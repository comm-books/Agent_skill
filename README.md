# Agent_skill

[Pub_Agent](https://github.com/comm-books/Pub_Agent)용 스킬 모음.
`Pub_Agent/skills/` 폴더에 클론하여 사용합니다.

## 설치

```bash
cd <Pub_Agent>/skills/
git clone https://github.com/comm-books/Agent_skill.git .
```

## 스킬 목록

| Skill | 설명 | 의존성 |
|-------|------|--------|
| intranet-search | 사내 XE 인트라넷 게시판 검색 (SSH + MySQL), Google Chat 직접 전송 | Node.js, google-auth-library |
| gdrive-search | Google Drive 파일 검색/읽기 (OAuth 2.0, 사용자별) | 없음 (Agent_interface API 경유) |
| gmail-search | Gmail 이메일 검색/읽기 (OAuth 2.0, Drive와 통합 인증) | 없음 (Agent_interface API 경유) |

### gdrive-search

Google Drive 검색/읽기 스킬. Agent_interface(`localhost:4000`)의 API를 경유하여 동작합니다.

**사전 조건:**
- Agent_interface 서버 실행 중 (포트 4000)
- 사용자가 Agent_interface에서 Google Drive 로그인 완료
- CLI 호출 시 `--user <userId>` 필수 (사용자별 드라이브 분리)

**사용법:**
```bash
node skills/gdrive-search/cli.js status --user USER_ID
node skills/gdrive-search/cli.js search 검색어 --user USER_ID
node skills/gdrive-search/cli.js list --user USER_ID
node skills/gdrive-search/cli.js read 파일ID --user USER_ID
```

### gmail-search

Gmail 이메일 검색/읽기 스킬. Agent_interface(`localhost:4000`)의 API를 경유하여 동작합니다.
Google Drive와 통합 인증 — 한 번 로그인으로 Drive + Gmail 동시 사용 가능.

**사전 조건:**
- Agent_interface 서버 실행 중 (포트 4000)
- 사용자가 Agent_interface에서 Google 로그인 완료 (Drive + Gmail 통합)
- CLI 호출 시 `--user <userId>` 필수

**사용법:**
```bash
node skills/gmail-search/cli.js status --user USER_ID
node skills/gmail-search/cli.js list --user USER_ID
node skills/gmail-search/cli.js search 검색어 --user USER_ID
node skills/gmail-search/cli.js search --from sender@example.com --user USER_ID
node skills/gmail-search/cli.js search 회의 --after 2026-03-01 --before 2026-03-13 --user USER_ID
node skills/gmail-search/cli.js read 메시지ID --user USER_ID
```

## Pub_Agent Compatibility

스킬 업데이트 시 Pub_Agent의 `AGENTS.md`/`TOOLS.md`도 함께 업데이트해야 합니다.

| 이 리포 커밋 | 설명 | Pub_Agent 호환 커밋 |
|-------------|------|---------------------|
| `74be1ce` | feat: gmail-search 스킬 추가 | `1d78a18` |
| `a217e4f` | feat: gdrive-search 스킬 추가 | `9915f14` |
| `aa335e2` | fix: ollama 요약 제거, 원본 미리보기 반환 | `534be78` |
| `da16f5f` | docs: 호환 참조 테이블 추가 | `3036575` |
| `506cfa0` | feat: Google Chat 직접 전송 추가 | `438611a` |
| `072a904` | Initial commit: intranet-search skill | _(사전)_ |
