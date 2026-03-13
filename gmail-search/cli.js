#!/usr/bin/env node
/**
 * gmail-search CLI
 * Agent_interface API(localhost:4000)를 통해 Gmail 검색/읽기
 * 의존성 없음 — Node.js 내장 fetch 사용
 *
 * Usage:
 *   node cli.js search <query> [--from <sender>] [--after <date>] [--before <date>] [--max <n>] [--user <id>]
 *   node cli.js list [--max <n>] [--user <id>]
 *   node cli.js read <messageId> [--user <id>]
 *   node cli.js status [--user <id>]
 */

const BASE = "http://localhost:4000/api/gmail";

function extractArg(args, flag) {
  const idx = args.indexOf(flag);
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
  const userId = extractArg(args, "--user");
  const headers = getHeaders(userId);

  if (!command || command === "help") {
    console.log(JSON.stringify({
      ok: true,
      commands: [
        "search <query> [--from <sender>] [--after <date>] [--before <date>] [--max <n>] [--user <id>]  — 메일 검색",
        "list [--max <n>] [--user <id>]                                                                  — 최근 메일 목록",
        "read <messageId> [--user <id>]                                                                  — 메일 내용 읽기",
        "status [--user <id>]                                                                            — 연결 상태 확인",
      ],
      note: "--user를 지정하면 해당 사용자의 Gmail에 접근합니다.",
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
          ? "Gmail 연결됨"
          : "Gmail 미연결. Agent_interface(localhost:4000)에서 도구탭 → 드라이브 → Google 로그인을 먼저 해주세요.",
      }));

    } else if (command === "search") {
      // 첫 번째 인자 중 --로 시작하지 않는 것이 쿼리
      const queryParts = [];
      for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith("--")) {
          i++; // skip flag value
          continue;
        }
        queryParts.push(args[i]);
      }
      const query = queryParts.join(" ");

      const from = extractArg(args, "--from");
      const after = extractArg(args, "--after");
      const before = extractArg(args, "--before");
      const max = extractArg(args, "--max");

      const params = { action: "search", q: query };
      if (from) params.from = from;
      if (after) params.after = after;
      if (before) params.before = before;
      if (max) params.max = max;

      const data = await apiGet(params, headers);
      if (!data.ok) {
        console.log(JSON.stringify({ ok: false, error: data.error, needAuth: data.needAuth }));
        return;
      }

      console.log(JSON.stringify({
        ok: true,
        command: "search",
        query,
        filters: { from, after, before },
        count: data.messages.length,
        results: data.messages.map((m) => ({
          id: m.id,
          subject: m.subject,
          from: m.from,
          to: m.to,
          date: m.date,
          snippet: m.snippet,
          hasAttachments: m.hasAttachments,
        })),
      }));

    } else if (command === "list") {
      const max = extractArg(args, "--max");
      const params = { action: "list" };
      if (max) params.max = max;

      const data = await apiGet(params, headers);
      if (!data.ok) {
        console.log(JSON.stringify({ ok: false, error: data.error, needAuth: data.needAuth }));
        return;
      }

      console.log(JSON.stringify({
        ok: true,
        command: "list",
        count: data.messages.length,
        results: data.messages.map((m) => ({
          id: m.id,
          subject: m.subject,
          from: m.from,
          to: m.to,
          date: m.date,
          snippet: m.snippet,
          hasAttachments: m.hasAttachments,
        })),
      }));

    } else if (command === "read") {
      const messageId = args[1];
      if (!messageId || messageId.startsWith("--")) {
        console.log(JSON.stringify({ ok: false, error: "messageId를 지정해주세요" }));
        return;
      }

      const data = await apiPost({ messageId }, headers);
      if (!data.ok) {
        console.log(JSON.stringify({ ok: false, error: data.error }));
        return;
      }

      const msg = data.message;
      const maxLen = 5000;
      const body = msg.body || "";
      const truncated = body.length > maxLen;

      console.log(JSON.stringify({
        ok: true,
        command: "read",
        id: msg.id,
        subject: msg.subject,
        from: msg.from,
        to: msg.to,
        date: msg.date,
        labels: msg.labels,
        hasAttachments: msg.hasAttachments,
        contentLength: body.length,
        truncated,
        body: truncated ? body.slice(0, maxLen) : body,
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
