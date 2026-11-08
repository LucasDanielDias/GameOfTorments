import { AI, RULES, type Difficulty } from '../config';
import { getDef, isTrick } from '../engine/cards';
import {
  applyAction,
  canFlip,
  compareFronts,
  determinize,
  doFlip,
  duelStanding,
  legalActions,
  openColumns,
  other,
  maxBack,
  swapPairs,
  type Action,
  type CardInst,
  type GameState,
  type PlayerId,
} from '../engine/game';
import { nextRandom } from '../engine/rng';

/**
 * Bot de treino — três níveis, todos sem olhar cartas ocultas do rival:
 *
 *  Fácil   → decisões aleatórias entre as jogadas legais.
 *  Médio   → heurísticas: distribui pensando nas chances de cada carta,
 *            escolhe o campo mais forte, só vira a backline quando ela
 *            muda o resultado e guarda as melhores defesas ocultas para
 *            os campos ainda livres.
 *  Difícil → Monte Carlo: para cada opção, sorteia vários mundos possíveis
 *            (as cartas ocultas do rival embaralhadas), joga o resto da
 *            rodada com a política do Médio e escolhe a melhor média.
 */

export interface BotDecision {
  action: Action;
  reason: string;
}

type Rng = { rng: number };

function rnd(r: Rng): number {
  const [v, n] = nextRandom(r.rng);
  r.rng = n;
  return v;
}

function pick<T>(r: Rng, xs: T[]): T {
  return xs[Math.floor(rnd(r) * xs.length)];
}

function shuffled<T>(r: Rng, xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(r) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Conhecimento público ─────────────────────────────────────────────────

/**
 * Personagens do rival que `viewer` não consegue ver (mão, deck e mesa virada).
 * Usa só a composição (que é pública: a lista do deck menos o que já apareceu).
 */
export function hiddenPool(s: GameState, viewer: PlayerId): CardInst[] {
  const o = s.players[other(viewer)];
  const out = [...o.hand, ...o.charDeck];
  for (const row of [o.front, o.back]) for (const x of row) if (x && !x.revealed && !isTrick(x.card.defId)) out.push(x.card);
  return out;
}

/** Chance de `card` vencer na frontline contra uma carta sorteada do rival. */
export function frontWinProb(card: CardInst, pool: CardInst[]): number {
  if (!pool.length) return 0.5;
  let sum = 0;
  for (const o of pool) {
    const c = compareFronts(card, o);
    if (c.leader === 0) sum += c.byPrinciple ? 1 : 0.8;
    else if (c.leader === null) sum += 0.5;
    else sum += c.byPrinciple ? 0 : 0.2;
  }
  return sum / pool.length;
}

const def = (c: CardInst) => getDef(c.defId).def;

// ─── Política média (heurística) ──────────────────────────────────────────

/** Valor de uma carta oculta na backline (personagem = DEF; truque = valor estimado). */
export const TRICK_VALUE: Record<string, number> = {
  't-mapa-confuso': 4,
  't-vara-de-pesca': 4.5,
  't-escudo-de-torre': 4,
  't-lanca-de-cerco': 3.5,
  't-sabotagem': 4,
  't-contra-ordem': 5,
  't-coroa-falsa': 5,
  't-tambor-de-guerra': 4,
};

/** Truques que viram um duelo perdido por princípio (os outros somam valores). */
const PRINCIPLE_FIXERS = new Set(['t-mapa-confuso', 't-contra-ordem', 't-coroa-falsa']);

export function backValue(c: CardInst): number {
  return isTrick(c.defId) ? TRICK_VALUE[c.defId] ?? 3 : def(c);
}

export function heuristicPlace(s: GameState, pid: PlayerId, r: Rng, jitter = 0): Extract<Action, { type: 'place' }> {
  const p = s.players[pid];
  const pool = hiddenPool(s, pid);
  const scored = p.hand.map((c) => ({ c, f: frontWinProb(c, pool) + (jitter ? (rnd(r) - 0.5) * jitter : 0), d: def(c) / 7 }));
  scored.sort((a, b) => b.f - 0.5 * b.d - (a.f - 0.5 * a.d));
  const fronts = shuffled(r, scored.slice(0, RULES.columns));
  // backline é opcional; o bot costuma preencher tudo, e nas variações (difícil) às vezes guarda cartas
  const need = jitter && rnd(r) < 0.25 ? Math.max(0, maxBack(p) - 1 - Math.floor(rnd(r) * 2)) : maxBack(p);
  const backs: (CardInst | null)[] = Array(RULES.columns).fill(null);
  let placed = 0;
  // frentes mais fracas primeiro: recebem truques que salvam duelo perdido por princípio
  const order = fronts.map((x, col) => ({ col, f: x.f })).sort((a, b) => a.f - b.f);
  const tricks = shuffled(r, p.trickHand).sort((a, b) => Number(PRINCIPLE_FIXERS.has(b.defId)) - Number(PRINCIPLE_FIXERS.has(a.defId)));
  const trickRate = jitter ? 0.35 + rnd(r) * 0.5 : 0.65;
  const maxTricks = 2 + (jitter ? Math.floor(rnd(r) * 2) : 0);
  for (const o of order) {
    if (placed >= need || placed >= maxTricks || !tricks.length) break;
    const t = tricks[0];
    const good = PRINCIPLE_FIXERS.has(t.defId) ? o.f < 0.5 : o.f >= 0.3;
    if (good && rnd(r) < trickRate) {
      backs[o.col] = tricks.shift()!;
      placed++;
    }
  }
  const restChars = scored.slice(RULES.columns).sort((a, b) => b.d - a.d).map((x) => x.c);
  for (let col = 0; col < RULES.columns && placed < need; col++) {
    if (backs[col]) continue;
    const c = restChars.shift() ?? tricks.shift();
    if (c) {
      backs[col] = c;
      placed++;
    }
  }
  return { type: 'place', front: fronts.map((x) => x.c.uid), back: backs.map((c) => (c ? c.uid : null)) };
}

export function randomPlace(s: GameState, pid: PlayerId, r: Rng): Extract<Action, { type: 'place' }> {
  const p = s.players[pid];
  const hand = shuffled(r, p.hand);
  const front = hand.slice(0, RULES.columns);
  const pool = shuffled(r, [...hand.slice(RULES.columns), ...p.trickHand]).slice(0, Math.floor(rnd(r) * (maxBack(p) + 1)));
  const back: (number | null)[] = pool.map((c) => c.uid);
  while (back.length < RULES.columns) back.push(null);
  return { type: 'place', front: front.map((c) => c.uid), back: shuffled(r, back) };
}

function mediumDecide(s: GameState, r: Rng): BotDecision {
  const me = s.actor;
  const P = s.players[me];
  const O = s.players[other(me)];
  switch (s.phase) {
    case 'coin':
      return { action: { type: 'coin', call: rnd(r) < 0.5 ? 'cara' : 'coroa' }, reason: 'Moeda é sorte.' };

    case 'place':
      return { action: heuristicPlace(s, me, r), reason: 'Frente: cartas com mais chance contra o que ainda pode vir do rival. Atrás: as maiores defesas e alguns truques atrás das frentes fracas.' };

    case 'choose': {
      const pool = hiddenPool(s, me);
      let best = openColumns(s)[0];
      let bv = -Infinity;
      for (const col of openColumns(s)) {
        const b = P.back[col];
        const v = frontWinProb(P.front[col]!.card, pool) + (b && !b.revealed ? backValue(b.card) / 30 : 0);
        if (v > bv) {
          bv = v;
          best = col;
        }
      }
      return { action: { type: 'choose', col: best }, reason: `Escolho o campo ${best + 1}, onde minha frontline tem mais chance (~${Math.round(Math.min(1, bv) * 100)}%).` };
    }

    case 'flip': {
      // Avalia virar ou não sorteando o que o rival esconde (sem espiar).
      const c = s.clash!;
      const back = P.back[c.col]!.card;
      const now = duelStanding(s, c.col);
      const winningNow = now.leader === me ? 1 : now.leader === null ? 0.5 : 0;
      let gain = 0;
      const N = 6;
      for (let i = 0; i < N; i++) {
        const w = determinize(s, me, (rnd(r) * 2 ** 32) >>> 0);
        const handBefore = w.players[me].hand.length;
        doFlip(w, me, []);
        const st = duelStanding(w, c.col);
        let v = st.leader === me ? 1 : st.leader === null ? 0.5 : 0;
        // o rival ainda pode responder se eu era o perdedor e ele tem backline oculta
        if (c.stage === 'loser' && canFlip(w, other(me)) && st.leader === me) v -= 0.25;
        v += 0.35 * (w.players[me].hand.length - handBefore); // carta roubada
        if (!w.players[other(me)].back[c.col] && O.back[c.col]) v += 0.15; // backline rival destruída
        gain += v - winningNow;
      }
      gain /= N;
      // virar gasta a carta oculta (não pode mais trocar de lugar); só vale se ajudar
      const cost = isTrick(back.defId) ? 0.05 : 0.08 + def(back) / 100;
      const flip = gain > cost;
      const what = isTrick(back.defId) ? 'o truque' : `a backline (DEF ${def(back)})`;
      return {
        action: { type: 'flip', flip },
        reason: flip ? `Virar ${what} melhora minhas chances neste duelo (+${Math.round(gain * 100)}%).` : now.byPrinciple && !isTrick(back.defId) ? 'O princípio já decidiu; somar DEF não muda nada.' : `Virar ${what} não muda o resultado; guardo oculta.`,
      };
    }

    case 'resolve':
      return { action: { type: 'resolve' }, reason: '' };

    case 'roundOver':
      return { action: { type: 'next' }, reason: '' };

    case 'swap': {
      // Campos já disputados ficam travados: só reorganiza entre campos livres.
      // Truques que salvam duelo por princípio vão para trás das frentes mais fracas.
      const pool = hiddenPool(s, me);
      const fOf = (col: number) => frontWinProb(P.front[col]!.card, pool);
      const want = (col: number, c: CardInst | null) => {
        if (!c) return 0;
        const f = fOf(col);
        if (isTrick(c.defId)) return PRINCIPLE_FIXERS.has(c.defId) ? (1 - f) * 6 : 3 + f;
        return def(c) * (0.4 + f);
      };
      let best: [number, number] | null = null;
      let gainBest = 0.5;
      for (const [a, b] of swapPairs(s, me)) {
        const ca = P.back[a]?.card ?? null;
        const cb = P.back[b]?.card ?? null;
        const g = want(a, cb) + want(b, ca) - want(a, ca) - want(b, cb);
        if (g > gainBest) {
          gainBest = g;
          best = [a, b];
        }
      }
      if (best && P.swapsThisTurn < 3) {
        return { action: { type: 'swap', a: best[0], b: best[1] }, reason: 'Reorganizo a backline oculta dos campos que ainda vão lutar.' };
      }
      return { action: { type: 'done' }, reason: 'Backline arrumada.' };
    }

    case 'over':
      return { action: { type: 'done' }, reason: '' };
  }
}

function easyDecide(s: GameState, r: Rng): BotDecision {
  if (s.phase === 'place') return { action: randomPlace(s, s.actor, r), reason: 'Distribuí no improviso.' };
  const acts = legalActions(s);
  if (s.phase === 'swap') return { action: rnd(r) < 0.7 ? { type: 'done' } : pick(r, acts), reason: 'Troca no improviso.' };
  return { action: pick(r, acts), reason: 'Jogada no improviso (nível fácil).' };
}

// ─── Monte Carlo (difícil) ────────────────────────────────────────────────

function score(s: GameState, me: PlayerId): number {
  const P = s.players[me];
  const O = s.players[other(me)];
  if (s.phase === 'over') return s.winner === me ? 200 : s.winner === 'empate' ? 0 : -200;
  return 3 * (P.points - O.points) + 0.9 * (P.duelWins - O.duelWins) + 0.3 * (P.trickHand.length - O.trickHand.length) + 0.06 * (P.hand.length - O.hand.length);
}

function rollout(s: GameState, me: PlayerId, r: Rng): number {
  const startRound = s.round;
  let guard = 0;
  while (s.phase !== 'over' && s.round === startRound && guard++ < 300) {
    applyAction(s, mediumDecide(s, r).action);
  }
  return score(s, me);
}

function candidates(s: GameState, r: Rng): Action[] {
  if (s.phase === 'place') {
    const out: Action[] = [heuristicPlace(s, s.actor, r)];
    for (let i = 1; i < AI.placeCandidates; i++) out.push(heuristicPlace(s, s.actor, r, 0.5));
    return out;
  }
  const acts = legalActions(s);
  if (s.phase === 'swap') {
    const m = mediumDecide(s, r).action;
    const pool = [{ type: 'done' } as Action, m];
    return pool.filter((a, i) => pool.findIndex((b) => JSON.stringify(b) === JSON.stringify(a)) === i);
  }
  return acts;
}

function hardDecide(s: GameState, r: Rng, budgetMs: number, minRollouts: number): BotDecision {
  if (s.phase === 'coin' || s.phase === 'over') return mediumDecide(s, r);
  const me = s.actor;
  const cands = candidates(s, r).map((a) => ({ a, sum: 0, n: 0 }));
  if (cands.length === 1) return { action: cands[0].a, reason: 'Única opção.' };
  const t0 = now();
  let round = 0;
  while (round < minRollouts || now() - t0 < budgetMs) {
    for (const c of cands) {
      const w = determinize(s, me, (rnd(r) * 2 ** 32) >>> 0);
      applyAction(w, c.a);
      c.sum += rollout(w, me, r);
      c.n++;
    }
    if (++round > 300) break;
  }
  cands.sort((x, y) => y.sum / y.n - x.sum / x.n);
  const best = cands[0];
  const sims = cands.reduce((t, c) => t + c.n, 0);
  const avg = best.sum / best.n;
  return {
    action: best.a,
    reason: `Comparei ${cands.length} opções em ${sims} simulações até o fim da rodada; esta rendeu em média ${avg >= 0 ? '+' : ''}${avg.toFixed(1)} ponto(s) de saldo.`,
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ─── API pública ──────────────────────────────────────────────────────────

export interface BotOptions {
  difficulty: Difficulty;
  seed?: number;
  budgetMs?: number;
  minRollouts?: number;
}

export function createBot(opts: BotOptions) {
  const r: Rng = { rng: (opts.seed ?? Math.random() * 2 ** 32) >>> 0 };
  return {
    difficulty: opts.difficulty,
    decide(s: GameState): BotDecision {
      switch (opts.difficulty) {
        case 'facil':
          return easyDecide(s, r);
        case 'medio':
          return mediumDecide(s, r);
        case 'dificil':
          return hardDecide(s, r, opts.budgetMs ?? AI.hardTimeBudgetMs, opts.minRollouts ?? AI.hardMinRollouts);
      }
    },
  };
}

export type Bot = ReturnType<typeof createBot>;

// ─── Textos para o modo treino ────────────────────────────────────────────

export function describeAction(_s: GameState, a: Action): string {
  switch (a.type) {
    case 'coin':
      return `Pedir ${a.call}`;
    case 'place':
      return 'Distribuir as cartas como sugerido (destacadas na mesa)';
    case 'choose':
      return `Escolher o campo ${a.col + 1}`;
    case 'flip':
      return a.flip ? 'Virar a backline deste campo' : 'Não virar a backline';
    case 'swap':
      return `Trocar as backlines ocultas dos campos ${a.a + 1} e ${a.b + 1}`;
    case 'done':
      return 'Não mover mais a backline';
    case 'resolve':
      return 'Apurar o duelo';
    case 'next':
      return 'Seguir para a próxima rodada';
  }
}
