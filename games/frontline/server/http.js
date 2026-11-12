// HTTP: 정적 파일(client/, shared/, three.js) 제공과 /status
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { APP_ENV, CLIENT_DIR, SHARED_DIR, STARTED_AT, THREE_DIR, VERSION } from './config.js';
import { roomStats } from './rooms.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// URL 앞부분 → 제공할 폴더. 위에서부터 먼저 맞는 것을 쓴다.
const MOUNTS = [
  { prefix: '/shared/', dir: SHARED_DIR, cache: 'no-cache' },
  { prefix: '/vendor/three/', dir: THREE_DIR, cache: 'max-age=86400' },
  { prefix: '/', dir: CLIENT_DIR, cache: 'no-cache' },
];

export function createHttpServer() {
  return http.createServer((req, res) => {
    let url;
    try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch { res.writeHead(400).end(); return; }

    // 상태 확인 (배포 전에 접속 중인 유저가 있는지 보는 용도)
    if (url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ env: APP_ENV, version: VERSION, uptime: Math.round((Date.now() - STARTED_AT) / 1000), ...roomStats() }));
      return;
    }

    const mount = MOUNTS.find(m => url.startsWith(m.prefix));
    const rel = url === '/' ? '/index.html' : url.slice(mount.prefix.length - 1);
    const file = path.join(mount.dir, rel);
    if (file !== mount.dir && !file.startsWith(mount.dir + path.sep)) { res.writeHead(403).end(); return; } // 폴더 밖 접근 차단
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': mount.cache });
      res.end(data);
    });
  });
}
