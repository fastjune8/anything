// HUD 공용: 이름·편 조회, 점수판 명단(roster) 갱신, 시간 표기. 다른 HUD 모듈이 같이 쓴다.
import { me, roster, isAlly } from '../state.js';
import { MODE_CFG } from '../util.js';

export const nameOf = id => (id === me.id ? me.name : (roster.get(id) || {}).name || '?');
export const sideOf = id => (id === me.id ? 'me' : MODE_CFG.teams && isAlly((roster.get(id) || {}).team) ? 'a' : 'e');
export const rosterSet = p => roster.set(p.id, { id: p.id, name: p.name, bot: !!p.bot, team: p.team ?? -1, k: p.k | 0, d: p.d | 0, a: p.a | 0, lvl: p.lvl | 0, lo: p.lo || null });
export function applyKD(kd) { for (const [id, k, d, a] of kd || []) { const p = roster.get(id); if (p) { p.k = k; p.d = d; p.a = a; } } }

export const teamCss = t => (t < 0 ? 'n' : t === me.team ? 'a' : 'e');
export function fmt(s) { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
