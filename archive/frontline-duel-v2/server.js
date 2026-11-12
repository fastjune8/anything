import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { WEAPONS, calcDamage, SPAWNS, GOAL, MAX_HP, RESPAWN_MS, MATCH_RESTART_MS, MATCH_TIME_MS, ROOM_MAX, BOT_FILL } from './public/js/shared.js';
import { Bot, BOT_NAMES } from './bots.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const PORT = Number(process.env.PORT) || 3000;
const APP_ENV = process.env.APP_ENV || 'dev'; // dev | staging | prod
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const STARTED_AT = Date.now();

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
  // 상태 확인 (배포 전에 접속 중인 유저가 있는지 보는 용도)
  if (url === '/status') {
    const list = [...rooms];
    const humans = list.reduce((n, r) => n + r.humans().length, 0);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ env: APP_ENV, version: VERSION, uptime: Math.round((Date.now() - STARTED_AT) / 1000), rooms: list.length, humans }));
    return;
  }
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

// ───────── 게임 상태: 방(Room) 단위 FFA ─────────
const TICK_MS = 50;
const GOAL_KILLS = Number(process.env.GOAL) || GOAL;
const RESTART_MS = process.env.RESTART_SECONDS ? Number(process.env.RESTART_SECONDS) * 1000 : MATCH_RESTART_MS;
const MATCH_MS = process.env.MATCH_SECONDS ? Number(process.env.MATCH_SECONDS) * 1000 : MATCH_TIME_MS;
const r2 = v => Math.round(v * 100) / 100;
const rooms = new Set();

class Room {
  constructor() {
    this.players = new Map();          // id → player
    this.state = 'playing';            // playing | ended
    this.endsAt = Date.now() + MATCH_MS;
    this.restartTimer = null;
    this.regenAcc = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    rooms.add(this);
  }

  humans() { return [...this.players.values()].filter(p => !p.bot); }
  freeId() { for (let i = 0; i < ROOM_MAX; i++) if (!this.players.has(i)) return i; return -1; }
  info(p) { return { id: p.id, name: p.name, bot: !!p.bot, k: p.kills, d: p.deaths, alive: p.alive }; }
  scoreList() { return [...this.players.values()].map(p => [p.id, p.kills, p.deaths]); }

  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws && p !== except && p.ws.readyState === 1) p.ws.send(s);
    }
  }
  sendTo(p, msg) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); }

  destroy() {
    clearInterval(this.timer); clearTimeout(this.restartTimer);
    for (const p of this.players.values()) clearTimeout(p.respawnTimer);
    rooms.delete(this);
  }

  newPlayer(id, name, ws) {
    return { id, ws, name, bot: null, hp: MAX_HP, alive: false, kills: 0, deaths: 0, pos: null, crouch: 0, lastHurt: 0, respawnTimer: null, room: this };
  }

  join(ws, name) {
    if (this.players.size >= ROOM_MAX) this.removeBot();
    const p = this.newPlayer(this.freeId(), name, ws);
    this.players.set(p.id, p);
    this.sendTo(p, {
      t: 'welcome', id: p.id, goal: GOAL_KILLS, left: Math.max(0, this.endsAt - Date.now()), state: this.state,
      players: [...this.players.values()].map(q => this.info(q)), lan: lanAddresses(), port: PORT,
    });
    this.broadcast({ t: 'pj', player: this.info(p) }, p);
    this.balanceBots();
    if (this.state === 'playing') this.spawn(p);
    console.log(`[+] ${p.name} 접속 (방 ${[...rooms].indexOf(this) + 1}, 사람 ${this.humans().length}명)`);
    return p;
  }

  leave(p) {
    if (this.players.get(p.id) !== p) return;
    clearTimeout(p.respawnTimer);
    this.players.delete(p.id);
    this.broadcast({ t: 'pl', id: p.id });
    console.log(`[-] ${p.name} 퇴장`);
    if (this.humans().length === 0) { this.destroy(); return; }
    this.balanceBots();
  }

  // 사람이 적으면 봇으로 BOT_FILL 명까지 채우고, 사람이 늘면 봇을 뺀다
  balanceBots() {
    const humans = this.humans().length;
    const want = Math.max(0, Math.min(BOT_FILL - humans, ROOM_MAX - humans));
    let bots = [...this.players.values()].filter(p => p.bot);
    while (bots.length < want) { this.addBot(); bots = [...this.players.values()].filter(p => p.bot); }
    while (bots.length > want) this.removeBot(bots.pop());
  }

  addBot() {
    const id = this.freeId();
    if (id < 0) return;
    const used = new Set([...this.players.values()].map(p => p.name));
    const pool = BOT_NAMES.filter(n => !used.has(n));
    const name = pool.length ? pool[(Math.random() * pool.length) | 0] : `Bot${id}`;
    const p = this.newPlayer(id, name, null);
    p.bot = new Bot(p, this);
    this.players.set(id, p);
    this.broadcast({ t: 'pj', player: this.info(p) });
    if (this.state === 'playing') this.spawn(p);
  }

  removeBot(bot) {
    const b = bot || [...this.players.values()].filter(p => p.bot).sort((a, c) => a.kills - c.kills)[0];
    if (!b) return;
    clearTimeout(b.respawnTimer);
    this.players.delete(b.id);
    this.broadcast({ t: 'pl', id: b.id });
  }

  pickSpawn(p) {
    const others = [...this.players.values()].filter(o => o !== p && o.alive && o.pos);
    if (!others.length) return SPAWNS[(Math.random() * SPAWNS.length) | 0];
    const ranked = SPAWNS
      .map(s => ({ s, d: Math.min(...others.map(o => Math.hypot(s[0] - o.pos[0], s[1] - o.pos[2]))) }))
      .sort((a, b) => b.d - a.d);
    return ranked[Math.floor(Math.random() * 3)].s;
  }

  spawn(p) {
    const s = this.pickSpawn(p);
    p.hp = MAX_HP; p.alive = true; p.lastHurt = 0; p.crouch = 0;
    p.pos = [s[0], 0, s[1]];
    clearTimeout(p.respawnTimer);
    if (p.bot) p.bot.reset(p.pos);
    this.broadcast({ t: 'spawn', id: p.id, p: p.pos });
  }

  applyDamage(attacker, victim, wi, dmg, head) {
    if (this.state !== 'playing' || attacker === victim || !attacker.alive || !victim.alive) return;
    victim.hp = Math.max(0, victim.hp - dmg);
    victim.lastHurt = Date.now();
    this.broadcast({ t: 'dmg', to: victim.id, from: attacker.id, hp: victim.hp, dmg, head });
    if (victim.hp > 0) return;

    victim.alive = false; victim.deaths++; attacker.kills++;
    this.broadcast({ t: 'kill', killer: attacker.id, victim: victim.id, w: wi, head, sc: this.scoreList() });
    if (attacker.kills >= GOAL_KILLS) { this.endMatch(); return; }
    victim.respawnTimer = setTimeout(() => {
      if (this.players.get(victim.id) === victim && this.state === 'playing') this.spawn(victim);
    }, RESPAWN_MS);
  }

  onHit(p, m) {
    if (this.state !== 'playing' || !p.alive) return;
    const wi = m.w | 0, w = WEAPONS[wi];
    if (!w || !Array.isArray(m.hits)) return;
    const groups = new Map();
    for (const h of m.hits.slice(0, w.pellets)) {
      if (!Array.isArray(h)) continue;
      const v = this.players.get(h[2] | 0);
      if (!v || v === p || !v.alive) continue;
      const part = h[0] === 'head' || h[0] === 'leg' ? h[0] : 'body';
      const dist = Math.min(400, Math.max(0, Number(h[1]) || 0));
      const g = groups.get(v) || { dmg: 0, head: false };
      g.dmg += calcDamage(wi, part, dist);
      if (part === 'head') g.head = true;
      groups.set(v, g);
    }
    for (const [v, g] of groups) {
      const d = Math.round(g.dmg);
      if (d > 0) this.applyDamage(p, v, wi, d, g.head);
    }
  }

  endMatch() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    const ranked = [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    for (const p of this.players.values()) clearTimeout(p.respawnTimer);
    this.broadcast({ t: 'end', winner: ranked[0] ? ranked[0].id : -1, sc: this.scoreList(), restart: RESTART_MS });
    this.restartTimer = setTimeout(() => this.startMatch(), RESTART_MS);
  }

  startMatch() {
    clearTimeout(this.restartTimer);
    this.state = 'playing';
    this.endsAt = Date.now() + MATCH_MS;
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; p.alive = false; }
    this.broadcast({ t: 'start', goal: GOAL_KILLS, left: MATCH_MS, players: [...this.players.values()].map(p => this.info(p)) });
    for (const p of this.players.values()) this.spawn(p);
  }

  tick() {
    if (this.state !== 'playing') return;
    const dt = TICK_MS / 1000, now = Date.now();
    if (now >= this.endsAt) { this.endMatch(); return; }

    for (const p of this.players.values()) {
      if (!p.bot) continue;
      if (this.state !== 'playing') return;
      p.bot.update(dt);
      if (p.alive) {
        this.broadcast({ t: 's', id: p.id, p: [r2(p.pos[0]), 0, r2(p.pos[2])], y: +p.bot.yaw.toFixed(3), x: +p.bot.pitch.toFixed(3), c: 0, w: p.bot.weapon });
      }
    }

    // 체력 자동 회복 (5초간 피해 없으면)
    this.regenAcc += TICK_MS;
    if (this.regenAcc >= 500) {
      this.regenAcc = 0;
      for (const p of this.players.values()) {
        if (p.alive && p.hp < MAX_HP && now - p.lastHurt > 5000) {
          p.hp = Math.min(MAX_HP, p.hp + 5);
          this.sendTo(p, { t: 'hp', hp: p.hp });
        }
      }
    }
  }
}

function findRoom() {
  for (const room of rooms) if (room.humans().length < ROOM_MAX) return room;
  return new Room();
}

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
wss.on('connection', ws => {
  let me = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'join') {
      if (me) return;
      const name = String(m.name || '').trim().slice(0, 14) || '병사';
      me = findRoom().join(ws, name);
      return;
    }
    if (!me) return;
    const room = me.room;
    switch (m.t) {
      case 's':
        if (Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite)) { me.pos = m.p; me.crouch = m.c ? 1 : 0; }
        else return;
        m.id = me.id; room.broadcast(m, me);
        break;
      case 'shot': case 'rl':
        if (me.alive) { m.id = me.id; room.broadcast(m, me); }
        break;
      case 'hit': room.onHit(me, m); break;
    }
  });

  ws.on('close', () => { if (me) me.room.leave(me); });
});

// 끊긴 연결 정리 (프록시/공유기가 유휴 연결을 끊는 것도 방지)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 25000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  FRONTLINE DUEL — 봇 대전(FFA) 서버 실행 중\n');
  console.log(`  이 컴퓨터:        http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  같은 네트워크:    http://${ip}:${PORT}`);
  console.log(`\n  방당 최대 ${ROOM_MAX}명, 사람이 적으면 봇이 ${BOT_FILL}명까지 채웁니다. (Ctrl+C 로 종료)\n`);
});
