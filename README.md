# Agent_skill

[Pub_Agent](https://github.com/comm-books/Pub_Agent)용 스킬 모음.
`Pub_Agent/skills/` 폴더에 클론하여 사용합니다.

## 설치

```bash
cd <Pub_Agent>/skills/
git clone https://github.com/comm-books/Agent_skill.git .
```

## 스킬 목록

| Skill | 설명 |
|-------|------|
| intranet-search | 사내 XE 인트라넷 게시판 검색 (SSH + MySQL), Google Chat 직접 전송 |

## Pub_Agent Compatibility

스킬 업데이트 시 Pub_Agent의 `AGENTS.md`/`TOOLS.md`도 함께 업데이트해야 합니다.

| 이 리포 커밋 | 설명 | Pub_Agent 호환 커밋 |
|-------------|------|---------------------|
| `aa335e2` | fix: ollama 요약 제거, 원본 미리보기 반환 | `534be78` |
| `da16f5f` | docs: 호환 참조 테이블 추가 | `3036575` |
| `506cfa0` | feat: Google Chat 직접 전송 추가 | `438611a` |
| `072a904` | Initial commit: intranet-search skill | _(사전)_ |
