// 게임의 효과 재생: content/effects.json 의 효과를 전장 장면에 그린다 (실행기는 effects.js — 스튜디오 효과 에디터와 같다).
//   쓰는 곳(EFFECT_HOOKS, shared/content/schema.js)의 id 와 같은 효과가 있으면 그 순간에 재생하고, 없으면 false (부르는 쪽은 예전 코드 효과)
import list from '/content/effects.json' with { type: 'json' };
import { createEffects } from './effects.js';
import { scene } from './scene.js';

const byId = new Map(list.map(e => [e.id, e]));
export const vfx = createEffects(scene);
// id 효과를 pos(Vector3)에서. o = { dir, scale }. 반환: 재생했는가
export function playFx(id, pos, o) { const d = byId.get(id); if (!d) return false; vfx.play(d, pos, o); return true; }
