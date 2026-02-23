#!/usr/bin/env node

// intranet-search CLI
// SSH + MySQL을 통해 사내 XE 인트라넷 게시판을 검색합니다.
// JSON 출력으로 OpenClaw 에이전트가 파싱 가능.

const { execFile } = require('child_process');
const http = require('http');

const SSH_HOST = 'intranet';
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const OLLAMA_MODEL = 'qwen3:14b-16k';
const MYSQL_CMD = String.raw`C:\xampp\mysql\bin\mysql.exe -u xe -pcomm7474 intranet --default-character-set=utf8`;

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

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
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

  // --detail: 내용을 가져온 뒤 ollama로 로컬 요약 (원본 데이터는 외부 모델에 노출하지 않음)
  if (args.detail && rows.length) {
    const contentPreviews = [];
    for (const row of rows) {
      const contentSql = `SELECT REPLACE(REPLACE(LEFT(content, 1000), CHAR(10), ' '), CHAR(13), ' ') AS preview FROM xe_documents WHERE document_srl=${row.document_srl};`;
      const contentOut = await runQuery(contentSql);
      const contentRows = parseTable(contentOut);
      const preview = contentRows.length ? stripHtml(contentRows[0].preview) : '';
      contentPreviews.push(`[${row.title}] (${formatDate(row.regdate)}, ${row.nick_name})\n${preview}`);
    }

    const prompt = `/no_think\n다음은 사내 인트라넷 게시판 검색 결과입니다. 검색 조건: ${queryDesc}\n\n${contentPreviews.join('\n\n---\n\n')}\n\n위 내용을 한국어로 간결하게 요약해주세요. 각 글의 핵심 내용을 2-3줄로 정리하세요.`;

    try {
      const summary = await ollamaSummarize(prompt);
      console.log(JSON.stringify({
        ok: true,
        command: 'search',
        board: args.board,
        query: queryDesc,
        count: rows.length,
        summary,
        note: '원본 데이터는 로컬에서 요약되었습니다. 이 요약만 반환됩니다.'
      }));
    } catch (err) {
      // ollama 실패 시 제목 목록만 반환 (내용 없이)
      console.log(JSON.stringify({
        ok: true,
        command: 'search',
        board: args.board,
        query: queryDesc,
        count: rows.length,
        results: rows.map(r => ({ title: r.title, nick_name: r.nick_name, regdate_formatted: formatDate(r.regdate) })),
        warning: 'ollama 요약 실패: ' + err.message
      }));
    }
  } else {
    // 목록만: 제목/작성자/날짜만 반환 (내용 없음)
    console.log(JSON.stringify({
      ok: true,
      command: 'search',
      board: args.board,
      query: queryDesc,
      count: rows.length,
      results: rows.map(r => ({
        document_srl: r.document_srl,
        title: r.title,
        nick_name: r.nick_name,
        regdate_formatted: formatDate(r.regdate)
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

주요 게시판: comm1(업무일지), comm22(제작정보), paper2025(공지사항), comm30(표지기록), comm35(디자인)`);
    process.exit(0);
  }

  try {
    if (cmd === 'list-boards') {
      await cmdListBoards();
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
