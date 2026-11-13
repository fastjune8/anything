// 게임 모드 정의. 로비에서 고르고, 서버는 모드별로 방을 따로 만든다.
export const MODES = {
  ffa: {
    id: 'ffa', name: '개인 데스매치', desc: '모두가 적 · 20킬 선승',
    map: 'frontline',
    max: 8,       // 방 최대 인원 (사람 + 봇)
    fill: 6,      // 사람이 적으면 봇으로 이 인원까지 채운다
    teams: 0,     // 0 = 팀 없음
    goal: 20,     // 승리 킬 수 (개인)
  },
  tdm: {
    id: 'tdm', name: '팀 데스매치 5 대 5', desc: '두 팀 · 팀 합계 50킬 선승',
    map: 'warehouse',
    max: 10,
    fill: 10,     // 항상 5 대 5 가 되도록 봇으로 채운다
    teams: 2,
    goal: 50,     // 승리 킬 수 (팀 합계)
  },
};
export const DEFAULT_MODE = 'ffa';
export const MAX_PLAYERS = Math.max(...Object.values(MODES).map(m => m.max)); // 화면에 미리 만들어 둘 캐릭터 모델 수
