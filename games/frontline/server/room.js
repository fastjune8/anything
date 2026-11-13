// 방(Room) 하나 = 한 판의 경기 (개인전 또는 팀전). 플레이어/봇 관리, 피해·킬 처리, 경기 진행을 맡는다.
import { MAX_HP, RESPAWN_MS, RESPAWN_MIN_MS, SPAWN_PROTECT_MS } from '../shared/constants.js';
import { getMap } from '../shared/maps/index.js';
import { MODES } from '../shared/modes.js';
import { navFor } from './bots/nav.js';
import { Bot } from './bots/bot.js';
import { BOT_NAMES } from './bots/names.js';
import { sanitizeChat, allowChat } from './chat.js';
import { resolveHits } from './combat.js';
import { PORT, TICK_MS, MATCH_MS, RESTART_MS, goalFor, botFillFor, lanAddresses } from './config.js';

const r2 = v => Math.round(v * 100) / 100;
const SAFE_SPAWN_DIST = 25; // 이 거리(m) 안에 적이 있는 스폰 지점은 피한다

export class Room {
  // number: 방 번호(로그용), mode: 'ffa' | 'tdm', onDestroy: 사람이 모두 나가 방이 사라질 때 호출
  // custom: 친선전이면 { code, name, isPrivate, bots, matchMs } (빠른 시작 방은 null)
  constructor({ number, mode = 'ffa', onDestroy, custom = null }) {
    this.number = number;
    this.onDestroy = onDestroy;
    this.mode = mode;
    this.custom = custom;
    this.matchMs = custom ? custom.matchMs : MATCH_MS;
    this.cfg = MODES[mode];             // 인원·팀 수·목표 킬 등
    this.map = getMap(this.cfg.map);
    this.nav = navFor(this.cfg.map);    // 봇 길찾기
    this.goal = goalFor(this.cfg);
    this.teamScores = [0, 0];           // 팀전: 팀별 킬 합계
    this.players = new Map();          // id → player
    this.state = 'playing';            // playing | ended
    this.endsAt = Date.now() + this.matchMs;
    this.restartTimer = null;
    this.regenAcc = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  humans() { return [...this.players.values()].filter(p => !p.bot); }
  freeId() { for (let i = 0; i < this.cfg.max; i++) if (!this.players.has(i)) return i; return -1; }
  info(p) { return { id: p.id, name: p.name, bot: !!p.bot, k: p.kills, d: p.deaths, alive: p.alive, hp: p.hp, team: p.team }; }
  // 방 목록에 보여 줄 요약
  summary() { return { code: this.custom.code, name: this.custom.name, mode: this.mode, humans: this.humans().length, max: this.cfg.max, state: this.state, minutes: Math.round(this.matchMs / 60000), bots: this.custom.bots }; }
  // 서로 적인가 (개인전: 나 빼고 전부, 팀전: 다른 팀)
  isEnemy(a, b) { return a !== b && (!this.cfg.teams || a.team !== b.team); }
  teamCount(team) { let n = 0; for (const p of this.players.values()) if (p.team === team) n++; return n; }
  // 새로 들어오는 사람/봇이 갈 팀: 인원이 적은 쪽 (개인전은 -1)
  pickTeam() { return this.cfg.teams ? (this.teamCount(0) <= this.teamCount(1) ? 0 : 1) : -1; }
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
    return { id, ws, name, bot: null, hp: MAX_HP, alive: false, kills: 0, deaths: 0, pos: null, crouch: 0, lastHurt: 0, respawnTimer: null, invulnUntil: 0, lastSpawn: null, diedAt: 0, team: this.pickTeam(), room: this };
  }

  // ───────── 입장 / 퇴장 ─────────
  join(ws, name) {
    if (this.players.size >= this.cfg.max) this.removeBot();
    const p = this.newPlayer(this.freeId(), name, ws);
    this.players.set(p.id, p);
    this.sendTo(p, {
      t: 'welcome', id: p.id, mode: this.mode, room: this.custom ? { code: this.custom.code, name: this.custom.name, minutes: Math.round(this.matchMs / 60000) } : null, team: p.team, ts: this.teamScores, goal: this.goal, left: Math.max(0, this.endsAt - Date.now()), state: this.state,
      players: [...this.players.values()].map(q => this.info(q)), lan: lanAddresses(), port: PORT,
    });
    this.broadcast({ t: 'pj', player: this.info(p) }, p);
    this.balanceBots();
    if (this.state === 'playing') this.spawn(p);
    console.log(`[+] ${p.name} 접속 (방 ${this.number} ${this.mode}${this.custom ? ' 친선전 ' + this.custom.code : ''}, 사람 ${this.humans().length}명)`);
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
    const fill = this.custom && !this.custom.bots ? 0 : botFillFor(this.cfg); // 친선전은 봇 채우기를 끌 수 있다
    const want = Math.max(0, Math.min(fill - humans, this.cfg.max - humans));
    let bots = [...this.players.values()].filter(p => p.bot);
    while (bots.length < want) { this.addBot(); bots = [...this.players.values()].filter(p => p.bot); }
    while (bots.length > want) { this.removeBot(); bots = [...this.players.values()].filter(p => p.bot); }
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
    // 뺄 봇: 팀전이면 인원이 많은 팀에서 먼저, 그 안에서는 킬이 적은 봇
    const big = this.cfg.teams ? (this.teamCount(0) >= this.teamCount(1) ? 0 : 1) : -1;
    const b = bot || [...this.players.values()].filter(p => p.bot).sort((a, c) => (c.team === big) - (a.team === big) || a.kills - c.kills)[0];
    if (!b) return;
    clearTimeout(b.respawnTimer);
    this.players.delete(b.id);
    this.broadcast({ t: 'pl', id: b.id });
  }

  // ───────── 스폰 ─────────
  // 살아있는 다른 플레이어와 충분히 떨어진 지점 중에서 무작위. 직전에 태어난 곳은 피한다.
  pickSpawn(p) {
    const spawns = this.cfg.teams ? this.map.spawns.team[p.team] : this.map.spawns.ffa; // 팀전은 자기 진영에서만
    const others = [...this.players.values()].filter(o => this.isEnemy(p, o) && o.alive && o.pos);
    const dist = s => (others.length ? Math.min(...others.map(o => Math.hypot(s[0] - o.pos[0], s[1] - o.pos[2]))) : Infinity);
    const fresh = spawns.filter(s => s !== p.lastSpawn);
    let pool = fresh.filter(s => dist(s) >= SAFE_SPAWN_DIST);
    if (pool.length < 3) pool = [...fresh].sort((x, y) => dist(y) - dist(x)).slice(0, 3); // 다 가까우면 그나마 먼 3곳
    return pool[(Math.random() * pool.length) | 0];
  }

  spawn(p) {
    const s = this.pickSpawn(p);
    p.hp = MAX_HP; p.alive = true; p.lastHurt = 0; p.crouch = 0;
    p.pos = [s[0], 0, s[1]]; p.lastSpawn = s;
    p.invulnUntil = Date.now() + SPAWN_PROTECT_MS;
    clearTimeout(p.respawnTimer);
    if (p.bot) p.bot.reset(p.pos);
    this.broadcast({ t: 'spawn', id: p.id, p: p.pos, inv: SPAWN_PROTECT_MS });
  }

  // ───────── 전투 ─────────
  applyDamage(attacker, victim, wi, dmg, head) {
    if (this.state !== 'playing' || !this.isEnemy(attacker, victim) || !attacker.alive || !victim.alive) return; // 아군 사격은 무효
    attacker.invulnUntil = 0;                       // 공격하면 내 무적은 풀린다
    if (victim.invulnUntil > Date.now()) return;    // 스폰 직후 무적
    victim.hp = Math.max(0, victim.hp - dmg);
    victim.lastHurt = Date.now();
    this.broadcast({ t: 'dmg', to: victim.id, from: attacker.id, hp: victim.hp, dmg, head });
    if (victim.hp > 0) return;

    victim.alive = false; victim.deaths++; attacker.kills++;
    if (this.cfg.teams) this.teamScores[attacker.team]++;
    this.broadcast({ t: 'kill', killer: attacker.id, victim: victim.id, w: wi, head, sc: this.scoreList(), ts: this.teamScores });
    const reached = this.cfg.teams ? this.teamScores[attacker.team] >= this.goal : attacker.kills >= this.goal;
    if (reached) { this.endMatch(); return; }
    victim.diedAt = Date.now();
    // 봇은 자동으로 부활한다. 사람은 자동 부활이 없고, 입력을 하면 부활을 요청한다 (onRespawn).
    if (victim.bot) {
      victim.respawnTimer = setTimeout(() => {
        if (this.players.get(victim.id) === victim && this.state === 'playing') this.spawn(victim);
      }, RESPAWN_MS);
    }
  }

  // 사람이 보낸 부활 요청: 죽은 뒤 최소 시간이 지났을 때만 받아 준다
  onRespawn(p) {
    if (this.state !== 'playing' || p.alive || p.bot) return;
    if (Date.now() - p.diedAt < RESPAWN_MIN_MS) return;
    this.spawn(p);
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
    // 팀전: 점수가 높은 팀이 승리 (동점이면 -1 = 무승부). wt = 이긴 팀
    const [s0, s1] = this.teamScores;
    const wt = this.cfg.teams ? (s0 === s1 ? -1 : s0 > s1 ? 0 : 1) : -1;
    this.broadcast({ t: 'end', winner: ranked[0] ? ranked[0].id : -1, wt, ts: this.teamScores, sc: this.scoreList(), restart: RESTART_MS });
    this.restartTimer = setTimeout(() => this.startMatch(), RESTART_MS);
  }

  startMatch() {
    clearTimeout(this.restartTimer);
    this.state = 'playing';
    this.endsAt = Date.now() + this.matchMs;
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; p.alive = false; }
    this.teamScores = [0, 0];
    this.broadcast({ t: 'start', goal: this.goal, ts: this.teamScores, left: this.matchMs, players: [...this.players.values()].map(p => this.info(p)) });
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
