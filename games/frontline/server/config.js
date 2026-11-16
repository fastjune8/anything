// 서버 설정: 환경변수와 경로, 게임 진행 시간 등 (여기서만 process.env 를 읽는다)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATCH_RESTART_MS, MATCH_TIME_MS } from '../shared/constants.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLIENT_DIR = path.join(ROOT, 'client');
export const SHARED_DIR = path.join(ROOT, 'shared');
export const CONTENT_DIR = path.join(ROOT, 'content'); // 맵·무기·파츠 데이터 (에디터가 쓴다)
export const EDITOR_DIR = path.join(ROOT, 'editor');   // 맵 에디터 (개발 서버에서만 제공)
export const THREE_DIR = path.join(ROOT, 'node_modules', 'three');

export const PORT = Number(process.env.PORT) || 3000;
export const APP_ENV = process.env.APP_ENV || 'dev'; // dev | prod | test
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
export const STARTED_AT = Date.now();

export const TICK_MS = 50; // 방 업데이트 주기 (봇 AI, 체력 회복)

// 아래는 테스트에서 시간을 줄이려고 환경변수로 바꿀 수 있다
export const goalFor = cfg => Number(process.env.GOAL) || cfg.goal;
export const MATCH_MS = process.env.MATCH_SECONDS ? Number(process.env.MATCH_SECONDS) * 1000 : MATCH_TIME_MS;
export const RESTART_MS = process.env.RESTART_SECONDS ? Number(process.env.RESTART_SECONDS) * 1000 : MATCH_RESTART_MS;
export const botFillFor = cfg => (process.env.BOT_FILL !== undefined ? Number(process.env.BOT_FILL) : cfg.fill);

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}
