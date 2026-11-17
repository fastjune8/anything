// 출전 무기(2개)와 무기별 파츠: 브라우저에 저장하고, 바뀌면 성능(eff)을 다시 계산해 듣는 쪽에 알린다.
// 규칙(어떤 파츠를 달 수 있는지, 성능 계산)은 shared/parts.js 에 있고 서버도 같은 것을 쓴다.
import { WEAPONS } from '/shared/weapons.js';
import { applyParts, sanitizeParts, sanitizeLoadout, getPart, weaponId } from '/shared/parts.js';
import { pickSkill, skillsFor } from '/shared/skills.js';
import { loadout, eff, wp, inv } from './state.js';
import { params } from './util.js';

const KEY = 'fd_loadout';

// 지금까지 얻은 무기. 아직 획득 시스템이 없어서 전부 가진 것으로 시작한다. (?owned=ar,m9 로 일부만 가진 화면을 확인할 수 있다)
const ownedParam = params.get('owned');
export const owned = new Set(ownedParam ? ownedParam.split(',') : WEAPONS.map(w => w.id));
if (ownedParam) for (const id of ['ar', 'm9']) owned.add(id); // 기본 무기는 항상 가진다

const listeners = [];
// fn(wi): wi 번 무기의 파츠가 바뀜, fn(-1): 출전 무기가 바뀜(전체 다시 그리기)
export function onLoadoutChange(fn) { listeners.push(fn); }
const notify = wi => { for (const fn of listeners) fn(wi); };

function refresh(wi) { Object.assign(eff[wi], applyParts(WEAPONS[wi], loadout.parts[wi])); }
function save() {
  const parts = {}, skills = {};
  WEAPONS.forEach((w, i) => { if (Object.keys(loadout.parts[i]).length) parts[w.id] = loadout.parts[i]; if (loadout.skills[i].some(Boolean)) skills[w.id] = loadout.skills[i]; });
  try { localStorage.setItem(KEY, JSON.stringify({ slots: loadout.slots.map(i => WEAPONS[i].id), parts, skills })); } catch { /* 저장 불가(사생활 보호 모드 등)면 이번 접속 동안만 유지 */ }
}
// 손에 든 무기를 1번으로 되돌린다 (로비에서 출전 무기를 바꿨을 때)
function holdFirst() { wp.cur = loadout.slots[0]; wp.prev = loadout.slots[1]; }

// 저장된 값 불러오기 (형식이 깨졌거나 없어진 무기/파츠는 버린다)
{
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* 깨진 값은 무시 */ }
  const sp = saved && typeof saved.parts === 'object' && saved.parts ? saved.parts : {};
  const ss = saved && typeof saved.skills === 'object' && saved.skills ? saved.skills : {};
  WEAPONS.forEach((w, i) => {
    loadout.parts[i] = sanitizeParts(w.id, sp[w.id]); refresh(i); inv[i].ammo = eff[i].mag;
    loadout.skills[i] = [0, 1].map(n => { const s = pickSkill(w, n, (ss[w.id] || [])[n]); return s ? s.id : null; }); // 자리마다 고를 수 있는 스킬 (처음엔 첫 번째)
  });
  const ids = saved && Array.isArray(saved.slots) ? saved.slots.map(weaponId).filter(id => owned.has(id)) : []; // 없어진 무기(M4·AK)는 기본 돌격소총으로
  loadout.slots = sanitizeLoadout(ids.map(id => ({ id }))).map(l => l.wi);
  holdFirst();
}

// slot(0/1)번 자리에 wi 번 무기를 넣는다. 이미 다른 자리에 있던 무기면 두 자리를 맞바꾼다.
export function equip(slot, wi) {
  if (!owned.has(WEAPONS[wi].id) || loadout.slots[slot] === wi) return;
  const other = 1 - slot;
  if (loadout.slots[other] === wi) loadout.slots[other] = loadout.slots[slot];
  loadout.slots[slot] = wi;
  holdFirst(); save(); notify(-1);
}

// wi 번 무기의 slotId 자리에 파츠를 단다. partId 가 없으면(null) 기본 상태로 되돌린다.
export function setPart(wi, slotId, partId) {
  if (partId && !getPart(WEAPONS[wi].id, slotId, partId)) return;
  if (partId) loadout.parts[wi][slotId] = partId; else delete loadout.parts[wi][slotId];
  refresh(wi); inv[wi].ammo = eff[wi].mag;
  save(); notify(wi);
}

// wi 번 무기를 slot(0 = 주무기, 1 = 보조무기) 자리에 들고 갈 때 쓸 스킬
export function setSkill(wi, slot, skillId) {
  if (!skillsFor(WEAPONS[wi], slot).some(s => s.id === skillId)) return;
  loadout.skills[wi][slot] = skillId;
  save(); notify(wi);
}

// 입장할 때 서버로 보내는 형식
export const loadoutMessage = () => loadout.slots.map((i, n) => ({ id: WEAPONS[i].id, parts: loadout.parts[i], skill: loadout.skills[i][n] }));
