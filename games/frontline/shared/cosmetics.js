// 캐릭터 옷(꾸미기) 규칙. 서버와 클라이언트 공용.
//  - 아이템·팔레트·기본 옷은 content/cosmetics.json (칸 설명: docs/CHARACTER_CUSTOMIZATION.md)
//  - 플레이어가 고른 값(choice) = { items: { 슬롯: 아이템id | null }, palette, skin }
//      슬롯이 없으면 기본 옷, null 이면 "벗음"(그 슬롯을 비운다)
//  - resolveOutfit(choice) 가 슬롯별 아이템·몸 가리기 비트를 정한다 (서버·모든 화면이 같은 결과)
//  - 꾸미기는 판정·이동에 아무 영향이 없다 (shared/hitbox.js 는 옷을 모른다)
import data from '../content/cosmetics.json' with { type: 'json' };
import { checkCosmetics } from './content/schema.js';

export const SLOTS = ['head', 'hair', 'upper', 'lower', 'hands', 'feet', 'back', 'waist', 'acc1', 'acc2'];
// 몸 영역 = 몸 메시 정점의 _REGION 번호 (Blender tools/blender/frontier_wear.py REGIONS 와 같은 순서)
export const REGIONS = ['head', 'neck', 'chest', 'abdomen', 'pelvis',
  'shoulder_l', 'upperarm_l', 'forearm_l', 'hand_l', 'thigh_l', 'shin_l', 'foot_l',
  'shoulder_r', 'upperarm_r', 'forearm_r', 'hand_r', 'thigh_r', 'shin_r', 'foot_r'];
// 1인칭 팔 모델에 있는 영역 (이 영역을 가리는 아이템은 fp 모델이 있어야 한다)
export const FP_REGIONS = ['chest', 'shoulder_l', 'upperarm_l', 'forearm_l', 'hand_l', 'shoulder_r', 'upperarm_r', 'forearm_r', 'hand_r'];

{
  const errors = checkCosmetics(data, { slots: SLOTS, regions: REGIONS, fpRegions: FP_REGIONS });
  if (errors.length) throw new Error('옷 데이터 오류 (content/cosmetics.json):\n  ' + errors.join('\n  '));
}

export const COLOR_SLOTS = data.colorSlots;     // 옷 재질 이름 = 색 칸 (이 순서가 셰이더의 색 번호)
export const MATERIALS = data.materials;        // 색 칸 → { rough, metal }
export const PALETTES = data.palettes;          // 팔레트 id → { 색 칸: '#rrggbb' }
export const TEAM_COLORS = data.teams;          // 팀전에서 team 칸 색
export const SKINS = data.skins;                // 피부색 (보이는 몸 = 머리·목 등)
export const DEFAULTS = data.defaults;
export const ITEMS = new Map(data.items.map(it => [it.id, it]));

const REGION_BIT = new Map(REGIONS.map((r, i) => [r, 1 << i]));
const FP_BITS = FP_REGIONS.reduce((m, r) => m | REGION_BIT.get(r), 0);
export const maskBits = names => (names || []).reduce((m, r) => m | (REGION_BIT.get(r) || 0), 0);

// 받은 값 정리: 없는 아이템·슬롯이 안 맞는 아이템·없는 팔레트는 버린다 (버린 슬롯 = 기본 옷)
//   owned(id) → bool 을 주면 갖지 않은 아이템도 버린다 (소유 시스템이 생기면 서버가 쓴다)
export function sanitizeOutfit(raw, owned = null) {
  const out = { items: {}, palette: DEFAULTS.palette, skin: DEFAULTS.skin };
  if (!raw || typeof raw !== 'object') return out;
  const items = raw.items && typeof raw.items === 'object' ? raw.items : {};
  for (const slot of SLOTS) {
    if (!(slot in items)) continue;
    const id = items[slot];
    if (id === null || id === '') { out.items[slot] = null; continue; }            // 벗음
    const it = typeof id === 'string' ? ITEMS.get(id) : null;
    if (it && it.slot === slot && (!owned || owned(id))) out.items[slot] = id;
  }
  if (typeof raw.palette === 'string' && PALETTES[raw.palette]) out.palette = raw.palette;
  if (Number.isInteger(raw.skin) && raw.skin >= 0 && raw.skin < SKINS.length) out.skin = raw.skin;
  return out;
}

// 고른 값 → 실제로 입는 것. { items: { 슬롯: 아이템 }, palette, skin, mask, fpMask }
//   기본 옷 채우기 → occupies(다른 슬롯 차지) / blocks(다른 슬롯 막기) / replaces(다른 슬롯을 다른 아이템으로) 적용
export function resolveOutfit(choice) {
  const c = choice || {};
  const pick = {};
  for (const slot of SLOTS) {
    const chosen = c.items && slot in c.items ? c.items[slot] : DEFAULTS.items[slot];
    const it = chosen ? ITEMS.get(chosen) : null;
    if (it && it.slot === slot) pick[slot] = it;
  }
  for (const slot of SLOTS) {                                   // 앞 슬롯이 우선 (결정적)
    const it = pick[slot]; if (!it) continue;
    for (const s of it.occupies || []) if (s !== slot) delete pick[s];
    for (const s of it.blocks || []) if (s !== slot) delete pick[s];
    for (const [s, id] of Object.entries(it.replaces || {})) if (pick[s]) pick[s] = ITEMS.get(id);
  }
  let mask = 0, fpMask = 0;
  for (const it of Object.values(pick)) {
    const m = maskBits(it.mask);
    mask |= m;
    if (it.fp) fpMask |= m & FP_BITS;
  }
  const palette = PALETTES[c.palette] ? c.palette : DEFAULTS.palette;
  const skin = Number.isInteger(c.skin) && c.skin >= 0 && c.skin < SKINS.length ? c.skin : DEFAULTS.skin;
  return { items: pick, palette, skin, mask, fpMask };
}

// 네트워크용 짧은 모양: [팔레트, 피부, [슬롯, 아이템id|0], …] — 기본 옷과 다른 슬롯만
export function packOutfit(choice) {
  const c = sanitizeOutfit(choice);
  const diff = SLOTS.filter(s => s in c.items && c.items[s] !== (DEFAULTS.items[s] || null)).map(s => [s, c.items[s] || 0]);
  return [c.palette, c.skin, ...diff];
}
export function unpackOutfit(ck) {
  if (!Array.isArray(ck)) return sanitizeOutfit(null);
  const [palette, skin, ...rest] = ck;
  const items = {};
  for (const e of rest) if (Array.isArray(e) && typeof e[0] === 'string') items[e[0]] = e[1] || null;
  return sanitizeOutfit({ items, palette, skin });
}

// 봇: 봇 번호로 정해진 모습 (난수 없음 → 다시 들어와도 같은 모습). 지금은 세트가 하나라 피부색만 다르다
export function botOutfit(n) {
  return sanitizeOutfit({ items: {}, palette: DEFAULTS.palette, skin: Math.abs(n | 0) % SKINS.length });
}

// 아이템 모델 경로 (view: 'tp' | 'fp'). fp 가 없는 아이템은 1인칭에서 그리지 않는다
export const modelPath = (it, view) => (view === 'fp' ? it.fp || null : it.tp);
