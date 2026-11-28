// 출전 무기 2자루 · 자리별 스킬 · 외형. 브라우저에 저장하고 서버(계정)에도 알린다 (로비의 `lo`).
//   규칙(같은 무기 두 번 금지, 고를 수 있는 스킬)은 shared/sim/player.js 의 makeLoadout — 서버도 같은 함수로 정리한다.
import { WEAPONS } from '/shared/weapons.js';
import { makeLoadout, loadoutWire } from '/shared/sim/player.js';
import { skillsFor } from '/shared/skills.js';
import { sanitizeOutfit, SLOTS as OUTFIT_SLOTS } from '/shared/cosmetics.js';
import { me, wp, net } from './state.js';
import { params } from './util.js';

const KEY = 'fd_loadout2', OUTFIT_KEY = 'fd_outfit';
const listeners = [];
export function onLoadoutChange(fn) { listeners.push(fn); }
const notify = () => { for (const fn of listeners) fn(-1); };

// 출전 정보: [{ id, skill }, { id, skill }]
export const loadout = { wire: loadoutWire(me.lo) };
function apply(wire, { save = true, tell = true } = {}) {
  me.lo = makeLoadout(wire);
  loadout.wire = loadoutWire(me.lo);
  wp.cur = me.lo[0].wi; wp.slot = 0;
  if (save) { try { localStorage.setItem(KEY, JSON.stringify(loadout.wire)); } catch { /* 저장 불가면 이번 접속만 */ } }
  if (tell) net.send({ t: 'lo', loadout: loadout.wire });
  notify();
}
{
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* 깨진 값 */ }
  const q = params.get('lo'); // 개발·테스트: ?lo=ar:dash,awm:grapple
  if (q) saved = q.split(',').map(p => { const [id, skill] = p.split(':'); return { id, skill }; });
  if (saved) apply(saved, { save: !q, tell: false });
}
// 서버가 계정에 저장해 둔 값 (다른 브라우저에서 고른 것)
export function fromServer(wire) { if (!localStorage.getItem(KEY) && Array.isArray(wire)) apply(wire, { tell: false }); else net.send({ t: 'lo', loadout: loadout.wire, outfit: outfit.choice }); }
// slot 자리에 무기 id. 다른 자리에 같은 무기가 있으면 맞바꾼다
export function equip(slot, id) {
  const w = loadout.wire.map(x => ({ ...x }));
  if (w[1 - slot].id === id) w[1 - slot] = { ...w[slot] };
  w[slot] = { id, skill: null };
  apply(w);
}
export function setSkill(slot, skillId) {
  const w = loadout.wire.map(x => ({ ...x }));
  w[slot].skill = skillId;
  apply(w);
}
export const skillChoices = slot => skillsFor(WEAPONS.find(w => w.id === loadout.wire[slot].id), slot);

// ───── 총기 스킨 (로비에서 무기마다 고르는 색 프리셋 — 이름은 modelrules.js 의 SKINS) ─────
//   이 브라우저에만 저장한다. 로비 미리보기(lobbyview.js)와 내 1인칭 총 모델(viewmodel.js applyGunSkins)에 입힌다. 다른 플레이어 화면에는 아직 보이지 않는다 (서버로 보내지 않음).
const GUNSKIN_KEY = 'fd_gunskin';
export const gunSkin = { choice: {} };
{
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(GUNSKIN_KEY)); } catch { /* 깨진 값 */ }
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) gunSkin.choice = saved;
}
export function setGunSkin(weaponId, name) {
  gunSkin.choice = { ...gunSkin.choice, [weaponId]: name };
  try { localStorage.setItem(GUNSKIN_KEY, JSON.stringify(gunSkin.choice)); } catch { /* 저장 불가면 이번 접속만 */ }
  notify();
}

// ───── 외형 (기획 11.3: 헤어·의상·의상 색·액세서리) ─────
export const outfit = { choice: { items: {} } };
const outfitListeners = [];
export function onOutfitChange(fn) { outfitListeners.push(fn); }
{
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(OUTFIT_KEY)); } catch { /* 깨진 값 */ }
  const raw = saved && typeof saved === 'object' ? saved : { items: {} };
  const q = params.get('outfit');
  if (q) for (const part of q.split(',')) {
    const [k, v] = part.split(':');
    if (k === 'none') { raw.items = Object.fromEntries(OUTFIT_SLOTS.map(s => [s, null])); continue; }
    if (k === 'palette') raw.palette = v; else if (k === 'skin') raw.skin = Number(v);
    else if (OUTFIT_SLOTS.includes(k)) { raw.items = raw.items || {}; raw.items[k] = v === '-' || !v ? null : v; }
  }
  outfit.choice = sanitizeOutfit(raw);
}
export function setOutfitChoice(choice) {
  outfit.choice = sanitizeOutfit(choice);
  try { localStorage.setItem(OUTFIT_KEY, JSON.stringify(outfit.choice)); } catch { /* 저장 불가 */ }
  net.send({ t: 'lo', outfit: outfit.choice });
  for (const fn of outfitListeners) fn(outfit.choice);
}
export function equipOutfit(slot, id) {
  const items = { ...outfit.choice.items };
  if (id === undefined) delete items[slot]; else items[slot] = id;
  setOutfitChoice({ ...outfit.choice, items });
}
export const outfitMessage = () => outfit.choice;
