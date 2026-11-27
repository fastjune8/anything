// 서버 설정: 환경변수와 경로 (여기서만 process.env 를 읽는다)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLIENT_DIR = path.join(ROOT, 'client');
export const SHARED_DIR = path.join(ROOT, 'shared');
export const CONTENT_DIR = path.join(ROOT, 'content'); // 맵·무기·스킬 데이터 (스튜디오가 쓴다)
export const STUDIO_DIR = path.join(ROOT, 'studio');   // FRONTIER Studio (개발 서버에서만 제공)
export const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data'); // 계정·전적 저장 (git 에 올리지 않는다)

export const PORT = Number(process.env.PORT) || 3000;
export const APP_ENV = process.env.APP_ENV || 'dev'; // dev | prod | test
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
export const STARTED_AT = Date.now();

// 테스트에서 시간을 줄이려고 환경변수로 바꿀 수 있다
export const goalFor = cfg => Number(process.env.GOAL) || cfg.goal;
export const matchMsFor = cfg => (process.env.MATCH_SECONDS ? Number(process.env.MATCH_SECONDS) * 1000 : cfg.minutes * 60000);
export const FORCE_MAP = process.env.FORCE_MAP || ''; // 개발·테스트: 맵 순환을 끄고 이 맵 하나만 쓴다 (테스트가 맵 좌표를 가정하므로 tests/helpers.mjs 가 기본으로 켠다)
export const RESULTS_MS = process.env.RESULTS_SECONDS ? Number(process.env.RESULTS_SECONDS) * 1000 : 15000; // 결과 화면 (재매치/로비 선택)
export const VICTORY_MS = process.env.VICTORY_SECONDS ? Number(process.env.VICTORY_SECONDS) * 1000 : 3500;  // 승리 연출
export const botFillFor = cfg => (process.env.BOT_FILL !== undefined ? Number(process.env.BOT_FILL) : cfg.fill);
export const respawnFor = cfg => (process.env.RESPAWN_SECONDS ? Number(process.env.RESPAWN_SECONDS) : cfg.respawn);
export const PERSIST = process.env.PERSIST !== 'off';
// 입력 큐 (기본 켜짐): 받은 입력을 바로 몰아서 처리하지 않고 한 tick 에 1~2개씩 처리한다. 끄면 예전 방식 (시험 비교용)
export const INPUT_QUEUE = process.env.INPUT_QUEUE !== 'off';
export const PERF_LOG = process.env.PERF_LOG === '1'; // 1초마다 서버 성능 요약을 로그로 (개발·측정용)   // 테스트는 계정 파일을 쓰지 않는다

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}
