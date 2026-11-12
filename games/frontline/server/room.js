// 방(Room) 하나 = 한 판의 FFA 경기. 플레이어/봇 관리, 피해·킬 처리, 경기 진행을 맡는다.
import { MAX_HP, RESPAWN_MS, ROOM_MAX } from '../shared/constants.js';
import { SPAWNS } from '../shared/spawns.js';
import { Bot } from './bots/bot.js';
import { BOT_NAMES } from './bots/names.js';
import { sanitizeChat, allowChat } from './chat.js';
import { resolveHits } from './combat.js';
import { PORT, TICK_MS, GOAL_KILLS, MATCH_MS, RESTART_MS, botFill, lanAddresses } from './config.js';

const r2 = v => Math.round(v * 100) / 100;

export class Room {
  // number: 방 번호(로그용), onDestroy: 사람이 모두 나가 방이 사라질 때 호출
  constructor({ number, onDestroy }) {
    this.number = number;
    this.onDestroy = onDestroy;
    this.players = new Map();          // id → player
    this.state = 'playing';            // playing | ended
    this.endsAt = Date.now() + MATCH_MS;
    this.restartTimer = null;
    this.regenAcc = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
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
    if (this.onDestroy) this.onDestroy(this);
  }

  newPlayer(id, name, ws) {
    return { id, ws, name, bot: null, hp: MAX_HP, alive: false, kills: 0, deaths: 0, pos: null, crouch: 0, lastHurt: 0, respawnTimer: null, room: this };
  }

  // ───────── 입장 / 퇴장 ─────────
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
    console.log(`[+] ${p.name} 접속 (방 ${this.number}, 사람 ${this.humans().length}명)`);
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

  // ───────── 봇 ─────────
  // 사람이 적으면 봇으로 채우고, 사람이 늘면 봇을 뺀다
  balanceBots() {
    const humans = this.humans().length;
    const want = Math.max(0, Math.min(botFill() - humans, ROOM_MAX - humans));
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

  // ───────── 스폰 ─────────
  // 다른 플레이어에게서 먼 지점 상위 3곳 중 하나
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

  // ───────── 전투 ─────────
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

  // 사람이 보낸 명중 신호
  onHit(p, m) {
    if (this.state !== 'playing' || !p.alive) return;
    const result = resolveHits(this.players, p, m);
    if (!result) return;
    for (const { victim, dmg, head } of result.damages) this.applyDamage(p, victim, result.wi, dmg, head);
  }

  // ───────── 채팅 ─────────
  onChat(p, m) {
    const text = sanitizeChat(m.text);
    if (!text || !allowChat(p, Date.now())) return;
    this.broadcast({ t: 'chat', id: p.id, name: p.name, text });
  }

  // ───────── 경기 진행 ─────────
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
