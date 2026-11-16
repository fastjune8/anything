// 총기 파츠와 출전 무기(무기고에서 고른 2개) 규칙. 서버와 클라이언트 공용.
//  - 파츠는 성능 값에 배율(mul)을 곱한다. 모든 파츠는 좋아지는 값과 나빠지는 값을 함께 가진다 (단위 테스트가 확인한다).
//  - 서버는 입장할 때 받은 출전 무기를 sanitizeLoadout 으로 정리하고, 피해 계산에 applyParts 결과를 쓴다.
import { WEAPONS } from './weapons.js';

export const SLOTS = [
  { id: 'optic', name: '조준경' },
  { id: 'barrel', name: '총열' },
  { id: 'grip', name: '손잡이' },
  { id: 'mag', name: '탄창' },
  { id: 'stock', name: '개머리판' },
];

// mul 의 키는 shared/weapons.js 의 성능 이름. 예외: range = 피해가 줄기 시작하는/끝나는 거리(falloff) 둘 다.
// only / not: 장착할 수 있는 / 없는 무기 id.  quiet: 총소리가 작고 미니맵에 표시되지 않는다.
export const PARTS = {
  optic: [
    { id: 'reddot', name: '도트 사이트', mul: { adsTime: 0.88, ads: 1.2 }, not: ['awm'] },
    { id: 'acog', name: '4배율 조준경', mul: { adsFov: 0.55, ads: 0.8, adsTime: 1.22, hip: 1.1 }, only: ['m4', 'ak', 'mp5', 'm249'] },
    { id: 'scope_lo', name: '저배율 스코프', mul: { adsTime: 0.78, move: 1.03, adsFov: 1.8 }, only: ['awm'] },
    { id: 'scope_hi', name: '고배율 스코프', mul: { adsFov: 0.62, adsTime: 1.2, hip: 1.15 }, only: ['awm'] },
  ],
  barrel: [
    { id: 'suppressor', name: '소음기', quiet: true, mul: { range: 0.82, adsTime: 1.08, draw: 1.1 } },
    { id: 'comp', name: '보정기', mul: { recoilV: 0.8, recoilH: 1.15, bloom: 1.1 } },
    { id: 'long', name: '장총열', mul: { range: 1.2, ads: 0.85, hip: 0.92, adsTime: 1.12, draw: 1.12, move: 0.97 }, not: ['awm'] },
  ],
  grip: [
    { id: 'vertical', name: '수직 손잡이', mul: { recoilV: 0.85, adsTime: 1.08 }, only: ['m4', 'ak', 'mp5', 'm249'] },
    { id: 'angled', name: '앵글 손잡이', mul: { adsTime: 0.88, draw: 0.9, recoilH: 1.12 }, only: ['m4', 'ak', 'mp5', 'm249'] },
    { id: 'stubby', name: '스터비 손잡이', mul: { hip: 0.8, adsTime: 1.05, recoilH: 1.05 }, only: ['m4', 'ak', 'mp5', 'm249'] },
  ],
  mag: [
    { id: 'ext', name: '확장 탄창', mul: { mag: 1.34, reload: 1.15, adsTime: 1.05, move: 0.98 } },
    { id: 'fast', name: '신속 탄창', mul: { reload: 0.75, mag: 0.84 } },
  ],
  stock: [
    { id: 'light', name: '경량 개머리판', mul: { move: 1.04, adsTime: 0.9, recoilV: 1.12, recoilH: 1.1 }, not: ['m9'] },
    { id: 'heavy', name: '중량 개머리판', mul: { recoilV: 0.88, recoilH: 0.9, move: 0.96, adsTime: 1.08 }, not: ['m9'] },
  ],
};

// 성능 이름 → [표시 이름, 값이 클수록 좋은가]
const STAT = {
  recoilV: ['수직 반동', false], recoilH: ['수평 반동', false],
  hip: ['지향 사격 탄퍼짐', false], ads: ['정조준 탄퍼짐', false], bloom: ['연사 중 탄퍼짐 증가', false],
  adsTime: ['정조준 시간', false], reload: ['재장전 시간', false], draw: ['꺼내는 시간', false],
  move: ['이동 속도', true], mag: ['탄창 용량', true], range: ['유효 사거리', true], adsFov: ['확대 배율', true],
};

const usable = (part, weaponId) => (!part.only || part.only.includes(weaponId)) && !(part.not && part.not.includes(weaponId));

// 이 무기의 이 자리에 달 수 있는 파츠 목록
export function partsFor(weaponId, slotId) { return (PARTS[slotId] || []).filter(p => usable(p, weaponId)); }
export function getPart(weaponId, slotId, partId) { return partsFor(weaponId, slotId).find(p => p.id === partId) || null; }

// 받은 값에서 이 무기에 실제로 달 수 있는 파츠만 남긴다. 반환: { 자리: 파츠id }
export function sanitizeParts(weaponId, raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const s of SLOTS) if (typeof raw[s.id] === 'string' && getPart(weaponId, s.id, raw[s.id])) out[s.id] = raw[s.id];
  return out;
}

// 이 값이 이 무기에서 실제로 바뀌는가 (예: 저격소총은 거리별 피해 감소가 없어서 사거리 변화가 의미 없다)
function applies(base, key) {
  if (key === 'range') return !!base.falloff;
  return base[key] > 0;
}

// 무기 기본 성능에 파츠를 반영한 새 성능 객체. parts = { 자리: 파츠id }
export function applyParts(base, parts = {}) {
  const w = { ...base, snd: { ...base.snd }, falloff: base.falloff ? [...base.falloff] : null, quiet: false };
  for (const s of SLOTS) {
    const part = getPart(base.id, s.id, parts[s.id]);
    if (!part) continue;
    for (const [key, m] of Object.entries(part.mul)) {
      if (!applies(base, key)) continue;
      if (key === 'range') { w.falloff[0] *= m; w.falloff[1] *= m; }
      else w[key] *= m;
    }
    if (part.quiet) { w.quiet = true; w.snd.vol *= 0.3; w.snd.f *= 0.55; w.snd.dur *= 0.7; }
  }
  w.mag = Math.max(1, Math.round(w.mag));
  return w;
}

// 파츠 하나의 장단점 설명. 반환: { pros: [글], cons: [글] }
export function describePart(base, part) {
  const pros = [], cons = [];
  if (part.quiet) pros.push('총소리가 작아지고 쏴도 미니맵에 표시되지 않음');
  for (const [key, m] of Object.entries(part.mul)) {
    if (!applies(base, key)) continue;
    const [label, higherBetter] = STAT[key];
    let text, better;
    if (key === 'mag') {
      const n = Math.max(1, Math.round(base.mag * m));
      if (n === base.mag) continue;
      text = `${label} ${base.mag} → ${n}발`; better = n > base.mag;
    } else {
      const k = key === 'adsFov' ? 1 / m : m; // 시야각이 좁아질수록 배율이 커진다
      const pct = Math.round((k - 1) * 100);
      if (!pct) continue;
      text = `${label} ${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`; better = (k > 1) === higherBetter;
    }
    (better ? pros : cons).push(text);
  }
  return { pros, cons };
}

// ───── 출전 무기 ─────
export const LOADOUT_SIZE = 2;
export const DEFAULT_LOADOUT = ['m4', 'm9'];
const indexOfWeapon = id => WEAPONS.findIndex(w => w.id === id);

// 받은 값(입장 메시지 / 브라우저 저장값)을 "서로 다른 무기 2개 + 달 수 있는 파츠"로 정리한다.
// raw = [{ id, parts }, { id, parts }].  반환: [{ wi(WEAPONS 번호), id, parts }, …] (항상 2개)
export function sanitizeLoadout(raw) {
  const out = [];
  for (const e of Array.isArray(raw) ? raw.slice(0, LOADOUT_SIZE) : []) {
    const id = e && typeof e === 'object' ? e.id : null, wi = indexOfWeapon(id);
    if (wi < 0 || out.some(o => o.wi === wi)) continue;
    out.push({ wi, id, parts: sanitizeParts(id, e.parts) });
  }
  for (const id of [...DEFAULT_LOADOUT, ...WEAPONS.map(w => w.id)]) { // 모자라면 기본 무기로 채운다
    if (out.length >= LOADOUT_SIZE) break;
    if (!out.some(o => o.id === id)) out.push({ wi: indexOfWeapon(id), id, parts: {} });
  }
  return out;
}
