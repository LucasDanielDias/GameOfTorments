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

const TRICK_ART: Record<string, string> = {
  // mapa dobrado com rota tracejada e um X
  't-mapa-confuso': `
    <path d="M16 26 L38 18 L62 26 L84 18 L84 76 L62 84 L38 76 L16 84 Z"/>
    <path d="M38 18 L38 76 M62 26 L62 84"/>
    <path d="M24 66 Q34 50 46 58 T66 44 T76 34" stroke-dasharray="4 4"/>
    <path d="M71 29 l10 10 M81 29 l-10 10"/>
    <path d="M28 40 q4 -6 8 0 q-4 6 -8 0 z"/>`,
  // vara de pesca com linha e anzol
  't-vara-de-pesca': `
    <path d="M18 86 L72 16"/>
    <path d="M24 78 l6 4 M30 70 l6 4"/>
    <path d="M72 16 Q80 34 78 60"/>
    <path d="M78 60 q0 10 -7 10 q-6 0 -6 -6"/>
    <path d="M65 64 l-3 -3"/>
    <path d="M14 90 L30 90"/>`,
  // escudo de torre alto, com rebites
  't-escudo-de-torre': `
    <path d="M30 14 H70 V62 C70 76 60 84 50 90 C40 84 30 76 30 62 Z"/>
    <path d="M36 20 H64 V60 C64 71 57 78 50 82 C43 78 36 71 36 60 Z"/>
    <path d="M50 22 V80 M38 44 H62"/>
    <circle cx="34" cy="18" r="1.6"/><circle cx="66" cy="18" r="1.6"/>`,
  // lança de cerco com flâmula
  't-lanca-de-cerco': `
    <path d="M20 84 L74 22"/>
    <path d="M74 22 L84 12 L80 26 Z"/>
    <path d="M66 32 L60 26 M70 28 L64 22"/>
    <path d="M56 38 Q66 46 58 54 Q54 48 48 46 Z"/>
    <path d="M18 88 l6 -6"/>`,
  // engrenagem quebrada com faísca
  't-sabotagem': `
    <path d="M38 30 A22 22 0 1 0 64 70"/>
    <path d="M30 26 l-4 -6 M24 40 l-7 -2 M24 58 l-7 3 M34 72 l-4 6 M52 78 l1 7"/>
    <circle cx="44" cy="52" r="7"/>
    <path d="M60 22 L56 36 L66 34 L60 50"/>
    <path d="M70 40 l8 -4 M72 48 l9 1 M66 30 l6 -8"/>`,
  // duas setas que se cruzam e invertem
  't-contra-ordem': `
    <path d="M20 34 H72"/><path d="M64 26 L74 34 L64 42"/>
    <path d="M80 66 H28"/><path d="M36 58 L26 66 L36 74"/>
    <path d="M50 20 V80" stroke-dasharray="3 5"/>`,
  // coroa com máscara
  't-coroa-falsa': `
    <path d="M24 46 L20 20 L36 34 L50 14 L64 34 L80 20 L76 46 Z"/>
    <path d="M24 52 H76"/>
    <path d="M28 62 Q50 54 72 62 Q70 80 56 82 Q50 74 44 82 Q30 80 28 62 Z"/>
    <path d="M36 66 q5 -4 10 0 M54 66 q5 -4 10 0"/>`,
  // tambor de guerra com baquetas
  't-tambor-de-guerra': `
    <ellipse cx="50" cy="40" rx="26" ry="9"/>
    <path d="M24 40 V70 Q50 84 76 70 V40"/>
    <path d="M28 46 L40 74 M40 48 L52 78 M52 48 L64 76 M64 46 L74 70"/>
    <path d="M30 14 L48 36 M70 14 L52 36"/>
    <circle cx="29" cy="13" r="3"/><circle cx="71" cy="13" r="3"/>`,
};

export function trickSvg(id: string): string {
  return `<svg class="emblem" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${TRICK_ART[id] ?? '<circle cx="50" cy="50" r="24"/>'}</svg>`;
}

export const ICON = {
  sword: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3H21v6.5L10 20.5l-1.5-1.5L6 21.5 2.5 18 5 15.5 3.5 14z" fill="currentColor" opacity=".18"/><path d="M14.5 3H21v6.5L10 20.5 3.5 14zM6.5 15.5l2 2M5 15.5 2.5 18 6 21.5l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 20 5v6c0 5-3.4 8.7-8 10.5C7.4 19.7 4 16 4 11V5z" fill="currentColor" opacity=".18"/><path d="M12 2.5 20 5v6c0 5-3.4 8.7-8 10.5C7.4 19.7 4 16 4 11V5zM12 2.5v19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  hourglass: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12M6 21h12M7 3c0 5 10 6 10 9s-10 4-10 9M17 3c0 5-10 6-10 9s10 4 10 9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.8"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
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
