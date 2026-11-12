// 방 목록 관리: 빈자리가 있는 방을 찾거나 새로 만든다
import { ROOM_MAX } from '../shared/constants.js';
import { Room } from './room.js';

const rooms = new Set();
let nextNumber = 1;

export function findRoom() {
  for (const room of rooms) if (room.humans().length < ROOM_MAX) return room;
  const room = new Room({ number: nextNumber++, onDestroy: r => rooms.delete(r) });
  rooms.add(room);
  return room;
}

export function roomStats() {
  const list = [...rooms];
  return { rooms: list.length, humans: list.reduce((n, r) => n + r.humans().length, 0) };
}
