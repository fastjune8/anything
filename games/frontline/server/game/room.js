// 경기 방 하나. 60Hz 고정 시뮬레이션 (서버 권한):
//   사람: 브라우저가 1/60초 입력(cmd)을 보내면 도착하는 대로 shared/sim/player.js 로 계산 (실제 흐른 시간만큼만 받는다 — 속도 핵 방지)
//   봇: 매 tick server/bots/brain.js 가 같은 형식의 cmd 를 만든다 → 사람과 똑같은 이동·무기·스킬 규칙
//   사격: 시뮬레이션이 낸 사격 사건을 서버가 히트스캔으로 판정한다. 다른 사람은 쏜 사람이 보던 순간(vt)으로 되감는다 (lagcomp.js)
//   피해 → 처치 → 자동 부활 (모드별 대기), 부활 보호, 점수·승패 (modes/), 결과 화면 → 개인별 재매치/로비
import { MODES } from '../../shared/modes.js';
import { getMap } from '../../shared/maps/index.js';
import { WEAPONS, calcDamage, isMelee } from '../../shared/weapons.js';
import { packOutfit, botOutfit } from '../../shared/cosmetics.js';
import { makeLoadout, loadoutWire, newPlayerSim, respawnSim, stepPlayer, decodeCmd } from '../../shared/sim/player.js';
import { applyImpulse, knockDown, eyeY, hSpeed } from '../../shared/sim/movement.js';
import { castRay, castMelee } from '../../shared/sim/hitscan.js';
import { pickDynamic, pickTeam } from '../../shared/sim/spawn.js';
import { NOISE, quantBearing } from '../../shared/sim/noise.js';
import { rayWorld } from '../../shared/collision.js';
import { TICK_HZ, DT, SNAP_EVERY, HEALTH, KILL_Y, ASSIST_WINDOW, ENV_CREDIT, PF } from '../../shared/sim/config.js';
import { navFor } from '../bots/nav.js';
import { Brain, botLoadout } from '../bots/brain.js';
import { BOT_NAMES } from '../bots/names.js';
import { createRules } from './modes/index.js';
import { record, poseAt, clampVt, crouchOf } from './lagcomp.js';
import { launch, tickProjectiles } from './projectiles.js';
import { allowChat } from '../chat.js';
import { perf } from '../perf.js';
import { goalFor, matchMsFor, botFillFor, respawnFor, RESULTS_MS, VICTORY_MS, APP_ENV, lanAddresses, PORT, INPUT_QUEUE } from '../config.js';

const BURST = 30, MAX_PER_MSG = 120;
// 입력 큐: 한 tick 에 1개, 쌓인 게 CATCHUP_AT 를 넘으면 2개씩 따라잡는다 (남에게는 최대 2배속으로 보일 뿐 순간이동하지 않는다). MAX_QUEUE 를 넘으면 오래된 것부터 버린다 (0.6초)
const CATCHUP_AT = 3, MAX_QUEUE = 36;
const r3 = v => Math.round(v * 1000) / 1000;
const r2 = v => Math.round(v * 100) / 100;

export class Room {
  constructor({ number, mode, custom = null, hub }) {
    this.number = number; this.mode = mode; this.custom = custom; this.hub = hub;
    this.cfg = MODES[mode];
    this.mapId = (custom && custom.map) || this.cfg.map;
    this.map = getMap(this.mapId);
    this.nav = navFor(this.mapId);
    this.goal = goalFor(this.cfg);
    this.matchMs = custom ? custom.matchMs : matchMsFor(this.cfg);
    this.maxPlayers = custom ? custom.max : this.cfg.max;
    this.respawnS = respawnFor(this.cfg);
    this.players = new Map();
    this.rules = createRules(this);
    this.tickN = 0; this.time = 0;
    this.spawnUse = new Map();
    this.startMatch(true);
    this.lastHr = process.hrtime.bigint(); this.acc = 0;
    this.timer = setInterval(() => this.pump(), 4);
  }

  // ───── 시간: 4ms 마다 깨어나 밀린 tick 을 돌린다 (setInterval 의 들쭉날쭉함과 상관없이 1초에 60번) ─────
  pump() {
    const now = process.hrtime.bigint();
    this.acc += Number(now - this.lastHr) / 1e9; this.lastHr = now;
    let n = 0;
    while (this.acc >= DT && n < 5) { this.acc -= DT; this.tick(); n++; }
    if (this.acc > DT * 5) this.acc = 0; // 너무 밀리면 버린다 (서버가 잠깐 멈췄을 때)
  }

  humans() { return [...this.players.values()].filter(p => !p.bot); }
  bots() { return [...this.players.values()].filter(p => p.bot); }
  isEnemy(a, b) { return a !== b && (!this.cfg.teams || a.team !== b.team); }
  teamCount(t) { let n = 0; for (const p of this.players.values()) if (p.team === t) n++; return n; }
  teamHumans(t) { let n = 0; for (const p of this.players.values()) if (!p.bot && p.team === t) n++; return n; }
  canFit(size) {
    if (this.state !== 'playing' && this.state !== 'results') return false;
    if (this.humans().length + size > this.maxPlayers) return false;
    if (!this.cfg.teams) return true;
    const half = Math.ceil(this.maxPlayers / 2);
    return this.teamHumans(0) + size <= half || this.teamHumans(1) + size <= half;
  }
  summary() {
    const c = this.custom;
    return { code: c.code, name: c.name, mode: this.mode, map: this.mapId, humans: this.humans().length, max: c.max, state: this.state, minutes: c.minutes, bots: c.bots, locked: !!c.pass };
  }
  info(P) { return { id: P.id, name: P.name, bot: !!P.bot, team: P.team, k: P.kills, d: P.deaths, a: P.assists, alive: P.alive, hp: Math.ceil(P.hp), lo: loadoutWire(P.lo), ck: packOutfit(P.outfit), lvl: P.level || 0 }; }
  freeId() { for (let i = 0; i < 32; i++) if (!this.players.has(i)) return i; return -1; }

  // ───── 보내기 ─────
  send(P, m) { const ws = P.sess && P.sess.ws; if (ws && ws.readyState === 1) { const s = JSON.stringify(m); perf.out(s.length); ws.send(s); } }
  broadcast(m) { const s = JSON.stringify(m); for (const P of this.players.values()) { const ws = P.sess && P.sess.ws; if (ws && ws.readyState === 1) { perf.out(s.length); ws.send(s); } } }
  // 사건: tick 끝에 한 묶음으로 (filter(P) 가 true 인 사람에게만)
  emit(e, filter = null) { for (const P of this.players.values()) if (!P.bot && (!filter || filter(P))) P.out.push(e); }

  // ───── 입장 / 퇴장 ─────
  newPlayer(id, name, team, lo, outfit) {
    const P = {
      id, name, team, lo, outfit, bot: null, sess: null, hp: HEALTH.max, alive: false, kills: 0, deaths: 0, assists: 0, caps: 0,
      respawnAt: 0, lastHurt: -99, contrib: new Map(), hitBy: null, hist: [], out: [], meDirty: true, rematch: null,
      budget: BURST, budgetAt: Date.now(), lastSeq: -1, doneSeq: -1, inq: [], starve: 0, tpn: 0, bleed: null, bleedHits: new Map(), slashHit: null, stepAcc: 0, sndKey: 0,
      m: { weapons: {} }, joinedAt: this.time, killedBy: null,
    };
    P.ps = newPlayerSim(id, lo, 0, -500, 0, 0); P.ps.alive = false;
    return P;
  }
  pickTeamFor(size) {
    if (!this.cfg.teams) return -1;
    const half = Math.ceil(this.maxPlayers / 2), h0 = this.teamHumans(0), h1 = this.teamHumans(1);
    if (h0 + size > half) return 1;
    if (h1 + size > half) return 0;
    return h0 <= h1 ? 0 : 1;
  }
  // 파티(또는 혼자)를 한 팀으로 넣는다
  joinGroup(group) {
    const team = this.pickTeamFor(group.length);
    for (const s of group) {
      while (this.players.size >= this.maxPlayers && this.bots().length) this.removeBot(team);
      const id = this.freeId();
      if (id < 0) { this.hub.toLobby(s); continue; }
      const P = this.newPlayer(id, s.acc.name, team, makeLoadout(s.loadout), s.outfit);
      P.sess = s; P.level = s.acc.level; P.accId = s.id;
      s.room = this; s.player = P;
      this.players.set(id, P);
      this.welcome(P);
      this.emit({ e: 'pj', p: this.info(P) }, Q => Q !== P);
      if (this.state === 'playing') this.spawn(P);
      console.log(`[+] ${P.name} → 방 ${this.number} (${this.mode}${this.custom ? ' 커스텀 ' + this.custom.code : ''}) 팀 ${team}, 사람 ${this.humans().length}명`);
    }
    this.balanceBots();
  }
  welcome(P) {
    this.send(P, {
      t: 'welcome', id: P.id, mode: this.mode, map: this.mapId, team: P.team, n: this.tickN, state: this.state,
      left: Math.max(0, this.endsAt - this.time) * 1000, ot: this.overtime ? 1 : 0, goal: this.goal, sc: this.scores, respawn: this.respawnS,
      room: this.custom ? { code: this.custom.code, name: this.custom.name, locked: !!this.custom.pass, host: this.custom.host } : null,
      players: [...this.players.values()].map(Q => this.info(Q)), lo: loadoutWire(P.lo), ...this.rules.snapshot(),
      lan: APP_ENV !== 'prod' ? lanAddresses() : [], port: PORT,
    });
  }
  leave(s) {
    const P = s.player;
    if (!P || this.players.get(P.id) !== P) return;
    this.players.delete(P.id);
    this.emit({ e: 'pl', id: P.id });
    s.room = null; s.player = null;
    console.log(`[-] ${P.name} 방 ${this.number} 에서 나감`);
    if (!this.humans().length) { this.destroy(); return; }
    this.balanceBots();
  }
  destroy() { clearInterval(this.timer); this.hub.removeRoom(this); }

  // 방이 맡는 메시지. 반환: 처리했나
  handle(s, m) {
    const P = s.player;
    if (!P) return false;
    switch (m.t) {
      case 'cmd': this.onCmds(P, m); return true;
      case 'leave': this.leave(s); this.hub.toLobby(s); return true;
      case 'rematch': if (this.state === 'results' || this.state === 'victory') { P.rematch = !!m.v; this.emit({ e: 'rm', id: P.id, v: P.rematch }); } return true;
      case 'tp': // 개발·테스트용 순간이동 (라이브에서는 무시)
        if (APP_ENV !== 'prod' && Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite)) {
          const ps = P.ps; ps.x = m.p[0]; ps.y = m.p[1]; ps.z = m.p[2]; ps.vx = ps.vy = ps.vz = 0; ps.vault = null; ps.mo = null; ps.ground = true;
          if (Number.isFinite(m.y)) ps.yaw = m.y;
          P.tpn++; P.meDirty = true;
        }
        return true;
      case 'hp': if (APP_ENV !== 'prod' && Number.isFinite(m.v)) { P.hp = Math.max(1, Math.min(HEALTH.max, m.v)); P.meDirty = true; } return true;
      default: return false;
    }
  }
  chat(s, text) {
    const P = s.player;
    if (!P || !allowChat(P, Date.now())) return;
    this.broadcast({ t: 'chat', ch: 'room', from: s.id, id: P.id, name: P.name, text, team: P.team });
  }

  // ───── 봇 ─────
  balanceBots() {
    const humans = this.humans().length;
    const fill = this.custom && !this.custom.bots ? 0 : Math.min(botFillFor(this.cfg), this.maxPlayers);
    const want = Math.max(0, Math.min(fill - humans, this.maxPlayers - humans));
    while (this.bots().length < want) this.addBot();
    while (this.bots().length > want) this.removeBot();
  }
  addBot() {
    const id = this.freeId();
    if (id < 0) return;
    const used = new Set([...this.players.values()].map(p => p.name));
    const pool = BOT_NAMES.filter(n => !used.has(n));
    const name = pool.length ? pool[(Math.random() * pool.length) | 0] : `Bot${id}`;
    const team = this.cfg.teams ? (this.teamCount(0) <= this.teamCount(1) ? 0 : 1) : -1;
    const P = this.newPlayer(id, name, team, makeLoadout(botLoadout(id)), botOutfit(id));
    P.bot = new Brain(P, this);
    this.players.set(id, P);
    this.emit({ e: 'pj', p: this.info(P) });
    if (this.state === 'playing') this.spawn(P);
  }
  removeBot(preferTeam = -2) {
    const bots = this.bots();
    if (!bots.length) return;
    const big = this.cfg.teams ? (preferTeam >= 0 ? preferTeam : this.teamCount(0) >= this.teamCount(1) ? 0 : 1) : -1;
    const b = bots.sort((a, c) => (c.team === big) - (a.team === big) || a.kills - c.kills)[0];
    this.players.delete(b.id);
    this.emit({ e: 'pl', id: b.id });
  }

  // ───── 스폰 (기획 5.5) ─────
  pickSpawn(P) {
    const sp = this.map.spawns;
    const last = P.lastSpawn || null;
    if (this.cfg.spawn === 'team' && sp.team && P.team >= 0) return pickTeam(sp.team[P.team], { last, used: this.spawnUse });
    const cs = this.map.layout.colliders;
    const enemies = [], allies = [];
    for (const Q of this.players.values()) if (Q !== P && Q.alive) (this.isEnemy(P, Q) ? enemies : allies).push({ x: Q.ps.x, z: Q.ps.z, y: eyeY(Q.ps) });
    const sees = (e, x, z) => {
      const o = { x: e.x, y: e.y, z: e.z }, dx = x - e.x, dy = 1.5 - e.y, dz = z - e.z, l = Math.hypot(dx, dy, dz);
      return rayWorld(o, { x: dx / l, y: dy / l, z: dz / l }, cs, l).t >= l - 0.1;
    };
    const objective = this.rules.objectiveFor(P);
    const list = sp.team && this.cfg.teams && P.team >= 0 ? [...sp.ffa, ...sp.team[P.team]] : sp.ffa;
    return pickDynamic(list, { enemies, allies: this.cfg.teams ? allies : [], objective, used: this.spawnUse, last, sees });
  }
  spawn(P) {
    const s = this.pickSpawn(P);
    P.lastSpawn = s;
    this.spawnUse.set(s, (this.spawnUse.get(s) || 0) + 1);
    const yaw = Math.atan2(s[0], s[1]); // 맵 가운데를 본다
    respawnSim(P.ps, P.lo, s[0], 0, s[1], yaw);
    P.hp = HEALTH.max; P.alive = true; P.lastHurt = -99; P.contrib.clear(); P.hitBy = null; P.bleed = null; P.killedBy = null;
    P.sndKey = (Math.random() * 1e9) | 0; P.meDirty = true; P.hist = [];
    if (P.bot) P.bot.reset();
    this.emit({ e: 'spawn', id: P.id, p: [s[0], 0, s[1]], y: r3(yaw) });
  }

  // ───── 입력 ─────
  refill(P) { const now = Date.now(); P.budget = Math.min(BURST, P.budget + ((now - P.budgetAt) / 1000) * TICK_HZ); P.budgetAt = now; }
  onCmds(P, m) {
    if (!Array.isArray(m.c) || !Number.isInteger(m.s)) return;
    if (!INPUT_QUEUE) return this.onCmdsDirect(P, m);
    const list = m.c.slice(0, MAX_PER_MSG);
    for (let k = 0; k < list.length; k++) {
      const seq = m.s + k;
      if (seq <= P.lastSeq || !Array.isArray(list[k])) continue;
      P.lastSeq = seq;
      P.inq.push({ seq, cmd: decodeCmd(list[k]) });
    }
    while (P.inq.length > MAX_QUEUE) P.doneSeq = P.inq.shift().seq; // 너무 많이 밀렸다: 오래된 것은 버린다 (브라우저는 서버 상태로 맞춘다)
  }
  // 예전 방식 (INPUT_QUEUE=off): 도착하는 대로 바로 처리 — 입력이 몰려 오면 그 자리에서 전부 계산한다
  onCmdsDirect(P, m) {
    this.refill(P);
    const list = m.c.slice(0, MAX_PER_MSG);
    for (let k = 0; k < list.length; k++) {
      const seq = m.s + k;
      if (seq <= P.lastSeq || !Array.isArray(list[k])) continue;
      P.lastSeq = seq; P.doneSeq = seq; P.meDirty = true;
      if (P.budget < 1) continue; // 시간보다 많이 보냄 → 버린다 (속도 핵)
      P.budget -= 1; P.starve = 0;
      this.runCmd(P, decodeCmd(list[k]));
    }
  }
  starveCheck(P) { // (INPUT_QUEUE=off) 예전 방식의 입력 끊김 처리
    if (!P.alive) return;
    P.starve = (P.starve || 0) + 1;
    if (P.starve <= 20) return;
    this.refill(P);
    if (P.budget < 1) return;
    P.budget -= 1; P.meDirty = true;
    this.runCmd(P, { fwd: 0, side: 0, btn: 0, yaw: P.ps.yaw, pitch: P.ps.pitch, slot: P.ps.cur, vt: this.tickN });
  }
  // 입력 큐에서 이번 tick 에 처리할 만큼 꺼내 계산한다 (속도 핵 방지: 실제 시간이 허락한 만큼만)
  consume(P) {
    this.refill(P);
    const L = P.inq.length;
    if (!L) { // 입력이 안 온다 (렉·창 내림): 0.33초 넘으면 서버가 빈 입력으로 시간을 진행한다 (부활 보호·넘어짐·낙하가 멈추지 않게)
      if (!P.alive || ++P.starve <= 20 || P.budget < 1) return;
      P.budget -= 1; P.meDirty = true;
      this.runCmd(P, { fwd: 0, side: 0, btn: 0, yaw: P.ps.yaw, pitch: P.ps.pitch, slot: P.ps.cur, vt: this.tickN });
      return;
    }
    P.starve = 0;
    for (let k = L > CATCHUP_AT ? 2 : 1; k > 0 && P.inq.length; k--) {
      const e = P.inq.shift();
      P.doneSeq = e.seq; P.meDirty = true;
      if (P.budget < 1) continue;
      P.budget -= 1;
      this.runCmd(P, e.cmd);
    }
  }
  runCmd(P, cmd) {
    if (this.state !== 'playing') { P.ps.yaw = cmd.yaw; P.ps.pitch = cmd.pitch; return; }
    const wasStealth = P.ps.st.stealth > 0;
    const ev = stepPlayer(P.ps, cmd, P.lo, this.map.layout.colliders, DT);
    if (!P.alive) return;
    const vt = P.bot ? this.tickN : clampVt(cmd.vt, this.tickN);
    for (const shot of ev.shots) this.resolveShot(P, shot, vt);
    if (ev.reload) { this.emit({ e: 'rl', id: P.id, w: P.lo[P.ps.cur].wi }, Q => Q !== P); this.noise(P, 'reload'); }
    if (ev.skills) for (const s of ev.skills) { this.emit({ e: 'sk', id: P.id, k: s.effect }, Q => Q !== P); this.noise(P, 'skill'); }
    if (ev.slash) P.slashHit = { dmg: ev.slash.dmg, wi: P.lo[ev.slash.slot].wi, ids: new Set() };
    if (ev.grenade) launch(this, P, ev.grenade, P.lo[ev.grenade.slot].skill, P.lo[ev.grenade.slot].wi);
    if (ev.grapple) this.emit({ e: 'hook', id: P.id, p: [r2(ev.grapple.x), r2(ev.grapple.y), r2(ev.grapple.z)] }, Q => Q !== P);
    if (ev.swap) this.emit({ e: 'sw', id: P.id, w: P.lo[P.ps.cur].wi }, Q => Q !== P);
    if (wasStealth && P.ps.st.stealth <= 0) P.meDirty = true;
    // 발소리 등 소음 (기획 9.3)
    const mv = ev.move;
    if (mv) {
      if (mv.slideStart) this.noise(P, 'slide');
      if (mv.landed > 0.3) this.noise(P, 'land');
      if (mv.moved > 0 && !P.ps.crouch) {
        P.stepAcc += mv.moved;
        const every = P.ps.sprinting ? 2.4 : 2.0;
        if (P.stepAcc >= every) { P.stepAcc = 0; this.noise(P, P.ps.sprinting ? 'sprint' : 'walk'); }
      }
    }
  }

  // ───── 소리 탐지: 들을 수 있는 적에게 대략의 방향만 ─────
  noise(P, kind, at = null) {
    const r = NOISE[kind];
    if (!r) return;
    const x = at ? at.x : P.ps.x, z = at ? at.z : P.ps.z;
    for (const L of this.players.values()) {
      if (L.bot || !L.alive || !this.isEnemy(L, P)) continue;
      const dx = x - L.ps.x, dz = z - L.ps.z, d = Math.hypot(dx, dz);
      if (d > r || d < 1) continue;
      L.out.push({ e: 'snd', s: P.sndKey, k: kind, b: r3(quantBearing(dx, dz)), w: d < r * 0.35 ? 3 : d < r * 0.7 ? 2 : 1 });
    }
  }

  // ───── 사격 판정 ─────
  targetsAt(P, vt) {
    const out = [];
    for (const Q of this.players.values()) {
      if (Q === P) continue;
      const pose = poseAt(Q, vt);
      if (!pose.alive || !Q.alive) continue;
      out.push({ id: Q.id, x: pose.x, y: pose.y, z: pose.z, crouch: pose.crouch });
    }
    return out;
  }
  resolveShot(P, shot, vt) {
    const w = WEAPONS[shot.wi], cs = this.map.layout.colliders;
    const targets = this.targetsAt(P, vt).filter(t => this.isEnemy(P, this.players.get(t.id)));
    const st = this.wstat(P, w.id); st.shots++;
    if (!(w.snd && w.snd.vol === 0)) this.noise(P, isMelee(w) ? 'walk' : 'fire');
    const byVictim = new Map(), ends = [];
    if (shot.melee) {
      const h = castMelee(shot.o, P.ps.yaw, P.ps.pitch, shot.range, cs, targets);
      if (h) byVictim.set(h.id, { dmg: w.dmg * shot.mul, head: false, dist: h.t });
      this.emit({ e: 'mel', id: P.id }, Q => Q !== P);
    } else {
      for (const d of shot.dirs) {
        const r = castRay(shot.o, d, shot.range, cs, targets, shot.pierce);
        ends.push([r2(r.end.x), r2(r.end.y), r2(r.end.z), r.n]);
        r.hits.forEach((h, k) => {
          let dmg = calcDamage(w, h.part, h.t, { headMul: shot.headMul }) * shot.mul * Math.pow(shot.pierceMul, k);
          if (shot.close && h.t <= shot.close) dmg *= shot.closeMul;
          const a = byVictim.get(h.id) || { dmg: 0, head: false, dist: h.t };
          a.dmg += dmg; if (h.part === 'head') a.head = true;
          byVictim.set(h.id, a);
        });
      }
      this.emit({ e: 'shot', id: P.id, w: shot.wi, o: [r2(shot.o.x), r2(shot.o.y), r2(shot.o.z)], l: ends, c: shot.charged ? 1 : 0 }, Q => Q !== P);
    }
    for (const [id, a] of byVictim) {
      const V = this.players.get(id);
      if (!V || !V.alive) continue;
      st.hits++; if (a.head) st.heads++;
      const dealt = this.damage(P, V, a.dmg, { wi: shot.wi, how: shot.melee ? 'melee' : a.head ? 'head' : 'normal', part: a.head ? 'head' : 'body' });
      if (dealt <= 0) continue;
      if (shot.knock) { // 넉백 스킬: 맞은 적을 밀어내고 넘어뜨린다
        const dx = V.ps.x - P.ps.x, dz = V.ps.z - P.ps.z, l = Math.hypot(dx, dz) || 1;
        applyImpulse(V.ps, dx / l * shot.knock.force, 3, dz / l * shot.knock.force, 0.5);
        knockDown(V.ps, shot.knock.stun); V.meDirty = true; V.hitBy = { id: P.id, t: this.time };
        this.emit({ e: 'shove', id: V.id, by: P.id });
        shot.knock = null;
      }
      if (shot.bleed && V.alive) this.bleedHit(P, V, shot);
    }
  }
  bleedHit(P, V, shot) {
    const b = shot.bleed, list = (P.bleedHits.get(V.id) || []).filter(t => this.time - t < b.wait);
    list.push(this.time);
    if (list.length >= b.hits) { V.bleed = { by: P.id, wi: shot.wi, t: b.dur, dps: b.dps, acc: 0 }; list.length = 0; this.emit({ e: 'bleed', id: V.id }); }
    P.bleedHits.set(V.id, list);
  }
  wstat(P, wid) { return P.m.weapons[wid] || (P.m.weapons[wid] = { kills: 0, deaths: 0, dmg: 0, shots: 0, hits: 0, heads: 0 }); }

  // ───── 피해 → 처치 (기획 6장) ─────
  // info = { wi, how: head|normal|melee|blast|bleed|fall, part }. 반환: 실제로 준 피해
  damage(att, vic, amount, info) {
    if (this.state !== 'playing' || !vic.alive || amount <= 0) return 0;
    if (att && att !== vic && !this.isEnemy(att, vic)) return 0;
    const st = vic.ps.st;
    if (st.protect > 0 || st.invuln > 0) { if (att && !att.bot) att.out.push({ e: 'blk', id: vic.id }); return 0; } // 부활 보호·구르기 무적
    if (st.dr > 0) amount *= vic.ps.drMul;
    const dmg = Math.min(vic.hp, amount);
    vic.hp -= amount; vic.lastHurt = this.time; vic.meDirty = true;
    if (st.stealth > 0) st.stealth = 0;           // 스텔스: 피해를 받으면 풀린다
    if (att && att !== vic) {
      if (att.ps.st.stealth > 0) { att.ps.st.stealth = 0; att.meDirty = true; } // 피해를 주면 풀린다
      const c = vic.contrib.get(att.id) || { dmg: 0, t: 0 }; c.dmg += dmg; c.t = this.time; vic.contrib.set(att.id, c);
      vic.hitBy = { id: att.id, t: this.time };
      this.wstat(att, WEAPONS[info.wi] ? WEAPONS[info.wi].id : 'env').dmg += dmg;
    }
    this.emit({ e: 'dmg', to: vic.id, from: att ? att.id : -1, hp: Math.max(0, Math.ceil(vic.hp)), d: Math.round(dmg), h: info.how === 'head' ? 1 : 0, k: info.how });
    if (vic.hp <= 0.0001) this.kill(att, vic, info);
    return dmg;
  }
  kill(att, vic, info) {
    vic.alive = false; vic.ps.alive = false; vic.hp = 0; vic.deaths++;
    vic.respawnAt = this.time + this.respawnS; vic.meDirty = true; vic.bleed = null;
    const self = !att || att === vic;
    if (!self) att.kills++;
    // 어시스트 (기획 6.2: 표시는 나중, 기록은 지금부터): 최근 피해를 준 다른 적
    const assists = [];
    for (const [id, c] of vic.contrib) if (id !== (att && att.id) && this.time - c.t <= ASSIST_WINDOW) { const A = this.players.get(id); if (A) { A.assists++; assists.push(id); } }
    const w = WEAPONS[info.wi];
    if (w) { if (!self) this.wstat(att, w.id).kills++; }
    for (const l of vic.lo) this.wstat(vic, l.w.id).deaths += l.wi === vic.lo[vic.ps.cur].wi ? 1 : 0;
    this.rules.onKill(self ? null : att, vic);
    vic.killedBy = { k: self ? -1 : att.id, w: info.wi, how: info.how };
    this.emit({ e: 'kill', k: self ? -1 : att.id, v: vic.id, w: info.wi ?? -1, how: info.how, as: assists, sc: this.scores, kd: [...this.players.values()].map(Q => [Q.id, Q.kills, Q.deaths, Q.assists]), rs: this.respawnS });
  }

  // ───── 경기 진행 ─────
  startMatch(first = false) {
    this.state = 'playing';
    this.matchStart = this.time;
    this.endsAt = this.time + this.matchMs / 1000;
    this.overtime = false; this.overtimeAt = 0;
    this.scores = [0, 0]; this.grenades = [];
    this.rules.reset();
    this.spawnUse.clear();
    for (const P of this.players.values()) { P.kills = P.deaths = P.assists = P.caps = 0; P.m = { weapons: {} }; P.rematch = null; P.joinedAt = this.time; P.inq = []; }
    if (!first) {
      this.broadcast({ t: 'start', n: this.tickN, left: this.matchMs, goal: this.goal, sc: this.scores, players: [...this.players.values()].map(Q => this.info(Q)), ...this.rules.snapshot() });
      for (const P of this.players.values()) this.spawn(P);
    }
  }
  endMatch(res) {
    this.state = 'victory';
    this.resultAt = this.time + VICTORY_MS / 1000;
    this.restartAt = this.resultAt + RESULTS_MS / 1000;
    const dur = this.time - this.matchStart;
    const winTeam = this.cfg.teams ? res.winner : -1;
    const top = this.cfg.teams ? -1 : res.top ?? -1;
    const board = [...this.players.values()].map(P => ({ id: P.id, name: P.name, team: P.team, bot: !!P.bot, k: P.kills, d: P.deaths, a: P.assists, caps: P.caps, w: P.lo.map(l => l.w.id) }));
    for (const P of this.players.values()) {
      if (P.bot) continue;
      const result = this.cfg.teams ? (winTeam < 0 ? 'draw' : winTeam === P.team ? 'win' : 'loss') : (top < 0 ? 'draw' : top === P.id ? 'win' : 'loss');
      const acc = this.hub.account(P.sess);
      let xp = { xp: 0, ups: 0 };
      if (acc) xp = this.hub.record(P.sess, { sec: this.time - P.joinedAt, result, kills: P.kills, deaths: P.deaths, assists: P.assists, caps: P.caps, weapons: P.m.weapons });
      this.send(P, { t: 'end', wt: winTeam, top, sc: this.scores, dur: Math.round(dur), board, me: { result, ...xp, profile: acc ? this.hub.profileOf(P.sess) : null }, victory: VICTORY_MS, results: RESULTS_MS });
    }
  }
  finishResults() {
    // 결과 화면이 끝났다: 재매치를 고른 사람만 남는다 (고르지 않거나 로비를 고른 사람은 로비로)
    for (const P of this.humans()) if (P.rematch !== true) { const s = P.sess; this.players.delete(P.id); this.emit({ e: 'pl', id: P.id }); s.room = null; s.player = null; this.hub.toLobby(s); }
    if (!this.humans().length) { this.destroy(); return; }
    this.balanceBots();
    this.startMatch();
  }

  tick() {
    const t0 = performance.now();
    if (this.lastTickAt) perf.interval(t0 - this.lastTickAt);
    this.lastTickAt = t0;
    this.tick0();
    perf.tick(performance.now() - t0);
  }
  tick0() {
    this.tickN++; this.time += DT;
    if (this.state === 'victory' && this.time >= this.resultAt) this.state = 'results';
    if (this.state === 'results' && this.time >= this.restartAt) { this.finishResults(); if (!this.players.size) return; }
    if (this.state === 'playing') this.simulate();
    for (const P of this.players.values()) record(P, this.tickN);
    const b0 = performance.now();
    if (this.tickN % SNAP_EVERY === 0) this.sendSnapshots();
    this.flush();
    perf.bcast(performance.now() - b0);
  }
  simulate() {
    // 봇 생각 → cmd
    for (const P of this.players.values()) if (P.bot) this.runCmd(P, P.bot.think(DT));
    for (const P of this.players.values()) {
      if (P.bot) continue;
      if (INPUT_QUEUE) this.consume(P); else this.starveCheck(P);
    }
    if (this.state !== 'playing') return;
    tickProjectiles(this, DT);
    for (const P of this.players.values()) {
      if (!P.alive) {
        if (this.time >= P.respawnAt) this.spawn(P);
        continue;
      }
      const ps = P.ps;
      // 슬래시: 돌진하는 길의 적을 한 번씩 벤다
      if (P.slashHit && ps.mo && ps.mo.k === 'slash') {
        for (const V of this.players.values()) {
          if (!V.alive || !this.isEnemy(P, V) || P.slashHit.ids.has(V.id)) continue;
          if (Math.hypot(V.ps.x - ps.x, V.ps.z - ps.z) < 1.3 && Math.abs(V.ps.y - ps.y) < 1.4) { P.slashHit.ids.add(V.id); this.damage(P, V, P.slashHit.dmg, { wi: P.slashHit.wi, how: 'melee', part: 'body' }); }
        }
      } else P.slashHit = null;
      // 출혈 (지속 피해)
      if (P.bleed) {
        const b = P.bleed, A = this.players.get(b.by);
        b.t -= DT; b.acc += b.dps * DT;
        if (b.acc >= 1) { const d = Math.floor(b.acc); b.acc -= d; this.damage(A || null, P, d, { wi: b.wi, how: 'bleed', part: 'body' }); }
        if (b.t <= 0) P.bleed = null;
        if (!P.alive) continue;
      }
      // 스텔스: 적과 3m 안이면 풀린다
      if (ps.st.stealth > 0) {
        const sk = P.lo.map(l => l.skill).find(s => s && s.effect === 'stealth');
        for (const V of this.players.values()) if (V.alive && this.isEnemy(P, V) && Math.hypot(V.ps.x - ps.x, V.ps.y - ps.y, V.ps.z - ps.z) < (sk ? sk.range : 3)) { ps.st.stealth = 0; P.meDirty = true; break; }
      }
      // 체력 자동 회복 (기획 4.1)
      if (P.hp < HEALTH.max && this.time - P.lastHurt >= HEALTH.regenDelay) { P.hp = Math.min(HEALTH.max, P.hp + HEALTH.regenRate * DT); P.meDirty = true; }
      // 낙사: 처치자 = 최근에 피해·밀어내기를 준 적
      if (ps.y < KILL_Y) {
        const A = P.hitBy && this.time - P.hitBy.t <= ENV_CREDIT ? this.players.get(P.hitBy.id) : null;
        P.hp = 0; this.kill(A || null, P, { wi: A ? A.lo[A.ps.cur].wi : -1, how: 'fall' });
      }
    }
    // 모드 규칙 / 승패
    const timeUp = this.time >= this.endsAt;
    const res = this.rules.tick(DT, timeUp, this.overtime && this.time - this.overtimeAt >= ((this.cfg.dom && this.cfg.dom.overtimeMax) || 180));
    if (res.overtime && !this.overtime) { this.overtime = true; this.overtimeAt = this.time; this.emit({ e: 'ot' }); }
    if (res.over) this.endMatch(res);
  }

  // ───── 스냅샷 (30Hz) ─────
  flagsOf(P) {
    const ps = P.ps, st = ps.st;
    return ((ps.adsT > 0.5 ? PF.ads : 0) | (ps.sprinting && hSpeed(ps) > 1 ? PF.sprint : 0) | (!ps.ground && !ps.vault ? PF.air : 0) | (ps.slide > 0 ? PF.slide : 0)
      | (ps.crouch && ps.slide <= 0 ? PF.crouch : 0) | (ps.stun > 0 ? PF.stun : 0) | (st.stealth > 0 ? PF.stealth : 0) | (st.protect > 0 ? PF.protect : 0)
      | (st.invuln > 0 ? PF.invuln : 0) | (ps.w[ps.cur].rl > 0 ? PF.reload : 0) | (ps.mo && ps.mo.k === 'grapple' ? PF.grapple : 0)
      | (ps.mo && ps.mo.k !== 'grapple' ? PF.dash : 0) | (st.intro > 0 ? PF.intro : 0) | (st.dr > 0 ? PF.dr : 0));
  }
  sendSnapshots() {
    const rows = [];
    for (const P of this.players.values()) {
      if (!P.alive) continue;
      const ps = P.ps;
      rows.push([P.id, r3(ps.x), r3(ps.y), r3(ps.z), r3(ps.yaw), r3(ps.pitch), this.flagsOf(P), P.lo[ps.cur].wi, Math.ceil(P.hp), r3(crouchOf(ps)), r2(ps.vx), r2(ps.vy), r2(ps.vz)]);
    }
    for (const P of this.players.values()) {
      if (P.bot) continue;
      this.send(P, { t: 'snap', n: this.tickN, p: rows.filter(r => r[0] !== P.id) });
      if (P.meDirty) { P.meDirty = false; this.send(P, { t: 'me', q: P.doneSeq, k: P.tpn, n: this.tickN, hp: Math.ceil(P.hp), alive: P.alive, ps: P.ps }); }
    }
  }
  flush() {
    for (const P of this.players.values()) {
      if (P.bot || !P.out.length) continue;
      this.send(P, { t: 'ev', n: this.tickN, l: P.out });
      P.out = [];
    }
  }
}
