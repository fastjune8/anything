// Web Audio 로 합성하는 효과음 (외부 파일 없음)
export class Sfx {
  constructor() { this.ctx = null; this.volume = 0.6; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.nbuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.nbuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  _out(node, pan) {
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p).connect(this.master);
    } else node.connect(this.master);
  }

  _burst({ dur, type = 'lowpass', f, f2, q = 0.8, vol, pan = 0, when = 0 }) {
    const ctx = this.ctx; if (!ctx || vol <= 0.001) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = this.nbuf; src.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f, t);
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(flt).connect(g); this._out(g, pan);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  _tone({ f, f2, dur, vol, type = 'sine', pan = 0, when = 0 }) {
    const ctx = this.ctx; if (!ctx || vol <= 0.001) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); this._out(g, pan);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // dist: 음원까지 거리(m). 멀수록 작고 먹먹하게
  shot(w, dist = 0, pan = 0) {
    if (!this.ctx) return;
    const s = w.snd, att = 1 / (1 + dist / 22), muffle = 1 / (1 + dist / 45);
    const v = s.vol * att;
    this._burst({ dur: 0.045, type: 'bandpass', f: s.f * 1.6 * muffle, q: 0.6, vol: v * 0.9, pan });
    this._burst({ dur: s.dur, f: s.f * 2.2 * muffle, f2: 260, vol: v, pan });
    this._tone({ f: s.thump * 1.6, f2: s.thump * 0.45, dur: 0.11, vol: v * 0.9, pan });
    this._burst({ dur: s.dur * 4.5, f: 1100 * muffle, f2: 180, vol: v * 0.22, pan, when: 0.03 });
  }

  mech(kind, vol = 1, pan = 0, when = 0) {
    if (!this.ctx) return;
    const b = (f, d, v, w = 0, type = 'bandpass') => this._burst({ dur: d, type, f, q: 2.5, vol: v * vol, pan, when: when + w });
    switch (kind) {
      case 'magout': b(1400, 0.05, 0.35); b(700, 0.08, 0.25, 0.04); break;
      case 'magin': b(900, 0.06, 0.4); b(2600, 0.03, 0.3, 0.05); break;
      case 'bolt': b(2200, 0.035, 0.4); b(1500, 0.05, 0.4, 0.09); break;
      case 'shell': b(1100, 0.05, 0.35); b(2400, 0.025, 0.2, 0.04); break;
      case 'pump': b(1300, 0.06, 0.45); b(1700, 0.06, 0.45, 0.16); break;
      case 'dry': b(3000, 0.02, 0.3); break;
      case 'draw': b(600, 0.09, 0.18, 0, 'lowpass'); b(2000, 0.03, 0.12, 0.08); break;
    }
  }

  step(vol = 1, pan = 0) {
    this._burst({ dur: 0.07, f: 420 + Math.random() * 160, f2: 120, vol: 0.22 * vol, pan });
    this._burst({ dur: 0.03, type: 'highpass', f: 2500, vol: 0.03 * vol, pan });
  }
  land(vol = 1) { this._burst({ dur: 0.12, f: 380, f2: 90, vol: 0.4 * vol }); }

  impact(dist, pan) {
    this._burst({ dur: 0.05, type: 'bandpass', f: 2600 + Math.random() * 1500, q: 1.5, vol: 0.25 / (1 + dist / 10), pan });
  }
  hitmarker(head) {
    this._tone({ f: head ? 2500 : 1700, dur: 0.07, vol: 0.22, type: 'triangle' });
    if (head) this._tone({ f: 3300, dur: 0.12, vol: 0.16, type: 'triangle', when: 0.04 });
  }
  kill() {
    this._tone({ f: 880, dur: 0.12, vol: 0.2, type: 'triangle' });
    this._tone({ f: 1320, dur: 0.22, vol: 0.2, type: 'triangle', when: 0.1 });
  }
  hurt() {
    this._tone({ f: 110, f2: 55, dur: 0.18, vol: 0.55 });
    this._burst({ dur: 0.09, f: 700, f2: 200, vol: 0.3 });
  }
  boom(dist = 0, pan = 0) { // 유탄 폭발
    const k = 1 / (1 + dist / 18);
    this._burst({ dur: 0.9, f: 900, f2: 60, vol: 0.9 * k, pan });
    this._tone({ f: 70, f2: 30, dur: 0.6, vol: 0.7 * k, pan });
  }
  whoosh(pan) { this._burst({ dur: 0.12, type: 'bandpass', f: 3500, f2: 900, q: 3, vol: 0.2, pan }); }
}
