// 데이터 파일(content/<이름>.json) 목록 — 한 곳에서 정한다.
//   서버의 저장 API(PUT /api/content/<이름>)와 스튜디오의 검사가 이 목록을 그대로 쓴다.
//   새 데이터 종류 = schema.js 에 모양(check 함수)을 정의하고, 여기에 한 줄 더하면 저장·검사가 따라온다.
//   check(데이터, 참고) — 참고: 다른 파일에서 온 id 목록 { models, skills, weapons(무기 객체들), maps }
import { checkWeapons, checkParts, checkModes, checkPrefabs, checkLooks, checkSkills, checkGunMaterials, checkEffects, RULES } from './schema.js';

const ids = list => (Array.isArray(list) ? list : []).map(x => x && x.id);

export const CONTENT = {
  weapons: { label: '무기', check: (d, ref) => checkWeapons(d, ref.models, ref.skills) },
  parts: { label: '파츠', check: (d, ref) => checkParts(d, ids(ref.weapons)) },
  modes: {
    label: '모드',
    check: (d, ref) => checkModes(d, ref.maps).concat((Array.isArray(d) ? d : []).filter(m => m && !RULES.includes(m.rules)).map(m => `모드 ${m.id}: 없는 규칙 ${m.rules}`)),
  },
  // 스킬: 모양 + 무기가 쓰고 있는 스킬을 지우거나 id 를 바꾸지 않았는가
  skills: { label: '스킬', check: (d, ref) => checkSkills(d).concat(checkWeapons(ref.weapons || [], null, ids(d)).filter(e => e.includes('없는 스킬'))) },
  prefabs: { label: '프리팹', check: d => checkPrefabs(d) },
  looks: { label: '분위기', check: d => checkLooks(d) },
  gunmaterials: { label: '총 질감', check: d => checkGunMaterials(d) },
  effects: { label: '효과', check: d => checkEffects(d) },
};
export const CONTENT_NAMES = Object.keys(CONTENT);
