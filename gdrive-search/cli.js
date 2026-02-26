#!/usr/bin/env node
/**
 * gdrive-search CLI
 * Agent_interface API(localhost:4000)를 통해 Google Drive 검색/읽기
 * 의존성 없음 — Node.js 내장 fetch 사용
 *
 * Usage:
 *   node cli.js search <query>                    # 파일 검색
 *   node cli.js search <query> --folder <id>      # 특정 폴더 내 검색
 *   node cli.js list [folderId]                   # 폴더 내용 목록
 *   node cli.js read <fileId>                     # 파일 내용 읽기
 *   node cli.js status                            # 연결 상태 확인
 */

const BASE = "http://localhost:4000/api/gdrive";

// Agent_interface의 세션 쿠키를 가져오기 위해 쿠키 파일 사용
// 또는 내부 API이므로 인증을 스킵하는 헤더를 보냄
// --user 파라미터에서 사용자 ID 추출
function extractUser(args) {
  const idx = args.indexOf("--user");
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return null;
}

function getHeaders(userId) {
  const h = {
    "Content-Type": "application/json",
    "X-Skill-Token": "internal-skill-call",
  };
  if (userId) h["X-Skill-User"] = userId;
  return h;
}

async function apiGet(params, headers) {
  const url = `${BASE}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers });
  return res.json();
}

async function apiPost(body, headers) {
  const res = await fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const userId = extractUser(args);
  const headers = getHeaders(userId);

  if (!command || command === "help") {
    console.log(JSON.stringify({
      ok: true,
      commands: [
        "search <query> [--folder <id>] [--user <id>]  — 파일 검색",
        "list [folderId] [--user <id>]                  — 폴더 내용 목록",
        "read <fileId> [--user <id>]                    — 파일 내용 읽기",
        "status [--user <id>]                           — 연결 상태 확인",
      ],
      note: "--user를 지정하면 해당 사용자의 드라이브에 접근합니다.",
    }));
    return;
  }

  try {
    if (command === "status") {
      const data = await apiGet({ action: "status" }, headers);
      console.log(JSON.stringify({
        ok: true,
        connected: data.connected || false,
        message: data.connected
          ? "Google Drive 연결됨"
          : "Google Drive 미연결. Agent_interface(localhost:4000)에서 도구탭 → 드라이브 → Google 로그인을 먼저 해주세요.",
      }));

    } else if (command === "search") {
      const query = args[1] || "";
      const folderIdx = args.indexOf("--folder");
      const folderId = folderIdx >= 0 ? args[folderIdx + 1] : undefined;

      const params = { action: "search", q: query };
      if (folderId) params.folderId = folderId;

      const data = await apiGet(params, headers);
      if (!data.ok) {
        console.log(JSON.stringify({ ok: false, error: data.error, needAuth: data.needAuth }));
        return;
      }

      console.log(JSON.stringify({
        ok: true,
        command: "search",
        query,
        count: data.files.length,
        results: data.files.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.mimeType,
          modified: f.modifiedTime,
          link: f.webViewLink,
        })),
      }));

    } else if (command === "list") {
      const folderId = args[1] || undefined;
      const params = { action: "list" };
      if (folderId) params.folderId = folderId;

      const data = await apiGet(params, headers);
      if (!data.ok) {
        console.log(JSON.stringify({ ok: false, error: data.error, needAuth: data.needAuth }));
        return;
      }

      console.log(JSON.stringify({
        ok: true,
        command: "list",
        folderId: folderId || "root",
        count: data.files.length,
        results: data.files.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.mimeType,
          isFolder: f.mimeType === "application/vnd.google-apps.folder",
          modified: f.modifiedTime,
          link: f.webViewLink,
        })),
      }));

    } else if (command === "read") {
      const fileId = args[1];
      if (!fileId) {
        console.log(JSON.stringify({ ok: false, error: "fileId를 지정해주세요" }));
        return;
      }

      const data = await apiPost({ fileId }, headers);
      if (!data.ok) {
        console.log(JSON.stringify({ ok: false, error: data.error }));
        return;
      }

      // 내용이 너무 길면 자르기
      const maxLen = 5000;
      const content = data.content || "";
      const truncated = content.length > maxLen;

      console.log(JSON.stringify({
        ok: true,
        command: "read",
        name: data.name,
        mimeType: data.mimeType,
        contentLength: content.length,
        truncated,
        content: truncated ? content.slice(0, maxLen) : content,
      }));

    } else {
      console.log(JSON.stringify({ ok: false, error: `알 수 없는 명령: ${command}` }));
    }
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      error: `API 호출 실패: ${err.message}. Agent_interface(localhost:4000)가 실행 중인지 확인해주세요.`,
    }));
  }
}

main();
