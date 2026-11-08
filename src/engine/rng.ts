/** RNG determinístico (mulberry32). O estado é só um número, fácil de clonar. */
export function nextRandom(seed: number): [number, number] {
  let t = (seed + 0x6d2b79f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), t | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return [value, t];
}

export interface HasRng {
  rng: number;
}

export function rand(s: HasRng): number {
  const [v, next] = nextRandom(s.rng);
  s.rng = next;
  return v;
}

export function randInt(s: HasRng, n: number): number {
  return Math.floor(rand(s) * n);
}

export function rollD6(s: HasRng): number {
  return randInt(s, 6) + 1;
}

export function shuffle<T>(s: HasRng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0;
}
