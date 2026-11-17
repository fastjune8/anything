// 사격, 재장전, 무기 교체, 탄약 관리
import { MAX_HP } from '/shared/constants.js';
import { rayWorld } from '/shared/collision.js';
import { camera, colliders } from './scene.js';
import { impact, addTracer, muzzleLight } from './fx.js';
import { remoteHit } from './remotes.js';
import { guns, showGun } from './viewmodel.js';
import { showHit } from './hud.js';
import { sfx } from './sfx.js';
import { me, inv, wp, inp, game, net, loadout, eff, adsInput, currentSpread, hSpeed, PITCH_MAX } from './state.js';
import { V3, UP, DEG, lerp, clamp } from './util.js';
import { rpmMul, heldSkill, heatShot, heatOf, grenadeMode, sk, resetSkills, onFire } from './skills.js';

const _o = new V3(), _d = new V3(), _f = new V3(), _r = new V3(), _u = new V3(), _mz = new V3();

// 총구 위치(월드 좌표). 정조준하면 화면 중앙으로 모인다
function muzzleWorld(out) {
  const k = wp.adsT;
  return out.set(lerp(0.13, 0, k), lerp(-0.11, -0.04, k), -0.75).applyQuaternion(camera.quaternion).add(camera.position);
}

// 한 발 쏘기: 탄 소모 → 탄도(퍼짐) 계산 → 벽/사람 맞힘 판정 → 서버에 알림 → 반동/이펙트/소리
function fire() {
  const w = eff[wp.cur], st = inv[wp.cur];
  st.ammo--; wp.cooldown = 60 / (w.rpm * rpmMul()); inp.fireFresh = false; // 아드레날린: 공격 속도 증가
  const charged = onFire(wp.cur); // 차지 샷 · 밀어내기 · 밀려나기 (스킬)
  camera.getWorldDirection(_f);
  _r.crossVectors(_f, UP).normalize(); _u.crossVectors(_r, _f);
  _o.copy(camera.position);
  const tanS = Math.tan(currentSpread() * DEG);
  const ends = [], hits = [];
  muzzleWorld(_mz);
  for (let i = 0; i < w.pellets; i++) {
    const rr = tanS * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
    _d.copy(_f).addScaledVector(_r, rr * Math.cos(th)).addScaledVector(_u, rr * Math.sin(th)).normalize();
    const wh = rayWorld(_o, _d, colliders);
    const eh = remoteHit(_o, _d, wh.t);
    let t = wh.t, n = wh.n;
    if (eh) { t = eh.t; n = 6; hits.push([eh.part, Math.round(t * 10) / 10, eh.id, +_d.x.toFixed(5), +_d.y.toFixed(5), +_d.z.toFixed(5), eh.n]); } // 방향·시각 번호: 서버가 그때 그 자리로 되돌려 확인한다
    const end = _o.clone().addScaledVector(_d, t);
    impact(end, n);
    addTracer(_mz, end);
    ends.push([+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2), n]);
  }
  net.send({ t: 'shot', w: wp.cur, o: [+_mz.x.toFixed(2), +_mz.y.toFixed(2), +_mz.z.toFixed(2)], e: ends });
  if (hits.length) {
    net.send({ t: 'hit', w: wp.cur, o: [+_o.x.toFixed(3), +_o.y.toFixed(3), +_o.z.toFixed(3)], hits }); // o: 쏜 눈 위치
    showHit(hits.some(h => h[0] === 'head'));
  }
  game.invUntil = 0; // 쏘면 스폰 무적 해제

  // 반동: 연사할수록 총구가 더 들리고 좌우로 쏠린다. 움직이거나 공중이면 커지고, 앉거나 정조준하면 줄어든다.
  const n = wp.burstN;
  if (n === 0) wp.burstSeed = Math.random() * Math.PI * 2;
  const ramp = w.auto ? 1 + Math.min(n, 10) * 0.07 : 1;
  const stance = (1 - 0.3 * wp.adsT) * (me.crouch ? 0.8 : 1) * (1 + Math.min(1, hSpeed() / 4.6) * 0.25) * (me.onGround ? 1 : 1.3);
  const rv = w.recoilV * DEG * stance * ramp * (0.9 + Math.random() * 0.2);
  me.pitch = Math.min(PITCH_MAX, me.pitch + rv * 0.55); wp.kickP += rv * 0.45; // 55% 는 돌아오지 않아 직접 눌러 줘야 한다
  // 좌우: 처음 몇 발은 거의 곧게, 이후 한쪽으로 쏠렸다 반대로 넘어가는 흐름 + 약간의 무작위
  const drift = Math.sin(n * 0.55 + wp.burstSeed) * Math.min(1, n / 3);
  const rh = (drift * 0.75 + (Math.random() * 2 - 1) * 0.45) * w.recoilH * DEG * stance * ramp;
  me.yaw += rh * 0.6; wp.kickY += rh * 0.4;
  wp.burstN = n + 1; wp.sinceShot = 0;
  wp.bloom = Math.min(w.bloomMax, wp.bloom + w.bloom);
  wp.vmKick = 1; wp.flashT = 0.045;
  guns[wp.cur].flash.rotation.z = Math.random() * Math.PI;
  guns[wp.cur].flash.scale.setScalar((w.pellets > 1 || w.scope ? 1.5 : 1) * (0.8 + Math.random() * 0.5) * (1 - 0.5 * wp.adsT));
  muzzleLight.position.copy(_mz); muzzleLight.intensity = 60;
  sfx.shot(w);
  if (charged) { sfx.mech('bolt', 1); guns[wp.cur].flash.scale.multiplyScalar(1.6); wp.vmKick = 1.6; } // 충전된 한 발
  if (w.bolt) sfx.mech('bolt', 1, 0, 0.5);
  if (w.shell) sfx.mech('pump', 1, 0, 0.28);
}

// 유탄 한 발: 서버가 날아가는 길과 폭발을 계산하고, 모두에게 알려 준다 (net.js 의 gl · boom)
function fireGrenade() {
  inp.fireFresh = false;
  if (sk.gl.ammo <= 0) { sfx.mech('dry'); return; }
  sk.gl.ammo--; wp.cooldown = 0.6;
  camera.getWorldDirection(_f);
  _o.copy(camera.position);
  net.send({ t: 'gl', o: [+_o.x.toFixed(3), +_o.y.toFixed(3), +_o.z.toFixed(3)], d: [+_f.x.toFixed(4), +_f.y.toFixed(4), +_f.z.toFixed(4)] });
  game.invUntil = 0;
  me.pitch = Math.min(PITCH_MAX, me.pitch + 2.2 * DEG); wp.kickP += 1.8 * DEG; wp.vmKick = 1.4; wp.flashT = 0.06;
  sfx.mech('pump', 1, 0, 0.5); sfx.impact(4, 0);
}

export function startReload() {
  if (grenadeMode()) return; // 유탄 모드에서는 재장전하지 않는다
  const w = eff[wp.cur], st = inv[wp.cur];
  if (wp.reload || wp.drawT > 0 || st.ammo >= w.mag || st.reserve <= 0 || !me.alive) return;
  wp.reload = { t: 0, total: w.shell ? 0.45 : w.reload, shell: !!w.shell, ev: 0, first: true };
  net.send({ t: 'rl', w: wp.cur });
}

// i: WEAPONS 번호. 들고 들어온 무기(무기고에서 고른 2개)로만 바꿀 수 있다.
export function switchTo(i) {
  if (i === wp.cur || !loadout.slots.includes(i) || !me.alive) return;
  wp.prev = wp.cur; wp.cur = i; wp.reload = null; wp.drawT = eff[i].draw; wp.adsT = 0; wp.bloom = 0; inp.fireFresh = false; wp.cooldown = 0;
  sfx.mech('draw');
  showGun();
}

const RELOAD_EV = [[0.15, 'magout'], [0.62, 'magin'], [0.88, 'bolt']]; // [재장전 진행도, 소리]
export function updateWeapon(dt, active) {
  const w = eff[wp.cur], st = inv[wp.cur];
  const can = active && me.alive && game.matchState !== 'ended' && !me.vault && !(me.stunT > 0); // 넘어가는 동안·넘어져 있는 동안은 쏠 수 없다
  wp.cooldown = Math.max(0, wp.cooldown - dt);
  wp.drawT = Math.max(0, wp.drawT - dt);
  wp.bloom = Math.max(0, wp.bloom - dt * (w.bloomMax || 1) * 3.2);
  // 사격을 멈추면 연사 카운트가 빠르게 풀린다 (끊어 쏘면 반동이 다시 작아진다)
  wp.sinceShot += dt;
  if (wp.sinceShot > Math.max(0.18, 96 / w.rpm)) wp.burstN = Math.max(0, wp.burstN - dt * 14);

  const rl = wp.reload;
  if (rl) {
    rl.t += dt;
    if (rl.shell) { // 산탄총: 한 발씩 장전
      if (rl.t >= rl.total) {
        st.ammo++; st.reserve--; sfx.mech('shell');
        if (st.ammo < w.mag && st.reserve > 0) { rl.t = 0; rl.total = w.reload; rl.first = false; }
        else { wp.reload = null; sfx.mech('pump', 0.8, 0, 0.18); wp.cooldown = Math.max(wp.cooldown, 0.45); }
      }
    } else {
      const f = rl.t / rl.total;
      while (rl.ev < RELOAD_EV.length && f >= RELOAD_EV[rl.ev][0]) sfx.mech(RELOAD_EV[rl.ev++][1]);
      if (f >= 1) {
        const n = Math.min(w.mag - st.ammo, st.reserve);
        st.ammo += n; st.reserve -= n; wp.reload = null;
      }
    }
  }

  const wantAds = can && adsInput() && !wp.reload && wp.drawT <= 0 && !wp.sprinting;
  wp.adsT = clamp(wp.adsT + (wantAds ? dt : -dt) / w.adsTime, 0, 1);
  const lowered = (wp.sprinting && !(heldSkill('sprint') && (inp.fireHeld || wp.sinceShot < 0.4))) || me.vault; // 질주 스킬: 쏘는 동안은 총을 든다
  wp.sprintT = lerp(wp.sprintT, lowered ? 1 : 0, 1 - Math.exp(-dt * 12)); // 넘어갈 때는 달릴 때처럼 총을 내린다

  const glMode = grenadeMode(), oh = heldSkill('overheat');
  if (glMode) { if (can && inp.fireFresh && wp.drawT <= 0 && wp.cooldown <= 0 && !wp.reload) fireGrenade(); }
  else if (can && (w.auto ? inp.fireHeld : inp.fireFresh) && wp.drawT <= 0 && wp.cooldown <= 0) {
    if (wp.reload && wp.reload.shell && st.ammo > 0) { wp.reload = null; wp.cooldown = 0.25; } // 산탄총은 장전 중 사격으로 끊을 수 있다
    else if (oh && heatOf(wp.cur).over) { if (inp.fireFresh) sfx.mech('dry'); inp.fireFresh = false; } // 과열: 다 식을 때까지 못 쏜다
    else if (!wp.reload) {
      if (st.ammo > 0) { if (oh) heatShot(oh); fire(); }
      else {
        if (inp.fireFresh) sfx.mech('dry');
        inp.fireFresh = false;
        startReload();
      }
    }
  }
  if (!w.auto && !inp.fireHeld) inp.fireFresh = false;

  // 반동 복귀
  const rec = Math.exp(-dt * 9);
  wp.kickP *= rec; wp.kickY *= rec;
  wp.vmKick *= Math.exp(-dt * 16);

  wp.flashT -= dt;
  guns[wp.cur].flash.visible = wp.flashT > 0;
  muzzleLight.intensity *= Math.exp(-dt * 40);
  if (muzzleLight.intensity < 0.05) muzzleLight.intensity = 0;
}

// ───── 부활/새 경기 때 상태 초기화 ─────
function resetLoadout() { eff.forEach((w, i) => { inv[i].ammo = w.mag; inv[i].reserve = w.reserve; }); wp.reload = null; wp.cooldown = 0; wp.bloom = 0; wp.burstN = 0; }
export function placeMe(p) {
  me.pos.set(p[0], p[1], p[2]); me.vel.set(0, 0, 0);
  me.yaw = Math.atan2(p[0], p[2]) || 0; me.pitch = 0; wp.kickP = wp.kickY = 0;
  me.hp = MAX_HP; me.alive = true; me.crouch = false; me.onGround = true; me.stepOff = 0; me.deadT = 0;
  me.vault = null; me.dashT = 0; me.dashCd = 0; me.dashV = null; me.stunT = 0; me.slideT = 0; me.kickCd = 0;
  resetLoadout(); resetSkills(); wp.drawT = eff[wp.cur].draw; showGun();
}
