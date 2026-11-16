// 개발용 기능: 맵 에디터(/editor/)와 에디터가 저장할 때 쓰는 API. 라이브(prod)에서는 꺼져 있다.
//   PUT /api/maps/<id>   맵 데이터 저장 → 검사 → content/maps/<id>.json 에 쓰고, 새 맵이면 목록(index.json)에 추가
// 저장하면 서버 메모리의 맵도 바로 바뀐다 (새로 만드는 방부터 적용, 이미 열린 방은 그대로).
import fs from 'node:fs';
import path from 'node:path';
import { APP_ENV, CONTENT_DIR } from './config.js';
import { checkMap } from '../shared/content/schema.js';
import { formatContent } from '../shared/content/format.js';
import { setMapDef, MAP_IDS } from '../shared/maps/index.js';
import { forgetNav } from './bots/nav.js';

export const DEV_TOOLS = APP_ENV !== 'prod';
const MAX_BODY = 2 * 1024 * 1024;

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// 처리했으면 true
export function handleDevApi(req, res, url) {
  if (!DEV_TOOLS || !url.startsWith('/api/')) return false;
  const m = url.match(/^\/api\/maps\/([a-z0-9_]+)$/);
  if (!m || req.method !== 'PUT') { send(res, 404, { ok: false, errors: ['없는 API'] }); return true; }
  const id = m[1];
  readBody(req).then(text => {
    let def;
    try { def = JSON.parse(text); } catch { send(res, 400, { ok: false, errors: ['JSON 이 아님'] }); return; }
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
