// 홈 (허브): 게임의 모든 데이터를 종류별로 한눈에 보고, 고를 것을 편집기로 연다.
//   왼쪽 = 종류 (맵 · 모델 · 무기 · 파츠 · 모드 · 효과), 가운데 = 카드 목록, 오른쪽 = 고른 것의 자세한 정보 + 연결된 데이터 + 편집기로 열기
import { buildLayout } from '/shared/maps/build.js';
import { calcDamage } from '/shared/weapons.js';
import { describePart } from '/shared/parts.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const $ = id => document.getElementById(id);

// 편집기 종류 (새 편집기는 여기에 더한다. soon = 아직 없음)
export const EDITORS = {
  map: { name: '맵 에디터', icon: '▦' },
  model: { name: '모델 에디터', icon: '⌐' },
  data: { name: '데이터 에디터', icon: '≡' },
  effect: { name: '효과 에디터', icon: '✺', soon: true },
};
// 데이터 종류
export const CATS = [
  { group: '콘텐츠', id: 'maps', label: '맵', icon: '▦', editor: 'map', desc: '전장 배치 — 구조물·엄폐물·스폰 지점·거점' },
  { group: '콘텐츠', id: 'models', label: '모델', icon: '⌐', editor: 'model', desc: 'Blender 로 만든 총·물체 모델 (.glb). 규칙 검사·1인칭·파츠·스킨 미리 보기' },
  { group: '게임 데이터', id: 'weapons', label: '무기', icon: '✦', editor: 'data', desc: '총의 성능 수치 — 피해·연사·탄창·반동 …' },
  { group: '게임 데이터', id: 'parts', label: '파츠', icon: '⚙', editor: 'data', desc: '총에 다는 부품 — 자리별 파츠와 장단점' },
  { group: '게임 데이터', id: 'modes', label: '모드', icon: '⚑', editor: 'data', desc: '게임 방식 — 인원·목표 점수·점령전 수치' },
  { group: '준비 중', id: 'effects', label: '효과', icon: '✺', editor: 'effect', soon: true, desc: '스킬·총구 화염·피격 효과. 스킬 시스템과 함께 추가됩니다' },
];

// 맵 미리보기: 위에서 본 구조물 + 스폰 + 거점
export function drawMapThumb(def, w = 400, h = 300) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#20281f'; g.fillRect(0, 0, w, h);
  let layout;
  try { layout = buildLayout(def); } catch { return c; }
  const half = def.half + 2, k = Math.min(w, h) / (half * 2), ox = w / 2, oy = h / 2;
  const X = x => ox + x * k, Y = z => oy + z * k;
  for (const b of layout.colliders) {
    g.fillStyle = b.minY >= 2.2 ? 'rgba(226,218,180,.25)' : b.maxY > 2.2 ? '#cfc7a3' : '#a39a74';
    g.fillRect(X(b.minX), Y(b.minZ), Math.max(1, (b.maxX - b.minX) * k), Math.max(1, (b.maxZ - b.minZ) * k));
  }
  for (const zn of def.zones || []) { g.beginPath(); g.arc(X(zn.x), Y(zn.z), zn.r * k, 0, Math.PI * 2); g.fillStyle = 'rgba(255,180,58,.25)'; g.fill(); g.strokeStyle = '#ffb43a'; g.lineWidth = 2; g.stroke(); }
  const dot = (p, col) => { g.beginPath(); g.arc(X(p[0]), Y(p[1]), 2.6, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
  if (def.spawns.team) { def.spawns.team[0].forEach(p => dot(p, '#5aa9ff')); def.spawns.team[1].forEach(p => dot(p, '#ff4b3a')); }
  else def.spawns.ffa.forEach(p => dot(p, '#e9ecef'));
  return c;
}

export function createHome(ctx) {
  let cat = 'maps', sel = null, query = '', modelKind = 'gun';
  const data = { maps: [], models: [], weapons: [], parts: null, modes: [] };

  async function load() {
    const get = u => fetch(u, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [mapIds, gunIds, weapons, parts, modes] = await Promise.all([get('/content/maps/index.json'), get('/content/guns/index.json'), get('/content/weapons.json'), get('/content/parts.json'), get('/content/modes.json')]);
    data.maps = (await Promise.all((mapIds || []).map(id => get(`/content/maps/${id}.json`)))).filter(Boolean);
    data.models = await Promise.all((gunIds || []).map(async id => {
      const head = await fetch(`/content/guns/${id}.glb`, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
      return { id, kind: 'gun', bytes: head ? Number(head.headers.get('content-length')) || 0 : 0 };
    }));
    data.weapons = weapons || []; data.parts = parts; data.modes = modes || [];
    render();
  }

  // ───────── 종류별 카드 ─────────
  const count = id => ({ maps: data.maps.length, models: data.models.length, weapons: data.weapons.length, parts: data.parts ? Object.values(data.parts.parts).flat().length : 0, modes: data.modes.length, effects: 0 }[id]);
  const docOf = key => ctx.docs().get(key);
  const statePill = key => { const d = docOf(key); return d ? (d.isDirty() ? ['저장 안 됨', 'warn'] : ['열림', 'good']) : null; };

  function items() {
    switch (cat) {
      case 'maps': return data.maps.map(m => ({
        key: `map:${m.id}`, title: m.name, sub: `${m.id} · ${m.half * 2}×${m.half * 2}m · 물체 ${m.objects.length}개`, thumb: () => drawMapThumb(m, 400, 240), def: m,
      }));
      case 'models': return modelKind === 'gun' ? data.models.map(m => ({ key: `gun:${m.id}`, title: m.id, sub: `총 · ${(m.bytes / 1024).toFixed(0)}KB`, icon: '⌐', def: m })) : [];
      case 'weapons': {
        const maxDmg = Math.max(...data.weapons.map(w => w.dmg * w.pellets)), maxRpm = Math.max(...data.weapons.map(w => w.rpm));
        return data.weapons.map(w => ({ key: `weapon:${w.id}`, title: w.name, sub: `${w.cls} · ${w.id}`, icon: '✦', def: w,
          bars: [['피해', w.dmg * w.pellets / maxDmg], ['연사', w.rpm / maxRpm], ['사거리', w.falloff ? Math.min(1, w.falloff[1] / 100) : 1], ['이동', (w.move - 0.75) / 0.35]] }));
      }
      case 'parts': return data.parts ? data.parts.slots.flatMap(s => (data.parts.parts[s.id] || []).map(p => ({ key: `part:${s.id}:${p.id}`, title: p.name, sub: `${s.name} · ${p.id}`, icon: '⚙', def: p, slot: s }))) : [];
      case 'modes': return data.modes.map(m => ({ key: `mode:${m.id}`, title: m.name, sub: `${m.teams ? `${m.max / 2} 대 ${m.max / 2}` : `최대 ${m.max}명`} · 맵 ${m.map}`, icon: '⚑', def: m }));
      case 'effects': return [['총구 화염', '쏠 때 총구의 불꽃'], ['피격', '맞았을 때 튀는 것'], ['스킬 효과', '스킬 발동·명중 연출']].map(([t, s]) => ({ key: `effect:${t}`, title: t, sub: s, icon: '✺', soon: true }));
    }
    return [];
  }

  function render() {
    // 왼쪽: 종류
    const nav = $('homeNav'); nav.replaceChildren();
    let group = '';
    for (const c of CATS) {
      if (c.group !== group) { group = c.group; nav.appendChild(el('h4', '', group)); }
      const b = el('button', `cat${c.id === cat ? ' on' : ''}`); b.type = 'button'; b.dataset.cat = c.id;
      b.append(el('span', 'ic', c.icon), el('span', '', c.label), c.soon ? el('span', 'pill soon', '준비 중') : el('span', 'n', String(count(c.id))));
      b.addEventListener('click', () => { cat = c.id; sel = null; query = ''; render(); });
      nav.appendChild(b);
    }
    nav.appendChild(el('h4', '', '편집기'));
    for (const e of Object.values(EDITORS)) {
      const d = el('div', 'cat'); d.style.cursor = 'default';
      d.append(el('span', 'ic', e.icon), el('span', '', e.name), e.soon ? el('span', 'pill soon', '준비 중') : el('span'));
      nav.appendChild(d);
    }

    // 가운데: 머리 + 카드
    const c = CATS.find(x => x.id === cat), head = $('homeHead'); head.replaceChildren();
    const ht = el('div'); ht.append(el('h2', '', `${c.icon} ${c.label}`), el('p', '', c.desc)); head.appendChild(ht);
    const acts = el('div', 'acts');
    if (!c.soon) {
      const search = el('input'); search.type = 'search'; search.placeholder = '찾기'; search.value = query; search.id = 'homeSearch';
      search.addEventListener('input', () => { query = search.value; renderCards(); });
      acts.appendChild(search);
    }
    if (cat === 'maps') acts.appendChild(btn('+ 새 맵', () => ctx.openAsset(`map:new${Date.now()}`, { create: true }), 'primary', 'newMapBtn'));
    if (cat === 'models') {
      const seg = el('div', 'seg');
      for (const [k, label] of [['gun', '총'], ['prop', '물체 (준비 중)']]) { const b = btn(label, () => { modelKind = k; sel = null; render(); }, k === modelKind ? 'on' : ''); seg.appendChild(b); }
      acts.append(seg, btn('.glb 열기', () => $('fileIn').click(), '', 'openGlbBtn'), btn('예시 모델', () => ctx.openAsset('gun:sample'), '', 'sampleBtn'));
    }
    if (['weapons', 'parts', 'modes'].includes(cat)) acts.appendChild(btn('데이터 에디터로 열기', () => ctx.openAsset(`data:${cat}`), 'primary'));
    head.appendChild(acts);
    renderCards(); renderDetail();
  }

  function renderCards() {
    const box = $('homeCards'); box.replaceChildren();
    const list = items().filter(it => !query || `${it.title} ${it.sub}`.toLowerCase().includes(query.toLowerCase()));
    for (const it of list) {
      // 그림이 있는 것(맵)은 큰 카드, 나머지는 작은 카드 (아이콘 + 글)
      const card = el('div', `acard${it.thumb ? '' : ' compact'}${sel === it.key ? ' on' : ''}${it.soon ? ' soon' : ''}`); card.dataset.asset = it.key;
      const th = el('div', 'thumb');
      if (it.thumb) th.appendChild(it.thumb()); else th.textContent = it.icon;
      const body = el('div', 'body'), t = el('div', 't');
      if (!it.thumb) t.append(el('span', 'ic', it.icon));
      t.append(el('span', '', it.title));
      const st = it.soon ? ['준비 중', 'soon'] : statePill(it.key);
      if (st) t.append(el('span', `pill ${st[1]}`, st[0]));
      body.append(t, el('div', 's', it.sub));
      if (it.bars) { const b = el('div', 'bars'); for (const [k, v] of it.bars) { const i = el('i'); i.style.width = `${Math.max(4, Math.min(1, v) * 100)}%`; b.append(el('span', '', k), el('span')); b.lastChild.appendChild(i); } body.appendChild(b); }
      card.append(...(it.thumb ? [th, body] : [body]));
      if (!it.soon) {
        card.addEventListener('click', () => { sel = it.key; renderCards(); renderDetail(); });
        card.addEventListener('dblclick', () => open(it));
      }
      box.appendChild(card);
    }
    if (cat === 'models' && modelKind === 'prop') box.appendChild(Object.assign(el('p', 'note', '물체 모델(상자·컨테이너 같은 맵 물체를 Blender 로 만든 것)은 다음 단계에서 추가됩니다. 지금 맵 물체는 코드로 만든 기본 모양입니다.'), { style: 'grid-column: 1 / -1' }));
    else if (!list.length && !query) box.appendChild(Object.assign(el('p', 'note', cat === 'models' ? '아직 저장된 모델이 없습니다. ".glb 열기" 로 Blender 에서 내보낸 파일을 열거나 "예시 모델" 을 보세요.' : '없습니다.'), { style: 'grid-column: 1 / -1' }));
  }

  // 편집기로 열기
  function open(it) {
    const [kind, id, id2] = it.key.split(':');
    if (kind === 'map' || kind === 'gun') ctx.openAsset(it.key);
    else if (kind === 'weapon') ctx.openAsset('data:weapons', { select: id });
    else if (kind === 'part') ctx.openAsset('data:parts', { slot: id, select: id2 });
    else if (kind === 'mode') ctx.openAsset('data:modes', { select: id });
  }

  // ───────── 오른쪽: 자세히 ─────────
  function renderDetail() {
    const box = $('homeDetail'); box.replaceChildren();
    const it = items().find(x => x.key === sel);
    if (!it) { box.appendChild(el('p', 'emptyd', '카드를 누르면 여기에 자세한 정보가 나옵니다.\n두 번 누르면 편집기로 엽니다.')); return; }
    if (it.thumb) { const big = el('div', 'big'); big.appendChild(drawMapThumb(it.def, 600, 380)); box.appendChild(big); } // 그림이 있는 것(맵)만 큰 미리보기
    box.append(el('h2', '', `${it.thumb ? '' : it.icon + ' '}${it.title}`), el('div', 'sub', it.sub));
    const ed = EDITORS[CATS.find(x => x.id === cat).editor];
    const acts = el('div', 'acts');
    acts.appendChild(btn(`${ed.icon} ${ed.name}로 열기`, () => open(it), 'primary', 'openSel'));
    if (cat === 'maps') acts.appendChild(btn('▶ 이 맵으로 시험 플레이', async () => { const d = await ctx.openAsset(it.key); if (d && d.play) d.play(); }));
    box.appendChild(acts);
    const dl = el('dl'), row = (k, v) => dl.append(el('dt', '', k), el('dd', '', v));
    const rel = (title, list) => {
      box.appendChild(el('h4', '', title));
      const r = el('div', 'rel');
      if (!list.length) r.appendChild(el('span', 'note', '없음'));
      for (const [label, fn] of list) r.appendChild(btn(label, fn));
      box.appendChild(r);
    };
    const go = (c, key) => () => { cat = c; sel = key; render(); };
    if (cat === 'maps') {
      const m = it.def;
      row('파일', `content/maps/${m.id}.json`); row('크기', `${m.half * 2} × ${m.half * 2} m`); row('물체', `${m.objects.length}개`);
      row('스폰', `개인전 ${m.spawns.ffa.length}곳${m.spawns.team ? ` · 팀 ${m.spawns.team.map(t => t.length).join(' / ')}` : ' · 팀 없음'}`); row('거점', `${(m.zones || []).length}개`);
      box.appendChild(dl);
      rel('이 맵을 기본 맵으로 쓰는 모드', data.modes.filter(x => x.map === m.id).map(x => [x.name, go('modes', `mode:${x.id}`)]));
    } else if (cat === 'models') {
      row('파일', `content/guns/${it.def.id}.glb`); row('크기', `${(it.def.bytes / 1024).toFixed(0)} KB`); row('게임 연결', '아직 (다음 단계)');
      box.appendChild(dl);
    } else if (cat === 'weapons') {
      const w = it.def, dps = calcDamage(w, 'body', 10) * w.pellets * w.rpm / 60;
      row('분류', w.cls); row('피해', `${w.dmg}${w.pellets > 1 ? ' × ' + w.pellets : ''} (머리 ×${w.head})`); row('분당 발사', `${w.rpm}`); row('DPS (10m)', dps.toFixed(0));
      row('탄창', `${w.mag} / 예비 ${w.reserve}`); row('재장전', `${w.reload}초`); row('이동 속도', `${Math.round(w.move * 100)}%`); row('모델', '코드로 만든 총 (모델 연결 전)');
      box.appendChild(dl);
      const usable = data.parts ? data.parts.slots.flatMap(s => (data.parts.parts[s.id] || []).filter(p => (!p.only || p.only.includes(w.id)) && !(p.not || []).includes(w.id)).map(p => [p.name, go('parts', `part:${s.id}:${p.id}`)])) : [];
      rel(`달 수 있는 파츠 (${usable.length})`, usable);
    } else if (cat === 'parts') {
      const p = it.def;
      row('자리', it.slot.name); row('id', p.id); if (p.quiet) row('특징', '소음 (미니맵에 안 보임)');
      box.appendChild(dl);
      const ws = data.weapons.filter(w => (!p.only || p.only.includes(w.id)) && !(p.not || []).includes(w.id));
      if (ws[0]) { const d = describePart(ws[0], p); box.appendChild(el('h4', '', `장단점 (${ws[0].name} 기준)`)); box.appendChild(el('p', 'note pc p', d.pros.join(' · ') || '—')); box.appendChild(el('p', 'note pc c', d.cons.join(' · ') || '—')); }
      rel(`달 수 있는 무기 (${ws.length})`, ws.map(w => [w.name, go('weapons', `weapon:${w.id}`)]));
    } else if (cat === 'modes') {
      const m = it.def;
      row('규칙', m.rules === 'zone' ? '점령전 (거점 점수)' : '데스매치 (킬 = 점수)'); row('인원', `최대 ${m.max} · 봇으로 ${m.fill}까지`); row('팀', m.teams ? `${m.teams}팀` : '개인전'); row('목표', `${m.goal}${m.rules === 'zone' ? '점' : '킬'}`);
      if (m.zone) row('점령 시간', `${m.zone.capture}초`);
      box.appendChild(dl);
      const map = data.maps.find(x => x.id === m.map);
      rel('기본 맵', map ? [[map.name, go('maps', `map:${map.id}`)]] : []);
    }
  }

  function btn(label, fn, cls = '', id) { const b = el('button', cls, label); b.type = 'button'; if (id) b.id = id; b.addEventListener('click', fn); return b; }

  return {
    load, render,
    get data() { return data; },
    setCat(c, key) { cat = c; sel = key || null; render(); },
    get sel() { return sel; },
  };
}
