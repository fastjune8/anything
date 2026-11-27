// 아래쪽 스킬 바(자리별 스킬·쿨타임·상태)와 무기 자리 표시, 듀얼 쿠나이 상태 상자.
import { SKILL_KEYS } from '/shared/skills.js';
import { CHARGED } from '/shared/sim/abilities.js';
import { KS, kunaiSlot, wireOn, wireTime, anchored, activeNodes, planThread, pinCount, areaValid, THREAD, KIND_NAME } from '/shared/sim/kunai.js';
import { colliders } from '../scene.js';
import { me } from '../state.js';
import { $, clamp } from '../util.js';
import { setText, setClass } from '../dom.js';

let skillFlash = '', skillFlashT = 0;
export function flashSkill(text) { skillFlash = text; skillFlashT = 1.2; } // 스킬 칸에 잠깐 띄우는 안내 ("닿는 곳이 없다" 등)

const skillEls = [0, 1].map(n => {
  const d = document.createElement('div'); d.className = 'sk';
  d.innerHTML = `<span class="k">${SKILL_KEYS[n]}</span><div class="n"></div><div class="s"></div><i class="cd"></i>`;
  $('skills').appendChild(d); return d;
});
const slotEls = [0, 1].map(n => { const d = document.createElement('div'); $('slots').appendChild(d); d.dataset.n = n; return d; });
function updateSkills() {
  const ps = me.ps;
  skillEls.forEach((el, n) => {
    const l = me.lo[n], sk = l && l.skill, s = ps.sk[n];
    setText(el.children[1], sk ? (sk.effect === 'kunai' ? (ps.kmode ? '와이어 설치' : '앵커 기동') : sk.name) : '스킬 없음');
    let text = '', fill = 0, wait = false, on = false, hot = false;
    if (sk && sk.type === 'active') {
      if (CHARGED.has(sk.effect)) { text = `${s.ch}/${sk.charges}`; fill = s.ch >= sk.charges ? 1 : s.rech / sk.cd; wait = s.ch <= 0; }
      else { wait = s.cd > 0; text = wait ? `${Math.ceil(s.cd)}초` : '준비'; fill = wait ? 1 - s.cd / sk.cd : 1; }
      const st = ps.st;
      if (sk.effect === 'adrenaline' && st.adren > 0) { on = true; text = `사용 중 ${st.adren.toFixed(1)}`; }
      if (sk.effect === 'stealth' && st.stealth > 0) { on = true; text = `투명 ${st.stealth.toFixed(1)}`; }
      if (sk.effect === 'shove' && st.shove > 0) { on = true; text = '다음 사격에 넉백'; }
      if (sk.effect === 'backstep' && st.bs > 0) { on = true; text = '다음 사격 2배'; }
      if (sk.effect === 'kunai') {
        const a = anchored(ps).length, nodes = activeNodes(ps).length, plan = ps.kmode ? threadPlan() : null;
        on = (ps.mo && ps.mo.k === 'kpull') || (ps.kmode === 1 && wireOn(ps));
        text = ps.kmode ? (plan.fail ? (nodes < 2 ? `노드 ${nodes}/2+` : '설치 불가') : `노드 ${nodes} → ${KIND_NAME[plan.kind]}`) : (ps.mo && ps.mo.k === 'kpull' ? '기동 중' : a ? `앵커 ${a}개` : '앵커 없음');
        wait = wait || (ps.kmode ? !!plan.fail : !a);
      }
      if (ps.qsk === n) { on = true; text = '꺼내는 중'; }
    } else if (sk) {
      const ws = ps.w[n], held = ps.cur === n;
      on = held;
      if (sk.effect === 'overheat') { hot = ws.over; text = ws.over ? '과열 — 식는 중' : held ? `열 ${Math.round(ws.heat * 100)}%` : '들면 켜짐'; fill = ws.heat; }
      else if (sk.effect === 'charge' || sk.effect === 'quickdraw') { const ready = ws.idle >= sk.wait; text = ready ? '충전됨' : `${Math.ceil(sk.wait - ws.idle)}초`; fill = ready ? 1 : ws.idle / sk.wait; wait = !ready; }
      else { text = held ? '적용 중' : '들면 켜짐'; fill = held ? 1 : 0; }
    }
    if (skillFlashT > 0 && n === ps.cur) text = skillFlash;
    setText(el.children[2], text); el.children[3].style.width = `${clamp(fill, 0, 1) * 100}%`;
    setClass(el, 'none', !sk); setClass(el, 'wait', wait); setClass(el, 'on', on); setClass(el, 'hot', hot);
  });
  slotEls.forEach((el, n) => { setText(el, `${n + 1}  ${me.lo[n].w.name}`); setClass(el, 'cur', ps.cur === n); });
}

// 듀얼 쿠나이 상태 (그 무기를 가지고 있을 때만): 모드 · 손마다 준비/비행/고정(남은 시간)/회수 · 와이어 남은 시간
const kBox = $('kunaiBox'), kRows = kBox ? [...kBox.querySelectorAll('.kr')] : [];
// 설치 모드 미리보기 (지금 노드로 무엇이 만들어지나 / 왜 안 되나): 노드가 바뀔 때만 다시 계산
let planKey = '', planCache = null;
function threadPlan() {
  const ps = me.ps, key = activeNodes(ps).map(n => `${n.i}:${n.g}`).join(',');
  if (key !== planKey || !planCache) { planKey = key; planCache = planThread(ps, colliders); }
  return planCache;
}
function updateKunaiBox() {
  const ps = me.ps, slot = kunaiSlot(me.lo);
  const show = !!kBox && slot >= 0 && me.alive && !!ps.ku;
  setClass(kBox, 'on', show);
  if (!show) return;
  const key = SKILL_KEYS[slot];
  setText(kBox.children[0], ps.kmode ? `설치 모드 · ${key} 와이어` : `기동 모드 · ${key} 끌려가기`);
  kRows.forEach((el, h) => {
    const k = ps.ku[h], name = h ? '오른손 (우클릭)' : '왼손 (좌클릭)';
    const st = k.s === KS.ANCHOR ? `고정 ${Math.ceil(k.t)}초` : k.s === KS.FLY ? '비행' : k.s === KS.READY ? '준비' : '회수 중';
    el.innerHTML = `<span><b>${h ? 'R' : 'L'}</b>${name}</span><span>${st}</span>`;
    setClass(el, 'anc', k.s === KS.ANCHOR);
  });
  const pins = pinCount(ps), kp = kBox.children[3];
  setText(kp, `핀 노드 (F) 박힘 ${pins} · 남은 ${ps.pinCh}/${THREAD.pin.charges}${ps.pinCh < THREAD.pin.charges ? ` · 충전 ${Math.ceil(THREAD.pin.recharge - ps.pinRe)}초` : ''}`);
  const w = wireOn(ps), kw = kBox.children[4], area = ps.area && areaValid(ps);
  if (w) setText(kw, `${area ? `영역 (${ps.area.n.length}각형)` : `와이어 ${ps.wires.length}줄`} · ${wireTime(ps).toFixed(1)}초`);
  else { const plan = threadPlan(); setText(kw, plan.fail ? plan.fail : `설치 가능: ${KIND_NAME[plan.kind]} (노드 ${activeNodes(ps).length})`); }
  setClass(kw, 'on', w);
}


// 매 프레임
export function updateSkillBar(dt) {
  updateKunaiBox();
  updateSkills();
  skillFlashT -= dt;
}
