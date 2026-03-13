---
name: gmail-search
version: 1.0.0
description: Gmail 이메일 검색 및 읽기
tags: [gmail, email, search, google]
tools: [Bash]
---

# Gmail Search Agent

사용자의 Gmail에서 이메일을 검색하고, 메일 내용을 읽어옵니다.
OAuth 2.0 인증으로 사용자별 개인 Gmail에 접근합니다. 읽기 전용.

## 트리거 (이 스킬을 사용해야 하는 경우)

다음 키워드가 포함된 요청은 **반드시 이 스킬의 `cli.js`를 exec 도구로 실행**하세요.

- **이메일**, 메일, email, Gmail
- **메일 검색**, 메일 찾기, 메일 확인
- **받은 메일**, 보낸 메일, 최근 메일
- 특정 사람이 보낸 메일, 특정 기간 메일

### 중요: --user 파라미터 필수

여러 사용자가 각자의 Gmail을 사용하므로, **반드시 `--user` 파라미터로 요청자의 user_id를 전달**하세요.
user_id는 현재 세션 키에서 추출합니다: `agent:local:web-{userId}` → `{userId}` 부분.

### 트리거 예시

| 사용자 요청 | 실행할 명령 |
|-------------|------------|
| "최근 메일 보여줘" | `node skills/gmail-search/cli.js list --user USER_ID` |
| "회의 관련 메일 찾아줘" | `node skills/gmail-search/cli.js search 회의 --user USER_ID` |
| "김대리가 보낸 메일 찾아줘" | `node skills/gmail-search/cli.js search --from 김대리 --user USER_ID` |
| "이번 주 받은 메일" | `node skills/gmail-search/cli.js search --after 2026-03-09 --user USER_ID` |
| "3월 1일부터 10일까지 프로젝트 관련 메일" | `node skills/gmail-search/cli.js search 프로젝트 --after 2026-03-01 --before 2026-03-10 --user USER_ID` |
| "이 메일 내용 보여줘" | `node skills/gmail-search/cli.js read <messageId> --user USER_ID` |

## 사전 조건

- Agent_interface(localhost:4000)에서 사용자가 Google 로그인을 먼저 해야 합니다.
- 도구 탭 → 드라이브 버튼 → Google 로그인 (Drive + Gmail 통합 인증)
- 연결 안 되어 있으면 CLI가 안내 메시지를 반환합니다.

## CLI 사용법

```bash
# 연결 상태 확인
node skills/gmail-search/cli.js status --user USER_ID

# 최근 메일 목록
node skills/gmail-search/cli.js list --user USER_ID
node skills/gmail-search/cli.js list --max 10 --user USER_ID

# 메일 검색
node skills/gmail-search/cli.js search 검색어 --user USER_ID
node skills/gmail-search/cli.js search --from sender@example.com --user USER_ID
node skills/gmail-search/cli.js search 회의 --after 2026-03-01 --before 2026-03-13 --user USER_ID

# 메일 내용 읽기
node skills/gmail-search/cli.js read 메시지ID --user USER_ID
```

## 출력 형식 (JSON)

### list / search
```json
{
  "ok": true,
  "command": "search",
  "query": "회의",
  "count": 5,
  "results": [
    {
      "id": "18e1234abc",
      "subject": "3월 회의록",
      "from": "김대리 <kim@example.com>",
      "to": "me@example.com",
      "date": "Thu, 13 Mar 2026 10:00:00 +0900",
      "snippet": "3월 프로젝트 회의 내용입니다...",
      "hasAttachments": false
    }
  ]
}
```

### read
```json
{
  "ok": true,
  "command": "read",
  "subject": "3월 회의록",
  "from": "김대리 <kim@example.com>",
  "to": "me@example.com",
  "date": "Thu, 13 Mar 2026 10:00:00 +0900",
  "contentLength": 1234,
  "truncated": false,
  "body": "메일 본문..."
}
```

## 검색 옵션

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--from <sender>` | 발신자 필터 | `--from kim@example.com` |
| `--after <date>` | 이후 날짜 | `--after 2026-03-01` |
| `--before <date>` | 이전 날짜 | `--before 2026-03-13` |
| `--max <n>` | 최대 결과 수 (기본 20) | `--max 10` |
| `--user <id>` | 사용자 ID | `--user user123` |

## 에러 처리

| 에러 | 원인 | 대처 |
|------|------|------|
| `"needAuth": true` | 해당 사용자가 Google 로그인 안 함 | "Gmail에 로그인이 필요합니다. localhost:4000 도구 탭에서 드라이브 → Google 로그인해주세요." |
| `"unauthorized"` | --user가 없거나 잘못됨 | 현재 세션의 userId 확인 후 --user 추가하여 재시도 |
| `"API 호출 실패"` | Agent_interface 서버 꺼져 있음 | "서버 연결 실패. localhost:4000이 실행 중인지 확인해주세요." |
| `"truncated": true` | 메일이 5000자 초과 | 사용자에게 잘렸음을 알리기 |

## 주의사항

- **읽기 전용**: 메일 전송/삭제/수정 불가
- 메일 본문이 5000자를 초과하면 잘려서 출력됨 (`truncated: true`)
- 미연결 시 "Agent_interface에서 먼저 로그인해주세요" 메시지 반환
- OAuth 토큰은 Agent_interface의 SQLite DB에 저장되며 자동 갱신됨
- Google Drive 인증과 통합되어 있음 (한 번 로그인으로 Drive + Gmail 동시 사용)
