import { describe, expect, it } from 'vitest';
import { createBot } from '../src/ai/bot';
import { applyAction, isLegal, newGame } from '../src/engine/game';
import { playMatch } from '../src/engine/match';

describe('bot de treino', () => {
  it('sempre escolhe ações legais, em todos os níveis', () => {
    for (const difficulty of ['facil', 'medio', 'dificil'] as const) {
      const s = newGame({ seed: 101 });
      const bot = createBot({ difficulty, seed: 5, budgetMs: 0, minRollouts: 2 });
      for (let i = 0; i < 60 && s.phase !== 'over'; i++) {
        const d = bot.decide(s);
        expect(isLegal(s, d.action)).toBe(true);
        applyAction(s, d.action);
      }
    }
  });

  it('partidas sempre terminam', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = playMatch('medio', 'facil', seed);
      expect(s.phase).toBe('over');
    }
  });

  it('médio vence o fácil na maioria das vezes', () => {
    let wins = 0;
    const N = 40;
    for (let seed = 1; seed <= N; seed++) {
      // alterna quem é o jogador 0 para não favorecer um deck
      const flip = seed % 2 === 0;
      const s = flip ? playMatch('facil', 'medio', seed) : playMatch('medio', 'facil', seed);
      if (s.winner === (flip ? 1 : 0)) wins++;
    }
    expect(wins / N).toBeGreaterThan(0.75);
  });
});
