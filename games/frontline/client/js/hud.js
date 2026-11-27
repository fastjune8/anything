// 전투 화면 (기획 9장·6장·10장) — 진입점. 실제 그리기는 hud/ 아래 모듈이 나눠 맡는다:
//   common(이름·편·명단)  vitals(체력·탄약)  skills(스킬 바·쿠나이)  combat(맞힘·피격·조준선·도트)
//   match(점수·시간·거점·알림)  feed(킬피드)  screens(사망·점수판·결과)
// 다른 모듈은 여기서만 불러온다 (내부 모듈 구성이 바뀌어도 import 가 안 바뀌게). 새 HUD 요소는 맞는 모듈에 넣고 필요하면 여기서 다시 내보낸다.
import { $ } from './util.js';
import { updateVitals } from './hud/vitals.js';
import { updateSkillBar } from './hud/skills.js';
import { updateCombat } from './hud/combat.js';
import { updateMatchBar } from './hud/match.js';
import { updateScreens } from './hud/screens.js';
import { game } from './state.js';

export { nameOf, sideOf, rosterSet, applyKD } from './hud/common.js';
export { showHit, hurt, damageNumber } from './hud/combat.js';
export { killFeed, feedNote } from './hud/feed.js';
export { flashSkill } from './hud/skills.js';
export { banner, setZones } from './hud/match.js';
export { showDeath, showEnd } from './hud/screens.js';

const hudEl = $('hud');
export const setHudOn = on => hudEl.classList.toggle('on', on);

// 매 프레임
export function updateHud(dt, showBoard) {
  updateVitals();
  updateSkillBar(dt);
  updateCombat(dt);
  updateMatchBar(dt);
  updateScreens(showBoard && game.matchState === 'playing');
}
