// 테스트 공용 도구: 임시 서버 실행, WebSocket 클라이언트, 간단한 assert
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// GitHub Actions 에서는 실패를 화면 위 오류 표시(annotation)로도 남긴다 (실행 기록을 열지 않아도 보이게)
const CI = !!process.env.GITHUB_ACTIONS;
const annotate = text => { if (CI) console.log(`::error::${String(text).replace(/\r?\n/g, '%0A').slice(0, 3000)}`); };
if (CI) {
  const orig = console.error.bind(console);
  console.error = (...a) => { orig(...a); annotate(a.map(x => (x && x.stack) || String(x)).join(' ')); };
}

let failures = 0;
export function check(cond, label, detail = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${!cond && detail ? `  → ${detail}` : ''}`);
  if (!cond) { failures++; annotate(`${label}${detail ? ' → ' + detail : ''}`); }
}
export const failed = () => failures;

// 임시 서버를 빈 포트에서 띄운다 (라이브/개발 서버와 절대 겹치지 않도록 무작위 포트)
export async function startServer(extraEnv = {}) {
  const port = 3200 + Math.floor(Math.random() * 700);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), APP_ENV: 'test', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 50; i++) {
    if (log.includes('서버 실행 중')) break;
    if (child.exitCode !== null) throw new Error('서버가 바로 종료됨:\n' + log);
    await sleep(100);
  }
  if (!log.includes('서버 실행 중')) { child.kill(); throw new Error('서버 시작 시간 초과:\n' + log); }
  return { port, child, stop: () => child.kill() };
}

// 테스트 클라이언트가 들고 들어가는 무기 (명중 테스트가 AWM 과 M9 을 쓴다)
export const TEST_LOADOUT = [{ id: 'awm', parts: {} }, { id: 'm9', parts: {} }];

// 메시지를 모아 두고 조건을 기다릴 수 있는 클라이언트. 기본은 개인전. extra: join 메시지에 더할 값 (예: { loadout }, { mode })
export function connect(port, name, extra = {}) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const c = { ws, me: -1, msgs: [], players: new Map(), autoRespawn: true }; // autoRespawn: 죽으면 1.7초 뒤 부활 요청
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'welcome') { c.me = m.id; m.players.forEach(p => c.players.set(p.id, p)); }
    if (m.t === 'pj') c.players.set(m.player.id, m.player);
    if (m.t === 'pl') c.players.delete(m.id);
    if (m.t === 'kill' && m.victim === c.me && c.autoRespawn) setTimeout(() => { if (ws.readyState === 1) c.send({ t: 'respawn' }); }, 1700);
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.count = t => c.msgs.filter(m => m.t === t).length;
  c.find = (t, fn = () => true) => c.msgs.find(m => m.t === t && fn(m));
  c.waitFor = async (t, fn = () => true, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const m = c.find(t, fn); if (m) return m; await sleep(50); }
    return null;
  };
  c.open = new Promise((res, rej) => { ws.on('open', () => { c.send({ t: 'join', name, mode: 'ffa', loadout: TEST_LOADOUT, ...extra }); res(); }); ws.on('error', rej); });
  return c;
}

export async function getStatus(port) {
  const r = await fetch(`http://localhost:${port}/status`);
  return r.json();
}
