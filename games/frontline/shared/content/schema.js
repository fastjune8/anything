// 콘텐츠(content/*.json) 의 모양 정의. 한 곳에서 정의해서
//  - 서버·테스트: 시작할 때 check* 로 검사 (잘못된 데이터면 바로 알려 준다)
//  - 에디터: 이 정의를 읽어 입력 칸(라벨·범위·선택지)을 자동으로 만든다
// 필드 정의: { kind, label, optional, min, max, step, options, of, fields, hint }
//  kind: num | int | str | bool | enum | color | point | list | obj | map(키 → 같은 모양 값)

const F = (kind, label, o = {}) => ({ kind, label, ...o });
export const num = (label, o) => F('num', label, o);
export const int = (label, o) => F('int', label, o);
export const str = (label, o) => F('str', label, o);
export const bool = (label, o) => F('bool', label, o);
export const oneOf = (label, options, o) => F('enum', label, { options, ...o });
export const color = (label, o) => F('color', label, o);
export const point = (label, o) => F('point', label, o); // [x, z]
export const list = (label, of, o) => F('list', label, { of, ...o });
export const obj = (label, fields, o) => F('obj', label, { fields, ...o });
export const dict = (label, of, o) => F('map', label, { of, ...o });
const opt = o => ({ optional: true, ...o });

// ───────── 맵 ─────────
export const MATERIALS = ['concrete', 'concreteDark', 'brick', 'container', 'crate', 'wood', 'sandbag', 'metal', 'barrel'];
const X = num('x (m)', { step: 0.1 }), Z = num('z (m)', { step: 0.1 });
const AXIS = oneOf('방향', ['x', 'z'], { hint: 'x = 동서로 길게, z = 남북으로 길게' });
const OPENING = obj('구멍', { at: num('위치 (벽을 따라 절대 좌표)', { step: 0.1 }), w: num('너비', { min: 0.5, max: 10, step: 0.1 }), type: oneOf('종류', ['door', 'window']) });
const OPENINGS = list('문·창문', OPENING, opt());
const Y = num('바닥 높이 (m, 공중·2층에 놓기)', opt({ min: -2, max: 60, step: 0.1 }));
const DIR = oneOf('오르는 방향', ['n', 's', 'e', 'w'], { hint: 'n = 북 z+, s = 남 z−, e = 동 x+, w = 서 x−' });
const sideOpenings = label => list(label, OPENING, opt());

// 모든 물체에 공통인 칸
export const COMMON_FIELDS = {
  rot: oneOf('회전 (도)', [0, 90, 180, 270], opt()),
  sym: bool('반대편에도 배치 (맵 중심 대칭)', opt()),
};

// 물체 종류별 칸. 순서 = 에디터에 보이는 순서. label = 에디터 목록에 보일 이름
export const OBJECT_SCHEMAS = {
  box: { label: '박스', fields: {
    x: X, z: Z, y: num('바닥 높이', opt({ min: 0, step: 0.1 })),
    w: num('너비 (x)', { min: 0.05, max: 300, step: 0.1 }), h: num('높이', { min: 0.05, max: 40, step: 0.1 }), d: num('깊이 (z)', { min: 0.05, max: 300, step: 0.1 }),
    mat: oneOf('재질', MATERIALS), tint: color('색', opt()), fit: bool('텍스처를 면 하나에 맞춤', opt()),
    shape: oneOf('모양', ['cyl'], opt({ hint: 'cyl = 원기둥' })), noCollide: bool('충돌 없음', opt()), invisible: bool('안 보임 (충돌만)', opt()),
  } },
  wall: { label: '벽', fields: {
    axis: AXIS, at: num('고정 좌표 (axis 가 x 면 z 값)', { step: 0.1 }), from: num('시작', { step: 0.1 }), to: num('끝', { step: 0.1 }),
    h: num('높이', { min: 0.3, max: 20, step: 0.1 }), t: num('두께', opt({ min: 0.1, max: 3, step: 0.05 })), mat: oneOf('재질', MATERIALS), ops: OPENINGS, y: Y,
    plain: bool('건축 장식 없음 (틀·기단·머리돌·기둥)', opt()), face: oneOf('장식 면 (비우면 양쪽)', ['+', '-'], opt({ hint: '+ = axis 가 x 면 z+ 쪽, z 면 x+ 쪽. 한쪽만 보이는 바깥 벽에 쓴다' })),
  } },
  building: { label: '건물', fields: {
    x: X, z: Z, w: num('너비 (x)', { min: 2, max: 100, step: 0.1 }), d: num('깊이 (z)', { min: 2, max: 100, step: 0.1 }), h: num('높이', { min: 1, max: 20, step: 0.1 }),
    mat: oneOf('재질', MATERIALS), roof: bool('지붕', opt()), y: Y, plain: bool('건축 장식 없음 (틀·기단·모서리·지붕 띠)', opt()),
    ops: obj('문·창문 (위치 = 벽을 따라가는 절대 좌표)', { n: sideOpenings('북쪽 벽 (z+)'), s: sideOpenings('남쪽 벽 (z−)'), e: sideOpenings('동쪽 벽 (x+)'), w: sideOpenings('서쪽 벽 (x−)') }, opt()),
  } },
  container: { label: '컨테이너', fields: { x: X, z: Z, axis: AXIS, tint: color('색', opt()), y: num('바닥 높이 (2단 = 2.59)', opt({ min: 0, step: 0.01 })) } },
  crate: { label: '상자', fields: { x: X, z: Z, s: num('크기', opt({ min: 0.3, max: 4, step: 0.1 })), y: num('바닥 높이', opt({ min: 0, step: 0.1 })) } },
  sandbags: { label: '모래주머니', fields: { x: X, z: Z, axis: AXIS, len: num('길이', opt({ min: 0.5, max: 20, step: 0.1 })), h: num('높이', opt({ min: 0.3, max: 2, step: 0.05 })), y: Y } },
  barrier: { label: '콘크리트 방벽', fields: { x: X, z: Z, axis: AXIS, y: Y } },
  barrel: { label: '드럼통', fields: { x: X, z: Z, tint: color('색', opt()), y: Y } },
  tower: { label: '감시탑', fields: { x: X, z: Z, y: Y } },
  tree: { label: '나무', fields: { x: X, z: Z, s: num('크기', opt({ min: 0.3, max: 3, step: 0.05 })) } },
  // 높이 요소
  ramp: { label: '경사로', fields: {
    x: X, z: Z, y: Y, dir: DIR, len: num('길이 (오르는 방향)', { min: 1, max: 60, step: 0.5 }), w: num('폭', { min: 0.5, max: 30, step: 0.5 }),
    h: num('오르는 높이', { min: 0.2, max: 20, step: 0.1 }), mat: oneOf('재질', MATERIALS),
  } },
  stairs: { label: '계단', fields: {
    x: X, z: Z, y: Y, dir: DIR, len: num('길이 (오르는 방향)', { min: 0.5, max: 40, step: 0.5 }), w: num('폭', { min: 0.5, max: 20, step: 0.5 }),
    h: num('오르는 높이 (한 단 0.3m 이하로 나눈다)', { min: 0.2, max: 20, step: 0.1 }), mat: oneOf('재질', MATERIALS),
  } },
  platform: { label: '발판', fields: {
    x: X, z: Z, y: num('윗면 높이 (m)', { min: 0.2, max: 60, step: 0.1 }), w: num('너비 (x)', { min: 0.5, max: 100, step: 0.5 }), d: num('깊이 (z)', { min: 0.5, max: 100, step: 0.5 }),
    t: num('두께', opt({ min: 0.1, max: 2, step: 0.05 })), mat: oneOf('재질', MATERIALS), pillars: bool('기둥', opt()), base: num('기둥 바닥 높이', opt({ min: 0, max: 60, step: 0.1 })),
  } },
};

export const ZONE = obj('거점', { id: str('id'), name: str('이름', opt()), x: X, z: Z, r: num('반지름', { min: 1, max: 30, step: 0.5 }), y: num('바닥 높이 (m)', opt({ min: 0, max: 40, step: 0.1 })) });

export const MAP_SCHEMA = obj('맵', {
  id: str('id', { pattern: '^[a-z0-9_]+$', hint: '영문 소문자·숫자·_ (파일 이름이 된다)' }),
  name: str('이름'),
  half: num('맵 절반 크기 (m)', { min: 10, max: 250 }),
  spawns: obj('스폰 지점', {
    ffa: list('개인전 스폰', point('지점'), { minLen: 2 }),
    team: list('팀 스폰 [0팀, 1팀]', list('팀', point('지점'), { minLen: 1 }), opt({ minLen: 2, maxLen: 2 })),
  }),
  zones: list('거점', ZONE, opt()),
  look: str('분위기 (content/looks.json 의 id, 비우면 첫 번째)', opt()),
  objects: list('물체', obj('물체', {}), { custom: 'object' }),
});

// ───────── 무기 ─────────
// 코드로 모양을 만들어 둔 기본 무기 (client/js/guns.js 의 BUILD). 이 밖의 새 무기는 등록된 모델이 있어야 한다
export const BUILTIN_GUNS = ['ar', 'mp5', 'm870', 'awm', 'm249', 'revolver', 'akimbo', 'knife'];
// 무기 종류 (기획 3.4 의 8종). 1인칭·3인칭 동작, 봇 사거리가 이 값으로 정해진다
export const WEAPON_KINDS = ['ar', 'smg', 'shotgun', 'sniper', 'melee', 'revolver', 'akimbo', 'lmg'];
export const WEAPON_SCHEMA = obj('무기', {
  id: str('id', { pattern: '^[a-z0-9_]+$' }), name: str('이름'), cls: str('분류'),
  kind: oneOf('종류', WEAPON_KINDS, { hint: 'ar 돌격소총, smg 기관단총, shotgun 산탄총, sniper 저격, melee 근접, revolver 리볼버, akimbo 아킴보 권총, lmg 경기관총' }),
  auto: bool('연사'), rpm: num('분당 발사 수', { min: 10, max: 2000 }),
  dmg: num('피해', { min: 1, max: 300 }), head: num('머리 배율', { min: 1, max: 5, step: 0.05 }), pellets: int('산탄 수', { min: 1, max: 20 }),
  mag: int('탄창 (근접 무기는 1)', { min: 1, max: 300 }), reload: num('재장전 (초, 한 발씩 장전이면 한 발당)', { min: 0.05, max: 10, step: 0.05 }),
  shell: bool('한 발씩 장전', opt()), bolt: bool('볼트액션', opt()), scope: bool('스코프 화면', opt()),
  hip: num('지향 사격 탄퍼짐 (도)', { min: 0, max: 15, step: 0.05 }), ads: num('정조준 탄퍼짐 (도)', { min: 0, max: 10, step: 0.01 }),
  bloom: num('연사 중 탄퍼짐 증가', { min: 0, max: 3, step: 0.01 }), bloomMax: num('탄퍼짐 증가 최대', { min: 0, max: 10, step: 0.05 }),
  recoilV: num('수직 반동', { min: 0, max: 10, step: 0.05 }), recoilH: num('수평 반동', { min: 0, max: 5, step: 0.05 }),
  adsFov: num('정조준 시야각', { min: 3, max: 90 }), adsTime: num('정조준 시간 (초)', { min: 0.05, max: 2, step: 0.01 }),
  falloff: list('거리 감쇠 [시작 m, 끝 m, 최소 배율] (없으면 null)', num('값'), opt({ nullable: true, minLen: 3, maxLen: 3 })),
  range: num('사거리 (m, 근접 무기는 닿는 거리)', { min: 1, max: 500, step: 0.1 }),
  move: num('이동 속도 배율 (기획 2.3: SMG 1.1 · 산탄 1.05 · AR 1 · 저격 0.9 · LMG 0.85)', { min: 0.5, max: 1.5, step: 0.01 }),
  draw: num('꺼내는 시간 (초) — 이 시간 동안 쏠 수 없다', { min: 0.05, max: 3, step: 0.05 }),
  sprintFire: bool('달리면서 사격 가능'), slideFire: bool('슬라이딩 중 사격 가능'),
  snd: obj('총소리', { f: num('주파수'), dur: num('길이'), vol: num('크기'), thump: num('저음') }),
  model: str('모델 (등록된 모델 id, 없으면 코드로 만든 모양)', opt({ pattern: '^[a-z0-9_]+$' })),
  skills: obj('스킬 (고를 수 있는 것)', {
    primary: list('주무기(1번)일 때', str('스킬 id'), opt()), secondary: list('보조무기(2번)일 때', str('스킬 id'), opt()),
  }, opt()),
});

// ───────── 파츠 ─────────
const STATS = ['recoilV', 'recoilH', 'hip', 'ads', 'bloom', 'adsTime', 'reload', 'draw', 'move', 'mag', 'range', 'adsFov'];
const STAT_LABELS = { recoilV: '수직 반동', recoilH: '수평 반동', hip: '지향 사격 탄퍼짐', ads: '정조준 탄퍼짐', bloom: '연사 중 탄퍼짐 증가', adsTime: '정조준 시간', reload: '재장전 시간', draw: '꺼내는 시간', move: '이동 속도', mag: '탄창 용량', range: '유효 사거리', adsFov: '정조준 시야각' };
export const PART_SCHEMA = obj('파츠', {
  id: str('id', { pattern: '^[a-z0-9_]+$' }), name: str('이름'),
  mul: dict('성능 배율 (1 보다 크면 값이 커진다)', num('배율', { min: 0.1, max: 5, step: 0.01 }), { keys: STATS, keyLabels: STAT_LABELS }),
  only: list('이 무기에만', str('무기 id'), opt()), not: list('이 무기에는 안 됨', str('무기 id'), opt()),
  quiet: bool('소음 (미니맵에 안 보임)', opt()),
});
export const PARTS_SCHEMA = obj('파츠 목록', {
  slots: list('자리', obj('자리', { id: str('id'), name: str('이름') })),
  parts: dict('자리별 파츠', list('파츠', PART_SCHEMA)),
});

// ───────── 프리팹 (맵 에디터에서 만든 물체 묶음, 클릭 한 번으로 찍는다) ─────────
// objects 는 맵의 물체와 같은 모양이고, 좌표는 묶음 가운데가 (0, 0) 이 되도록 저장한다
export const PREFAB_SCHEMA = obj('프리팹', {
  id: str('id', { pattern: '^[a-z][a-z0-9_]*$' }), name: str('이름'),
  objects: list('물체', obj('물체', {}), { custom: 'object', minLen: 1 }),
});
export function checkPrefabs(list) {
  const errors = check(list, F('list', '프리팹 목록', { of: PREFAB_SCHEMA }));
  const ids = (Array.isArray(list) ? list : []).map(p => p && p.id);
  ids.forEach((id, i) => { if (ids.indexOf(id) !== i) errors.push(`프리팹 id 중복: ${id}`); });
  return errors;
}

// ───────── 등록된 에셋 ─────────
// 스튜디오에서 검증을 통과한 것만 "데이터로 등록" 해서 게임 데이터가 참조할 수 있게 한다.
// 지금은 모델(content/models.json). 효과 에디터가 생기면 같은 모양으로 content/effects.json 을 더한다.
export const MODEL_SCHEMA = obj('등록된 모델', {
  id: str('id', { pattern: '^[a-z0-9_]+$' }), name: str('이름'),
  kind: oneOf('종류', ['gun', 'melee', 'prop'], { hint: 'gun = 총, melee = 근접 무기(칼 등), prop = 맵 물체' }),
  file: str('파일 (content/ 기준)', { pattern: '^(guns|props)/[a-z0-9_]+\\.glb$' }),
  tris: int('삼각형 수', { min: 1 }), bytes: int('파일 크기 (바이트)', { min: 1 }),
  warnings: int('등록할 때 남아 있던 확인 사항 수', { min: 0 }),
  registered: str('등록한 날 (YYYY-MM-DD)', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
});
export function checkModels(list) {
  const errors = check(list, F('list', '등록된 모델 목록', { of: MODEL_SCHEMA }));
  const ids = (Array.isArray(list) ? list : []).map(m => m && m.id);
  ids.forEach((id, i) => { if (ids.indexOf(id) !== i) errors.push(`모델 id 중복: ${id}`); });
  return errors;
}

// ───────── 분위기 (content/looks.json): 빛·하늘·안개 + 재질(맵 물체 겉모습) 묶음. 맵마다 하나를 고른다 ─────────
export const MAT_STYLES = ['classic', 'plain', 'panel', 'blocks', 'corrugated', 'crate', 'planks', 'plate', 'stripe', 'ground', 'bag'];
export const LOOK_MATERIALS = ['ground', ...MATERIALS];
const MAT_LOOK = obj('재질', {
  style: oneOf('무늬', MAT_STYLES, { hint: 'classic = 예전 사실적 무늬, panel = 칠한 패널, blocks = 큰 블록, corrugated = 골판 금속, crate = 상자, planks = 판자, plate = 금속판, stripe = 띠, bag = 모래주머니 한 개, ground = 땅' }),
  base: color('바탕 색', opt()), line: color('선·이음새 색', opt()), accent: color('포인트 색', opt()), trim: color('아래 띠 색 (패널)', opt()),
  cells: int('패널 칸 수 (한 장 안에)', opt({ min: 1, max: 8 })), rows: int('블록 줄 수', opt({ min: 1, max: 16 })), cols: int('블록 칸 수', opt({ min: 1, max: 8 })),
  grime: num('때·얼룩 (0~1)', opt({ min: 0, max: 1, step: 0.05 })),
  tile: num('무늬 한 장 크기 (m, 0 = 면마다 한 장)', { min: 0, max: 40, step: 0.1 }),
  rough: num('거칠기 (0 = 매끈, 1 = 거침)', { min: 0, max: 1, step: 0.01 }), metal: num('금속성', opt({ min: 0, max: 1, step: 0.01 })),
  bump: num('요철', { min: 0, max: 2, step: 0.05 }),
});
export const LOOK_SCHEMA = obj('분위기', {
  id: str('id', { pattern: '^[a-z0-9_]+$' }), name: str('이름'),
  exposure: num('밝기 (노출)', { min: 0.2, max: 2, step: 0.01 }),
  sun: obj('해', { elev: num('높이 (도)', { min: 2, max: 90, step: 1 }), azim: num('방위 (도)', { min: 0, max: 360, step: 1 }), color: color('색'), intensity: num('세기', { min: 0, max: 10, step: 0.1 }) }),
  sky: obj('하늘', { turbidity: num('뿌연 정도', { min: 0, max: 20, step: 0.1 }), rayleigh: num('푸른 정도', { min: 0, max: 4, step: 0.05 }), mie: num('햇무리 크기', { min: 0, max: 0.1, step: 0.001 }), mieG: num('햇무리 집중', { min: 0, max: 0.999, step: 0.01 }) }),
  fill: obj('그늘 빛 (하늘·땅 반사)', { sky: color('위쪽 (그늘 색)'), ground: color('아래쪽 (땅 반사)'), intensity: num('세기', { min: 0, max: 5, step: 0.05 }) }),
  fog: obj('안개', { color: color('색'), density: num('짙기', { min: 0, max: 0.03, step: 0.0005 }) }),
  env: num('주변 반사 세기', { min: 0, max: 3, step: 0.05 }),
  hills: color('먼 산 색'), leaves: list('나뭇잎 색', color('색'), { minLen: 1, maxLen: 6 }),
  materials: dict('재질', MAT_LOOK, { keys: LOOK_MATERIALS }),
});
export function checkLooks(list) {
  const errors = check(list, F('list', '분위기 목록', { of: LOOK_SCHEMA, minLen: 1 }));
  const arr = Array.isArray(list) ? list : [];
  arr.map(l => l && l.id).forEach((id, i, ids) => { if (ids.indexOf(id) !== i) errors.push(`분위기 id 중복: ${id}`); });
  for (const l of arr) if (l && l.materials) for (const k of LOOK_MATERIALS) if (!l.materials[k]) errors.push(`분위기 ${l.id}: 재질 ${k} 가 없음`);
  return errors;
}

// ───────── 스킬 (content/skills.json) ─────────
// effect = 코드(shared/sim/abilities.js)에 있는 동작. type: active = Q/E 로 쓴다, passive = 그 무기를 든 동안 늘 켜짐
export const SKILL_EFFECTS = {
  adrenaline: '공격 속도 증가', sprint: '달리며 사격', grenade: '유탄', dash: '대쉬', overheat: '과열', charge: '차지 샷', shove: '넉백 (다음 사격)',
  kickback: '반동 이동', backstep: '백스텝', grapple: '그래플', caliber: '관통', stealth: '투명화', slash: '돌진 베기', quickdraw: '퀵드로우',
  fanning: '패닝 (연속 발사)', roll: '구르기 (무적)', bang: '헤드샷 강화', fastreload: '빠른 재장전', bleed: '출혈',
};
const SKILL_NUMS = {
  cd: num('쿨타임 (초)', opt({ min: 0.5, max: 120, step: 0.5 })), dur: num('지속 시간 (초)', opt({ min: 0.05, max: 30, step: 0.05 })),
  rate: num('공격 속도 증가 (0.4 = +40%)', opt({ min: 0, max: 3, step: 0.05 })),
  heat: num('한 발에 오르는 열 (0~1)', opt({ min: 0.001, max: 1, step: 0.005 })), cool: num('초당 식는 열', opt({ min: 0.05, max: 5, step: 0.05 })),
  coolDelay: num('쏘기를 멈추고 식기 시작할 때까지 (초)', opt({ min: 0, max: 5, step: 0.05 })),
  bonus: num('피해 증가 (0.4 = +40%)', opt({ min: 0, max: 3, step: 0.05 })), mul: num('배율', opt({ min: 0.05, max: 5, step: 0.05 })),
  charges: int('충전 수', opt({ min: 1, max: 10 })), dmg: num('피해', opt({ min: 1, max: 300, step: 1 })),
  radius: num('폭발 반경 (m)', opt({ min: 0.5, max: 20, step: 0.5 })), speed: num('속도 (m/s)', opt({ min: 5, max: 120, step: 1 })),
  dist: num('이동 거리 (m)', opt({ min: 0.5, max: 30, step: 0.5 })), range: num('거리 (m)', opt({ min: 0.5, max: 100, step: 0.5 })),
  wait: num('기다리는 시간 (초)', opt({ min: 0.5, max: 60, step: 0.5 })), close: num('가까운 거리 (m)', opt({ min: 0.5, max: 50, step: 0.5 })),
  force: num('세기 (m/s)', opt({ min: 0.5, max: 40, step: 0.5 })), stun: num('넘어지는 시간 (초)', opt({ min: 0.05, max: 5, step: 0.05 })),
  pierce: int('관통 수', opt({ min: 1, max: 10 })), shots: int('발사 수', opt({ min: 1, max: 20 })), gap: num('발사 간격 (초)', opt({ min: 0.02, max: 1, step: 0.01 })),
  spread: num('추가 탄퍼짐 (도)', opt({ min: 0, max: 20, step: 0.1 })), hits: int('명중 횟수', opt({ min: 1, max: 20 })), dps: num('초당 피해', opt({ min: 1, max: 100, step: 1 })),
};
export const SKILL_SCHEMA = obj('스킬', {
  id: str('id', { pattern: '^[a-z][a-z0-9_]*$' }), name: str('이름'),
  type: oneOf('종류', ['active', 'passive'], { hint: 'active = Q/E 로 사용, passive = 늘 켜짐' }),
  effect: oneOf('효과 (코드에 있는 것)', Object.keys(SKILL_EFFECTS)),
  desc: str('설명 (로비에 보인다)'),
  ...SKILL_NUMS,
  secondary: obj('보조무기(2번) 자리일 때 바뀌는 값', SKILL_NUMS, opt()),
});
// 효과마다 꼭 있어야 하는 수치
const SKILL_NEEDS = {
  adrenaline: ['cd', 'dur', 'rate'], sprint: [], grenade: ['cd', 'charges', 'dmg', 'radius', 'speed'], dash: ['cd', 'dist', 'dur'],
  overheat: ['heat', 'cool', 'coolDelay', 'bonus'], charge: ['wait', 'bonus'], shove: ['cd', 'dur', 'force', 'stun'], kickback: ['force'],
  backstep: ['cd', 'dur', 'force', 'mul'], grapple: ['cd', 'range', 'dur', 'speed'], caliber: ['pierce', 'mul'], stealth: ['cd', 'dur', 'range'],
  slash: ['cd', 'dist', 'dur', 'dmg', 'mul'], quickdraw: ['wait', 'bonus', 'close', 'mul'], fanning: ['cd', 'shots', 'gap', 'spread'],
  roll: ['cd', 'dist', 'dur'], bang: ['mul'], fastreload: ['mul'], bleed: ['hits', 'wait', 'dur', 'dps'],
};
export const PASSIVE_EFFECTS = ['sprint', 'overheat', 'charge', 'kickback', 'caliber', 'quickdraw', 'bang', 'fastreload', 'bleed'];
export function checkSkills(list) {
  const errors = check(list, F('list', '스킬 목록', { of: SKILL_SCHEMA }));
  const arr = Array.isArray(list) ? list : [];
  arr.map(s => s && s.id).forEach((id, i, ids) => { if (ids.indexOf(id) !== i) errors.push(`스킬 id 중복: ${id}`); });
  for (const s of arr) {
    if (!s || !SKILL_NEEDS[s.effect]) continue;
    for (const k of SKILL_NEEDS[s.effect]) if (s[k] === undefined) errors.push(`스킬 ${s.id}: ${s.effect} 효과에는 "${SKILL_NUMS[k].label}" 가 있어야 한다`);
    if ((s.type === 'passive') !== PASSIVE_EFFECTS.includes(s.effect)) errors.push(`스킬 ${s.id}: ${s.effect} 는 ${PASSIVE_EFFECTS.includes(s.effect) ? 'passive' : 'active'} 여야 한다`);
  }
  return errors;
}

// ───────── 총 재질 (content/gunmaterials.json): 색 칸별 재질 성질. 모든 총(Blender 모델·코드 총)에 엔진이 입힌다 ─────────
// 스킨은 색만 바꾸고 이 값은 그대로 → 어떤 스킨이든 금속은 금속, 폴리머는 폴리머로 보인다
export const GUN_SLOTS = ['body', 'body2', 'dark', 'metal', 'accent', 'core'];
const GUN_SLOT_MAT = obj('색 칸 재질', {
  metal: num('금속성 (0 = 비금속, 1 = 금속)', { min: 0, max: 1, step: 0.01 }), rough: num('거칠기 (0 = 매끈, 1 = 거침)', { min: 0, max: 1, step: 0.01 }),
  env: num('주변 반사 세기', { min: 0, max: 3, step: 0.05 }), glow: num('스스로 빛나는 세기 (core)', opt({ min: 0, max: 10, step: 0.1 })),
  coat: num('광택 코팅 (도장면의 맑은 반사층)', opt({ min: 0, max: 1, step: 0.05 })), grain: num('미세 질감 (결·오돌토돌함)', opt({ min: 0, max: 2, step: 0.05 })),
  brushed: bool('브러시 결 (금속, 앞뒤로 긴 결)', opt()), wear: num('모서리 닳음 (칠이 벗겨진 금속이 보임)', opt({ min: 0, max: 1, step: 0.05 })),
});
export const GUNMAT_SCHEMA = obj('총 재질', {
  slots: dict('색 칸', GUN_SLOT_MAT, { keys: GUN_SLOTS }),
  wearColor: color('닳은 모서리의 금속 색'), wearWidth: num('닳은 모서리 폭 (m)', { min: 0.0005, max: 0.02, step: 0.0005 }),
  heatColor: color('과열 때 달아오르는 색 (metal 칸)'), heatGlow: num('과열 빛 세기', { min: 0, max: 20, step: 0.1 }),
  chargeGlow: num('충전·스킬 때 core 빛 세기', { min: 0, max: 20, step: 0.1 }),
});
export function checkGunMaterials(d) {
  const errors = check(d, GUNMAT_SCHEMA);
  if (d && d.slots) for (const k of GUN_SLOTS) if (!d.slots[k]) errors.push(`색 칸 ${k} 의 재질이 없음`);
  return errors;
}

// ───────── 효과 (content/effects.json): 스킬·폭발 등의 시각 효과. 스튜디오 효과 에디터에서 만든다 ─────────
// 효과 하나 = 층(emitter) 여러 개. 게임은 아래 "쓰는 곳"의 id 와 같은 효과를 그 순간에 재생한다 (없으면 예전 코드 효과)
export const EFFECT_HOOKS = {
  grenade_explode: '유탄이 터질 때 (크기 = 폭발 반경 ÷ 5)',
  skill_adrenaline: '아드레날린을 쓸 때 (쓴 사람 발밑)',
  skill_shove_hit: '밀어내기에 맞았을 때 (맞은 사람 가슴)',
  charge_shot: '차지 샷이 나갈 때 (총구, 앞 = 쏜 방향)',
};
const BLEND = oneOf('섞는 방식', ['add', 'normal'], { hint: 'add = 빛처럼 더해짐(불꽃·빛), normal = 덮음(연기·먼지·파편)' });
const DELAY = num('시작 지연 (초)', opt({ min: 0, max: 10, step: 0.01 }));
export const EMITTER_SCHEMAS = {
  particles: { label: '입자', fields: {
    name: str('이름 (구분용)', opt()), delay: DELAY,
    count: int('한 번에 뿜는 수', { min: 0, max: 500 }), rate: num('초당 뿜는 수 (흘려 뿜기)', opt({ min: 0, max: 1000, step: 1 })), duration: num('흘려 뿜는 시간 (초)', opt({ min: 0, max: 20, step: 0.05 })),
    lifeMin: num('수명 최소 (초)', { min: 0.01, max: 20, step: 0.01 }), lifeMax: num('수명 최대 (초)', { min: 0.01, max: 20, step: 0.01 }),
    speedMin: num('속도 최소 (m/s)', { min: 0, max: 200, step: 0.1 }), speedMax: num('속도 최대 (m/s)', { min: 0, max: 200, step: 0.1 }),
    dir: oneOf('방향', ['sphere', 'up', 'down', 'out', 'ground', 'cone'], { hint: 'sphere = 사방, up/down = 위/아래, out = 가운데에서 바깥, ground = 바닥을 따라 둥글게, cone = 앞(쏜 방향)' }),
    spread: num('퍼짐 (도, up·down·cone)', opt({ min: 0, max: 180, step: 1 })), radius: num('나오는 곳 반경 (m)', opt({ min: 0, max: 20, step: 0.05 })),
    gravity: num('중력 (m/s², 음수 = 떠오름)', opt({ min: -50, max: 50, step: 0.1 })), drag: num('공기 저항', opt({ min: 0, max: 20, step: 0.1 })),
    sizeStart: num('크기 처음 (m)', { min: 0, max: 20, step: 0.01 }), sizeEnd: num('크기 끝 (m)', { min: 0, max: 20, step: 0.01 }),
    colorStart: color('색 처음'), colorEnd: color('색 끝'), glow: num('밝기 배율 (1 넘으면 더 빛남)', opt({ min: 0, max: 10, step: 0.1 })),
    alphaStart: num('투명도 처음 (1 = 불투명)', { min: 0, max: 1, step: 0.01 }), alphaEnd: num('투명도 끝', { min: 0, max: 1, step: 0.01 }),
    texture: oneOf('무늬', ['soft', 'spark', 'smoke', 'ring', 'star', 'square'], { hint: 'soft = 부드러운 빛, spark = 불꽃, smoke = 연기, ring = 고리, star = 별빛, square = 각진 파편' }), blend: BLEND,
  } },
  ring: { label: '고리', fields: {
    name: str('이름 (구분용)', opt()), delay: DELAY, life: num('지속 (초)', { min: 0.02, max: 10, step: 0.01 }),
    radiusStart: num('반경 처음 (m)', { min: 0, max: 50, step: 0.05 }), radiusEnd: num('반경 끝 (m)', { min: 0.01, max: 50, step: 0.05 }), width: num('두께 (m)', { min: 0.01, max: 10, step: 0.01 }),
    color: color('색'), alphaStart: num('투명도 처음', { min: 0, max: 1, step: 0.01 }), alphaEnd: num('투명도 끝', { min: 0, max: 1, step: 0.01 }),
    facing: oneOf('방향', ['ground', 'camera'], { hint: 'ground = 바닥에 눕힘, camera = 화면을 향함' }), blend: BLEND,
  } },
  light: { label: '빛', fields: {
    name: str('이름 (구분용)', opt()), delay: DELAY, life: num('지속 (초)', { min: 0.02, max: 10, step: 0.01 }),
    color: color('색'), intensity: num('세기', { min: 0, max: 2000, step: 1 }), range: num('비추는 거리 (m)', { min: 0.5, max: 100, step: 0.5 }),
  } },
};
export const emitterSpec = kind => (EMITTER_SCHEMAS[kind] ? obj(EMITTER_SCHEMAS[kind].label, { kind: oneOf('종류', Object.keys(EMITTER_SCHEMAS)), ...EMITTER_SCHEMAS[kind].fields }) : null);
export const EFFECT_SCHEMA = obj('효과', {
  id: str('id', { pattern: '^[a-z][a-z0-9_]*$', hint: '게임이 이 id 로 부른다 (쓰는 곳 목록 참고)' }), name: str('이름'), desc: str('설명', opt()),
  emitters: list('층', obj('층', {}), { custom: 'emitter', minLen: 1 }),
});
export function checkEffects(list) {
  const errors = check(list, F('list', '효과 목록', { of: EFFECT_SCHEMA }));
  (Array.isArray(list) ? list : []).map(e => e && e.id).forEach((id, i, ids) => { if (ids.indexOf(id) !== i) errors.push(`효과 id 중복: ${id}`); });
  return errors;
}

// ───────── 모드 ─────────
export const RULES = ['domination', 'deathmatch']; // server/game/modes/ 에 있는 규칙
export const MODE_SCHEMA = obj('모드', {
  id: str('id', { pattern: '^[a-z0-9_]+$' }), name: str('이름 (로비 카드)'), desc: str('설명 (로비 카드)'),
  map: str('기본 맵 id'), rules: oneOf('점수·승리 규칙', RULES, { hint: 'domination = 거점 점령전, deathmatch = 킬이 점수' }),
  max: int('방 최대 인원 (사람 + 봇)', { min: 2, max: 16 }), fill: int('봇으로 채울 인원', { min: 0, max: 16 }),
  teams: oneOf('팀 수', [0, 2], { hint: '0 = 개인전' }), goal: int('승리 점수 (킬 또는 거점 점수)', { min: 1, max: 1000 }),
  minutes: num('제한 시간 (분)', { min: 1, max: 30, step: 0.5 }),
  respawn: num('부활 대기 (초)', { min: 0.5, max: 30, step: 0.5 }),
  spawn: oneOf('리스폰 방식', ['team', 'dynamic'], { hint: 'team = 팀별 고정 스폰, dynamic = 적·아군·목표를 보고 고른다' }),
  dom: obj('점령전 설정', {
    capture: num('혼자 점령하는 시간 (초)', { min: 1, max: 60, step: 0.5 }),
    speedup: list('인원별 점령 속도 배율 [1명, 2명, 3명, …]', num('배율', { min: 0.1, max: 5, step: 0.05 }), { minLen: 1, maxLen: 8 }),
    scoreRate: num('거점 하나가 1초에 만드는 점수', { min: 0.01, max: 10, step: 0.01 }),
    height: num('거점 바닥에서 이 높이까지 안으로 친다 (m)', { min: 1, max: 20, step: 0.5 }),
    overtimeMax: num('연장전 최대 (초, 넘으면 무승부)', { min: 10, max: 900, step: 10 }),
  }, opt()),
});

// ───────── 검사 ─────────
const isNum = v => typeof v === 'number' && Number.isFinite(v);

// value 가 spec 에 맞는지 검사. 반환: 오류 문장 목록 (비어 있으면 통과)
export function check(value, spec, path = '', errors = []) {
  const at = path || '(전체)';
  if (value === undefined) { if (!spec.optional) errors.push(`${at}: 값이 없음 (${spec.label})`); return errors; }
  if (value === null) { if (!spec.nullable) errors.push(`${at}: null 은 안 됨`); return errors; }
  const range = () => {
    if (spec.min !== undefined && value < spec.min) errors.push(`${at}: ${value} 는 최소 ${spec.min} 보다 작음 (${spec.label})`);
    if (spec.max !== undefined && value > spec.max) errors.push(`${at}: ${value} 는 최대 ${spec.max} 보다 큼 (${spec.label})`);
  };
  switch (spec.kind) {
    case 'num': if (!isNum(value)) errors.push(`${at}: 숫자가 아님`); else range(); break;
    case 'int': if (!Number.isInteger(value)) errors.push(`${at}: 정수가 아님`); else range(); break;
    case 'str':
      if (typeof value !== 'string' || !value) errors.push(`${at}: 글자가 아님`);
      else if (spec.pattern && !new RegExp(spec.pattern).test(value)) errors.push(`${at}: "${value}" 는 형식이 맞지 않음 (${spec.hint || spec.pattern})`);
      break;
    case 'bool': if (typeof value !== 'boolean') errors.push(`${at}: true/false 가 아님`); break;
    case 'enum': if (!spec.options.includes(value)) errors.push(`${at}: "${value}" 는 고를 수 없는 값 (${spec.options.join(', ')})`); break;
    case 'color': if (!(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))) errors.push(`${at}: 색은 #rrggbb 형식`); break;
    case 'point': if (!(Array.isArray(value) && value.length === 2 && value.every(isNum))) errors.push(`${at}: [x, z] 형식이 아님`); break;
    case 'list':
      if (!Array.isArray(value)) { errors.push(`${at}: 목록이 아님`); break; }
      if (spec.minLen !== undefined && value.length < spec.minLen) errors.push(`${at}: 최소 ${spec.minLen}개 필요 (${spec.label})`);
      if (spec.maxLen !== undefined && value.length > spec.maxLen) errors.push(`${at}: 최대 ${spec.maxLen}개 (${spec.label})`);
      value.forEach((v, i) => (spec.custom === 'object' ? checkObject(v, `${path}[${i}]`, errors) : spec.custom === 'emitter' ? checkEmitter(v, `${path}[${i}]`, errors) : check(v, spec.of, `${path}[${i}]`, errors)));
      break;
    case 'obj':
      if (typeof value !== 'object' || Array.isArray(value)) { errors.push(`${at}: 객체가 아님`); break; }
      for (const [k, f] of Object.entries(spec.fields)) check(value[k], f, path ? `${path}.${k}` : k, errors);
      for (const k of Object.keys(value)) if (!spec.fields[k]) errors.push(`${path ? path + '.' : ''}${k}: 모르는 칸`);
      break;
    case 'map':
      if (typeof value !== 'object' || Array.isArray(value)) { errors.push(`${at}: 객체가 아님`); break; }
      for (const [k, v] of Object.entries(value)) {
        if (spec.keys && !spec.keys.includes(k)) errors.push(`${path}.${k}: 모르는 칸 (${spec.keys.join(', ')})`);
        check(v, spec.of, `${path}.${k}`, errors);
      }
      break;
  }
  return errors;
}

// 맵 물체 하나: type 에 따라 칸이 달라진다
// 겉모습 칸: 모든 물체(나무 빼고)의 재질·색을 바꿀 수 있다. 자기 칸이 이미 있으면 그것을 쓴다
const LOOK_FIELDS = {
  mat: oneOf('재질', MATERIALS, opt({ hint: '비우면 이 물체의 기본 재질' })),
  tint: color('색 (재질 위에 덧칠)', opt({ hint: '흰색에 가까울수록 재질 그대로, 진할수록 그 색으로' })),
};
export function objectSpec(type) {
  const s = OBJECT_SCHEMAS[type];
  if (!s) return null;
  const look = type === 'tree' ? {} : Object.fromEntries(Object.entries(LOOK_FIELDS).filter(([k]) => !s.fields[k]));
  return obj(s.label, { type: oneOf('종류', Object.keys(OBJECT_SCHEMAS)), ...s.fields, ...look, ...COMMON_FIELDS });
}
function checkEmitter(e, path, errors) {
  const spec = e && typeof e === 'object' ? emitterSpec(e.kind) : null;
  if (!spec) { errors.push(`${path}: 모르는 층 종류 "${e && e.kind}" (${Object.keys(EMITTER_SCHEMAS).join(', ')})`); return; }
  check(e, spec, path, errors);
}
function checkObject(o, path, errors) {
  const spec = o && typeof o === 'object' ? objectSpec(o.type) : null;
  if (!spec) { errors.push(`${path}: 모르는 물체 종류 "${o && o.type}" (${Object.keys(OBJECT_SCHEMAS).join(', ')})`); return; }
  check(o, spec, path, errors);
}

// 맵 전체: 모양 + 서로 맞물리는 규칙 (스폰이 맵 안에 있는가 등)
export function checkMap(m) {
  const errors = check(m, MAP_SCHEMA);
  if (errors.length) return errors;
  const inside = ([x, z], where) => { if (Math.abs(x) > m.half || Math.abs(z) > m.half) errors.push(`${where} [${x}, ${z}] 가 맵 밖 (half ${m.half})`); };
  m.spawns.ffa.forEach((p, i) => inside(p, `spawns.ffa[${i}]`));
  (m.spawns.team || []).forEach((t, k) => t.forEach((p, i) => inside(p, `spawns.team[${k}][${i}]`)));
  const zoneIds = new Set();
  for (const z of m.zones || []) { inside([z.x, z.z], `거점 ${z.id}`); if (zoneIds.has(z.id)) errors.push(`거점 id 중복: ${z.id}`); zoneIds.add(z.id); }
  return errors;
}

// modelIds: 등록된 모델 id 목록 (주면 무기의 model 이 등록된 것인지도 본다)
// skillIds: 스킬 id 목록 (주면 무기의 skills 가 있는 스킬인지도 본다)
export function checkWeapons(list, modelIds = null, skillIds = null) {
  const errors = checkWeaponsBase(list, modelIds);
  if (skillIds && Array.isArray(list)) for (const w of list) for (const k of ['primary', 'secondary']) for (const id of (w && w.skills && w.skills[k]) || []) if (!skillIds.includes(id)) errors.push(`무기 ${w.id}: 없는 스킬 "${id}" (${k})`);
  return errors;
}
function checkWeaponsBase(list, modelIds) {
  const errors = check(list, F('list', '무기 목록', { of: WEAPON_SCHEMA, minLen: 2 }));
  const ids = list.map(w => w && w.id);
  ids.forEach((id, i) => { if (ids.indexOf(id) !== i) errors.push(`무기 id 중복: ${id}`); });
  if (modelIds) for (const w of list) if (w && w.model && !modelIds.includes(w.model)) errors.push(`무기 ${w.id}: 등록되지 않은 모델 "${w.model}" (모델 에디터에서 데이터로 등록)`);
  for (const w of list) if (w && w.id && !BUILTIN_GUNS.includes(w.id) && !w.model) errors.push(`무기 ${w.id}: 새 무기는 모델이 있어야 한다 (데이터로 등록된 모델을 고르세요)`);
  return errors;
}

export function checkParts(data, weaponIds) {
  const errors = check(data, PARTS_SCHEMA);
  if (errors.length) return errors;
  const slots = new Set(data.slots.map(s => s.id));
  for (const [slot, parts] of Object.entries(data.parts)) {
    if (!slots.has(slot)) errors.push(`parts.${slot}: slots 에 없는 자리`);
    for (const p of parts) for (const id of [...(p.only || []), ...(p.not || [])]) if (!weaponIds.includes(id)) errors.push(`파츠 ${p.id}: 없는 무기 id "${id}"`);
  }
  return errors;
}

export function checkModes(list, mapIds = null) {
  const errors = check(list, F('list', '모드 목록', { of: MODE_SCHEMA, minLen: 1 }));
  if (errors.length) return errors;
  const ids = list.map(m => m.id);
  ids.forEach((id, i) => { if (ids.indexOf(id) !== i) errors.push(`모드 id 중복: ${id}`); });
  for (const m of list) {
    if (m.rules === 'domination' && !m.dom) errors.push(`모드 ${m.id}: 점령전 규칙에는 점령전 설정(dom)이 필요`);
    if (m.rules === 'domination' && !m.teams) errors.push(`모드 ${m.id}: 점령전은 팀이 2개여야 한다`);
    if (m.fill > m.max) errors.push(`모드 ${m.id}: 봇으로 채울 인원(${m.fill})이 최대 인원(${m.max})보다 많다`);
    if (mapIds && !mapIds.includes(m.map)) errors.push(`모드 ${m.id}: 없는 맵 "${m.map}"`);
  }
  return errors;
}

// ───────── 옷 (content/cosmetics.json): 캐릭터 꾸미기 아이템. 규칙은 shared/cosmetics.js, 만드는 법은 docs/CHARACTER_CUSTOMIZATION.md ─────────
export const COSMETIC_RARITY = ['common', 'rare', 'epic', 'legendary'];
export const COSMETIC_UNLOCK = ['default', 'shop', 'season', 'achievement'];
// ref: { slots, regions, fpRegions } (shared/cosmetics.js 가 넘긴다)
export function checkCosmetics(d, ref) {
  const errors = [];
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const hex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  if (!isObj(d)) return ['옷 데이터가 객체가 아님'];
  const slots = ref.slots, regions = ref.regions, fpRegions = new Set(ref.fpRegions);
  const colorSlots = Array.isArray(d.colorSlots) ? d.colorSlots : [];
  if (!colorSlots.length) errors.push('colorSlots 가 비었음');
  if (colorSlots.length > 8) errors.push('colorSlots 는 8개까지 (셰이더 색 배열 크기)');
  if (!colorSlots.includes('team')) errors.push('colorSlots 에 team 칸이 필요함 (팀전 색)');
  for (const c of colorSlots) {
    const m = isObj(d.materials) ? d.materials[c] : null;
    if (!m || typeof m.rough !== 'number' || typeof m.metal !== 'number') errors.push(`materials.${c}: rough·metal 숫자가 필요함`);
  }
  if (!isObj(d.palettes) || !Object.keys(d.palettes).length) errors.push('palettes 가 비었음');
  else for (const [id, p] of Object.entries(d.palettes)) for (const c of colorSlots) if (!hex(p && p[c])) errors.push(`팔레트 ${id}: ${c} 색이 없거나 #rrggbb 가 아님`);
  if (!isObj(d.teams) || !hex(d.teams.ally) || !hex(d.teams.foe)) errors.push('teams.ally / teams.foe 색이 필요함');
  if (!Array.isArray(d.skins) || !d.skins.length || !d.skins.every(hex)) errors.push('skins: #rrggbb 목록이 필요함');
  const items = Array.isArray(d.items) ? d.items : [];
  if (!Array.isArray(d.items)) errors.push('items 가 목록이 아님');
  const ids = new Map();
  items.forEach((it, i) => {
    const where = `아이템 ${it && it.id ? it.id : '#' + i}`;
    if (!isObj(it)) { errors.push(`${where}: 객체가 아님`); return; }
    if (typeof it.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(it.id)) errors.push(`${where}: id 는 소문자·숫자·_`);
    if (ids.has(it.id)) errors.push(`${where}: id 중복`);
    ids.set(it.id, it);
    if (typeof it.name !== 'string' || !it.name) errors.push(`${where}: name 이 없음`);
    if (!slots.includes(it.slot)) errors.push(`${where}: 없는 슬롯 ${it.slot}`);
    if (typeof it.tp !== 'string' || !/^wearables\/[a-z0-9_]+\.glb$/.test(it.tp)) errors.push(`${where}: tp 는 wearables/<이름>.glb`);
    if (it.fp !== undefined && (typeof it.fp !== 'string' || !/^wearables\/[a-z0-9_]+\.glb$/.test(it.fp))) errors.push(`${where}: fp 는 wearables/<이름>.glb`);
    if (it.mount !== 'skin' && !(isObj(it.mount) && typeof it.mount.bone === 'string' && it.mount.bone)) errors.push(`${where}: mount 는 "skin" 또는 { "bone": 뼈이름 }`);
    if (!Array.isArray(it.mask)) errors.push(`${where}: mask 는 목록`);
    else {
      for (const r of it.mask) if (!regions.includes(r)) errors.push(`${where}: 없는 몸 영역 ${r}`);
      if (it.mask.some(r => fpRegions.has(r)) && !it.fp) errors.push(`${where}: 1인칭에 보이는 영역(${it.mask.filter(r => fpRegions.has(r)).join(' ')})을 가리므로 fp 모델이 필요함`);
      if (isObj(it.mount) && it.mask.length) errors.push(`${where}: 뼈에 붙이는 물건은 몸을 가리지 않는다 (mask 를 비우거나 skin 으로)`);
    }
    if (!COSMETIC_RARITY.includes(it.rarity)) errors.push(`${where}: rarity 는 ${COSMETIC_RARITY.join('|')}`);
    if (!isObj(it.unlock) || !COSMETIC_UNLOCK.includes(it.unlock.type)) errors.push(`${where}: unlock.type 은 ${COSMETIC_UNLOCK.join('|')}`);
    if (it.palette !== undefined && !(isObj(d.palettes) && d.palettes[it.palette])) errors.push(`${where}: 없는 팔레트 ${it.palette}`);
    for (const k of ['occupies', 'blocks']) if (it[k] !== undefined && (!Array.isArray(it[k]) || it[k].some(s => !slots.includes(s)))) errors.push(`${where}: ${k} 는 슬롯 목록`);
  });
  for (const it of items) {
    if (!isObj(it)) continue;
    if (it.replaces !== undefined) {
      if (!isObj(it.replaces)) errors.push(`아이템 ${it.id}: replaces 는 { 슬롯: 아이템id }`);
      else for (const [s, id] of Object.entries(it.replaces)) { const t = ids.get(id); if (!t || t.slot !== s) errors.push(`아이템 ${it.id}: replaces.${s} 는 그 슬롯의 아이템이어야 함 (${id})`); }
    }
    if (it.variantOf !== undefined && !ids.has(it.variantOf)) errors.push(`아이템 ${it.id}: variantOf ${it.variantOf} 가 없음`);
  }
  const def = d.defaults;
  if (!isObj(def) || !isObj(def.items)) errors.push('defaults.items 가 필요함');
  else {
    for (const [s, id] of Object.entries(def.items)) { const t = ids.get(id); if (!slots.includes(s) || !t || t.slot !== s) errors.push(`defaults.items.${s}: ${id} 는 그 슬롯의 아이템이 아님`); }
    if (!(isObj(d.palettes) && d.palettes[def.palette])) errors.push(`defaults.palette ${def.palette} 가 없음`);
    if (!Number.isInteger(def.skin) || !Array.isArray(d.skins) || def.skin < 0 || def.skin >= d.skins.length) errors.push('defaults.skin 이 skins 범위 밖');
  }
  return errors;
}
