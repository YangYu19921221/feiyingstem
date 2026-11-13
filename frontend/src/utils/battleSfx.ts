/**
 * 宠物对战的声音(2026-11-11)。全部在浏览器里现合成(Web Audio),不带音频文件 ——
 * 以前 public/sfx 下那 7 个 mp3 是同一个 0.1 秒的静音占位文件,对战从头到尾没有声音。
 *
 * 规矩:
 * - 浏览器不让没点过屏幕的页面出声。没解锁时一律不响、也不排队(攒着等解锁会一下子全炸出来)。
 * - 开关按设备记(localStorage),默认开。电教室里几十台电脑一起响会吵,所以对战页右上角有开关。
 * - 只管音效。单词发音仍走 useAudio(Edge TTS 那一个声音),两边互不打断。
 */
import type { SfxName } from '../components/battle/fx';

const MUTE_KEY = 'pet_battle_sfx_muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = readMuted();
let unlockBound = false;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isBattleSfxMuted(): boolean {
  return muted;
}

export function setBattleSfxMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    /* 隐私模式存不了: 只在这次打开期间生效 */
  }
  if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 0.55, ctx.currentTime, 0.02);
}

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55;
  // 几个声音叠在一起(大招命中 + 震屏 + 倒下)时压一下,不爆音
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 18;
  limiter.ratio.value = 6;
  master.connect(limiter);
  limiter.connect(ctx.destination);
  return ctx;
}

/** 进对战页时调一次: 第一次点屏幕 / 按键时把声音解锁 */
export function bindBattleSfxUnlock(): () => void {
  if (unlockBound) return () => {};
  unlockBound = true;
  const unlock = () => {
    const c = getContext();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  return () => {
    unlockBound = false;
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
}

/** 现在能不能出声(点过屏幕且没静音)。自动读单词也看它: 没点过就别去触发「点一下才能播放」的蒙层 */
export function battleAudioReady(): boolean {
  return !!ctx && ctx.state === 'running';
}

function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

interface ToneOpts {
  type?: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  gain?: number;
  attack?: number;
  at?: number;
}

function tone(c: AudioContext, t0: number, o: ToneOpts) {
  const start = t0 + (o.at ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.from, start);
  if (o.to && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), start + o.dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.25, start + (o.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, start + o.dur);
  osc.connect(g);
  g.connect(master!);
  osc.start(start);
  osc.stop(start + o.dur + 0.03);
}

interface NoiseOpts {
  filter?: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
  dur: number;
  gain?: number;
  attack?: number;
  at?: number;
}

function hiss(c: AudioContext, t0: number, o: NoiseOpts) {
  const start = t0 + (o.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const filter = c.createBiquadFilter();
  filter.type = o.filter ?? 'bandpass';
  filter.Q.value = o.q ?? 0.9;
  filter.frequency.setValueAtTime(o.from, start);
  if (o.to && o.to !== o.from) filter.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), start + o.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.25, start + (o.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, start + o.dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master!);
  src.start(start, Math.random());
  src.stop(start + o.dur + 0.03);
}

/** 一串音: [频率, 第几秒, 多长] */
function notes(c: AudioContext, t0: number, seq: Array<[number, number, number]>, type: OscillatorType, gain: number) {
  seq.forEach(([freq, at, dur]) => tone(c, t0, { type, from: freq, dur, gain, at, attack: 0.012 }));
}

const SOUNDS: Record<SfxName, (c: AudioContext, t: number) => void> = {
  tap: (c, t) => tone(c, t, { type: 'triangle', from: 720, to: 540, dur: 0.06, gain: 0.16 }),
  tick: (c, t) => tone(c, t, { type: 'square', from: 1180, dur: 0.035, gain: 0.07 }),
  beep: (c, t) => tone(c, t, { type: 'triangle', from: 587, dur: 0.16, gain: 0.22 }),
  go: (c, t) => {
    tone(c, t, { type: 'triangle', from: 880, dur: 0.34, gain: 0.26 });
    tone(c, t, { type: 'sine', from: 1320, dur: 0.34, gain: 0.12 });
  },
  arm: (c, t) => {
    notes(c, t, [[523, 0, 0.09], [784, 0.07, 0.14]], 'triangle', 0.2);
    hiss(c, t, { filter: 'highpass', from: 3000, dur: 0.16, gain: 0.05 });
  },
  ready: (c, t) => {
    notes(c, t, [[659, 0, 0.1], [880, 0.09, 0.1], [1319, 0.18, 0.28]], 'triangle', 0.2);
    hiss(c, t, { filter: 'highpass', from: 5000, dur: 0.4, gain: 0.04, at: 0.16 });
  },
  whoosh: (c, t) => hiss(c, t, { from: 320, to: 2600, q: 1.4, dur: 0.26, gain: 0.3, attack: 0.09 }),
  shot: (c, t) => {
    tone(c, t, { type: 'sawtooth', from: 960, to: 260, dur: 0.2, gain: 0.14 });
    hiss(c, t, { from: 2400, to: 700, dur: 0.2, gain: 0.16 });
  },
  hit: (c, t) => {
    tone(c, t, { from: 190, to: 58, dur: 0.2, gain: 0.5, attack: 0.004 });
    hiss(c, t, { filter: 'lowpass', from: 2600, to: 420, dur: 0.14, gain: 0.34, attack: 0.003 });
  },
  hitHeavy: (c, t) => {
    tone(c, t, { from: 150, to: 34, dur: 0.6, gain: 0.7, attack: 0.004 });
    tone(c, t, { type: 'triangle', from: 78, to: 40, dur: 0.75, gain: 0.3 });
    hiss(c, t, { filter: 'lowpass', from: 5200, to: 240, dur: 0.48, gain: 0.5, attack: 0.003 });
    hiss(c, t, { filter: 'highpass', from: 2400, dur: 0.9, gain: 0.07, at: 0.05 });
  },
  // 打在护盾上: 一声闷的「咚」+ 一点金属的亮
  guard: (c, t) => {
    tone(c, t, { type: 'sine', from: 240, to: 120, dur: 0.22, gain: 0.4, attack: 0.004 });
    tone(c, t, { type: 'triangle', from: 1320, to: 990, dur: 0.18, gain: 0.12 });
  },
  backfire: (c, t) => {
    tone(c, t, { type: 'square', from: 260, to: 90, dur: 0.2, gain: 0.14 });
    hiss(c, t, { filter: 'lowpass', from: 1500, to: 300, dur: 0.16, gain: 0.3, attack: 0.003 });
  },
  cutin: (c, t) => {
    hiss(c, t, { filter: 'highpass', from: 800, to: 6000, dur: 0.34, gain: 0.2, attack: 0.2 });
    tone(c, t, { type: 'triangle', from: 110, to: 220, dur: 0.34, gain: 0.26, attack: 0.1 });
    tone(c, t, { type: 'sine', from: 1760, dur: 0.5, gain: 0.07, at: 0.28 });
  },
  charge: (c, t) => {
    tone(c, t, { type: 'sawtooth', from: 98, to: 392, dur: 1.15, gain: 0.11, attack: 0.5 });
    tone(c, t, { type: 'sine', from: 196, to: 1175, dur: 1.15, gain: 0.1, attack: 0.6 });
    hiss(c, t, { from: 500, to: 5200, q: 2.2, dur: 1.15, gain: 0.12, attack: 0.8 });
  },
  zap: (c, t) => {
    [0, 0.05, 0.11, 0.2, 0.31].forEach((at, i) => {
      tone(c, t, { type: 'square', from: 1700 - i * 190, to: 240, dur: 0.07, gain: 0.11, at });
      hiss(c, t, { filter: 'highpass', from: 3600, dur: 0.06, gain: 0.16, at });
    });
  },
  roar: (c, t) => {
    hiss(c, t, { filter: 'lowpass', from: 300, to: 1900, dur: 0.75, gain: 0.42, attack: 0.25 });
    tone(c, t, { type: 'sawtooth', from: 70, to: 120, dur: 0.75, gain: 0.14, attack: 0.3 });
  },
  splash: (c, t) => {
    hiss(c, t, { from: 3600, to: 520, q: 0.7, dur: 0.6, gain: 0.34, attack: 0.05 });
    tone(c, t, { from: 520, to: 180, dur: 0.3, gain: 0.12 });
  },
  shimmer: (c, t) => notes(c, t, [[1568, 0, 0.2], [2093, 0.07, 0.2], [2637, 0.14, 0.24], [3136, 0.21, 0.4]], 'sine', 0.09),
  swish: (c, t) => {
    hiss(c, t, { filter: 'highpass', from: 5200, to: 1500, dur: 0.22, gain: 0.26, attack: 0.02 });
    hiss(c, t, { filter: 'highpass', from: 5200, to: 1500, dur: 0.2, gain: 0.2, attack: 0.02, at: 0.14 });
  },
  ko: (c, t) => {
    tone(c, t, { type: 'triangle', from: 440, to: 92, dur: 0.62, gain: 0.26 });
    tone(c, t, { from: 120, to: 44, dur: 0.34, gain: 0.5, at: 0.56, attack: 0.004 });
    hiss(c, t, { filter: 'lowpass', from: 900, to: 180, dur: 0.3, gain: 0.3, at: 0.56, attack: 0.004 });
  },
  correct: (c, t) => notes(c, t, [[659, 0, 0.1], [988, 0.08, 0.2]], 'triangle', 0.2),
  wrong: (c, t) => notes(c, t, [[311, 0, 0.13], [233, 0.11, 0.22]], 'triangle', 0.16),
  enter: (c, t) => {
    hiss(c, t, { from: 420, to: 1900, dur: 0.24, gain: 0.2, attack: 0.1 });
    tone(c, t, { from: 150, to: 62, dur: 0.2, gain: 0.34, at: 0.2, attack: 0.004 });
  },
  switch: (c, t) => {
    hiss(c, t, { filter: 'highpass', from: 1500, to: 5200, dur: 0.2, gain: 0.16 });
    notes(c, t, [[784, 0.08, 0.1], [1047, 0.16, 0.18]], 'sine', 0.13);
  },
  victory: (c, t) => {
    notes(c, t, [[523, 0, 0.14], [659, 0.13, 0.14], [784, 0.26, 0.14], [1047, 0.39, 0.5], [784, 0.62, 0.12], [1047, 0.74, 0.7]], 'triangle', 0.22);
    notes(c, t, [[262, 0, 0.5], [330, 0.39, 0.5], [392, 0.74, 0.7]], 'sine', 0.14);
    hiss(c, t, { filter: 'highpass', from: 6000, dur: 0.7, gain: 0.05, at: 0.39 });
  },
  defeat: (c, t) => notes(c, t, [[392, 0, 0.26], [330, 0.24, 0.26], [262, 0.48, 0.6]], 'sine', 0.18),
  draw: (c, t) => notes(c, t, [[440, 0, 0.2], [440, 0.22, 0.4]], 'triangle', 0.16),
};

/** 现在响一声。没解锁 / 静音 / 浏览器不支持时什么都不做 */
export function playBattleSfx(name: SfxName) {
  if (muted) return;
  const c = getContext();
  if (!c || c.state !== 'running' || !master) return;
  try {
    SOUNDS[name](c, c.currentTime + 0.005);
  } catch {
    /* 合成失败不影响对战 */
  }
}
