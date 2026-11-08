import type { Difficulty } from '../config';

// ─── Preferências e placar (localStorage, sempre protegido) ────────────────

export interface Prefs {
  difficulty: Difficulty;
  muted: boolean;
  explain: boolean;
  reduceMotion: boolean;
}

export interface Record_ {
  wins: number;
  losses: number;
}

const PREFS_KEY = 'got.prefs.v1';
const STATS_KEY = 'got.stats.v1';

const DEFAULT_PREFS: Prefs = { difficulty: 'medio', muted: false, explain: true, reduceMotion: false };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* sem armazenamento: segue com o padrão */
  }
  return { ...DEFAULT_PREFS };
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignora */
  }
}

export function loadStats(): Record<Difficulty, Record_> {
  const empty = { facil: { wins: 0, losses: 0 }, medio: { wins: 0, losses: 0 }, dificil: { wins: 0, losses: 0 } };
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return { ...empty, ...JSON.parse(raw) };
  } catch {
    /* ignora */
  }
  return empty;
}

export function saveStats(s: Record<Difficulty, Record_>) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    /* ignora */
  }
}

// ─── Áudio sintetizado (Web Audio, sem arquivos) ───────────────────────────

export type Sfx = 'card' | 'move' | 'hit' | 'break' | 'coin' | 'dice' | 'direct' | 'win' | 'lose' | 'turn';

class Sound {
  private ctx: AudioContext | null = null;
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, freq: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
  }

  play(s: Sfx) {
    if (this.muted || !this.ctx) return;
    try {
      switch (s) {
        case 'card': this.noise(0.09, 0.5, 2400); break;
        case 'move': this.noise(0.12, 0.3, 1200); break;
        case 'hit': this.tone(140, 0.18, 'triangle', 0.35, 0, 60); this.noise(0.08, 0.4, 900); break;
        case 'break': this.noise(0.3, 0.45, 500); this.tone(90, 0.3, 'sawtooth', 0.12, 0, 40); break;
        case 'direct': this.tone(220, 0.25, 'square', 0.12, 0, 80); this.noise(0.15, 0.4, 700); break;
        case 'coin': [0, 0.07, 0.14].forEach((d, i) => this.tone(1800 + i * 300, 0.25, 'sine', 0.12, d)); break;
        case 'dice': [0, 0.05, 0.11, 0.18].forEach((d) => this.noise(0.04, 0.5, 3000, d)); break;
        case 'turn': this.tone(520, 0.18, 'sine', 0.08); this.tone(780, 0.22, 'sine', 0.06, 0.08); break;
        case 'win': [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.14, i * 0.12)); break;
        case 'lose': [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.12, i * 0.15)); break;
      }
    } catch {
      /* áudio é opcional */
    }
  }
}

export const sound = new Sound();

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
