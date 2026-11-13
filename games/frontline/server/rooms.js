// 방 목록 관리: 고른 모드에서 빈자리가 있는 방을 찾거나 새로 만든다
import { MODES } from '../shared/modes.js';
import { Room } from './room.js';

const rooms = new Set();
let nextNumber = 1;

export function findRoom(mode) {
  for (const room of rooms) if (room.mode === mode && room.humans().length < room.cfg.max) return room;
  const room = new Room({ number: nextNumber++, mode, onDestroy: r => rooms.delete(r) });
  rooms.add(room);
  return room;
}

// 전체와 모드별 접속 현황 (로비 표시, 배포 전 확인용)
export function roomStats() {
  const modes = {};
  for (const id of Object.keys(MODES)) modes[id] = { rooms: 0, humans: 0 };
  let humans = 0;
  for (const r of rooms) { const n = r.humans().length; humans += n; modes[r.mode].rooms++; modes[r.mode].humans += n; }
  return { rooms: rooms.size, humans, modes };
}
