// 게임 모드. 수치(맵·인원·팀·목표 점수·점령전 설정)는 content/modes.json (스튜디오에서 고친다), 칸 설명은 shared/content/schema.js 의 MODE_SCHEMA.
// rules: 점수·승리 규칙 (server/modes/<rules>.js). 새 규칙이 필요하면 규칙 파일을 만들고 schema 의 RULES 에 이름을 더한다.
import data from '../content/modes.json' with { type: 'json' };
import { checkModes } from './content/schema.js';

{
  const errors = checkModes(data);
  if (errors.length) throw new Error('모드 데이터 오류 (content/modes.json):\n  ' + errors.join('\n  '));
}
export const MODES = Object.fromEntries(data.map(m => [m.id, m])); // 목록 순서 = 로비에 보이는 순서
export const DEFAULT_MODE = MODES.zone ? 'zone' : data[0].id;     // 대표 모드
export const MAX_PLAYERS = Math.max(...data.map(m => m.max));      // 화면에 미리 만들어 둘 캐릭터 모델 수
