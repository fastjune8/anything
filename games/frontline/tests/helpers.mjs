// 테스트 공용 도구: 임시 서버 실행, WebSocket 클라이언트, 간단한 assert
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { WEAPONS } from '../shared/weapons.js';

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
    cwd: ROOT, env: { ...process.env, PORT: String(port), APP_ENV: 'test', PERSIST: 'off', FORCE_MAP: 'courtyard', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'],
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

export const W = id => WEAPONS.findIndex(w => w.id === id);

// 새 프로토콜 클라이언트: 연결하면 hello (손님 계정). 메시지를 모아 두고 조건을 기다릴 수 있다.
//   c.events(e) = 받은 'ev' 묶음 안의 사건들 중 e 종류
export function connect(port, name, token = undefined) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const c = { ws, me: -1, msgs: [], seq: 0, acc: null };
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'hi') c.acc = m.me;
    if (m.t === 'welcome') c.me = m.id;
  });
  c.send = m => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  c.find = (t, fn = () => true) => c.msgs.find(m => m.t === t && fn(m));
  c.all = (t, fn = () => true) => c.msgs.filter(m => m.t === t && fn(m));
  c.events = (e, fn = () => true) => c.msgs.filter(m => m.t === 'ev').flatMap(m => m.l).filter(x => x.e === e && fn(x));
  c.waitFor = async (t, fn = () => true, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const m = c.find(t, fn); if (m) return m; await sleep(30); }
    return null;
  };
  c.waitEvent = async (e, fn = () => true, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const x = c.events(e, fn)[0]; if (x) return x; await sleep(30); }
    return null;
  };
  // 1/60초 입력 n 개 보내기: [앞뒤, 좌우, 버튼, yaw, pitch, 자리, 화면 시각]
  c.cmds = (list) => { c.send({ t: 'cmd', s: c.seq, c: list }); c.seq += list.length; };
  // 브라우저처럼 실제 시간에 맞춰 1/30초마다 2개씩 (서버는 흐른 시간만큼만 입력을 받는다)
  c.play = async (list) => { for (let i = 0; i < list.length; i += 2) { c.cmds(list.slice(i, i + 2)); await sleep(33); } };
  c.open = new Promise((res, rej) => { ws.on('open', () => { c.send({ t: 'hello', name, token }); res(); }); ws.on('error', rej); });
  c.ready = async () => { await c.open; await c.waitFor('hi'); return c; };
  c.close = () => ws.close();
  return c;
}

export async function getStatus(port) {
  const r = await fetch(`http://localhost:${port}/status`);
  return r.json();
}
