import type { Principle } from '../config';
import alquimista from '../assets/art-alquimista.jpg';
import batedora from '../assets/art-batedora.jpg';
import calculista from '../assets/art-calculista.jpg';
import estrategista from '../assets/art-estrategista.jpg';
import marechal from '../assets/art-marechal.jpg';
import regente from '../assets/art-regente.jpg';
import veterano from '../assets/art-veterano.jpg';

/** Ilustrações provisórias (vindas do protótipo Solos de Runi). */
export const ART: Record<string, string> = {
  alquimista,
  batedora,
  calculista,
  estrategista,
  marechal,
  regente,
  veterano,
};

/**
 * Emblemas em traço de gravura para cartas sem ilustração.
 * Desenhados com stroke="currentColor" para herdar a cor do princípio.
 */
const EMBLEM_PATHS: Record<Principle, string> = {
  // engrenagem com compasso
  engenharia: `
    <circle cx="50" cy="50" r="22"/>
    <circle cx="50" cy="50" r="8"/>
    ${Array.from({ length: 10 }, (_, i) => {
      const a = (i * Math.PI) / 5;
      const x1 = 50 + Math.cos(a) * 22, y1 = 50 + Math.sin(a) * 22;
      const x2 = 50 + Math.cos(a) * 30, y2 = 50 + Math.sin(a) * 30;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="5"/>`;
    }).join('')}
    <path d="M50 14 L36 86 M50 14 L64 86 M41 62 L59 62"/>
    <circle cx="50" cy="14" r="3"/>`,
  // lanças cruzadas sobre escudo
  infantaria: `
    <path d="M22 84 L78 16 M78 84 L22 16"/>
    <path d="M78 16 l-9 2 l7 7 z M22 16 l9 2 l-7 7 z"/>
    <path d="M50 30 C63 34 70 34 72 34 C72 60 62 74 50 82 C38 74 28 60 28 34 C30 34 37 34 50 30 Z"/>
    <path d="M50 38 L50 74 M36 50 L64 50"/>`,
  // torre com estandarte
  qg: `
    <path d="M32 86 L36 40 L64 40 L68 86 Z"/>
    <path d="M32 40 L32 30 L39 30 L39 36 L46 36 L46 30 L54 30 L54 36 L61 36 L61 30 L68 30 L68 40"/>
    <path d="M44 86 L44 72 C44 66 56 66 56 72 L56 86"/>
    <rect x="46" y="48" width="8" height="10"/>
    <path d="M50 30 L50 10 M50 10 L70 14 L62 18 L70 22 L50 22"/>`,
  // coroa
  realeza: `
    <path d="M22 70 L18 32 L36 50 L50 24 L64 50 L82 32 L78 70 Z"/>
    <path d="M24 78 L76 78 M22 70 L78 70"/>
    <circle cx="18" cy="30" r="3"/><circle cx="50" cy="21" r="3.5"/><circle cx="82" cy="30" r="3"/>
    <circle cx="36" cy="62" r="3"/><circle cx="50" cy="60" r="4"/><circle cx="64" cy="62" r="3"/>`,
};

export function emblemSvg(p: Principle): string {
  return `<svg class="emblem" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${EMBLEM_PATHS[p]}</svg>`;
}

export const ICON = {
  sword: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3H21v6.5L10 20.5l-1.5-1.5L6 21.5 2.5 18 5 15.5 3.5 14z" fill="currentColor" opacity=".18"/><path d="M14.5 3H21v6.5L10 20.5 3.5 14zM6.5 15.5l2 2M5 15.5 2.5 18 6 21.5l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 20 5v6c0 5-3.4 8.7-8 10.5C7.4 19.7 4 16 4 11V5z" fill="currentColor" opacity=".18"/><path d="M12 2.5 20 5v6c0 5-3.4 8.7-8 10.5C7.4 19.7 4 16 4 11V5zM12 2.5v19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  hourglass: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12M6 21h12M7 3c0 5 10 6 10 9s-10 4-10 9M17 3c0 5-10 6-10 9s10 4 10 9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  crown: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18 2 7l6 5 4-7 4 7 6-5-1 11z" fill="currentColor"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-9.2-9.4C1.6 7.2 4 4 7.2 4c2 0 3.6 1.1 4.8 2.8C13.2 5.1 14.8 4 16.8 4 20 4 22.4 7.2 21.2 10.6 19.5 15.4 12 20 12 20z" fill="currentColor"/></svg>`,
  sound: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="m16 9 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
};

/** Faces do d6 (posições dos pontos numa grade 3×3). */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

export function dieSvg(n: number): string {
  const pips = (PIPS[n] ?? []).map(([x, y]) => `<circle cx="${12 + x * 13}" cy="${12 + y * 13}" r="3.6"/>`).join('');
  return `<svg viewBox="0 0 50 50" aria-hidden="true"><rect x="2" y="2" width="46" height="46" rx="7" class="die-body"/><g class="die-pips">${pips}</g></svg>`;
}
