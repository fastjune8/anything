// 왼손에 드는 두 번째 무기: 아킴보의 왼손 권총, 듀얼 쿠나이의 왼손 쿠나이.
//   무기 종류마다 만드는 법·포즈·표시 규칙이 달라서 종류별 항목(KINDS)으로 모아 둔다.
//   새로 두 손 무기를 만들면 KINDS 에 항목 하나를 더한다 — viewmodel.js 는 종류를 묻지 않고 show/pose 만 부른다.
//   pose(P, ctx): P = { p(위치), rx, ry, rz(회전) } 를 오른손 기준으로 받아 왼손 쪽을 배치하고, 필요하면 P 도 고친다. ctx = { kk(총 반동), g(오른손 총) }
import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';
import { buildGun } from '../guns.js';
import { defaultParts } from '../weaponview.js';
import { me, wp } from '../state.js';
import { poseClip, hasClip } from '../gunanim.js';

const kunaiBody = g => g.group.children[0]; // 쿠나이 모양 (팔 제외) — 던져서 손에 없으면 숨긴다

const KINDS = {
  // 아킴보: 오른손 총을 좌우로 뒤집은 복제. 쏜 손이 튄다
  akimbo(w, { vm, newFlash, rightGun }) {
    const gun = buildGun(w.id, true, defaultParts(w)); // 오른손 총과 같은 조준경, 팔까지 좌우로 뒤집는다
    gun.group.scale.x = -1;
    for (const g of [gun, rightGun]) if (g.armL) g.armL.visible = false; // 받치는 왼팔은 없다 (왼손은 왼쪽 총을 든다)
    const keep = new THREE.Vector3(), keepQ = new THREE.Quaternion(), mq = new THREE.Quaternion();
    gun.flash = newFlash(gun);
    gun.group.visible = false; vm.add(gun.group);
    return {
      gun,
      pose(P, { kk, g }) {
        const lk = wp.side === 1 ? kk : 0;
        if (wp.side === 1) { P.p.z -= kk * 0.035; P.rx -= kk * 0.045; }
        gun.group.position.set(-2 * Math.max(P.p.x, 0.12), 0, lk * 0.035);
        gun.group.rotation.set(lk * 0.05, -2 * P.ry, -2 * P.rz);
        gun.flash.visible = wp.flashT > 0 && wp.side === 1;
        if (wp.side === 1) g.flash.visible = false;
      },
      // 장전: 같은 클립을 좌우로 뒤집어 조금 늦게 재생한다 (pose 가 준 자리 위에 더한다)
      reload(f) {
        if (!hasClip(gun, 'reload')) return;
        const lf = f === null ? 0 : Math.max(0, (f - 0.035) / 0.965);
        poseClip(gun, 'reload', lf, false);
        const m = gun.motion;
        if (!m) return;
        keep.copy(gun.group.position); keepQ.copy(gun.group.quaternion);
        const under = 0.2 * Math.max(0, -m.p.x); // 교차할 때 왼손은 오른손 아래로 지나간다
        gun.group.position.set(keep.x - m.p.x, keep.y + m.p.y - under, keep.z + m.p.z);
        gun.group.quaternion.copy(keepQ).multiply(mq.set(m.q.x, -m.q.y, -m.q.z, m.q.w));
      },
    };
  },
  // 듀얼 쿠나이: 오른손 것을 좌우로 뒤집은 왼손 것 (팔까지 함께 뒤집는다, 받치는 왼팔은 숨긴다). 던진 손이 앞으로 뻗었다 돌아오고, 손에 없는 쿠나이는 안 보인다
  kunai(w, { vm, rightGun }) {
    const gun = buildGun(w.id, true, {});
    gun.group.scale.x = -1; gun.group.visible = false; vm.add(gun.group);
    for (const g of [gun, rightGun]) if (g.armL) g.armL.visible = false;
    return {
      gun,
      pose(P, { g }) {
        const ku = me.ps.ku, inHand = h => !ku || ku[h].s === 0 || ku[h].s === 4;
        const tr = Math.sin(Math.PI * Math.min(1, wp.kThrow[1])), tl = Math.sin(Math.PI * Math.min(1, wp.kThrow[0]));
        P.p.z -= tr * 0.12; P.p.y += tr * 0.03; P.rx -= tr * 0.25;
        gun.group.position.set(-2 * Math.max(P.p.x, 0.12), tr * -0.03 + tl * 0.03, tr * 0.12 - tl * 0.12);
        gun.group.rotation.set(-tl * 0.25 + tr * 0.25, -2 * P.ry, -2 * P.rz);
        kunaiBody(g).visible = inHand(1); kunaiBody(gun).visible = inHand(0);
      },
    };
  },
};

// guns: 오른손 총 목록 (무기 번호 순). newFlash(gun): 총구 불빛 메시를 만들어 달아 준다
export function createOffhands({ guns, vm, newFlash }) {
  const hands = new Map(); // 무기 번호 → { gun, pose }
  WEAPONS.forEach((w, wi) => { const make = KINDS[w.kind]; if (make) hands.set(wi, make(w, { vm, newFlash, rightGun: guns[wi] })); });
  return {
    show(cur) { for (const [wi, h] of hands) h.gun.group.visible = wi === cur; },
    pose(cur, P, ctx) { const h = hands.get(cur); if (h) h.pose(P, ctx); },
    gun(cur) { const h = hands.get(cur); return h && h.reload ? h.gun : null; }, // 왼손에 든 두 번째 "총" (아킴보)
    reload(cur, f) { const h = hands.get(cur); if (h && h.reload) h.reload(f); },
    each(fn) { for (const [wi, h] of hands) fn(wi, h.gun); }, // 왼손 총 전부 (무기 번호, 총) — 스킨 입히기 같은 일괄 처리용
  };
}
