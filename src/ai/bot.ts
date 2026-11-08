import { AI, RULES, type Difficulty } from '../config';
import { getDef, getTrick } from '../engine/cards';
import {
  applyAction,
  compareFronts,
  determinize,
  legalActions,
  openColumns,
  other,
  swapPairs,
  trickActions,
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

/** Personagens do rival que `viewer` não consegue ver (mão, deck e mesa virada). */
export function hiddenPool(s: GameState, viewer: PlayerId): CardInst[] {
  const o = s.players[other(viewer)];
  const out = [...o.hand, ...o.charDeck];
  for (const row of [o.front, o.back]) for (const x of row) if (x && !x.revealed) out.push(x.card);
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

export function heuristicPlace(s: GameState, pid: PlayerId, r: Rng, jitter = 0): Extract<Action, { type: 'place' }> {
  const p = s.players[pid];
  const pool = hiddenPool(s, pid);
  const scored = p.hand.map((c) => ({ c, f: frontWinProb(c, pool) + (jitter ? (rnd(r) - 0.5) * jitter : 0), d: def(c) / 7 }));
  scored.sort((a, b) => b.f - 0.5 * b.d - (a.f - 0.5 * a.d));
  const fronts = scored.slice(0, RULES.columns).map((x) => x.c);
  const rest = scored.slice(RULES.columns).sort((a, b) => b.d - a.d);
  const nBack = Math.min(RULES.columns, p.hand.length - RULES.columns);
  const backs: (number | null)[] = rest.slice(0, nBack).map((x) => x.c.uid);
  while (backs.length < RULES.columns) backs.push(null);
  return { type: 'place', front: shuffled(r, fronts).map((c) => c.uid), back: shuffled(r, backs) };
}

export function randomPlace(s: GameState, pid: PlayerId, r: Rng): Extract<Action, { type: 'place' }> {
  const hand = shuffled(r, s.players[pid].hand);
  const nBack = Math.min(RULES.columns, hand.length - RULES.columns);
  const back: (number | null)[] = hand.slice(RULES.columns, RULES.columns + nBack).map((c) => c.uid);
  while (back.length < RULES.columns) back.push(null);
  return { type: 'place', front: hand.slice(0, RULES.columns).map((c) => c.uid), back: shuffled(r, back) };
}

function mediumDecide(s: GameState, r: Rng): BotDecision {
  const me = s.actor;
  const P = s.players[me];
  const O = s.players[other(me)];
  switch (s.phase) {
    case 'coin':
      return { action: { type: 'coin', call: rnd(r) < 0.5 ? 'cara' : 'coroa' }, reason: 'Moeda é sorte.' };

    case 'place':
      return { action: heuristicPlace(s, me, r), reason: 'Frente: cartas com mais chance contra o que ainda pode vir do rival. Atrás: as maiores defesas.' };

    case 'trick': {
      const acts = trickActions(s, me) as Extract<Action, { type: 'trick' }>[];
      const open = new Set(openColumns(s));
      const vara = acts.filter((a) => getTrick(P.trickHand.find((c) => c.uid === a.uid)!.defId).id === 't-vara-de-pesca');
      const varaOpen = vara.filter((a) => open.has(a.target.col));
      if (varaOpen.length) return { action: pick(r, varaOpen), reason: 'Vara de Pesca numa backline de campo ainda livre: o rival perde a defesa ali e eu ganho a carta.' };
      const mapa = acts.filter((a) => getTrick(P.trickHand.find((c) => c.uid === a.uid)!.defId).id === 't-mapa-confuso');
      if (mapa.length) {
        const pool = hiddenPool(s, me);
        let best: (typeof mapa)[number] | null = null;
        let bestF = 0.35;
        for (const a of mapa) {
          const f = frontWinProb(P.front[a.target.col]!.card, pool);
          if (f < bestF) {
            bestF = f;
            best = a;
          }
        }
        if (best) return { action: best, reason: `Mapa Confuso na frontline mais fraca (chance estimada de ${Math.round(bestF * 100)}%).` };
      }
      if (vara.length && rnd(r) < 0.5) return { action: pick(r, vara), reason: 'Vara de Pesca numa backline oculta que ainda pode ser trocada para um campo livre.' };
      return { action: { type: 'pass' }, reason: 'Guardo os truques para um momento melhor.' };
    }

    case 'choose': {
      const pool = hiddenPool(s, me);
      let best = openColumns(s)[0];
      let bv = -Infinity;
      for (const col of openColumns(s)) {
        const b = P.back[col];
        const v = frontWinProb(P.front[col]!.card, pool) + (b && !b.revealed ? def(b.card) / 30 : 0);
        if (v > bv) {
          bv = v;
          best = col;
        }
      }
      return { action: { type: 'choose', col: best }, reason: `Escolho o campo ${best + 1}, onde minha frontline tem mais chance (~${Math.round(Math.min(1, bv) * 100)}%).` };
    }

    case 'flip': {
      const c = s.clash!;
      const myBack = P.back[c.col]!.card;
      const cmp = compareFronts(P.front[c.col]!.card, O.front[c.col]!.card);
      const mine = cmp.values[0];
      const theirs = cmp.values[1] + (c.flipped[other(me)] ? def(O.back[c.col]!.card) : 0);
      const withBack = mine + def(myBack);
      if (c.stage === 'loser') {
        const flip = withBack > theirs || (withBack === theirs && def(myBack) <= 3);
        return {
          action: { type: 'flip', flip },
          reason: flip ? `Virando, fico com ${withBack} contra ${theirs}.` : `Nem virando passo de ${theirs}; guardo a carta oculta para trocar depois.`,
        };
      }
      const flip = theirs >= mine && withBack >= theirs;
      return {
        action: { type: 'flip', flip },
        reason: flip ? `O rival foi a ${theirs}; virando eu chego a ${withBack}.` : theirs < mine ? `Já estou na frente (${mine} × ${theirs}).` : `Mesmo virando não alcanço ${theirs}.`,
      };
    }

    case 'swap': {
      const open = new Set(openColumns(s));
      let best: [number, number] | null = null;
      let gain = 0;
      for (const [a, b] of swapPairs(s, me)) {
        const [o, x] = open.has(a) && !open.has(b) ? [a, b] : open.has(b) && !open.has(a) ? [b, a] : [-1, -1];
        if (o < 0) continue;
        const vo = P.back[o] ? def(P.back[o]!.card) : 0;
        const vx = P.back[x] ? def(P.back[x]!.card) : 0;
        if (vx - vo > gain) {
          gain = vx - vo;
          best = [a, b];
        }
      }
      if (best && P.swapsThisTurn < 4) {
        return { action: { type: 'swap', a: best[0], b: best[1] }, reason: 'Levo uma defesa oculta mais forte para um campo ainda livre.' };
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
  if (s.phase === 'over') return s.winner === me ? 100 : s.winner === 'empate' ? 0 : -100;
  return P.points - O.points + 0.35 * (P.trickHand.length - O.trickHand.length) + 0.08 * (P.hand.length - O.hand.length);
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

export function describeAction(s: GameState, a: Action): string {
  const P = s.players[s.actor];
  switch (a.type) {
    case 'coin':
      return `Pedir ${a.call}`;
    case 'place':
      return 'Distribuir as cartas como sugerido (destacadas na mesa)';
    case 'pass':
      return 'Passar a fase de truques';
    case 'trick': {
      const t = P.trickHand.find((c) => c.uid === a.uid);
      const name = t ? getTrick(t.defId).name : 'truque';
      return `Usar ${name} na ${a.target.row === 'front' ? 'frontline' : 'backline'} ${a.target.side === s.actor ? 'sua' : 'do rival'}, campo ${a.target.col + 1}`;
    }
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
