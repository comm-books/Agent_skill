---
name: intranet-search
version: 1.1.0
description: 사내 XpressEngine 인트라넷 게시판 검색 에이전트
tags: [intranet, search, database, xe, mysql]
tools: [Bash]
---

# Intranet Search Agent

사내 XpressEngine 기반 인트라넷(http://intranet.eeel.net/) 게시판의 글을 SSH + MySQL CLI로 검색합니다.

## 트리거 (이 스킬을 사용해야 하는 경우)

다음 키워드가 포함된 요청은 **반드시 이 스킬의 `cli.js`를 exec 도구로 실행**하세요.
memory_search나 다른 도구를 사용하지 마세요.

- **업무일지**, 업무 기록, 업무 내용
- **게시판** 검색, 게시글 검색, 인트라넷 검색
- **제작정보**, 표지기록, 디자인 기록, 공지사항
- 특정 사람의 글 검색 (예: "조수완 업무일지", "김원재가 쓴 글")
- 특정 날짜의 글 검색 (예: "저번주 업무일지", "2월 19일 글")

### 트리거 예시

| 사용자 요청 | 실행할 명령 |
|-------------|------------|
| "조수완 저번주 업무일지 알려줘" | `node cli.js search -b comm1 -a 조수완 --date-from 2026-02-16 --date-to 2026-02-22 --detail` |
| "이번달 조수완 업무내용 요약" | `node cli.js search -b comm1 -a 조수완 --date-from 2026-02-01 --date-to 2026-02-28 --detail` |
| "오늘 업무일지 누가 썼어?" | `node cli.js search -b comm1 -d 2026-02-23` |
| "출간 관련 글 검색해줘" | `node cli.js search -b comm1 -k 출간 --detail` |
| "게시판 목록 보여줘" | `node cli.js list-boards` |

**참고**: 내용 요약이 필요한 요청에는 반드시 `--detail`을 붙이세요. `--detail` 사용 시 내용은 로컬 AI(ollama)가 요약하며, 원본 데이터는 외부로 전송되지 않습니다. 응답에 최대 5분까지 걸릴 수 있습니다.

### 주의: memory_search 사용 금지

업무일지, 게시판, 인트라넷 관련 요청에는 memory_search를 사용하지 마세요.
memory_search는 이 에이전트의 과거 대화 기록만 검색하며, 사내 인트라넷 데이터에 접근할 수 없습니다.
**반드시 exec 도구로 `node skills/intranet-search/cli.js`를 실행**하세요.

## 접속 정보

- **SSH**: `ssh intranet` (Tailscale VPN, ~/.ssh/config 설정 완료)
- **MySQL CLI**: `C:\xampp\mysql\bin\mysql.exe -u xe -pcomm7474 intranet --default-character-set=utf8`
- **메인 테이블**: `xe_documents` (게시글), `xe_modules` (게시판 목록)
- **테이블 접두사**: `xe_`

## 쿼리 실행 방법

```bash
ssh intranet "C:\xampp\mysql\bin\mysql.exe -u xe -pcomm7474 intranet --default-character-set=utf8 -e \"SQL쿼리;\""
```

## 한글 검색 (필수)

SSH를 통해 한글을 전달하면 깨지므로 **반드시 HEX 인코딩** 사용:

```sql
-- '김원재' → UTF-8 HEX: EAB980EC9B90EC9EAC
WHERE nick_name = CONVERT(X'EAB980EC9B90EC9EAC' USING utf8)

-- LIKE 검색
WHERE title LIKE CONCAT('%%', CONVERT(X'HEX값' USING utf8), '%%')
```

Python으로 HEX 변환: `'김원재'.encode('utf-8').hex().upper()`

## xe_documents 주요 컬럼

| 컬럼 | 타입 | 용도 |
|------|------|------|
| document_srl | bigint | PK |
| module_srl | bigint | 게시판 ID (xe_modules.module_srl) |
| title | varchar(250) | 제목 |
| content | longtext | 본문 (HTML) |
| nick_name | varchar(80) | 작성자 닉네임 |
| regdate | varchar(14) | 등록일 (20260219180951 형식) |
| status | varchar(20) | 상태 (PUBLIC) |

## 검색 패턴

### 게시판 목록 조회
```sql
SELECT m.mid, m.browser_title FROM xe_modules m WHERE m.module='board' ORDER BY m.mid;
```

### 주요 게시판
| mid | module_srl | 이름 |
|-----|-----------|------|
| comm1 | 335099 | 업무일지 |
| comm22 | 335100 | 제작정보 |
| paper2025 | 3370219 | 공지사항 |
| comm30 | 335101 | 표지기록 |
| comm35 | 335102 | 디자인 |

### 날짜 검색
```sql
SELECT document_srl, title, nick_name, regdate
FROM xe_documents
WHERE module_srl=335099 AND regdate LIKE '20260219%' AND status='PUBLIC'
ORDER BY document_srl DESC;
```

### 작성자 검색
```sql
SELECT document_srl, title, nick_name, regdate
FROM xe_documents
WHERE module_srl=335099 AND nick_name = CONVERT(X'HEX값' USING utf8) AND status='PUBLIC'
ORDER BY document_srl DESC LIMIT 20;
```

### 키워드 검색 (제목 + 내용)
```sql
SELECT document_srl, title, nick_name, regdate
FROM xe_documents
WHERE module_srl=335099
  AND (title LIKE CONCAT('%%', CONVERT(X'HEX값' USING utf8), '%%')
       OR content LIKE CONCAT('%%', CONVERT(X'HEX값' USING utf8), '%%'))
  AND status='PUBLIC'
ORDER BY document_srl DESC LIMIT 20;
```

### 내용 미리보기
```sql
SELECT REPLACE(REPLACE(LEFT(content, 500), CHAR(10), ' '), CHAR(13), ' ')
FROM xe_documents WHERE document_srl=문서번호;
```

### 복합 검색 (작성자 + 날짜)
```sql
SELECT document_srl, title, nick_name, regdate
FROM xe_documents
WHERE module_srl=335099
  AND nick_name = CONVERT(X'HEX값' USING utf8)
  AND regdate LIKE '20260219%'
  AND status='PUBLIC'
ORDER BY document_srl DESC;
```

### 기간 검색
```sql
WHERE regdate BETWEEN '20260201000000' AND '20260220235959'
```

## 주의사항

- **읽기 전용**: SELECT만 사용. INSERT/UPDATE/DELETE 절대 금지
- **Apache/MySQL 서비스 절대 건드리지 않기**: 인트라넷이 운영 중
- content는 HTML 포함 — 출력 시 태그 제거 필요
- `%%`는 SSH 이스케이프를 위한 표기 (MySQL의 `%` 와일드카드)

## CLI 도구 (Node.js)

`cli.js`를 사용합니다. JSON 출력으로 에이전트가 파싱 가능합니다.

```bash
node skills/intranet-search/cli.js list-boards                              # 게시판 목록
node skills/intranet-search/cli.js search -b comm1 -d 2026-02-19           # 날짜 검색
node skills/intranet-search/cli.js search -b comm1 -a 김원재               # 작성자 검색
node skills/intranet-search/cli.js search -b comm1 -k 출간                 # 키워드 검색
node skills/intranet-search/cli.js search -b comm1 -k 출간 --detail        # 내용 미리보기
node skills/intranet-search/cli.js search -b comm1 --date-from 2026-02-01 --date-to 2026-02-20  # 기간 검색
```

### 출력 예시

```json
{
  "ok": true,
  "command": "search",
  "board": "comm1",
  "query": "작성자: 김원재",
  "count": 3,
  "results": [
    {
      "document_srl": "12345",
      "title": "2월 19일 업무일지",
      "nick_name": "김원재",
      "regdate": "20260219180951",
      "regdate_formatted": "2026-02-19 18:09"
    }
  ]
}
```

### 레거시 (Python)

`search.py`도 동일 기능을 제공하지만, 텍스트 출력 전용입니다.

## Pub_Agent Compatibility

이 스킬 리포는 [Pub_Agent](https://github.com/comm-books/Pub_Agent)의 AGENTS.md/TOOLS.md와 함께 사용됩니다.
스킬 업데이트 시 Pub_Agent 쪽도 함께 업데이트해야 합니다.

| 이 리포 커밋 | 설명 | Pub_Agent 호환 커밋 |
|-------------|------|---------------------|
| `506cfa0` | Google Chat 직접 전송, 패키지 설정 추가 | `438611a` |
| `072a904` | Initial commit: intranet-search skill | _(사전)_ |
