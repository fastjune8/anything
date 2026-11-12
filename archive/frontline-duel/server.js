import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { WEAPONS, calcDamage, SPAWNS, GOAL, MAX_HP, RESPAWN_MS, MATCH_RESTART_MS } from './public/js/shared.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400).end(); return; }
  let base = PUBLIC, rel = url;
  if (url.startsWith('/vendor/three/')) { base = THREE_DIR; rel = url.slice('/vendor/three'.length); }
  if (rel === '/') rel = '/index.html';
  const file = path.join(base, rel);
  if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': base === THREE_DIR ? 'max-age=86400' : 'no-cache',
    });
    res.end(data);
  });
});

// ───────── 게임 상태 ─────────
const slots = [null, null];
let matchState = 'waiting'; // waiting | playing | ended
let restartTimer = null;

const send = (p, msg) => { if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); };
const broadcast = msg => slots.forEach(p => send(p, msg));
const other = p => slots[1 - p.id];
const score = () => [slots[0]?.kills || 0, slots[1]?.kills || 0];

function pickSpawn(p) {
  const o = other(p);
  if (!o || !o.pos) return SPAWNS[p.id === 0 ? 0 : SPAWNS.length / 2];
  const ranked = SPAWNS
    .map(s => ({ s, d: Math.hypot(s[0] - o.pos[0], s[1] - o.pos[2]) }))
    .sort((a, b) => b.d - a.d);
  return ranked[Math.floor(Math.random() * 3)].s;
}

function spawn(p, initial) {
  const s = initial ? SPAWNS[p.id === 0 ? 0 : SPAWNS.length / 2] : pickSpawn(p);
  p.hp = MAX_HP; p.alive = true; p.lastHurt = 0;
  p.pos = [s[0], 0, s[1]];
  clearTimeout(p.respawnTimer);
  broadcast({ t: 'spawn', id: p.id, p: p.pos });
}

function startMatch() {
  clearTimeout(restartTimer);
  matchState = 'playing';
  for (const p of slots) { p.kills = 0; p.deaths = 0; }
  broadcast({ t: 'start', players: slots.map(p => ({ id: p.id, name: p.name })), goal: GOAL });
  slots.forEach(p => spawn(p, true));
}

function onHit(p, m) {
  const v = other(p);
  if (matchState !== 'playing' || !v || !p.alive || !v.alive) return;
  const w = WEAPONS[m.w];
  if (!w || !Array.isArray(m.hits)) return;
  let dmg = 0, head = false;
  for (const h of m.hits.slice(0, w.pellets)) {
    const part = h[0] === 'head' || h[0] === 'leg' ? h[0] : 'body';
    dmg += calcDamage(m.w, part, Math.max(0, Number(h[1]) || 0));
    if (part === 'head') head = true;
  }
  dmg = Math.round(dmg);
  if (dmg <= 0) return;
  v.hp = Math.max(0, v.hp - dmg);
  v.lastHurt = Date.now();
  broadcast({ t: 'dmg', to: v.id, from: p.id, hp: v.hp, dmg, head });
  if (v.hp > 0) return;

  v.alive = false; v.deaths++; p.kills++;
  broadcast({ t: 'kill', killer: p.id, victim: v.id, w: m.w, head, score: score() });
  if (p.kills >= GOAL) {
    matchState = 'ended';
    broadcast({ t: 'end', winner: p.id, score: score(), restart: MATCH_RESTART_MS });
    restartTimer = setTimeout(() => { if (slots[0] && slots[1]) startMatch(); }, MATCH_RESTART_MS);
  } else {
    v.respawnTimer = setTimeout(() => { if (slots[v.id] === v && matchState === 'playing') spawn(v, false); }, RESPAWN_MS);
  }
}

// 체력 자동 회복 (5초간 피해 없으면)
setInterval(() => {
  if (matchState !== 'playing') return;
  const now = Date.now();
  for (const p of slots) {
    if (p && p.alive && p.hp < MAX_HP && now - p.lastHurt > 5000) {
      p.hp = Math.min(MAX_HP, p.hp + 5);
      send(p, { t: 'hp', hp: p.hp });
    }
  }
}, 500);

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  const id = slots[0] ? (slots[1] ? -1 : 1) : 0;
  if (id < 0) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }
  const p = { id, ws, name: `Player ${id + 1}`, hp: MAX_HP, alive: true, kills: 0, deaths: 0, pos: null, joined: false, lastHurt: 0 };
  slots[id] = p;

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'join': {
        if (p.joined) return;
        p.joined = true;
        p.name = String(m.name || '').trim().slice(0, 14) || p.name;
        send(p, { t: 'welcome', id, lan: lanAddresses(), port: PORT });
        const o = other(p);
        if (o && o.joined) startMatch();
        else send(p, { t: 'waiting' });
        console.log(`[+] ${p.name} 접속 (슬롯 ${id + 1})`);
        break;
      }
      case 's':
        if (Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite)) p.pos = m.p;
        m.id = id; send(other(p), m);
        break;
      case 'shot': case 'rl':
        if (p.alive) { m.id = id; send(other(p), m); }
        break;
      case 'hit': onHit(p, m); break;
    }
  });

  ws.on('close', () => {
    if (slots[id] !== p) return;
    clearTimeout(p.respawnTimer); clearTimeout(restartTimer);
    slots[id] = null;
    matchState = 'waiting';
    const o = slots[1 - id];
    if (o) {
      clearTimeout(o.respawnTimer);
      o.kills = 0; o.deaths = 0; o.hp = MAX_HP; o.alive = true;
      send(o, { t: 'left' });
    }
    if (p.joined) console.log(`[-] ${p.name} 퇴장`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  FRONTLINE DUEL 서버 실행 중\n');
  console.log(`  이 컴퓨터:        http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  같은 네트워크:    http://${ip}:${PORT}`);
  console.log('\n  두 명이 접속하면 경기가 시작됩니다. (Ctrl+C 로 종료)\n');
});
