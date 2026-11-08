import { AI, PRINCIPLE_LABEL, type Difficulty } from '../config';
import { getDef } from '../engine/cards';
import {
  activeValue,
  applyAction,
  attackCanTie,
  cloneState,
  determinize,
  legalActions,
  other,
  previewCombat,
  principleOf,
  unitAt,
  type Action,
  type GameState,
  type PlayerId,
} from '../engine/game';
import { nextRandom } from '../engine/rng';
import { cardValue, evaluate } from './evaluate';

/**
 * Bot de treino — três níveis:
 *
 *  Fácil   → joga ações legais ao acaso (com leve preferência por agir).
 *  Médio   → guloso: em cada passo escolhe a ação que mais melhora a
 *            avaliação imediata (empates de dado contam 50/50).
 *  Difícil → Monte Carlo com determinização: para as melhores ações
 *            candidatas, simula vários futuros possíveis (sorteando a mão
 *            escondida do rival) jogando 2 turnos à frente e escolhe a
 *            de melhor média. Nunca olha a mão real do oponente.
 */

export interface BotDecision {
  action: Action;
  /** Explicação curta para o modo treino. */
  reason: string;
  score?: number;
}

type Rng = { rng: number };

function rnd(r: Rng): number {
  const [v, n] = nextRandom(r.rng);
  r.rng = n;
  return v;
}

// ─── Avaliação de uma ação (1 passo, valor esperado) ──────────────────────

export function scoreAction(s: GameState, a: Action, me: PlayerId): number {
  if (a.type === 'end') return evaluate(s, me);
  if (attackCanTie(s, a)) {
    const w = cloneState(s);
    applyAction(w, a, { forceTie: 'att' });
    const l = cloneState(s);
    applyAction(l, a, { forceTie: 'def' });
    return 0.5 * evaluate(w, me) + 0.5 * evaluate(l, me);
  }
  const c = cloneState(s);
  applyAction(c, a, { forceTie: 'att' });
  return evaluate(c, me);
}

function rankActions(s: GameState, me: PlayerId): { a: Action; v: number }[] {
  return legalActions(s)
    .map((a) => ({ a, v: scoreAction(s, a, me) }))
    .sort((x, y) => y.v - x.v);
}

// ─── Políticas ────────────────────────────────────────────────────────────

function easyPolicy(s: GameState, r: Rng): BotDecision {
  const acts = legalActions(s);
  if (s.phase === 'coin') return { action: acts[Math.floor(rnd(r) * acts.length)], reason: 'Escolha aleatória.' };
  const nonEnd = acts.filter((a) => a.type !== 'end');
  if (nonEnd.length === 0 || rnd(r) < 0.18) return { action: { type: 'end' }, reason: 'Resolvi encerrar o turno.' };
  // Prefere baixar carta e atacar a ficar se mexendo à toa.
  const plays = nonEnd.filter((a) => a.type === 'play');
  const attacks = nonEnd.filter((a) => a.type === 'attack');
  const pool = plays.length && rnd(r) < 0.6 ? plays : attacks.length && rnd(r) < 0.7 ? attacks : nonEnd;
  return { action: pool[Math.floor(rnd(r) * pool.length)], reason: 'Jogada no improviso (nível fácil).' };
}

const EPS = 0.05;

function greedyPolicy(s: GameState, me: PlayerId): BotDecision {
  if (s.phase === 'coin') return { action: { type: 'coin', call: 'cara' }, reason: 'Sempre cara.' };
  const base = evaluate(s, me);
  const ranked = rankActions(s, me);
  const best = ranked.find((x) => x.a.type !== 'end');
  if (!best || best.v <= base + EPS) {
    return { action: { type: 'end' }, reason: 'Nenhuma jogada melhora a posição; encerro o turno.', score: base };
  }
  return { action: best.a, reason: `Melhora imediata estimada de ${(best.v - base).toFixed(1)} pontos.`, score: best.v };
}

/** Política rápida para as simulações do nível difícil (sem clonar estados). */
function fastPolicy(s: GameState, r: Rng): Action {
  const me = s.current;
  const P = s.players[me];
  const O = s.players[other(me)];
  const acts = legalActions(s);

  // 1) ataques com bom saldo esperado
  let bestAtk: Action | null = null;
  let bestAtkV = 0.2;
  for (const a of acts) {
    if (a.type !== 'attack') continue;
    const att = P.front[a.col]!;
    let v: number;
    if (a.target.kind === 'player') v = activeValue(att.card, 'front') * 1.1;
    else {
      const def = unitAt(O, a.target.row, a.target.col)!;
      const p = previewCombat(att.card, def.card, a.target.row).pAttWins;
      v = p * cardValue(def.card, a.target.row) - (1 - p) * cardValue(att.card, 'front');
    }
    v += rnd(r) * 0.3;
    if (v > bestAtkV) {
      bestAtkV = v;
      bestAtk = a;
    }
  }
  if (bestAtk) return bestAtk;

  // 2) baixar a carta mais forte, numa casa escolhida pela avaliação
  const plays = acts.filter((a) => a.type === 'play') as Extract<Action, { type: 'play' }>[];
  if (plays.length) {
    const strongest = P.hand
      .slice()
      .sort((x, y) => getDef(y.defId).atk + getDef(y.defId).def - (getDef(x.defId).atk + getDef(x.defId).def))[0];
    const opts = plays.filter((a) => getDef(P.hand.find((c) => c.uid === a.uid)!.defId).id === strongest.defId);
    let best = opts[0];
    let bv = -Infinity;
    for (const a of opts) {
      const c = cloneState(s);
      applyAction(c, a, { forceTie: 'att' });
      const v = evaluate(c, me) + rnd(r) * 0.4;
      if (v > bv) {
        bv = v;
        best = a;
      }
    }
    return best;
  }
  return { type: 'end' };
}

function playout(s: GameState, me: PlayerId, r: Rng, untilTurn: number): number {
  let guard = 0;
  while (s.phase === 'main' && s.turn <= untilTurn && guard++ < 200) {
    applyAction(s, fastPolicy(s, r));
  }
  return evaluate(s, me);
}

function hardPolicy(s: GameState, me: PlayerId, r: Rng, budgetMs: number, minRollouts: number): BotDecision {
  if (s.phase === 'coin') return { action: { type: 'coin', call: 'coroa' }, reason: 'Coroa, por superstição.' };
  const ranked = rankActions(s, me);
  // Candidatas: as K melhores pela intuição + encerrar o turno.
  const cands: { a: Action; sum: number; n: number; prior: number }[] = [];
  for (const x of ranked) {
    if (cands.length >= AI.hardCandidates) break;
    if (x.a.type !== 'end') cands.push({ a: x.a, sum: 0, n: 0, prior: x.v });
  }
  if (cands.length === 0) return { action: { type: 'end' }, reason: 'Nada a fazer; encerro o turno.' };
  const endV = ranked.find((x) => x.a.type === 'end')!.v;
  cands.push({ a: { type: 'end' }, sum: 0, n: 0, prior: endV });

  const t0 = now();
  const untilTurn = s.turn + AI.rolloutTurns;
  let round = 0;
  while (round < minRollouts || now() - t0 < budgetMs) {
    for (const c of cands) {
      const seed = (rnd(r) * 2 ** 32) >>> 0;
      const w = determinize(s, me, seed);
      applyAction(w, c.a);
      c.sum += playout(w, me, r, untilTurn);
      c.n++;
    }
    round++;
    if (round > 400) break;
  }
  // média das simulações + um pouco da intuição imediata para desempatar
  let best = cands[0];
  let bestV = -Infinity;
  for (const c of cands) {
    const v = c.sum / c.n + c.prior * 0.15;
    if (v > bestV) {
      bestV = v;
      best = c;
    }
  }
  const sims = cands.reduce((t, c) => t + c.n, 0);
  return {
    action: best.a,
    reason: `Comparei ${cands.length} opções em ${sims} simulações de ${AI.rolloutTurns} turnos; esta teve a melhor média.`,
    score: bestV,
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ─── API pública ──────────────────────────────────────────────────────────

export interface BotOptions {
  difficulty: Difficulty;
  seed?: number;
  /** Para testes/simulação: tempo de pensamento do difícil. */
  budgetMs?: number;
  minRollouts?: number;
}

export function createBot(opts: BotOptions) {
  const r: Rng = { rng: (opts.seed ?? (Math.random() * 2 ** 32)) >>> 0 };
  return {
    difficulty: opts.difficulty,
    decide(s: GameState): BotDecision {
      const me = s.current;
      switch (opts.difficulty) {
        case 'facil':
          return easyPolicy(s, r);
        case 'medio':
          return greedyPolicy(s, me);
        case 'dificil':
          return hardPolicy(s, me, r, opts.budgetMs ?? AI.hardTimeBudgetMs, opts.minRollouts ?? AI.hardMinRollouts);
      }
    },
  };
}

export type Bot = ReturnType<typeof createBot>;

// ─── Textos para o modo treino ────────────────────────────────────────────

const ROW_LABEL = { front: 'frontline', back: 'backline' } as const;

export function describeAction(s: GameState, a: Action): string {
  const me = s.players[s.current];
  const enemy = s.players[other(s.current)];
  switch (a.type) {
    case 'coin':
      return `Pedir ${a.call}`;
    case 'end':
      return 'Encerrar o turno';
    case 'play': {
      const c = me.hand.find((x) => x.uid === a.uid);
      const name = c ? getDef(c.defId).name : 'carta';
      return `Baixar ${name} na ${ROW_LABEL[a.row]}, coluna ${a.col + 1}`;
    }
    case 'move': {
      const u = unitAt(me, a.fromRow, a.fromCol);
      const name = u ? getDef(u.card.defId).name : 'carta';
      return `Mover ${name} para a ${ROW_LABEL[a.toRow]}, coluna ${a.toCol + 1}`;
    }
    case 'attack': {
      const att = me.front[a.col];
      const an = att ? getDef(att.card.defId).name : 'carta';
      if (a.target.kind === 'player') return `Atacar ${enemy.name} diretamente com ${an}`;
      const def = unitAt(enemy, a.target.row, a.target.col);
      if (!att || !def) return 'Atacar';
      const p = previewCombat(att.card, def.card, a.target.row);
      const adv = p.attBonus ? ` (vantagem de ${PRINCIPLE_LABEL[principleOf(att.card)]})` : p.defBonus ? ` (desvantagem contra ${PRINCIPLE_LABEL[principleOf(def.card)]})` : '';
      const odds = p.pAttWins === 1 ? 'vitória certa' : p.pAttWins === 0 ? 'derrota certa' : 'empate: decide no dado';
      return `Atacar ${getDef(def.card.defId).name} com ${an}: ${p.attValue + p.attBonus} × ${p.defValue + p.defBonus}${adv}, ${odds}`;
    }
  }
}
