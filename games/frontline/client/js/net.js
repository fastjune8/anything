// 서버 통신: 접속, 받은 메시지 처리, 내 상태 주기 전송. 메시지 종류는 docs/PROTOCOL.md 참고.
import { RESPAWN_MIN_MS, MAX_HP } from '/shared/constants.js';
import { WEAPONS } from '/shared/weapons.js';
import { addChatLine } from './chat.js';
import { impact, addTracer } from './fx.js';
import { feed, hurt, nameOf, sideOf, rosterSet, applyScores, showEnd, setHudOn } from './hud.js';
import { remotes, addRemote, removeRemote, clearRemotes } from './remotes.js';
import { sfx, audioAt } from './sfx.js';
import { me, wp, game, roster, net } from './state.js';
import { $, V3, NOLOCK, MODE, lerp, esc } from './util.js';
import { setText, setDisplay } from './dom.js';
import { placeMe } from './weapon.js';

const _v = new V3();

export function connect(name) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  net.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, mode: MODE }));
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
  ws.onclose = () => {
    if (net.ws !== ws) return;
    const was = game.joined; game.joined = false; net.ws = null;
    clearRemotes(); roster.clear(); game.matchState = 'idle';
    if (document.pointerLockElement) document.exitPointerLock();
    setDisplay($('pause'), false); setDisplay($('menu'), true, 'flex'); setHudOn(false);
    $('join').disabled = false;
    $('msg').textContent = was ? '서버와의 연결이 끊어졌습니다.' : '서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.';
  };
}

// 서버가 보낸 메시지 종류별 처리
function onMessage(m) {
  switch (m.t) {
    case 'welcome': {
      game.joined = true; me.id = m.id; me.team = m.team ?? -1; game.teamScores = m.ts || [0, 0];
      clearRemotes(); roster.clear();
      game.goalKills = m.goal; game.matchState = m.state; game.matchEndsAt = performance.now() + m.left; game.endAt = performance.now() + 10000;
      for (const p of m.players) { rosterSet(p); if (p.id !== m.id) addRemote(p); }
      setDisplay($('menu'), false); setHudOn(true);
      if (game.matchState === 'ended') showEnd(-1);
      if (!NOLOCK) setDisplay($('pause'), true, 'flex');
      break;
    }
    case 'pj':
      rosterSet(m.player); addRemote(m.player);
      if (!m.player.bot) feed(`<span class="w">${esc(m.player.name)} 입장</span>`);
      break;
    case 'pl': {
      const p = roster.get(m.id);
      if (p && !p.bot) feed(`<span class="w">${esc(p.name)} 퇴장</span>`);
      roster.delete(m.id); removeRemote(m.id);
      break;
    }
    case 'start':
      game.matchState = 'playing'; game.goalKills = m.goal; game.matchEndsAt = performance.now() + m.left; game.teamScores = m.ts || [0, 0];
      roster.clear();
      for (const p of m.players) { rosterSet(p); if (p.id !== me.id) addRemote(p); }
      feed('<span class="w">새 경기 시작</span>');
      break;
    case 'spawn':
      if (m.id === me.id) { placeMe(m.p); game.invUntil = performance.now() + (m.inv || 0); }
      else {
        const r = remotes.get(m.id);
        if (r) { r.alive = true; r.hasPos = true; r.deadT = 0; r.hp = MAX_HP; r.invUntil = performance.now() + (m.inv || 0); r.tpos.fromArray(m.p); r.pos.fromArray(m.p); }
      }
      break;
    case 's': { // 다른 사람의 위치/시선
      const r = remotes.get(m.id);
      if (!r) break;
      r.tpos.fromArray(m.p); r.tyaw = m.y; r.tpitch = m.x; r.crouchT = m.c ? 1 : 0; r.weapon = m.w | 0;
      if (!r.hasPos) { r.hasPos = true; r.pos.copy(r.tpos); }
      break;
    }
    case 'shot': {
      const w = WEAPONS[m.w]; if (!w) break;
      const o = new V3().fromArray(m.o), a = audioAt(o);
      sfx.shot(w, a.dist, a.pan);
      if (w.bolt) sfx.mech('bolt', a.att, a.pan, 0.5);
      const r = remotes.get(m.id);
      if (r) { r.rig.flash.position.copy(o); r.rig.flashT = 0.05; r.invUntil = 0; } // 쏜 사람은 무적이 풀린다
      for (const e of m.e || []) {
        const end = new V3(e[0], e[1], e[2]);
        addTracer(o, end);
        if (e[3] !== 6) { impact(end, e[3]); const ia = audioAt(end); if (ia.dist < 12) sfx.impact(ia.dist, ia.pan); }
      }
      break;
    }
    case 'rl': {
      const r = remotes.get(m.id);
      if (!r) break;
      const a = audioAt(r.pos); sfx.mech('magout', a.att, a.pan, 0.2); sfx.mech('magin', a.att, a.pan, 1.2);
      break;
    }
    case 'dmg':
      if (m.to === me.id) {
        const src = remotes.get(m.from);
        me.hp = m.hp; hurt(m.dmg, src ? src.pos : null);
        wp.kickP += (Math.random() - 0.3) * 0.02; wp.kickY += (Math.random() - 0.5) * 0.02;
        sfx.hurt();
        _v.copy(me.pos); _v.y += 1.2; impact(_v, -1);
      } else {
        const r = remotes.get(m.to);
        if (r) { r.hp = m.hp; _v.copy(r.pos); _v.y += lerp(1.25, 0.8, r.crouch); impact(_v, 6); }
      }
      break;
    case 'hp': me.hp = m.hp; break;
    case 'chat': addChatLine(String(m.name), String(m.text), m.id === me.id); break;
    case 'kill': {
      applyScores(m.sc); if (m.ts) game.teamScores = m.ts;
      const mine = m.killer === me.id, iDie = m.victim === me.id, w = WEAPONS[m.w];
      const kn = nameOf(m.killer), vn = nameOf(m.victim);
      feed(`<span class="${sideOf(m.killer)}">${esc(kn)}</span><span class="w">[${w ? w.name : '?'}]</span><span class="${sideOf(m.victim)}">${esc(vn)}</span>${m.head ? '<span class="hs">헤드샷</span>' : ''}`);
      if (mine) sfx.kill();
      if (iDie) {
        me.alive = false; me.hp = 0; wp.reload = null; game.respawnAt = performance.now() + RESPAWN_MIN_MS; // 이 시각 이후 아무 입력이나 하면 부활
        setText($('deadBy'), `${kn} 의 ${w ? w.name : ''}${m.head ? ' · 헤드샷' : ''}`);
      } else {
        const r = remotes.get(m.victim);
        if (r) { r.alive = false; r.hp = 0; }
      }
      break;
    }
    case 'end':
      applyScores(m.sc); if (m.ts) game.teamScores = m.ts;
      game.matchState = 'ended'; game.endAt = performance.now() + (m.restart || 10000);
      showEnd(m.winner, m.wt);
      break;
  }
}

// 내 위치/시선을 0.05초마다 서버로 (20회/초)
let sendAcc = 0;
export function sendState(dt) {
  sendAcc += dt;
  if (!game.joined || sendAcc < 0.05) return;
  sendAcc = 0;
  net.send({
    t: 's', p: [+me.pos.x.toFixed(3), +me.pos.y.toFixed(3), +me.pos.z.toFixed(3)],
    y: +me.yaw.toFixed(3), x: +(me.pitch + wp.kickP).toFixed(3), c: me.crouch ? 1 : 0, w: wp.cur,
  });
}
