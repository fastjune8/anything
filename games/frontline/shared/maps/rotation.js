// 맵 순환: 모드마다 맵 풀(content/modes.json 의 mapPool)에서 경기마다 무작위로 하나를 고른다. 순수 함수 (서버·브라우저·테스트 공용).
//   풀이 둘 이상이면 직전 맵은 뺀다 → 같은 맵이 연달아 나오지 않는다. mapPool 이 없으면 기본 맵(map) 하나만.

// cfg: 모드 설정, validIds: 실제로 있는 맵 id 목록. 없는 맵은 풀에서 뺀다 (기본 맵은 늘 남는다)
export function poolOf(cfg, validIds) {
  const pool = (Array.isArray(cfg.mapPool) && cfg.mapPool.length ? cfg.mapPool : [cfg.map]).filter(id => validIds.includes(id));
  return pool.length ? [...new Set(pool)] : [cfg.map];
}

// pool 에서 하나 고른다. lastId 는 직전에 쓴 맵 (풀이 하나뿐이면 어쩔 수 없이 같은 맵)
export function pickMap(pool, lastId = null, rand = Math.random) {
  const candidates = pool.length > 1 ? pool.filter(id => id !== lastId) : pool;
  return candidates[Math.min(candidates.length - 1, Math.floor(rand() * candidates.length))];
}
