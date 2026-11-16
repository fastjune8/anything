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
    h: num('높이', { min: 0.3, max: 20, step: 0.1 }), t: num('두께', opt({ min: 0.1, max: 3, step: 0.05 })), mat: oneOf('재질', MATERIALS), ops: OPENINGS,
  } },
  building: { label: '건물', fields: {
    x: X, z: Z, w: num('너비 (x)', { min: 2, max: 100, step: 0.1 }), d: num('깊이 (z)', { min: 2, max: 100, step: 0.1 }), h: num('높이', { min: 1, max: 20, step: 0.1 }),
    mat: oneOf('재질', MATERIALS), roof: bool('지붕', opt()),
    ops: obj('문·창문 (n=북 z+, s=남 z−, e=동 x+, w=서 x−)', { n: OPENINGS, s: OPENINGS, e: OPENINGS, w: OPENINGS }, opt()),
  } },
  container: { label: '컨테이너', fields: { x: X, z: Z, axis: AXIS, tint: color('색', opt()), y: num('바닥 높이 (2단 = 2.59)', opt({ min: 0, step: 0.01 })) } },
  crate: { label: '상자', fields: { x: X, z: Z, s: num('크기', opt({ min: 0.3, max: 4, step: 0.1 })), y: num('바닥 높이', opt({ min: 0, step: 0.1 })) } },
  sandbags: { label: '모래주머니', fields: { x: X, z: Z, axis: AXIS, len: num('길이', opt({ min: 0.5, max: 20, step: 0.1 })), h: num('높이', opt({ min: 0.3, max: 2, step: 0.05 })) } },
  barrier: { label: '콘크리트 방벽', fields: { x: X, z: Z, axis: AXIS } },
  barrel: { label: '드럼통', fields: { x: X, z: Z, tint: color('색', opt()) } },
  tower: { label: '감시탑', fields: { x: X, z: Z } },
  tree: { label: '나무', fields: { x: X, z: Z, s: num('크기', opt({ min: 0.3, max: 3, step: 0.05 })) } },
};

export const ZONE = obj('거점', { id: str('id'), name: str('이름', opt()), x: X, z: Z, r: num('반지름', { min: 1, max: 30, step: 0.5 }) });

export const MAP_SCHEMA = obj('맵', {
  id: str('id', { pattern: '^[a-z0-9_]+$', hint: '영문 소문자·숫자·_ (파일 이름이 된다)' }),
  name: str('이름'),
  half: num('맵 절반 크기 (m)', { min: 10, max: 250 }),
  spawns: obj('스폰 지점', {
    ffa: list('개인전 스폰', point('지점'), { minLen: 2 }),
    team: list('팀 스폰 [0팀, 1팀]', list('팀', point('지점'), { minLen: 1 }), opt({ minLen: 2, maxLen: 2 })),
  }),
  zones: list('거점', ZONE, opt()),
  objects: list('물체', obj('물체', {}), { custom: 'object' }),
});

// ───────── 무기 ─────────
export const WEAPON_SCHEMA = obj('무기', {
  id: str('id', { pattern: '^[a-z0-9_]+$' }), name: str('이름'), cls: str('분류'),
  auto: bool('연사'), rpm: num('분당 발사 수', { min: 10, max: 2000 }),
  dmg: num('피해', { min: 1, max: 300 }), head: num('머리 배율', { min: 1, max: 5, step: 0.1 }), pellets: int('산탄 수', { min: 1, max: 20 }),
  mag: int('탄창', { min: 1, max: 300 }), reserve: int('예비 탄', { min: 0, max: 1000 }), reload: num('재장전 (초)', { min: 0.1, max: 10, step: 0.05 }),
  shell: bool('한 발씩 장전', opt()), bolt: bool('볼트액션', opt()), scope: bool('스코프 화면', opt()),
  hip: num('지향 사격 탄퍼짐 (도)', { min: 0, max: 15, step: 0.05 }), ads: num('정조준 탄퍼짐 (도)', { min: 0, max: 10, step: 0.01 }),
  bloom: num('연사 중 탄퍼짐 증가', { min: 0, max: 3, step: 0.01 }), bloomMax: num('탄퍼짐 증가 최대', { min: 0, max: 10, step: 0.05 }),
  recoilV: num('수직 반동', { min: 0, max: 10, step: 0.05 }), recoilH: num('수평 반동', { min: 0, max: 5, step: 0.05 }),
  adsFov: num('정조준 시야각', { min: 3, max: 90 }), adsTime: num('정조준 시간 (초)', { min: 0.05, max: 2, step: 0.01 }),
  falloff: list('거리 감쇠 [시작 m, 끝 m, 최소 배율] (없으면 null)', num('값'), opt({ nullable: true, minLen: 3, maxLen: 3 })),
  move: num('이동 속도 배율', { min: 0.5, max: 1.5, step: 0.01 }), draw: num('꺼내는 시간 (초)', { min: 0.05, max: 3, step: 0.05 }),
  snd: obj('총소리', { f: num('주파수'), dur: num('길이'), vol: num('크기'), thump: num('저음') }),
});

// ───────── 파츠 ─────────
const STATS = ['recoilV', 'recoilH', 'hip', 'ads', 'bloom', 'adsTime', 'reload', 'draw', 'move', 'mag', 'range', 'adsFov'];
export const PART_SCHEMA = obj('파츠', {
  id: str('id', { pattern: '^[a-z0-9_]+$' }), name: str('이름'),
  mul: dict('성능 배율 (1 보다 크면 값이 커진다)', num('배율', { min: 0.1, max: 5, step: 0.01 }), { keys: STATS }),
  only: list('이 무기에만', str('무기 id'), opt()), not: list('이 무기에는 안 됨', str('무기 id'), opt()),
  quiet: bool('소음 (미니맵에 안 보임)', opt()),
});
export const PARTS_SCHEMA = obj('파츠 목록', {
  slots: list('자리', obj('자리', { id: str('id'), name: str('이름') })),
  parts: dict('자리별 파츠', list('파츠', PART_SCHEMA)),
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
      value.forEach((v, i) => (spec.custom === 'object' ? checkObject(v, `${path}[${i}]`, errors) : check(v, spec.of, `${path}[${i}]`, errors)));
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
export function objectSpec(type) {
  const s = OBJECT_SCHEMAS[type];
  return s ? obj(s.label, { type: oneOf('종류', Object.keys(OBJECT_SCHEMAS)), ...s.fields, ...COMMON_FIELDS }) : null;
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

export function checkWeapons(list) {
  const errors = check(list, F('list', '무기 목록', { of: WEAPON_SCHEMA, minLen: 2 }));
  const ids = list.map(w => w && w.id);
  ids.forEach((id, i) => { if (ids.indexOf(id) !== i) errors.push(`무기 id 중복: ${id}`); });
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
