// 개발용 기능: 스튜디오(/studio/)와 스튜디오가 저장할 때 쓰는 API. 라이브(prod)에서는 꺼져 있다.
//   PUT /api/maps/<id>   맵 데이터 저장 → 검사 → content/maps/<id>.json 에 쓰고, 새 맵이면 목록(index.json)에 추가
//   PUT /api/guns/<id>   총 모델(.glb) 저장 → content/guns/<id>.glb, 목록 content/guns/index.json
//   PUT /api/content/<weapons|parts|modes|prefabs>   데이터 파일 저장 (검사 후). 개발 서버는 이 파일이 바뀌면 다시 시작한다 (npm run dev)
//   PUT /api/drafts/<맵 id>   저장하지 않은 맵을 시험 플레이용으로 서버 메모리에만 올린다 → { id: 'draft_<맵 id>' }
//   GET /api/drafts/<draft id>   그 맵 데이터 (게임 화면이 받아 간다)
//   POST /api/register/model   검증을 통과해 저장한 모델을 "데이터로 등록" (content/models.json). 무기에 연결하면 weapons.json 의 model 도 바꾼다
//   DELETE /api/register/model/<id>   등록 해제 (그 모델을 쓰던 무기는 코드로 만든 총으로 돌아간다)
//   GET /api/version   GitHub(origin/main) 에 내 컴퓨터보다 새 커밋이 있는지 (스튜디오 업데이트 알림)
// 저장하면 서버 메모리의 맵도 바로 바뀐다 (새로 만드는 방부터 적용, 이미 열린 방은 그대로).
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { APP_ENV, CONTENT_DIR, ROOT } from './config.js';
import { checkMap, checkWeapons, checkParts, checkModes, checkModels, checkPrefabs, RULES } from '../shared/content/schema.js';
import { formatContent } from '../shared/content/format.js';
import { setMapDef, MAP_IDS } from '../shared/maps/index.js';
import { forgetNav } from './bots/nav.js';

export const DEV_TOOLS = APP_ENV !== 'prod';
const MAX_BODY = 2 * 1024 * 1024, MAX_GLB = 5 * 1024 * 1024;

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, max = MAX_BODY) { // 반환: Buffer
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 처리했으면 true
export function handleDevApi(req, res, url) {
  if (!DEV_TOOLS || !url.startsWith('/api/')) return false;
  if (url === '/api/register/model' && req.method === 'POST') { registerModel(req, res); return true; }
  const ur = url.match(/^\/api\/register\/model\/([a-z0-9_]+)$/);
  if (ur && req.method === 'DELETE') { unregisterModel(res, ur[1]); return true; }
  if (url === '/api/version' && req.method === 'GET') { versionInfo().then(v => send(res, 200, v)); return true; }
  const g = url.match(/^\/api\/guns\/([a-z0-9_]+)$/);
  if (g && req.method === 'PUT') { saveGun(req, res, g[1]); return true; }
  const c = url.match(/^\/api\/content\/(weapons|parts|modes|prefabs)$/);
  if (c && req.method === 'PUT') { saveData(req, res, c[1]); return true; }
  const d = url.match(/^\/api\/drafts\/([a-z0-9_]+)$/);
  if (d && req.method === 'PUT') { putDraft(req, res, d[1]); return true; }
  if (d && req.method === 'GET') { const def = drafts.get(d[1]); if (def) send(res, 200, def); else send(res, 404, { ok: false, errors: ['없는 시험 맵'] }); return true; }
  const m = url.match(/^\/api\/maps\/([a-z0-9_]+)$/);
  if (!m || req.method !== 'PUT') { send(res, 404, { ok: false, errors: ['없는 API'] }); return true; }
  const id = m[1];
  readBody(req).then(buf => {
    let def;
    try { def = JSON.parse(buf.toString('utf8')); } catch { send(res, 400, { ok: false, errors: ['JSON 이 아님'] }); return; }
    const errors = checkMap(def);
    if (def && def.id !== id) errors.push(`주소의 id(${id}) 와 데이터의 id(${def && def.id}) 가 다름`);
    if (errors.length) { send(res, 400, { ok: false, errors }); return; }
    const dir = path.join(CONTENT_DIR, 'maps');
    fs.writeFileSync(path.join(dir, `${id}.json`), formatContent(def));
    const isNew = !MAP_IDS.includes(id);
    if (isNew) fs.writeFileSync(path.join(dir, 'index.json'), formatContent([...MAP_IDS, id]));
    setMapDef(def); forgetNav(id);
    console.log(`[에디터] 맵 저장: ${id}${isNew ? ' (새 맵)' : ''}`);
    send(res, 200, { ok: true, id, isNew });
  }).catch(() => send(res, 413, { ok: false, errors: ['데이터가 너무 큼'] }));
  return true;
}

// 총 모델 저장. 내용 검사(부착 지점 등)는 총기 뷰어가 하고, 여기서는 glb 파일인지만 본다
function saveGun(req, res, id) {
  readBody(req, MAX_GLB).then(buf => {
    if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'glTF') { send(res, 400, { ok: false, errors: ['.glb 파일이 아님'] }); return; }
    const dir = path.join(CONTENT_DIR, 'guns'), index = path.join(dir, 'index.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.glb`), buf);
    const list = fs.existsSync(index) ? JSON.parse(fs.readFileSync(index, 'utf8')) : [];
    const isNew = !list.includes(id);
    if (isNew) fs.writeFileSync(index, formatContent([...list, id].sort()));
    console.log(`[총기 뷰어] 총 모델 저장: ${id}.glb (${(buf.length / 1024).toFixed(0)}KB)${isNew ? ' (새 총)' : ''}`);
    send(res, 200, { ok: true, id, isNew, bytes: buf.length });
  }).catch(() => send(res, 413, { ok: false, errors: ['파일이 너무 큼 (최대 5MB)'] }));
}

// 데이터 파일 저장: 검사를 통과하면 content/<name>.json 에 쓴다
const readJson = name => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, `${name}.json`), 'utf8'));
const DATA_CHECKS = {
  weapons: d => checkWeapons(d, readJson('models').map(m => m.id)),
  prefabs: d => checkPrefabs(d),
  parts: d => checkParts(d, readJson('weapons').map(w => w.id)),
  modes: d => checkModes(d, MAP_IDS.filter(id => !id.startsWith('draft_'))).concat((Array.isArray(d) ? d : []).filter(m => m && !RULES.includes(m.rules)).map(m => `모드 ${m.id}: 없는 규칙 ${m.rules}`)),
};
function saveData(req, res, name) {
  readBody(req).then(buf => {
    let data;
    try { data = JSON.parse(buf.toString('utf8')); } catch { send(res, 400, { ok: false, errors: ['JSON 이 아님'] }); return; }
    const errors = DATA_CHECKS[name](data);
    if (errors.length) { send(res, 400, { ok: false, errors }); return; }
    fs.writeFileSync(path.join(CONTENT_DIR, `${name}.json`), formatContent(data));
    console.log(`[스튜디오] 데이터 저장: content/${name}.json`);
    send(res, 200, { ok: true, name });
  }).catch(() => send(res, 413, { ok: false, errors: ['데이터가 너무 큼'] }));
}

// 시험 플레이용 임시 맵 (파일에 쓰지 않는다). 맵 id 마다 하나: draft_<id>
const drafts = new Map();
function putDraft(req, res, mapId) {
  readBody(req).then(buf => {
    let def;
    try { def = JSON.parse(buf.toString('utf8')); } catch { send(res, 400, { ok: false, errors: ['JSON 이 아님'] }); return; }
    const errors = checkMap(def);
    if (errors.length) { send(res, 400, { ok: false, errors }); return; }
    const id = `draft_${mapId}`.slice(0, 60), draft = { ...def, id, name: `${def.name} (시험)` };
    drafts.set(id, draft); setMapDef(draft); forgetNav(id);
    send(res, 200, { ok: true, id });
  }).catch(() => send(res, 413, { ok: false, errors: ['데이터가 너무 큼'] }));
}

// ───────── 업데이트 알림 ─────────
// git fetch 로 GitHub 의 main 을 받아 와서, 지금 컴퓨터(HEAD)에 없는 커밋이 몇 개인지 센다.
// fetch 는 5분에 한 번만 (스튜디오를 여러 번 열어도 GitHub 에 자주 묻지 않게). git 이 없거나 오프라인이면 { ok: false }
const git = args => new Promise(resolve => execFile('git', args, { cwd: ROOT, timeout: 15000 }, (err, out) => resolve(err ? null : String(out).trim())));
let lastFetch = 0, fetching = null;
async function versionInfo() {
  if (Date.now() - lastFetch > 5 * 60 * 1000) {
    fetching = fetching || git(['fetch', '--quiet', 'origin', 'main']).then(() => { lastFetch = Date.now(); fetching = null; });
    await fetching;
  }
  const behind = await git(['rev-list', '--count', 'HEAD..origin/main']);
  if (behind === null) return { ok: false };
  const latest = Number(behind) > 0 ? await git(['log', '-1', '--format=%s (%cr)', 'origin/main']) : null;
  const dirtyStudio = await git(['status', '--porcelain', '--', 'studio', 'server', 'shared', 'client']);
  return { ok: true, behind: Number(behind), latest, localChanges: !!dirtyStudio };
}

// ───────── 데이터로 등록 (모델) ─────────
// 모델 에디터가 검사(✕ 없음)를 통과한 모델만 보낸다. 서버는 파일이 정말 있는지·glb 인지·목록이 올바른지 다시 본다.
const writeJson = (name, data) => fs.writeFileSync(path.join(CONTENT_DIR, `${name}.json`), formatContent(data));
function registerModel(req, res) {
  readBody(req).then(buf => {
    let b;
    try { b = JSON.parse(buf.toString('utf8')); } catch { send(res, 400, { ok: false, errors: ['JSON 이 아님'] }); return; }
    if (!b || b.kind !== 'gun') { send(res, 400, { ok: false, errors: ['지금은 총 모델만 등록할 수 있다 (물체 모델은 준비 중)'] }); return; }
    const file = `guns/${b.id}.glb`, full = path.join(CONTENT_DIR, file);
    if (!/^[a-z0-9_]+$/.test(String(b.id)) || !fs.existsSync(full)) { send(res, 400, { ok: false, errors: [`content/${file} 이 없다 — 먼저 "프로젝트에 저장"`] }); return; }
    const glb = fs.readFileSync(full);
    if (glb.toString('ascii', 0, 4) !== 'glTF') { send(res, 400, { ok: false, errors: ['glb 파일이 아님'] }); return; }
    const entry = { id: b.id, name: String(b.name || b.id).slice(0, 40), kind: 'gun', file, tris: Math.max(1, Math.round(b.tris) || 1), bytes: glb.length, warnings: Math.max(0, b.warnings | 0), registered: new Date().toISOString().slice(0, 10) };
    const models = readJson('models').filter(m => m.id !== b.id).concat(entry);
    const errors = checkModels(models);
    if (errors.length) { send(res, 400, { ok: false, errors }); return; }
    let linked = null;
    if (b.weapon) { // 무기에 연결: 그 무기의 model 을 이 모델로
      const weapons = readJson('weapons'), w = weapons.find(x => x.id === b.weapon);
      if (!w) { send(res, 400, { ok: false, errors: [`없는 무기: ${b.weapon}`] }); return; }
      w.model = b.id; linked = w.id;
      writeJson('models', models); writeJson('weapons', weapons);
    } else writeJson('models', models);
    console.log(`[스튜디오] 데이터로 등록: 모델 ${b.id}${linked ? ` → 무기 ${linked}` : ''}`);
    send(res, 200, { ok: true, entry, linked });
  }).catch(() => send(res, 413, { ok: false, errors: ['데이터가 너무 큼'] }));
}
function unregisterModel(res, id) {
  const models = readJson('models');
  if (!models.some(m => m.id === id)) { send(res, 404, { ok: false, errors: ['등록되지 않은 모델'] }); return; }
  writeJson('models', models.filter(m => m.id !== id));
  const weapons = readJson('weapons'); let changed = false;
  for (const w of weapons) if (w.model === id) { delete w.model; changed = true; }
  if (changed) writeJson('weapons', weapons);
  console.log(`[스튜디오] 등록 해제: 모델 ${id}`);
  send(res, 200, { ok: true });
}
