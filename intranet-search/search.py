#!/usr/bin/env python3
"""사내 인트라넷 게시판 검색 도구"""

import argparse
import subprocess
import sys
import re
import json
from datetime import datetime


MYSQL_CMD = r'C:\xampp\mysql\bin\mysql.exe -u xe -pcomm7474 intranet --default-character-set=utf8'
SSH_HOST = 'intranet'


def to_hex(text):
    """한글 텍스트를 MySQL HEX 리터럴로 변환"""
    return text.encode('utf-8').hex().upper()


def run_query(sql):
    """SSH를 통해 MySQL 쿼리 실행"""
    cmd = f'{MYSQL_CMD} -e "{sql}"'
    result = subprocess.run(
        ['ssh', SSH_HOST, cmd],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        stderr = result.stderr.strip()
        # SSH 경고 메시지 필터링
        lines = [l for l in stderr.split('\n') if not l.startswith('**') and l.strip()]
        if lines:
            print(f"오류: {chr(10).join(lines)}", file=sys.stderr)
            sys.exit(1)
    return result.stdout.strip()


def parse_table(output):
    """MySQL 탭 구분 출력을 파싱"""
    if not output:
        return [], []
    lines = output.split('\n')
    headers = lines[0].split('\t')
    rows = []
    for line in lines[1:]:
        if line.strip():
            rows.append(line.split('\t'))
    return headers, rows


def format_date(regdate):
    """20260219180951 → 2026-02-19 18:09"""
    if len(regdate) >= 12:
        return f"{regdate[:4]}-{regdate[4:6]}-{regdate[6:8]} {regdate[8:10]}:{regdate[10:12]}"
    return regdate


def print_results(headers, rows, show_content=False):
    """결과를 보기 좋게 출력"""
    if not rows:
        print("검색 결과가 없습니다.")
        return

    print(f"\n총 {len(rows)}건\n")

    for row in rows:
        data = dict(zip(headers, row))
        date_str = format_date(data.get('regdate', ''))
        print(f"  [{data.get('document_srl', '')}] {data.get('title', '')}")
        print(f"  작성자: {data.get('nick_name', '')}  |  날짜: {date_str}")
        if show_content and 'content_preview' in data:
            content = data['content_preview']
            # HTML 태그 제거
            content = re.sub(r'<[^>]+>', '', content)
            content = content.replace('&nbsp;', ' ').replace('&lt;', '<').replace('&gt;', '>')
            content = re.sub(r'\s+', ' ', content).strip()
            if content:
                print(f"  내용: {content[:200]}...")
        print()


def build_where(args, module_srl):
    """WHERE 절 생성"""
    conditions = [f"module_srl={module_srl}", "status='PUBLIC'"]

    if args.date:
        date_str = args.date.replace('-', '')
        conditions.append(f"regdate LIKE '{date_str}%'")

    if args.date_from and args.date_to:
        date_from = args.date_from.replace('-', '') + '000000'
        date_to = args.date_to.replace('-', '') + '235959'
        conditions.append(f"regdate BETWEEN '{date_from}' AND '{date_to}'")

    if args.author:
        hex_val = to_hex(args.author)
        conditions.append(f"nick_name = CONVERT(X'{hex_val}' USING utf8)")

    if args.keyword:
        hex_val = to_hex(args.keyword)
        kw_expr = f"CONVERT(X'{hex_val}' USING utf8)"
        conditions.append(
            f"(title LIKE CONCAT('%%', {kw_expr}, '%%') OR content LIKE CONCAT('%%', {kw_expr}, '%%'))"
        )

    return ' AND '.join(conditions)


def get_module_srl(board_mid):
    """게시판 mid로 module_srl 조회"""
    sql = f"SELECT module_srl FROM xe_modules WHERE mid='{board_mid}' LIMIT 1;"
    output = run_query(sql)
    _, rows = parse_table(output)
    if not rows:
        print(f"게시판 '{board_mid}'을(를) 찾을 수 없습니다.", file=sys.stderr)
        sys.exit(1)
    return rows[0][0]


def cmd_list_boards(args):
    """게시판 목록 출력"""
    sql = "SELECT m.mid, m.browser_title, (SELECT COUNT(*) FROM xe_documents d WHERE d.module_srl=m.module_srl) AS cnt FROM xe_modules m WHERE m.module='board' ORDER BY cnt DESC LIMIT 50;"
    output = run_query(sql)
    headers, rows = parse_table(output)

    if not rows:
        print("게시판이 없습니다.")
        return

    print(f"\n{'게시판ID':<25} {'글 수':>8}  게시판명")
    print('-' * 70)
    for row in rows:
        data = dict(zip(headers, row))
        print(f"  {data['mid']:<23} {data['cnt']:>8}  {data['browser_title']}")
    print()


def cmd_search(args):
    """게시판 검색"""
    if not args.board:
        print("--board 옵션이 필요합니다. (예: --board comm1)", file=sys.stderr)
        print("게시판 목록: python search.py --list-boards", file=sys.stderr)
        sys.exit(1)

    module_srl = get_module_srl(args.board)

    where = build_where(args, module_srl)
    limit = args.limit or 20

    fields = "document_srl, title, nick_name, regdate"
    sql = f"SELECT {fields} FROM xe_documents WHERE {where} ORDER BY document_srl DESC LIMIT {limit};"
    output = run_query(sql)
    headers, rows = parse_table(output)

    # --detail: 각 글의 content를 개별 쿼리로 가져오기
    if args.detail and rows:
        headers.append('content_preview')
        for row in rows:
            doc_srl = row[0]
            content_sql = f"SELECT REPLACE(REPLACE(LEFT(content, 500), CHAR(10), ' '), CHAR(13), ' ') FROM xe_documents WHERE document_srl={doc_srl};"
            content_out = run_query(content_sql)
            content_lines = content_out.split('\n')
            content = content_lines[1] if len(content_lines) > 1 else ''
            row.append(content)

    board_name = args.board
    # 검색 조건 요약
    desc_parts = []
    if args.date:
        desc_parts.append(f"날짜: {args.date}")
    if args.date_from and args.date_to:
        desc_parts.append(f"기간: {args.date_from} ~ {args.date_to}")
    if args.author:
        desc_parts.append(f"작성자: {args.author}")
    if args.keyword:
        desc_parts.append(f"키워드: {args.keyword}")

    desc = ', '.join(desc_parts) if desc_parts else '최근 글'
    print(f"\n[{board_name}] {desc}")
    print_results(headers, rows, show_content=args.detail)


def main():
    parser = argparse.ArgumentParser(description='사내 인트라넷 게시판 검색')

    parser.add_argument('--list-boards', action='store_true', help='게시판 목록 조회')
    parser.add_argument('--board', '-b', help='게시판 ID (예: comm1)')
    parser.add_argument('--date', '-d', help='날짜 검색 (예: 2026-02-19)')
    parser.add_argument('--date-from', help='시작 날짜 (예: 2026-02-01)')
    parser.add_argument('--date-to', help='종료 날짜 (예: 2026-02-20)')
    parser.add_argument('--author', '-a', help='작성자 검색 (예: 김원재)')
    parser.add_argument('--keyword', '-k', help='키워드 검색 (제목+내용)')
    parser.add_argument('--detail', action='store_true', help='내용 미리보기 포함')
    parser.add_argument('--limit', '-l', type=int, default=20, help='결과 수 (기본: 20)')

    args = parser.parse_args()

    if args.list_boards:
        cmd_list_boards(args)
    else:
        cmd_search(args)


if __name__ == '__main__':
    main()
