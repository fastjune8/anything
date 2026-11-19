// 의상 문서 (모델 에디터): 게임과 똑같은 몸·옷 코드로 옷을 입히고, 벗기고, 갈아입혀 본다.
//   - 게임의 charassets.makeInstance / outfit.js (dress · setOutfit · equip) 를 그대로 쓴다 → 여기서 되면 게임에서도 된다
//   - 옷 목록은 content/cosmetics.json 의 items 에서 읽는다 → 새 의상을 그 파일에 한 줄 더하면 (새로고침 없이 "새 의상 찾기") 칸 목록에 자동으로 나온다
//   - 아직 등록 전인 옷 .glb 는 화면에 끌어다 놓거나 "의상 .glb 입혀 보기" 로 바로 입혀 본다 (임시: 저장되지 않는다)
//   - 아무것도 저장하지 않는다 (입는 설정은 게임의 옷 고르기가 따로 저장). 오른쪽의 "탈부착·교체 검사" 가 장착·해제·교체·누수를 실제로 돌려 본다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { tpAsset, fpAsset, makeInstance, registerWearableBuffer, forgetWearable } from '/js/charassets.js';
import { dress, setOutfit, outfitState, setTeamColor, undress } from '/js/outfit.js';
import { ITEMS, PALETTES, SKINS, SLOTS, DEFAULTS, TEAM_COLORS, REGIONS, FP_REGIONS, resolveOutfit } from '/shared/cosmetics.js';
import { el, html } from '../util.js';

import { SLOT_LABEL, regionName } from '../wearlabels.js';
export { SLOT_LABEL, regionName };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex = n => `0x${(n >>> 0).toString(16)}`;

// 카메라 자리: 방위(az) · 높낮이(el) · 거리 · 바라보는 높이(ty)
const VIEWS = [
  ['front', '정면', 0, 0.08, 3.4, 0.85], ['back', '뒷면', Math.PI, 0.08, 3.4, 0.85], ['side', '옆', -Math.PI / 2, 0.08, 3.4, 0.85], ['three_q', '3/4', 0.7, 0.15, 3.4, 0.85],
  ['upper', '상체', 0.5, 0.1, 1.5, 1.15], ['legs', '하체', 0.5, 0.05, 1.8, 0.55], ['head', '머리', 0.45, 0.05, 0.9, 1.45], ['feet', '발', 0.6, 0.2, 0.9, 0.12],
];

export async function createWardrobeDoc(ctx, id, opts = {}) {
  const { canvas, renderer } = ctx;
  if (!tpAsset) throw new Error('게임의 캐릭터 모델(content/characters)을 읽을 수 없습니다');

  // ───────── 상태 ─────────
  let choice = { items: { ...DEFAULTS.items }, palette: DEFAULTS.palette, skin: DEFAULTS.skin };
  let team = null; // null | 'ally' | 'foe'
  const tmpIds = new Set(); // 이 문서에서 임시로 입힌 옷 (닫으면 목록에서 뺀다)

  // ───────── 화면 조각 ─────────
  const sec = (title, inner) => `<div class="tbx-h">${title}</div><div>${inner}</div>`;
  const overlay = html('div', '', '<div class="vhint" data-r="vhint">끌기 = 돌리기 · 휠 = 확대 · 오른쪽 끌기 = 이동 · .glb 를 놓으면 그 옷을 입혀 봅니다</div><div class="vhint" data-r="fpLabel" style="left:auto;right:14px;bottom:auto"></div>');
  const tools = html('div', '', sec('① 옷 고르기', '<div class="wd-slots" data-r="slots"></div><p class="note" data-r="slotNote"></p>')
    + sec('② 한 번에', '<div class="wd-quick"><button type="button" data-r="qDefault" title="게임의 기본 복장으로">기본 복장</button><button type="button" data-r="qStrip" title="모든 칸을 벗는다 (몸이 다시 보이는지 확인)">전부 벗기</button></div>')
    + sec('③ 새 의상 입혀 보기', `<div class="wd-drop"><label class="kv">칸<select data-r="tmpSlot"></select></label>
      <button type="button" data-r="tmpBtn" title="Blender 에서 내보낸 의상 .glb (규칙: docs/CHARACTER_CUSTOMIZATION.md)">의상 .glb 입혀 보기…</button><input type="file" accept=".glb" data-r="tmpFile" hidden>
      <button type="button" data-r="rescan" title="content/cosmetics.json 에 새로 추가된 의상을 목록에 더한다">새 의상 찾기</button></div>
      <p class="note">.glb 를 화면에 놓으면 지금 골라 둔 "칸"에 입혀 봅니다 (저장되지 않는 임시 입기). 정식으로 쓰려면 cosmetics.json 에 한 줄 추가.</p>`)
    + sec('색 · 피부', `<label class="kv">팔레트<select data-r="palSel"></select></label><label class="kv">피부<span class="skins" data-r="skins"></span></label>
      <label class="kv">팀 색<select data-r="teamSel"><option value="">없음 (팔레트 색)</option><option value="ally">아군</option><option value="foe">적군</option></select></label>`)
    + sec('보기', `<div class="wd-views" data-r="views">${VIEWS.map(v => `<button type="button" data-view="${v[0]}">${v[1]}</button>`).join('')}</div>
      <label class="tog"><input type="checkbox" data-r="showFP" checked> 1인칭 창 (게임 카메라)</label>
      <label class="kv">자세<select data-r="clipSel"></select></label>
      <div class="motionbar"><button type="button" data-r="cPlay" title="재생 / 멈춤 (Space)">❚❚</button><input type="range" min="0" max="1" step="0.001" value="0" data-r="cScrub"><span class="status" data-r="cTime"></span></div>`)
    + '<p class="note">조작법과 튜토리얼은 ? (F1)</p>');
  for (const h of tools.querySelectorAll('.tbx-h')) h.addEventListener('click', () => h.classList.toggle('shut'));
  const toolbar = html('div', '', `<span class="grp"><span class="gl">의상 입혀 보기</span><span class="status">게임과 같은 몸 · 같은 옷 코드 — 저장할 것은 없습니다</span></span><span class="grow"></span>
    <span class="grp"><button type="button" data-r="tourBtn" title="모델 에디터 사용법 안내 (1분)">튜토리얼</button></span>`);
  const inspector = html('div', '', `<h2>입고 있는 옷</h2><div class="wd-worn" data-r="worn"></div><p class="note" data-r="maskNote"></p>
    <h2 class="sub2">탈부착 · 교체 검사</h2><p class="note">장착 → 해제 → 교체 → 반복(누수)을 실제로 돌려 봅니다. 끝나면 지금 입은 옷으로 돌아옵니다.</p>
    <div class="btns"><button type="button" class="primary" data-r="runChecks">검사 실행</button></div><div class="checks" data-r="checkOut"></div>`);
  const r = n => overlay.querySelector(`[data-r="${n}"]`) || tools.querySelector(`[data-r="${n}"]`) || toolbar.querySelector(`[data-r="${n}"]`) || inspector.querySelector(`[data-r="${n}"]`);

  // ───────── 3D ─────────
  const pmrem = new THREE.PMREMGenerator(renderer), envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  function mkScene(ground) {
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x30353f); s.environment = envTex; s.environmentIntensity = 0.55;
    s.add(new THREE.HemisphereLight(0xcfe0f0, 0x4a4234, 1.2));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(2, 4, 3); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; // 게임과 같은 그림자 설정 (다르면 줄무늬가 생긴다)
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 12 });
    s.add(sun);
    if (ground) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0x4a505c, roughness: 0.95 })); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; s.add(g);
      const grid = new THREE.GridHelper(10, 20, 0x666d7a, 0x444a55); s.add(grid);
    }
    return s;
  }
  const tpScene = mkScene(true), fpScene = mkScene(false);
  const tp = makeInstance(tpAsset), fp = fpAsset ? makeInstance(fpAsset) : null;
  tpScene.add(tp.root); if (fp) fpScene.add(fp.root);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50), fpCam = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
  const controls = new OrbitControls(camera, canvas); controls.disconnect(); controls.enableDamping = true; controls.minDistance = 0.4; controls.maxDistance = 8;
  function setView(name) {
    const v = VIEWS.find(x => x[0] === name); if (!v) return;
    const [, , az, el2, dist, ty] = v;
    camera.position.set(Math.sin(az) * Math.cos(el2) * dist, ty + Math.sin(el2) * dist, Math.cos(az) * Math.cos(el2) * dist);
    controls.target.set(0, ty, 0); controls.update();
    for (const b of r('views').children) b.classList.toggle('on', b.dataset.view === name);
  }

  // ───────── 애니메이션 ─────────
  const tpMix = new THREE.AnimationMixer(tp.root), fpMix = fp ? new THREE.AnimationMixer(fp.root) : null;
  let tpAct = null, paused = false;
  function setClip(name) {
    const clip = tpAsset.clips.get(name); if (!clip) return false;
    tpMix.stopAllAction(); tpAct = tpMix.clipAction(clip); tpAct.reset().play(); paused = false; r('cPlay').textContent = '❚❚';
    return true;
  }
  for (const n of tpAsset.clips.keys()) r('clipSel').appendChild(new Option(n.replace(/^TP_/, ''), n));
  if (fpAsset && fpMix) { const c = fpAsset.clips.get('FP_Rifle_Idle') || [...fpAsset.clips.values()][0]; if (c) fpMix.clipAction(c).play(); }
  r('clipSel').value = tpAsset.clips.has('TP_Idle') ? 'TP_Idle' : [...tpAsset.clips.keys()][0];
  r('clipSel').addEventListener('change', () => setClip(r('clipSel').value));
  r('cPlay').addEventListener('click', togglePlay);
  r('cScrub').addEventListener('input', () => { paused = true; r('cPlay').textContent = '▶'; if (tpAct) { tpAct.time = Number(r('cScrub').value) * tpAct.getClip().duration; tpAct.paused = true; tpMix.update(0); } });
  function togglePlay() { paused = !paused; if (tpAct) tpAct.paused = paused; r('cPlay').textContent = paused ? '▶' : '❚❚'; }
  setClip(r('clipSel').value);

  // ───────── 옷 입히기 (게임과 같은 핸들) ─────────
  const hTP = dress(tp, choice, { view: 'tp' }), hFP = fp ? dress(fp, choice, { view: 'fp' }) : null;
  const handles = () => [hTP, hFP].filter(Boolean);
  const pending = () => handles().some(h => outfitState(h).pending);
  const ready = async () => { for (let i = 0; i < 400 && pending(); i++) await sleep(25); await sleep(40); };
  const itemsOf = slot => [...ITEMS.values()].filter(i => i.slot === slot);

  function applyChoice() { for (const h of handles()) setOutfit(h, choice); }
  function setChoice(next) { choice = next; applyChoice(); syncUI(); queueInfo(); }
  const equipSlot = (slot, itemId) => setChoice({ ...choice, items: { ...choice.items, [slot]: itemId || null } });
  const stripAll = () => setChoice({ ...choice, items: Object.fromEntries(SLOTS.map(s => [s, null])) });
  const resetDefault = () => { team = null; r('teamSel').value = ''; applyTeam(); setChoice({ items: { ...DEFAULTS.items }, palette: DEFAULTS.palette, skin: DEFAULTS.skin }); };
  function applyTeam() { const c = team ? TEAM_COLORS[team] : null; for (const h of handles()) setTeamColor(h, c); }

  // ───────── 왼쪽: 칸마다 하나 고르기 ─────────
  const slotRows = new Map(); // slot → { row, sel }
  function buildSlots() {
    const box = r('slots'); box.replaceChildren(); slotRows.clear();
    const lonely = [];
    for (const slot of SLOTS) {
      const list = itemsOf(slot);
      if (!list.length && !(slot in DEFAULTS.items)) continue; // 옷이 하나도 없는 칸(허리·소품 …)은 감춘다
      const row = el('div', 'wd-slot'); row.dataset.slot = slot;
      const sel = el('select'); sel.dataset.slot = slot;
      sel.appendChild(new Option('(벗음)', ''));
      for (const it of list) sel.appendChild(new Option(`${it.name}${it.tmp ? ' · 임시' : ''}`, it.id));
      sel.addEventListener('change', () => equipSlot(slot, sel.value || null));
      const off = el('button', 'mini', '×'); off.type = 'button'; off.title = '이 칸을 벗기'; off.addEventListener('click', () => equipSlot(slot, null));
      row.append(el('span', 'lb', SLOT_LABEL[slot] || slot), sel, off);
      box.appendChild(row); slotRows.set(slot, { row, sel });
      if (list.length < 2) lonely.push(SLOT_LABEL[slot] || slot);
    }
    r('slotNote').textContent = !lonely.length ? '' : lonely.length === slotRows.size ? '모든 칸에 옷이 1벌씩이라 "교체"는 아직 해 볼 수 없습니다. 새 의상을 cosmetics.json 에 추가한 뒤 "새 의상 찾기", 또는 ③ 으로 .glb 를 입혀 보면 칸 목록에서 바로 바꿔 볼 수 있습니다.' : `${lonely.join(' · ')}: 옷이 1벌뿐이라 교체는 아직 해 볼 수 없습니다.`;
    // ③ 의 칸 목록
    const ts = r('tmpSlot'), keep = ts.value; ts.replaceChildren();
    for (const slot of SLOTS) if (itemsOf(slot).length || slot in DEFAULTS.items) ts.appendChild(new Option(SLOT_LABEL[slot] || slot, slot));
    if (keep && [...ts.options].some(o => o.value === keep)) ts.value = keep;
    syncUI();
  }
  function syncUI() {
    for (const [slot, { sel }] of slotRows) sel.value = choice.items[slot] && ITEMS.has(choice.items[slot]) ? choice.items[slot] : '';
    const pal = r('palSel'); if (pal.value !== choice.palette) pal.value = choice.palette;
    for (const b of r('skins').children) b.classList.toggle('on', Number(b.dataset.skin) === choice.skin);
  }
  for (const k of Object.keys(PALETTES)) r('palSel').appendChild(new Option(k, k));
  r('palSel').addEventListener('change', () => setChoice({ ...choice, palette: r('palSel').value }));
  SKINS.forEach((c, i) => { const b = el('button', 'sw'); b.type = 'button'; b.dataset.skin = i; b.style.background = c; b.title = `피부 ${i + 1}`; b.addEventListener('click', () => setChoice({ ...choice, skin: i })); r('skins').appendChild(b); });
  r('teamSel').addEventListener('change', () => { team = r('teamSel').value || null; applyTeam(); });
  r('qDefault').addEventListener('click', resetDefault);
  r('qStrip').addEventListener('click', stripAll);
  for (const b of r('views').children) b.addEventListener('click', () => setView(b.dataset.view));
  r('tourBtn').addEventListener('click', () => ctx.tour && ctx.tour('model'));

  // ───────── 새 의상 찾기 (cosmetics.json 다시 읽기) · 임시 .glb ─────────
  async function rescan() {
    const j = await fetch('/content/cosmetics.json', { cache: 'no-store' }).then(x => (x.ok ? x.json() : null)).catch(() => null);
    if (!j) { ctx.flash('content/cosmetics.json 을 읽을 수 없습니다'); return 0; }
    let n = 0;
    for (const it of j.items || []) if (!ITEMS.has(it.id)) { ITEMS.set(it.id, it); n++; }
    for (const [k, v] of Object.entries(j.palettes || {})) if (!PALETTES[k]) { PALETTES[k] = v; r('palSel').appendChild(new Option(k, k)); }
    buildSlots();
    ctx.flash(n ? `새 의상 ${n}벌을 찾았습니다` : '새 의상이 없습니다 (cosmetics.json 에 한 줄을 더하고 다시 눌러 보세요)');
    ctx.log(n ? `의상 목록 새로 고침: 새 의상 ${n}벌` : '의상 목록 새로 고침: 새 의상 없음', n ? 'ok' : 'info');
    return n;
  }
  r('rescan').addEventListener('click', rescan);
  async function wearGlb(buffer, name, slot) {
    slot = slot || r('tmpSlot').value;
    const base = itemsOf(slot).find(i => !i.tmp) || null; // 같은 칸 기존 옷의 가리기·붙이기 설정을 빌린다
    const safe = name.replace(/\.glb$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'wear';
    const itemId = `tmp_${safe}`, path = `tmp/${itemId}.glb`;
    forgetWearable(path);
    const asset = await registerWearableBuffer(path, buffer);
    if (!asset || !asset.parts.length) { forgetWearable(path); ctx.flash('옷으로 읽을 수 없는 .glb 입니다'); ctx.log(`임시 의상 실패: ${name} — 몸과 같은 뼈 이름·재질(색 칸) 규칙인지 확인 (docs/CHARACTER_CUSTOMIZATION.md)`, 'error'); return null; }
    const item = { id: itemId, name: name.replace(/\.glb$/i, ''), slot, tp: path, mount: base ? base.mount : 'skin', mask: base ? [...base.mask] : [], rarity: 'common', unlock: { type: 'default' }, tags: ['tmp'], tmp: true };
    ITEMS.set(itemId, item); tmpIds.add(itemId);
    if (choice.items[slot] === itemId) { choice = { ...choice, items: { ...choice.items, [slot]: null } }; applyChoice(); } // 같은 파일을 다시 불러오면 새로 입힌다
    buildSlots(); equipSlot(slot, itemId);
    ctx.log(`임시 입기: ${name} → ${SLOT_LABEL[slot] || slot} (저장되지 않음, 1인칭 모델 없음)`, 'ok');
    return itemId;
  }
  r('tmpBtn').addEventListener('click', () => r('tmpFile').click());
  r('tmpFile').addEventListener('change', async () => { const f = r('tmpFile').files[0]; r('tmpFile').value = ''; if (f) await wearGlb(await f.arrayBuffer(), f.name); });

  // ───────── 오른쪽: 입고 있는 옷 ─────────
  let infoQ = 0;
  async function queueInfo() { const n = ++infoQ; await ready(); if (n === infoQ) renderInfo(); }
  function renderInfo() {
    const st = outfitState(hTP), stFP = hFP ? outfitState(hFP) : null, res = resolveOutfit(choice), box = r('worn'); box.replaceChildren();
    for (const slot of SLOTS) {
      const want = choice.items[slot], it = want ? ITEMS.get(want) : null, put = res.items[slot], w = st.worn[slot];
      if (!it && !slotRows.has(slot)) continue;
      const row = el('div', 'wd-w');
      let state, cls = '';
      if (!it) { state = '벗음'; cls = 'dim'; }
      else if (!put || put.id !== it.id) { state = `막힘 — ${[...Object.values(res.items)].find(x => (x.occupies || []).includes(slot) || (x.blocks || []).includes(slot))?.name || '다른 옷'} 때문에 입을 수 없음`; cls = 'warn'; }
      else if (!w) { state = '불러오는 중…'; cls = 'dim'; }
      else if (!w.meshes) { state = '입혀지지 않음 — 뼈 이름·파일 확인'; cls = 'bad'; }
      else { const needFP = (it.mask || []).some(m => FP_REGIONS.includes(m)); state = `입음 (3인칭 ${w.meshes}개${w.skinned ? ' · 몸과 같은 뼈대' : ' · 뼈에 붙임'}${it.fp ? (stFP && stFP.worn[slot] && stFP.worn[slot].meshes ? ' · 1인칭 있음' : ' · 1인칭 준비 중') : needFP ? ' · 1인칭 모델 없음 — 1인칭에서는 맨팔이 보임' : ''})`; if (!it.fp && needFP) cls = 'warn'; }
      row.append(el('b', '', `${SLOT_LABEL[slot] || slot}`), el('span', '', it ? it.name : '—'), el('small', cls, state));
      if (it && it.mask && it.mask.length) row.appendChild(el('small', 'dim', `가리는 몸: ${it.mask.map(regionName).join(', ')}`));
      box.appendChild(row);
    }
    const hidden = REGIONS.filter((_, i) => (st.mask >> i) & 1);
    r('maskNote').textContent = `지금 가려진 몸 영역 ${hidden.length}곳 (마스크 ${hex(st.mask)}${stFP ? ` · 1인칭 ${hex(stFP.mask)}` : ''}) — 옷을 벗으면 그 영역이 다시 보여야 합니다.`;
  }

  // ───────── 탈부착 · 교체 검사 ─────────
  const wearIn = root => { const o = []; root.traverse(x => { if (x.userData.wear) o.push(x); }); return o; };
  const idsIn = root => wearIn(root).map(x => `${x.userData.wear.slot}:${x.userData.wear.id}`).sort();
  async function runChecks() {
    const btn = r('runChecks'); btn.disabled = true; r('checkOut').replaceChildren(el('div', 'sum', '검사하는 중…'));
    const out = [], add = (level, text) => out.push({ level, text });
    const saved = JSON.parse(JSON.stringify(choice)), savedTeam = team;
    const none = Object.fromEntries(SLOTS.map(s => [s, null]));
    const set = items => { choice = { ...choice, items: { ...none, ...items } }; applyChoice(); };
    const maskOf = h => outfitState(h).mask;
    try {
      // 1. 전부 벗기
      set({}); await ready();
      add(wearIn(tp.root).length === 0 && (!fp || wearIn(fp.root).length === 0) && maskOf(hTP) === 0 && (!hFP || maskOf(hFP) === 0) ? 'ok' : 'fail', '전부 벗기: 옷 메시가 모두 사라지고 몸 가리기가 0 이 된다 (3인칭·1인칭)');
      // 2. 칸마다: 입기 → 벗기
      for (const slot of SLOTS) {
        const list = itemsOf(slot); if (!list.length) continue;
        const it = list[0], tag = `${SLOT_LABEL[slot] || slot} [${it.name}]`;
        set({ [slot]: it.id }); await ready();
        const res = resolveOutfit(choice), w = outfitState(hTP).worn[slot], wf = hFP ? outfitState(hFP).worn[slot] : null;
        const onOk = !!w && w.meshes > 0 && maskOf(hTP) === res.mask && (!it.fp || !hFP || (!!wf && wf.meshes > 0 && maskOf(hFP) === res.fpMask));
        set({}); await ready();
        const offOk = wearIn(tp.root).length === 0 && maskOf(hTP) === 0 && (!hFP || (wearIn(fp.root).length === 0 && maskOf(hFP) === 0));
        add(onOk && offOk ? 'ok' : 'fail', `${tag}: 입기(메시 · 몸 가리기${it.fp ? ' · 1인칭' : ''}) → 벗기(메시 제거 · 몸 복원)${onOk ? '' : ' — 입히기 실패'}${offOk ? '' : ' — 벗기기 실패'}`);
      }
      // 3. 같은 칸에서 교체 (옷이 2벌 이상인 칸만)
      const multi = SLOTS.filter(s => itemsOf(s).length >= 2), single = SLOTS.filter(s => itemsOf(s).length === 1).map(s => SLOT_LABEL[s] || s);
      if (!multi.length) add('warn', `교체: 건너뜀 — 옷이 2벌 이상인 칸이 없어 실제 교체는 확인하지 못했습니다 (${single.join(' · ')} 은 1벌뿐). 새 의상을 추가하거나 ③ 으로 .glb 를 입혀 본 뒤 다시 검사하세요`);
      for (const slot of multi) {
        const [A, B] = itemsOf(slot), other = SLOTS.find(s => s !== slot && itemsOf(s).length), tag = `${SLOT_LABEL[slot] || slot} [${A.name} ↔ ${B.name}]`;
        const base = other ? { [other]: itemsOf(other)[0].id } : {};
        set({ ...base, [slot]: A.id }); await ready();
        const before = other ? Object.fromEntries(wearIn(tp.root).filter(x => x.userData.wear.slot === other).map(x => [x.uuid, 1])) : {};
        set({ ...base, [slot]: B.id }); await ready();
        const idsTP = idsIn(tp.root), idsFP = fp ? idsIn(fp.root) : [];
        const gone = ![...idsTP, ...idsFP].some(s => s === `${slot}:${A.id}`), there = idsTP.includes(`${slot}:${B.id}`);
        const keep = !other || wearIn(tp.root).filter(x => x.userData.wear.slot === other).every(x => before[x.uuid]);
        add(gone && there ? 'ok' : 'fail', `${tag}: A → B 교체 — A 메시가 사라지고 B 만 남는다 (추가되지 않는다)`);
        if (other) add(keep ? 'ok' : 'fail', `${tag}: 교체해도 다른 칸(${SLOT_LABEL[other] || other})의 옷은 그대로(같은 메시) 유지된다`);
        set({ ...base, [slot]: A.id }); await ready();
        choice = { ...choice, items: { ...choice.items, [slot]: B.id } }; applyChoice(); // 같은 순간에 B → A 를 연달아 요청: 마지막(A)이 이겨야 한다
        choice = { ...choice, items: { ...choice.items, [slot]: A.id } }; applyChoice(); await ready();
        const fin = idsIn(tp.root).filter(s => s.startsWith(`${slot}:`));
        add(fin.length && fin.every(s => s === `${slot}:${A.id}`) ? 'ok' : 'fail', `${tag}: 빠르게 A → B → A 를 요청하면 마지막 요청(A)이 입혀진다`);
      }
      // 4. 누수: 무작위로 계속 갈아입어도 GPU 형상·장면 노드가 늘지 않는다
      const all = SLOTS.filter(s => itemsOf(s).length);
      const swaps = async n => { for (let i = 0; i < n; i++) { const s = all[Math.floor(Math.random() * all.length)], l = itemsOf(s), k = Math.floor(Math.random() * (l.length + 1)); choice = { ...choice, items: { ...choice.items, [s]: k < l.length ? l[k].id : null } }; applyChoice(); if (i % 6 === 0) await ready(); } await ready(); await sleep(120); };
      await swaps(60); const g1 = renderer.info.memory.geometries, n1 = tpScene.children.length + fpScene.children.length;
      await swaps(60); const g2 = renderer.info.memory.geometries, n2 = tpScene.children.length + fpScene.children.length;
      set({}); await ready();
      add(g2 <= g1 && n2 === n1 ? 'ok' : 'fail', `갈아입기 120회: GPU 형상 ${g1} → ${g2}, 장면 노드 ${n1} → ${n2} (늘지 않아야 한다)`);
      add(wearIn(tp.root).length === 0 ? 'ok' : 'fail', '갈아입기가 끝난 뒤 전부 벗으면 남는 옷 메시가 없다');
    } catch (e) { add('fail', `검사 중 오류: ${e.message || e}`); }
    set(saved.items); choice = { ...choice, palette: saved.palette, skin: saved.skin }; team = savedTeam; applyChoice(); applyTeam(); syncUI(); await ready(); renderInfo();
    const fails = out.filter(c => c.level === 'fail').length, skips = out.filter(c => c.level === 'warn').length, box = r('checkOut'); box.replaceChildren();
    box.appendChild(el('div', `sum ${fails ? 'bad' : 'good'}`, fails ? `실패 ${fails}개` : skips ? `통과 (건너뛴 것 ${skips}개 — 확인하지 못한 항목)` : '모두 통과'));
    for (const c of out) box.appendChild(el('div', `ck ${c.level}`)).appendChild(el('span', '', c.text));
    ctx.log(`의상 검사: ${out.filter(c => c.level === 'ok').length} 통과 · ${fails} 실패 · ${skips} 건너뜀`, fails ? 'error' : 'ok');
    btn.disabled = false;
    return out;
  }
  r('runChecks').addEventListener('click', () => runChecks());

  // ───────── 문서 ─────────
  const _sz = new THREE.Vector2(), _c = new THREE.Color();
  const doc = {
    kind: 'wear', editor: 'model', key: 'wear:edit', id: 'edit', title: '의상 입혀 보기', icon: '♙', is3D: true, overlay, tools, toolbar, inspector,
    activate() { controls.connect(); renderer.toneMappingExposure = 0.85; canvas.style.cursor = 'grab'; },
    deactivate() { controls.disconnect(); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    frame(dt = 1 / 60) {
      if (!paused) { tpMix.update(dt); if (fpMix) fpMix.update(dt); if (tpAct) r('cScrub').value = (tpAct.time % tpAct.getClip().duration) / tpAct.getClip().duration; }
      else if (fpMix) fpMix.update(dt);
      const t = tpAct ? tpAct.time : 0; r('cTime').textContent = `${t.toFixed(2)}초`;
      controls.update();
      renderer.getSize(_sz);
      renderer.render(tpScene, camera);
      const showFP = r('showFP').checked && fp;
      r('fpLabel').textContent = '';
      if (showFP) { // 1인칭 창: 게임 카메라(원점 = 눈, 시야각 52°) 그대로
        const w = Math.min(420, _sz.x * 0.38), h = w * 0.62, x = _sz.x - w - 12, y = 12, prevA = renderer.getClearAlpha();
        renderer.getClearColor(_c);
        const keepAuto = renderer.autoClear; renderer.autoClear = false;
        renderer.setScissorTest(true); renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
        renderer.setClearColor(0x30353f, 1); renderer.clear(true, true, false);
        fpCam.aspect = w / h; fpCam.updateProjectionMatrix(); renderer.render(fpScene, fpCam);
        renderer.setScissorTest(false); renderer.setViewport(0, 0, _sz.x, _sz.y); renderer.autoClear = keepAuto; renderer.setClearColor(_c, prevA);
        const lb = r('fpLabel'); lb.textContent = '1인칭 (게임 카메라)'; lb.style.top = `${_sz.y - y - h - 24}px`;
      }
    },
    isDirty: () => false,
    save: async () => { ctx.flash('의상 화면은 저장할 것이 없습니다 — 옷을 추가하려면 content/cosmetics.json'); return true; },
    focus(o = {}) { if (o.select) { const it = ITEMS.get(o.select); if (it) { if (!slotRows.has(it.slot)) buildSlots(); equipSlot(it.slot, it.id); } } },
    dropFile: async file => { await wearGlb(await file.arrayBuffer(), file.name); },
    onKeyDown(e) { if (e.metaKey || e.ctrlKey) return; if (e.code === 'Space') { e.preventDefault(); togglePlay(); } else if (e.code === 'KeyF') setView('front'); },
    dispose() {
      controls.dispose(); tpMix.stopAllAction(); if (fpMix) fpMix.stopAllAction();
      for (const h of handles()) undress(h);
      for (const t of tmpIds) { ITEMS.delete(t); forgetWearable(`tmp/${t}.glb`); }
      pmrem.dispose(); envTex.dispose();
      tpScene.traverse(o => { if (o.isMesh && o.geometry && !o.isSkinnedMesh && o.geometry.type === 'PlaneGeometry') { o.geometry.dispose(); o.material.dispose(); } });
    },
    api: { tp, fp, hTP, hFP, get choice() { return choice; }, state: () => ({ tp: outfitState(hTP), fp: hFP ? outfitState(hFP) : null, choice, resolved: resolveOutfit(choice), tpWear: idsIn(tp.root), fpWear: fp ? idsIn(fp.root) : [], geometries: renderer.info.memory.geometries }),
      equip: equipSlot, strip: stripAll, reset: resetDefault, setChoice, ready, runChecks, rescan, wearGlb, setView, setClip, rows: slotRows, itemsOf },
  };
  buildSlots(); setView('front'); queueInfo();
  if (opts.select) doc.focus(opts);
  return doc;
}
