import type { Difficulty } from '../config';
import { createBot } from '../ai/bot';
import { applyAction, newGame, type GameState } from './game';

/** Roda uma partida bot × bot inteira (usada nos testes e no simulador). */
export function playMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  opts: { budgetMs?: number; minRollouts?: number } = {},
): GameState {
  const s = newGame({ seed, names: [a, b] });
  const bots = [
    createBot({ difficulty: a, seed: seed * 3 + 1, ...opts }),
    createBot({ difficulty: b, seed: seed * 7 + 2, ...opts }),
  ];
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 5000) {
    const d = bots[s.actor].decide(s);
    applyAction(s, d.action);
  }
  return s;
}
