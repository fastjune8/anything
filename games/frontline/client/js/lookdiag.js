// 시점 튐 진단 (개발용). 주소에 ?debuglook 가 있을 때만 켜지고, 없으면 lookDiag 가 null 이라 비용이 없다.
//   마우스 이벤트(movementX/Y·간격)와 프레임(dt·yaw 변화·셰이더 프로그램 수)을 2초치 기록하다가,
//   한 프레임에 yaw 가 JUMP 이상 바뀌면 원인을 판정해 console 에 직전 2초를 덤프한다.
//     A  한 이벤트의 movementX 하나가 JUMP 를 혼자 만든다 (포인터 락 스파이크)
//     B  프레임이 오래 멈췄다(dt > HITCH_MS) 풀리면서 정상 크기 이벤트가 몰렸다 / 그 프레임에 셰이더가 새로 컴파일됐다
//     C  마우스 입력으로 설명되지 않는 yaw 변화 (서버 보정·teleport·반동 등)
//   결과: window.__look.jumps (튄 프레임 목록) · window.__look.summary() (튐 횟수·최대 dt·긴 프레임 수)
import { params } from './util.js';
import { quality } from './quality.js';

const JUMP = 0.35;      // rad. 한 프레임에 이만큼 돌면 "튐"
const HITCH_MS = 50;    // 이보다 긴 프레임 = 정지(hitch)
const KEEP_MS = 2000;   // 덤프에 넣는 기록 길이

class LookDiag {
  constructor() {
    this.ev = [];        // { t, dx, dy, gap, avg }
    this.fr = [];        // { t, dt, dyaw, nEv, sumDx, programs, newPrograms }
    this.jumps = [];
    this.dropped = [];   // 필터가 버린 이벤트
    this.hitches = [];   // dt > HITCH_MS 인 프레임
    this.maxDt = 0; this.frames = 0; this.over100 = 0;
    this.lastEvT = 0; this.avgAbs = 0;
    this.cur = { n: 0, sumDx: 0, maxAbsDx: 0, yawFromMouse: 0 };
    this.lastYaw = null; this.lastPrograms = 0;
    this.k = 0; // 마우스 한 칸당 회전(rad) — input.js 가 이벤트마다 알려 준다
    this.loaf = [];      // Chrome 의 long-animation-frame (50ms 넘는 프레임을 어떤 스크립트가 잡아먹었는지)
    this.longtasks = [];
    this.jsSum = 0; this.jsMax = 0;
    for (const [type, list] of [['long-animation-frame', this.loaf], ['longtask', this.longtasks]]) {
      try {
        new PerformanceObserver(l => { for (const e of l.getEntries()) { list.push(this.#loaf(e)); if (list.length > 60) list.shift(); } }).observe({ type, buffered: true });
      } catch { /* 이 브라우저는 지원하지 않는다 */ }
    }
    this.#overlay();
    addEventListener('keydown', e => { if (e.code === 'F4') this.copy(); });
  }
  #loaf(e) {
    return { at: Math.round(e.startTime), dur: Math.round(e.duration), blocking: Math.round(e.blockingDuration || 0), render: e.renderStart ? Math.round(e.renderStart - e.startTime) : undefined, style: e.styleAndLayoutStart ? Math.round(e.styleAndLayoutStart - e.startTime) : undefined,
      scripts: (e.scripts || []).map(x => `${x.sourceFunctionName || '?'}@${String(x.sourceURL || '').split('/').pop()}:${x.sourceCharPosition} ${Math.round(x.duration)}ms (강제 레이아웃 ${Math.round(x.forcedStyleAndLayoutDuration || 0)}ms)`) };
  }
  #overlay() {
    const el = this.el = document.createElement('pre');
    el.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99999;margin:0;padding:6px 8px;background:#000a;color:#9f9;font:11px/1.35 monospace;pointer-events:none;white-space:pre';
    document.body.appendChild(el);
    setInterval(() => {
      const s = this.summary();
      el.textContent = `debuglook · F4 = 결과 복사\n프레임 ${s.frames} · 최대 ${s.maxDtMs}ms · 50ms↑ ${s.hitches50}회 · 100ms↑ ${s.over100}회\n튐 ${s.jumps}회 ${JSON.stringify(s.byKind)} · 버린 입력 ${s.droppedEvents}\nJS 평균 ${s.jsAvgMs}ms 최대 ${s.jsMaxMs}ms\nGPU ${quality.gpu.slice(0, 60)}${quality.software ? ' (소프트웨어!)' : ''} · 해상도 ${quality.ratio} · 그림자 ${quality.shadows ? 'ON' : 'OFF'}`;
    }, 500);
  }
  copy() {
    const text = JSON.stringify({ gpu: quality.gpu, software: quality.software, quality: { ratio: quality.ratio, shadows: quality.shadows, steps: quality.steps }, ua: navigator.userAgent, dpr: devicePixelRatio, size: `${innerWidth}x${innerHeight}`, mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB' : undefined, summary: this.summary(), jumps: this.jumps.slice(-6), loaf: this.loaf.slice(-12), longtasks: this.longtasks.slice(-8) }, null, 1);
    (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => console.log('[debuglook] 결과를 복사했습니다 (붙여넣기)'), () => console.log('[debuglook] 복사 실패 — 아래를 직접 복사하세요\n' + text));
    return text;
  }
  // input.js mousemove 에서: 원본 movementX/Y 와 실제로 적용된 값
  mouse(e, dx, dy, k, dropped) {
    const t = performance.now();
    this.k = k;
    const gap = this.lastEvT ? t - this.lastEvT : 0;
    this.lastEvT = t;
    const ax = Math.abs(e.movementX);
    this.ev.push({ t, dx: e.movementX, dy: e.movementY, gap, avg: this.avgAbs, dropped: !!dropped });
    if (dropped) { this.dropped.push({ t: Math.round(t), mx: e.movementX, my: e.movementY, gap: +gap.toFixed(1) }); console.warn('[debuglook] 마우스 이벤트를 버렸다 (필터)', this.dropped[this.dropped.length - 1]); return; }
    this.avgAbs = this.avgAbs * 0.9 + ax * 0.1;
    this.cur.n++; this.cur.sumDx += dx; this.cur.maxAbsDx = Math.max(this.cur.maxAbsDx, Math.abs(dx));
    this.cur.yawFromMouse -= dx * k;
  }
  // main.js 프레임 끝에서: real = 실제 경과(ms), yaw = me.yaw, programs = renderer.info.programs.length
  frame(real, yaw, programs, active, js) {
    const t = performance.now();
    this.frames++;
    this.maxDt = Math.max(this.maxDt, real);
    this.jsSum += js; this.jsMax = Math.max(this.jsMax, js);
    if (real > 100) this.over100++;
    const prev = this.lastYaw;
    this.lastYaw = yaw;
    const wasJs = this.prevJs; this.prevJs = js; // 튄 프레임 '직전' 프레임이 오래 걸린 것이므로 그 프레임의 JS 시간으로 판정
    const newPrograms = programs - this.lastPrograms; this.lastPrograms = programs;
    const c = this.cur; this.cur = { n: 0, sumDx: 0, maxAbsDx: 0, yawFromMouse: 0 };
    if (prev === null) return;
    let dyaw = (yaw - prev) % (Math.PI * 2); if (dyaw > Math.PI) dyaw -= Math.PI * 2; if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const rec = { t, dt: +real.toFixed(1), js: +js.toFixed(1), dyaw: +dyaw.toFixed(3), nEv: c.n, sumDx: c.sumDx, maxDx: c.maxAbsDx, programs, newPrograms, active };
    this.fr.push(rec);
    if (real > HITCH_MS) this.hitches.push({ ...rec, at: Math.round(t) });
    const cut = t - KEEP_MS;
    while (this.fr.length && this.fr[0].t < cut) this.fr.shift();
    while (this.ev.length && this.ev[0].t < cut) this.ev.shift();
    if (Math.abs(dyaw) < JUMP) return;
    // 원인 판정
    const nonMouse = dyaw - c.yawFromMouse;
    const prevJs = wasJs ?? js;
    let kind;
    if (Math.abs(nonMouse) >= JUMP * 0.5) kind = 'C (마우스로 설명되지 않는 yaw 변화)';
    else if (c.maxAbsDx * this.k >= JUMP) kind = 'A (이벤트 하나가 혼자 큼)';
    else if (real > HITCH_MS && prevJs < real * 0.3) kind = 'B-외부 (프레임이 오래 걸렸는데 우리 JS 는 짧았다 → GPU·브라우저·시스템 정지)';
    else if (real > HITCH_MS || newPrograms > 0) kind = 'B-JS (프레임 정지 후 입력 몰림 / 셰이더 컴파일)';
    else kind = '? (판정 불가)';
    const j = { kind, ...rec, nonMouse: +nonMouse.toFixed(3), maxDxDeg: +(c.maxAbsDx * this.k / Math.PI * 180).toFixed(1) };
    this.jumps.push(j);
    console.warn(`[debuglook] yaw 튐 ${(dyaw / Math.PI * 180).toFixed(0)}° — ${kind}`, j, '\n직전 2초 프레임', this.fr.slice(), '\n직전 2초 마우스', this.ev.slice());
  }
  summary() {
    return { frames: this.frames, jumps: this.jumps.length, droppedEvents: this.dropped.length, dropped: this.dropped.slice(-8), byKind: this.jumps.reduce((m, j) => (m[j.kind[0]] = (m[j.kind[0]] || 0) + 1, m), {}), maxDtMs: +this.maxDt.toFixed(1), jsAvgMs: +(this.jsSum / Math.max(1, this.frames)).toFixed(1), jsMaxMs: +this.jsMax.toFixed(1), hitches50: this.hitches.length, over100: this.over100, worstHitches: this.hitches.slice().sort((a, b) => b.dt - a.dt).slice(0, 8) };
  }
}

export const lookDiag = params.has('debuglook') ? new LookDiag() : null;
if (lookDiag) window.__look = lookDiag;
