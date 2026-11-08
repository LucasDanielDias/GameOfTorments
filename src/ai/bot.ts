import { AI, RULES, type Difficulty } from '../config';
import { getDef, isTrick } from '../engine/cards';
import {
  applyAction,
  compareFronts,
  determinize,
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
export function backValue(c: CardInst): number {
  if (c.defId === 't-mapa-confuso') return 4;
  if (c.defId === 't-vara-de-pesca') return 4.5;
  return def(c);
}

export function heuristicPlace(s: GameState, pid: PlayerId, r: Rng, jitter = 0): Extract<Action, { type: 'place' }> {
  const p = s.players[pid];
  const pool = hiddenPool(s, pid);
  const scored = p.hand.map((c) => ({ c, f: frontWinProb(c, pool) + (jitter ? (rnd(r) - 0.5) * jitter : 0), d: def(c) / 7 }));
  scored.sort((a, b) => b.f - 0.5 * b.d - (a.f - 0.5 * a.d));
  const fronts = shuffled(r, scored.slice(0, RULES.columns));
  // backline é opcional; o bot costuma preencher tudo, e nas variações (difícil) às vezes guarda cartas
  const need = jitter && rnd(r) < 0.25 ? Math.max(0, maxBack(p) - 1 - Math.floor(rnd(r) * 2)) : maxBack(p);
  // truques: Mapa Confuso atrás das frentes fracas, no máximo 1 Vara de Pesca
  const backs: (CardInst | null)[] = Array(RULES.columns).fill(null);
  let placed = 0;
  const order = fronts.map((x, col) => ({ col, f: x.f })).sort((a, b) => a.f - b.f);
  const mapas = p.trickHand.filter((c) => c.defId === 't-mapa-confuso');
  const varas = p.trickHand.filter((c) => c.defId === 't-vara-de-pesca');
  const trickRate = jitter ? 0.35 + rnd(r) * 0.5 : 0.6;
  for (const o of order) {
    if (placed >= need) break;
    if (o.f < 0.45 && mapas.length && rnd(r) < trickRate + 0.3) {
      backs[o.col] = mapas.pop()!;
      placed++;
    }
  }
  if (varas.length && placed < need && rnd(r) < trickRate) {
    const free = order.filter((o) => !backs[o.col]);
    if (free.length) {
      backs[free[Math.floor(free.length / 2)].col] = varas.pop()!;
      placed++;
    }
  }
  const restChars = scored.slice(RULES.columns).sort((a, b) => b.d - a.d).map((x) => x.c);
  const leftoverTricks = [...mapas, ...varas];
  for (let col = 0; col < RULES.columns && placed < need; col++) {
    if (backs[col]) continue;
    const c = restChars.shift() ?? leftoverTricks.shift();
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
      const c = s.clash!;
      const back = P.back[c.col]!.card;
      const st = duelStanding(s, c.col);
      const mine = st.totals[me];
      const theirs = st.totals[other(me)];
      const enemyBack = O.back[c.col];
      const enemyBackIsChar = !!enemyBack && !isTrick(enemyBack.card.defId);
      const winning = st.leader === me;
      if (back.defId === 't-mapa-confuso') {
        const flip = !winning;
        return { action: { type: 'flip', flip }, reason: flip ? 'Viro o Mapa Confuso: troco a frontline perdedora pela do topo do deck.' : 'Já estou vencendo; guardo o Mapa Confuso oculto.' };
      }
      if (back.defId === 't-vara-de-pesca') {
        const flip = !!enemyBack && (enemyBack.revealed ? enemyBackIsChar : true);
        return { action: { type: 'flip', flip }, reason: flip ? 'Viro a Vara de Pesca para roubar a backline do rival neste campo.' : 'Não há o que pescar aqui.' };
      }
      if (st.byPrinciple) return { action: { type: 'flip', flip: false }, reason: 'O princípio já decidiu; somar DEF não muda nada.' };
      const withBack = mine + def(back);
      if (c.stage === 'loser') {
        const flip = withBack > theirs || (withBack === theirs && def(back) <= 3);
        return { action: { type: 'flip', flip }, reason: flip ? `Virando, fico com ${withBack} contra ${theirs}.` : `Nem virando passo de ${theirs}; guardo a carta oculta para trocar depois.` };
      }
      const flip = !winning && withBack >= theirs;
      return {
        action: { type: 'flip', flip },
        reason: flip ? `O rival foi a ${theirs}; virando eu chego a ${withBack}.` : winning ? `Já estou na frente (${mine} × ${theirs}).` : `Mesmo virando não alcanço ${theirs}.`,
      };
    }

    case 'swap': {
      const open = new Set(openColumns(s));
      let best: [number, number] | null = null;
      let gain = 0;
      for (const [a, b] of swapPairs(s, me)) {
        const [o, x] = open.has(a) && !open.has(b) ? [a, b] : open.has(b) && !open.has(a) ? [b, a] : [-1, -1];
        if (o < 0) continue;
        const vo = P.back[o] ? backValue(P.back[o]!.card) : 0;
        const vx = P.back[x] ? backValue(P.back[x]!.card) : 0;
        if (vx - vo > gain) {
          gain = vx - vo;
          best = [a, b];
        }
      }
      if (best && P.swapsThisTurn < 4) {
        return { action: { type: 'swap', a: best[0], b: best[1] }, reason: 'Levo uma backline oculta mais útil para um campo ainda livre.' };
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
      return 'Terminar as trocas';
  }
}
