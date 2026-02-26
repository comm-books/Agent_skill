---
name: gdrive-search
version: 1.0.0
description: Google Drive 파일 검색 및 읽기
tags: [google-drive, search, documents, files]
tools: [Bash]
---

# Google Drive Search Agent

사용자의 Google Drive에서 파일을 검색하고, 문서 내용을 읽어옵니다.
OAuth 2.0 인증으로 사용자별 개인 드라이브에 접근합니다. 읽기 전용.

## 트리거 (이 스킬을 사용해야 하는 경우)

다음 키워드가 포함된 요청은 **반드시 이 스킬의 `cli.js`를 exec 도구로 실행**하세요.

- **구글 드라이브**, Google Drive, 드라이브 검색
- **문서 찾기**, 파일 찾기, 드라이브에서 찾아줘
- **구글 문서**, 구글 시트, 구글 프레젠테이션
- 드라이브에 있는 파일 내용 읽기

### 중요: --user 파라미터 필수

여러 사용자가 각자의 드라이브를 사용하므로, **반드시 `--user` 파라미터로 요청자의 user_id를 전달**하세요.
user_id는 현재 세션 키에서 추출합니다: `agent:local:web-{userId}` → `{userId}` 부분.

### 트리거 예시

| 사용자 요청 | 실행할 명령 |
|-------------|------------|
| "드라이브에서 회의록 찾아줘" | `node skills/gdrive-search/cli.js search 회의록 --user USER_ID` |
| "구글 드라이브에 에이전트 관련 파일 있어?" | `node skills/gdrive-search/cli.js search 에이전트 --user USER_ID` |
| "드라이브 최근 파일 보여줘" | `node skills/gdrive-search/cli.js list --user USER_ID` |
| "이 파일 내용 읽어줘" (fileId 알고 있을 때) | `node skills/gdrive-search/cli.js read <fileId> --user USER_ID` |
| "드라이브 연결됐어?" | `node skills/gdrive-search/cli.js status --user USER_ID` |

## 사전 조건

- Agent_interface(localhost:4000)에서 사용자가 Google Drive 로그인을 먼저 해야 합니다.
- 도구 탭 → 드라이브 버튼 → Google 로그인
- 연결 안 되어 있으면 CLI가 안내 메시지를 반환합니다.

## CLI 사용법

```bash
# 연결 상태 확인
node skills/gdrive-search/cli.js status

# 파일 검색
node skills/gdrive-search/cli.js search 검색어
node skills/gdrive-search/cli.js search 회의록 --folder 폴더ID

# 폴더 내용 목록
node skills/gdrive-search/cli.js list                  # 루트 폴더
node skills/gdrive-search/cli.js list 폴더ID           # 특정 폴더

# 파일 내용 읽기
node skills/gdrive-search/cli.js read 파일ID

# 파일 메타데이터
node skills/gdrive-search/cli.js info 파일ID
```

## 출력 형식 (JSON)

### search / list
```json
{
  "ok": true,
  "command": "search",
  "query": "회의록",
  "count": 5,
  "results": [
    {
      "id": "1abc...",
      "name": "2월 회의록",
      "type": "application/vnd.google-apps.document",
      "isFolder": false,
      "modified": "2026-02-26T10:00:00.000Z",
      "link": "https://docs.google.com/document/d/1abc.../edit"
    }
  ]
}
```

### read
```json
{
  "ok": true,
  "command": "read",
  "name": "2월 회의록",
  "mimeType": "application/vnd.google-apps.document",
  "contentLength": 1234,
  "truncated": false,
  "content": "문서 내용..."
}
```

## 지원 파일 형식

| Google 형식 | 읽기 방식 |
|-------------|-----------|
| Google Docs | 텍스트(plain text)로 변환 |
| Google Sheets | CSV로 변환 |
| Google Slides | 텍스트로 변환 |
| 텍스트 파일 (.txt, .csv 등) | 그대로 읽기 |
| 바이너리 파일 (PDF, 이미지 등) | 링크만 반환 |

## 에러 처리

CLI가 에러를 반환하면 다음 순서로 대처하세요:

| 에러 | 원인 | 대처 |
|------|------|------|
| `"needAuth": true` | 해당 사용자가 Google 로그인 안 함 | "Google Drive에 로그인이 필요합니다. localhost:4000 도구 탭에서 드라이브 → Google 로그인해주세요." |
| `"unauthorized"` | --user가 없거나 잘못됨 | 현재 세션의 userId 확인 후 --user 추가하여 재시도 |
| `"API 호출 실패"` | Agent_interface 서버 꺼져 있음 | "서버 연결 실패. localhost:4000이 실행 중인지 확인해주세요." |
| `"truncated": true` | 파일이 5000자 초과 | 사용자에게 잘렸음을 알리고 링크 제공 |

## 주의사항

- **읽기 전용**: 파일 수정/삭제/업로드 불가
- 파일 내용이 5000자를 초과하면 잘려서 출력됨 (`truncated: true`)
- 미연결 시 "Agent_interface에서 먼저 로그인해주세요" 메시지 반환
- OAuth 토큰은 Agent_interface의 SQLite DB에 저장되며 자동 갱신됨
