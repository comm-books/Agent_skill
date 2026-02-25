#!/usr/bin/env node

// intranet-search CLI
// SSH + MySQL을 통해 사내 XE 인트라넷 게시판을 검색합니다.
// JSON 출력으로 OpenClaw 에이전트가 파싱 가능.
// --direct-send: Google Chat으로 직접 전송 (민감 데이터가 외부 LLM을 거치지 않음)

const { execFile } = require('child_process');
const http = require('http');
const https = require('https');
const path = require('path');
const os = require('os');

const SSH_HOST = 'intranet';
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const OLLAMA_MODEL = 'qwen3:14b-16k';
const MYSQL_CMD = String.raw`C:\xampp\mysql\bin\mysql.exe -u xe -pcomm7474 intranet --default-character-set=utf8`;
const SERVICE_ACCOUNT_PATH = path.join(os.homedir(), '.openclaw/googlechat-service-account.json');
const GCHAT_API = 'https://chat.googleapis.com/v1';

function toHex(text) {
  return Buffer.from(text, 'utf8').toString('hex').toUpperCase();
}

function runQuery(sql) {
  return new Promise((resolve, reject) => {
    const cmd = `${MYSQL_CMD} -e "${sql}"`;
    execFile('ssh', [SSH_HOST, cmd], { encoding: 'utf8', timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        const lines = (stderr || '').split('\n').filter(l => !l.startsWith('**') && l.trim());
        if (lines.length) return reject(new Error(lines.join('\n')));
        return reject(err);
      }
      resolve(stdout.trim());
    });
  });
}

function parseTable(output) {
  if (!output) return [];
  const lines = output.replace(/\r/g, '').split('\n');
  const headers = lines[0].split('\t');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (cols[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function formatDate(regdate) {
  if (regdate && regdate.length >= 12) {
    return `${regdate.slice(0,4)}-${regdate.slice(4,6)}-${regdate.slice(6,8)} ${regdate.slice(8,10)}:${regdate.slice(10,12)}`;
  }
  return regdate || '';
}

function stripHtml(html, preserveNewlines = false) {
  let text = (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  if (preserveNewlines) {
    // 연속 빈 줄 3개 이상 → 2개로
    text = text.replace(/\n{3,}/g, '\n\n').trim();
  } else {
    text = text.replace(/\s+/g, ' ').trim();
  }
  return text;
}

function ollamaSummarize(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { num_predict: 1024, temperature: 0.3 }
    });
    const url = new URL(OLLAMA_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 300000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.response || '');
        } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ollama timeout')); });
    req.write(body);
    req.end();
  });
}

// --- Google Chat 직접 전송 ---

const fs = require('fs');
const SPACE_MAP_PATH = path.join(__dirname, 'gchat-space-map.json');

async function getGoogleChatToken() {
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/chat.bot']
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

function gchatRequest(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, GCHAT_API);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            return reject(new Error(`Google Chat API ${res.statusCode}: ${json.error?.message || data}`));
          }
          resolve(json);
        } catch { reject(new Error(`Google Chat API parse error: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Google Chat API timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// spaces.list → 멤버 조회 → displayName 매핑 자동 생성
async function buildSpaceMap(token) {
  const spacesResult = await gchatRequest('GET', '/v1/spaces?pageSize=100', token);
  const spaces = spacesResult.spaces || [];
  const dmSpaces = spaces.filter(s => s.singleUserBotDm || s.type === 'DM');

  const map = {};
  for (const space of dmSpaces) {
    try {
      const membersResult = await gchatRequest('GET', `/v1/${space.name}/members?pageSize=10`, token);
      const humans = (membersResult.memberships || []).filter(m => m.member?.type === 'HUMAN');
      for (const m of humans) {
        const name = m.member.displayName;
        const userId = m.member.name; // users/xxxxx
        if (name) map[name] = space.name;
        if (userId) map[userId] = space.name;
      }
    } catch { /* skip inaccessible spaces */ }
  }

  // 캐시 저장
  fs.writeFileSync(SPACE_MAP_PATH, JSON.stringify(map, null, 2));
  return map;
}

function loadSpaceMap() {
  try {
    return JSON.parse(fs.readFileSync(SPACE_MAP_PATH, 'utf8'));
  } catch { return null; }
}

async function resolveSpace(token, target) {
  // spaces/xxx 형태면 바로 사용
  if (target.startsWith('spaces/')) return target;

  // 캐시된 매핑에서 찾기
  let map = loadSpaceMap();
  if (map && map[target]) return map[target];

  // 캐시 미스 → 새로 빌드
  map = await buildSpaceMap(token);
  if (map[target]) return map[target];

  throw new Error(`Google Chat space를 찾을 수 없습니다: ${target}. 'node cli.js sync-spaces'로 매핑을 갱신하세요.`);
}

async function sendGoogleChatMessage(token, space, text) {
  return await gchatRequest('POST', `/v1/${space}/messages`, token, { text });
}

// --- 인자 파싱 ---

function parseArgs(argv) {
  const args = { _: [] };
  let currentKey = null;
  for (const token of argv) {
    if (token.startsWith('--')) {
      currentKey = token.slice(2);
      args[currentKey] = true;
    } else if (token.startsWith('-') && token.length === 2) {
      const shortMap = { b: 'board', d: 'date', a: 'author', k: 'keyword', l: 'limit' };
      currentKey = shortMap[token[1]] || token.slice(1);
      args[currentKey] = true;
    } else if (currentKey) {
      args[currentKey] = token;
      currentKey = null;
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function getModuleSrl(boardMid) {
  const sql = `SELECT module_srl FROM xe_modules WHERE mid='${boardMid}' LIMIT 1;`;
  const output = await runQuery(sql);
  const rows = parseTable(output);
  if (!rows.length) throw new Error(`게시판 '${boardMid}'을(를) 찾을 수 없습니다.`);
  return rows[0].module_srl;
}

async function cmdListBoards() {
  const sql = "SELECT m.mid, m.browser_title, (SELECT COUNT(*) FROM xe_documents d WHERE d.module_srl=m.module_srl) AS cnt FROM xe_modules m WHERE m.module='board' ORDER BY cnt DESC LIMIT 50;";
  const output = await runQuery(sql);
  const rows = parseTable(output);
  console.log(JSON.stringify({ ok: true, command: 'list-boards', boards: rows }));
}

async function cmdSearch(args) {
  if (!args.board) {
    console.log(JSON.stringify({ ok: false, error: '--board 옵션이 필요합니다. (예: --board comm1)' }));
    process.exit(1);
  }

  const directSend = args['direct-send'] === true;
  const sendTarget = args['user'] || args['user-email'] || args['space'];

  if (directSend && !sendTarget) {
    console.log(JSON.stringify({ ok: false, error: '--direct-send 사용 시 --user(이름) 또는 --space(spaces/xxx)가 필요합니다.' }));
    process.exit(1);
  }

  const moduleSrl = await getModuleSrl(args.board);
  const conditions = [`module_srl=${moduleSrl}`, "status='PUBLIC'"];

  if (args.date) {
    const dateStr = args.date.replace(/-/g, '');
    conditions.push(`regdate LIKE '${dateStr}%'`);
  }

  if (args['date-from'] && args['date-to']) {
    const from = args['date-from'].replace(/-/g, '') + '000000';
    const to = args['date-to'].replace(/-/g, '') + '235959';
    conditions.push(`regdate BETWEEN '${from}' AND '${to}'`);
  }

  if (args.author) {
    const hex = toHex(args.author);
    conditions.push(`nick_name = CONVERT(X'${hex}' USING utf8)`);
  }

  if (args.keyword) {
    const hex = toHex(args.keyword);
    const kwExpr = `CONVERT(X'${hex}' USING utf8)`;
    conditions.push(`(title LIKE CONCAT('%%', ${kwExpr}, '%%') OR content LIKE CONCAT('%%', ${kwExpr}, '%%'))`);
  }

  const where = conditions.join(' AND ');
  const limit = parseInt(args.limit, 10) || 20;

  const sql = `SELECT document_srl, title, nick_name, regdate FROM xe_documents WHERE ${where} ORDER BY document_srl DESC LIMIT ${limit};`;
  const output = await runQuery(sql);
  let rows = parseTable(output);

  // 날짜 포맷 변환
  rows = rows.map(r => ({ ...r, regdate_formatted: formatDate(r.regdate) }));

  const desc = [];
  if (args.date) desc.push(`날짜: ${args.date}`);
  if (args['date-from'] && args['date-to']) desc.push(`기간: ${args['date-from']} ~ ${args['date-to']}`);
  if (args.author) desc.push(`작성자: ${args.author}`);
  if (args.keyword) desc.push(`키워드: ${args.keyword}`);
  const queryDesc = desc.length ? desc.join(', ') : '최근 글';

  // --direct-send: Google Chat으로 직접 전송 (LLM 불필요, DB 원본 그대로)
  if (directSend && rows.length) {
    // --detail: 본문 내용도 가져와서 전송
    if (args.detail) {
      const contentBlocks = [];
      for (const row of rows) {
        const contentSql = `SELECT content FROM xe_documents WHERE document_srl=${row.document_srl};`;
        const contentOut = await runQuery(contentSql);
        const contentRows = parseTable(contentOut);
        const content = contentRows.length ? stripHtml(contentRows[0].content, true) : '';
        contentBlocks.push(`📝 ${row.title}\n👤 ${row.nick_name} | 📅 ${formatDate(row.regdate)}\n\n${content}`);
      }

      try {
        const token = await getGoogleChatToken();
        const space = await resolveSpace(token, sendTarget);

        // Google Chat 메시지 4096자 제한 → 글별로 분할 전송
        // space당 1건/초 rate limit → 1.1초 딜레이
        const delay = (ms) => new Promise(r => setTimeout(r, ms));
        const header = `📋 인트라넷 검색 결과 (${queryDesc}) — ${rows.length}건`;
        await sendGoogleChatMessage(token, space, header);

        for (const block of contentBlocks) {
          // 4000자 단위로 분할 (줄바꿈 기준으로 끊기)
          let remaining = block;
          while (remaining.length > 0) {
            await delay(1100);
            if (remaining.length <= 4000) {
              await sendGoogleChatMessage(token, space, remaining);
              break;
            }
            // 4000자 이내에서 마지막 줄바꿈 위치로 끊기
            let cutAt = remaining.lastIndexOf('\n', 4000);
            if (cutAt < 500) cutAt = 4000; // 줄바꿈이 너무 앞에 있으면 그냥 자르기
            await sendGoogleChatMessage(token, space, remaining.slice(0, cutAt));
            remaining = remaining.slice(cutAt).trimStart();
          }
        }

        console.log(JSON.stringify({
          ok: true, command: 'search', directSend: true,
          board: args.board, query: queryDesc, count: rows.length,
          status: 'sent',
          note: 'DB 원본이 Google Chat으로 직접 전송되었습니다.'
        }));
      } catch (sendErr) {
        console.log(JSON.stringify({ ok: false, directSend: true, error: 'Google Chat 전송 실패: ' + sendErr.message }));
      }
      return;
    }

    // --detail 없음: 제목 목록만 전송
    try {
      const token = await getGoogleChatToken();
      const space = await resolveSpace(token, sendTarget);
      const titleList = rows.map(r => `• ${r.title} (${formatDate(r.regdate)}, ${r.nick_name})`).join('\n');
      await sendGoogleChatMessage(token, space, `📋 인트라넷 검색 결과 (${queryDesc}) — ${rows.length}건\n\n${titleList}`);
      console.log(JSON.stringify({
        ok: true, command: 'search', directSend: true,
        board: args.board, query: queryDesc, count: rows.length, status: 'sent'
      }));
    } catch (sendErr) {
      console.log(JSON.stringify({ ok: false, directSend: true, error: 'Google Chat 전송 실패: ' + sendErr.message }));
    }
    return;
  }

  // --direct-send + 결과 없음
  if (directSend && !rows.length) {
    try {
      const token = await getGoogleChatToken();
      const space = await resolveSpace(token, sendTarget);
      await sendGoogleChatMessage(token, space, `📋 인트라넷 검색 결과 (${queryDesc})\n\n결과 없음`);
      console.log(JSON.stringify({
        ok: true, command: 'search', directSend: true,
        board: args.board, query: queryDesc, count: 0, status: 'sent'
      }));
    } catch (sendErr) {
      console.log(JSON.stringify({ ok: false, directSend: true, error: 'Google Chat 전송 실패: ' + sendErr.message }));
    }
    return;
  }

  // --- 기존 모드 (direct-send 아닐 때) ---

  if (args.detail && rows.length) {
    // --detail: 본문 미리보기 포함 (ollama 없이 원본 반환)
    const contentPreviews = [];
    for (const row of rows) {
      const contentSql = `SELECT REPLACE(REPLACE(LEFT(content, 1000), CHAR(10), ' '), CHAR(13), ' ') AS preview FROM xe_documents WHERE document_srl=${row.document_srl};`;
      const contentOut = await runQuery(contentSql);
      const contentRows = parseTable(contentOut);
      const preview = contentRows.length ? stripHtml(contentRows[0].preview) : '';
      contentPreviews.push({
        document_srl: row.document_srl, title: row.title,
        nick_name: row.nick_name, regdate_formatted: formatDate(row.regdate),
        preview
      });
    }
    console.log(JSON.stringify({
      ok: true, command: 'search', board: args.board, query: queryDesc,
      count: rows.length, results: contentPreviews
    }));
  } else {
    // 목록만
    console.log(JSON.stringify({
      ok: true, command: 'search', board: args.board, query: queryDesc,
      count: rows.length,
      results: rows.map(r => ({
        document_srl: r.document_srl, title: r.title,
        nick_name: r.nick_name, regdate_formatted: formatDate(r.regdate)
      }))
    }));
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`Usage:
  node cli.js list-boards
  node cli.js search -b comm1 -d 2026-02-19
  node cli.js search -b comm1 -a 김원재
  node cli.js search -b comm1 -k 출간 --detail
  node cli.js search -b comm1 --date-from 2026-02-01 --date-to 2026-02-20

  # Google Chat 직접 전송 (민감 데이터 보호)
  node cli.js search -b comm1 -a 조수완 --detail --direct-send --user 조수완
  node cli.js search -b comm1 -a 조수완 --detail --direct-send --space spaces/AAAA...

  # Google Chat space 매핑 갱신
  node cli.js sync-spaces

주요 게시판: comm1(업무일지), comm22(제작정보), paper2025(공지사항), comm30(표지기록), comm35(디자인)`);
    process.exit(0);
  }

  try {
    if (cmd === 'list-boards') {
      await cmdListBoards();
    } else if (cmd === 'sync-spaces') {
      const token = await getGoogleChatToken();
      const map = await buildSpaceMap(token);
      console.log(JSON.stringify({ ok: true, command: 'sync-spaces', map }));
    } else if (cmd === 'search') {
      await cmdSearch(args);
    } else {
      console.log(JSON.stringify({ ok: false, error: `알 수 없는 명령: ${cmd}` }));
      process.exit(1);
    }
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err.message || String(err) }));
    process.exit(1);
  }
}

main();
