// 분위기 목록 (content/looks.json): 빛·하늘·안개 + 맵 물체 재질. 맵 데이터의 look 으로 고른다 (없으면 첫 번째).
// 서버는 그리지 않지만 시작할 때 검사해서 잘못된 데이터를 바로 알린다.
import data from '../content/looks.json' with { type: 'json' };
import { checkLooks } from './content/schema.js';

const errors = checkLooks(data);
if (errors.length) throw new Error('분위기 데이터 오류 (content/looks.json):\n  ' + errors.join('\n  '));

export const LOOKS = data;
export const LOOK_IDS = data.map(l => l.id);
export const getLook = id => data.find(l => l.id === id) || data[0];
