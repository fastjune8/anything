// 도움말: 단축키와 사용법. 위쪽 ? 버튼 또는 F1. 지금 보고 있는 편집기의 탭이 먼저 열린다.
const K = s => s.split(' ').map(k => `<kbd>${k}</kbd>`).join(' ');
const rows = list => `<table>${list.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;

export const HELP = {
  common: {
    title: '처음 / 공통',
    html: `<h3>스튜디오 구조</h3>
      <p><b>홈</b>에서 모든 데이터(맵 · 모델 · 무기 · 파츠 · 모드)를 종류별로 보고, 카드를 <b>두 번 누르면</b> 그 데이터에 맞는 <b>편집기</b>가 탭으로 열립니다. 편집기는 여러 개를 열어 두고 위쪽 탭으로 오갑니다.</p>
      <p>편집기는 모두 같은 모양입니다: 위 = 편집기 버튼, 왼쪽 = <b>도구 상자</b>, 가운데 = <b>화면</b>, 오른쪽 = <b>속성</b>(고른 것의 수치), 맨 아래 = 상태 막대(누르면 콘솔).</p>
      <h3>단축키</h3>
      ${rows([[K('⌘ S'), '지금 탭 저장 (Windows 는 Ctrl)'], [K('⌘ ⇧ S'), '모두 저장'], [K('⌘ Z') + ' / ' + K('⌘ ⇧ Z'), '되돌리기 / 다시 하기'], [K('⌘ W'), '탭 닫기'], [K('⌘ P'), '시험 플레이 / 멈춤 (맵 에디터)'], [K('F1') + ' / ' + K('?'), '이 도움말'], [K('Esc'), '도움말·선택 닫기']])}
      <h3>저장한 것은 어디로?</h3>
      <p>모두 <code>content/</code> 폴더의 파일입니다. git 으로 커밋해서 올리면 팀원에게 전달됩니다 (docs/STUDIO.md). 탭의 <b>●</b> = 아직 저장하지 않음.</p>`,
  },
  map: {
    title: '맵 에디터',
    html: `<h3>물체 놓기</h3>
      <p>왼쪽 도구 상자에서 물체·스폰·거점을 고르고 화면 바닥을 클릭합니다. <kbd>Shift</kbd>+클릭이면 계속 놓고, <kbd>Esc</kbd> 로 그만둡니다.</p>
      <h3>카메라</h3>
      ${rows([[K('W A S D'), '지도 위를 앞뒤좌우로'], [K('Q') + ' / ' + K('E'), '시점 좌우로 돌기'], [K('Shift'), '빠르게'], ['오른쪽 버튼 누른 채', '비행: 마우스로 둘러보기 + WASD, Q/E 아래·위, 휠 = 비행 속도'], [K('Alt') + ' + 왼쪽 끌기', '궤도 회전'], ['가운데 끌기', '화면 이동'], ['휠', '마우스가 가리키는 곳으로 확대'], [K('F') + ' / 더블클릭', '선택한 곳으로'], [K('T'), '위에서 보기'], [K('Home'), '맵 전체 보기']])}
      <h3>편집</h3>
      ${rows([['왼쪽 클릭 / 끌기', '고르기 / 옮기기 (격자 단위)'], ['방향키', '격자 한 칸 옮기기 (Shift = 4칸)'], [K('R'), '90° 회전'], [K('G'), '격자 켜기·끄기 (크기는 위쪽 메뉴)'], [K('⌘ C') + ' / ' + K('⌘ V'), '복사 / 마우스 위치에 붙여넣기'], [K('⌘ D'), '복제'], [K('Delete'), '삭제']])}
      <h3>그 밖에</h3>
      <p><b>반대편에도 배치</b>(속성)를 켜면 맵 중심 대칭으로 하나 더 생깁니다. 대칭 복사본을 끌어도 원본이 같이 움직입니다.</p>
      <p><b>▶ 플레이</b>: 저장하지 않아도 지금 모습 그대로 화면 안에서 게임이 열립니다. "여기서 시작" 을 켜면 보고 있던 곳에서 태어납니다.</p>
      <p>맵 밖 스폰 같은 오류가 있으면 화면 왼쪽 아래에 나오고 저장·플레이가 잠깁니다.</p>`,
  },
  model: {
    title: '모델 에디터',
    html: `<p>Blender 로 만든 <b>.glb</b> 를 열면 규칙(docs/GUN_MODELING.md)대로 만들어졌는지 오른쪽에서 검사합니다. <b>✕</b> 는 꼭 고쳐야 저장할 수 있고, <b>!</b> 는 확인만 하면 됩니다.</p>
      ${rows([['열기', '홈 → 모델 → ".glb 열기", 또는 화면에 파일을 끌어다 놓기'], ['살펴보기', '왼쪽 끌기 회전 · 오른쪽 끌기 이동 · 휠 확대. 부착 지점 이름이 보인다'], ['1인칭', '게임에서 들고 있는 모습 (같은 시야각)'], ['정조준', '빨간 점(조준점)에 가늠쇠가 겹치면 정상'], ['크기 비교', '지금 게임의 총을 반투명으로 겹쳐 보기'], ['파츠 달아 보기', '조준경·소음기·앞 손잡이·탄창이 제자리에 붙는지'], ['스킨', '색 칸(재질 이름)별로 색을 바꿔 보기'], ['저장', '위쪽에 총 id 를 넣고 "프로젝트에 저장" → content/guns/&lt;id&gt;.glb']])}
      <p>Blender 준비는 <code>tools/blender/frontier_gun_template.py</code> 를 Scripting 탭에서 실행하면 됩니다.</p>`,
  },
  data: {
    title: '데이터 에디터',
    html: `<p>무기 · 파츠 · 모드의 수치를 고칩니다. 가운데에서 항목을 고르고, 오른쪽 속성에서 고치면 가운데 표가 바로 다시 계산됩니다.</p>
      ${rows([['무기', 'DPS, 거리별 TTK(체력 100 을 깎는 시간) 비교 — 밸런스 조정'], ['파츠', '자리 → 파츠를 고르면 달 수 있는 무기마다 좋아지는 점 · 나빠지는 점'], ['모드', '인원 · 봇 · 목표 점수 · 점령전 수치'], ['저장', '⌘S. 개발 서버가 다시 시작되어 게임에 바로 반영된다']])}
      <p>범위를 벗어난 값(예: 피해 0)은 오류로 표시되고 저장이 잠깁니다.</p>`,
  },
  effect: {
    title: '효과 에디터',
    html: '<p><b>준비 중</b>입니다. 스킬 시스템과 함께 총구 화염 · 피격 · 스킬 효과를 만드는 편집기가 추가됩니다.</p>',
  },
};

export function createHelp({ onTour }) {
  const box = document.getElementById('help'), tabs = document.getElementById('helpTabs'), body = document.getElementById('helpBody');
  let cur = 'common';
  function show(key) {
    cur = HELP[key] ? key : 'common';
    tabs.replaceChildren(...Object.entries(HELP).map(([k, v]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = v.title; b.dataset.k = k;
      if (k === cur) b.className = 'on';
      b.addEventListener('click', () => show(k));
      return b;
    }));
    body.innerHTML = HELP[cur].html;
  }
  const open = key => { show(key || cur); box.hidden = false; };
  const close = () => { box.hidden = true; };
  document.getElementById('helpClose').addEventListener('click', close);
  box.addEventListener('click', e => { if (e.target === box) close(); });
  document.getElementById('tourAgain').addEventListener('click', () => { close(); onTour(); });
  return { open, close, get isOpen() { return !box.hidden; } };
}
