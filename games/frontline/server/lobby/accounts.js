// 계정 · 레벨 · 전적 (기획 13장). 지금은 손님 계정: 브라우저가 처음 접속하면 토큰을 받아 저장하고, 다음부터 그 토큰으로 들어온다.
// 저장은 data/accounts.json (서버 한 대 기준). 나중에 로그인·DB 로 바꿀 때 이 파일만 바꾸면 된다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, PERSIST } from '../config.js';

const FILE = path.join(DATA_DIR, 'accounts.json');
const byId = new Map(), byToken = new Map();
let nextId = 1, saveTimer = null;

function load() {
  if (!PERSIST) return;
  try {
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const a of list) { byId.set(a.id, a); byToken.set(a.token, a); nextId = Math.max(nextId, a.id + 1); }
  } catch { /* 처음 실행 */ }
}
load();
export function saveSoon() {
  if (!PERSIST || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...byId.values()]));
    fs.renameSync(tmp, FILE);
  }, 1500);
}

const newStats = () => ({ playSec: 0, matches: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, assists: 0, caps: 0, weapons: {} });
const cleanName = n => String(n || '').replace(/[\u0000-\u001f\u007f#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
const randomTag = () => String(1000 + Math.floor(Math.random() * 9000));

export function getAccount(id) { return byId.get(id) || null; }
export function byTag(name, tag) { for (const a of byId.values()) if (a.tag === tag && a.name.toLowerCase() === String(name).toLowerCase()) return a; return null; }

// 토큰으로 찾고, 없으면 새 손님 계정
export function login(token, name) {
  let a = typeof token === 'string' ? byToken.get(token) : null;
  if (!a) {
    a = { id: nextId++, token: crypto.randomBytes(18).toString('base64url'), name: cleanName(name) || `병사${nextId}`, tag: randomTag(), created: Date.now(), xp: 0, level: 1, stats: newStats(), friends: [], requests: [], loadout: null, outfit: null };
    byId.set(a.id, a); byToken.set(a.token, a); saveSoon();
  }
  return a;
}
export function rename(a, name) { const n = cleanName(name); if (n) { a.name = n; saveSoon(); } return a.name; }

// ───── 레벨 (기획 13.2: 경험치 양·레벨 곡선 미확정 → 임시) ─────
export const xpToNext = level => 600 + 200 * (level - 1);
export function addXp(a, xp) {
  a.xp += xp;
  let ups = 0;
  while (a.xp >= xpToNext(a.level)) { a.xp -= xpToNext(a.level); a.level++; ups++; }
  return ups;
}
// 경기 한 판의 경험치: 참여 + 킬·어시스트·점령 + 승리
export const matchXp = r => Math.round(100 + r.kills * 25 + r.assists * 10 + r.caps * 40 + (r.result === 'win' ? 200 : r.result === 'draw' ? 80 : 0) + Math.min(r.sec, 900) / 6);

// 경기 결과 기록. r = { sec, result: win|loss|draw, kills, deaths, assists, caps, weapons: { id: { kills, deaths, dmg, shots, hits, heads } } }
export function recordMatch(a, r) {
  const s = a.stats;
  s.playSec += Math.round(r.sec); s.matches++;
  if (r.result === 'win') s.wins++; else if (r.result === 'loss') s.losses++; else s.draws++;
  s.kills += r.kills; s.deaths += r.deaths; s.assists += r.assists; s.caps += r.caps;
  for (const [id, w] of Object.entries(r.weapons)) {
    const t = s.weapons[id] || (s.weapons[id] = { uses: 0, kills: 0, deaths: 0, dmg: 0, shots: 0, hits: 0, heads: 0 });
    t.uses++; for (const k of ['kills', 'deaths', 'dmg', 'shots', 'hits', 'heads']) t[k] += Math.round(w[k] || 0);
  }
  const xp = matchXp(r), ups = addXp(a, xp);
  saveSoon();
  return { xp, ups };
}
// 브라우저에 보내는 내 정보 (토큰은 hello 응답에만)
export const profile = a => ({ id: a.id, name: a.name, tag: a.tag, level: a.level, xp: a.xp, next: xpToNext(a.level), stats: a.stats });
export const publicCard = a => ({ id: a.id, name: a.name, tag: a.tag, level: a.level });
