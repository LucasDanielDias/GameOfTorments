/**
 * Simulador bot × bot para balancear cartas e regras.
 *
 *   npm run sim -- --a dificil --b medio --games 100 --budget 30
 *
 * Mostra taxa de vitória, duração média e a vantagem de quem começa.
 */
import type { Difficulty } from '../src/config';
import { playMatch } from '../src/engine/match';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const a = arg('a', 'medio') as Difficulty;
const b = arg('b', 'facil') as Difficulty;
const games = Number(arg('games', '100'));
const budget = Number(arg('budget', '25'));

let winsA = 0;
let winsB = 0;
let draws = 0;
let turns = 0;
let starterWins = 0;
const t0 = Date.now();

for (let g = 1; g <= games; g++) {
  // alterna lados: metade das partidas com A no assento 0
  const swap = g % 2 === 0;
  const s = swap ? playMatch(b, a, g, { budgetMs: budget }) : playMatch(a, b, g, { budgetMs: budget });
  turns += s.round;
  if (s.winner === 'empate') draws++;
  else {
    const aWon = swap ? s.winner === 1 : s.winner === 0;
    if (aWon) winsA++;
    else winsB++;
    if (s.winner === s.coinWinner) starterWins++;
  }
  if (g % 10 === 0) process.stdout.write(`  ${g}/${games}\r`);
}

const pct = (n: number) => `${((100 * n) / games).toFixed(1)}%`;
console.log(`\n${a} × ${b} — ${games} partidas (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(`  ${a}: ${winsA} (${pct(winsA)})   ${b}: ${winsB} (${pct(winsB)})   empates: ${draws}`);
console.log(`  rodadas médias: ${(turns / games).toFixed(1)}   quem ganha a moeda vence: ${pct(starterWins)}`);
