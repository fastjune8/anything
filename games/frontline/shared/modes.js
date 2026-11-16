// 게임 모드 정의. 로비에서 고르고, 서버는 모드별로 방을 따로 만든다.
// rules: 점수·승리 규칙 (server/modes/<rules>.js). 새 모드는 여기에 설정을 추가하고, 필요하면 규칙 파일을 하나 더 만든다.
export const MODES = {
  zone: {
    id: 'zone', name: '점령전 5 대 5', desc: '거점 하나를 차지하고 지킨다 · 100점 선승',
    map: 'warehouse',
    rules: 'zone',
    max: 10,
    fill: 10,
    teams: 2,
    goal: 100,          // 승리 점수 (거점을 가진 팀이 1초에 1점)
    zone: {
      capture: 8,       // 한 명이 혼자 점령하는 데 걸리는 시간 (초). 2명 1.5배, 3명 이상 2배 빠르다
      decay: 0.5,       // 아무도 없을 때 점령 게이지가 줄어드는 빠르기 (점령 속도 대비)
      pointEvery: 1,    // 거점을 가진 팀이 이 시간(초)마다 1점 (교전 중에는 멈춘다)
      height: 4,        // 거점 바닥에서 이 높이까지 안에 있는 것으로 친다 (m)
    },
  },
  ffa: {
    id: 'ffa', name: '개인 데스매치', desc: '모두가 적 · 20킬 선승',
    map: 'frontline',
    rules: 'deathmatch',
    max: 8,       // 방 최대 인원 (사람 + 봇)
    fill: 6,      // 사람이 적으면 봇으로 이 인원까지 채운다
    teams: 0,     // 0 = 팀 없음
    goal: 20,     // 승리 킬 수 (개인)
  },
  tdm: {
    id: 'tdm', name: '팀 데스매치 5 대 5', desc: '두 팀 · 팀 합계 50킬 선승',
    map: 'warehouse',
    rules: 'deathmatch',
    max: 10,
    fill: 10,     // 항상 5 대 5 가 되도록 봇으로 채운다
    teams: 2,
    goal: 50,     // 승리 킬 수 (팀 합계)
  },
};
export const DEFAULT_MODE = 'zone'; // 대표 모드
export const MAX_PLAYERS = Math.max(...Object.values(MODES).map(m => m.max)); // 화면에 미리 만들어 둘 캐릭터 모델 수
