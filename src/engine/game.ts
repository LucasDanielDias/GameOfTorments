import {
  EXILE_ON_DEATH,
  PRINCIPLE_BEATS,
  PRINCIPLE_BONUS,
  PRINCIPLE_MODE,
  RULES,
  type Principle,
} from '../config';
import { DECKS, TRICK_DECK, getDef, getTrick, isTrick, type DeckKey } from './cards';
import { rand, rollD6, shuffle } from './rng';

/*
 * ESTRUTURA DA PARTIDA
 *
 *  Moeda       → quem acerta ganha a iniciativa (age primeiro nos truques e trocas).
 *  Rodada      → cada jogador recebe 10 personagens e distribui VIRADOS:
 *                5 na frontline e 5 na backline. Uma rodada tem 5 turnos.
 *  Turno       → 1) truques: cada um pode usar 1 truque/equipamento (ou passar)
 *                2) d6: ambos rolam; o maior escolhe um campo (coluna) ainda livre
 *                3) as duas frontlines daquele campo são reveladas e comparadas:
 *                   vantagem de princípio vence direto; senão, ATK × ATK
 *                4) quem está perdendo decide se vira a backline (soma a DEF);
 *                   se virar, o vencedor decide se vira a dele
 *                5) maior total leva 1 ponto; empate → d6 até desempatar
 *                6) o campo fica travado; cada um pode trocar de lugar
 *                   as cartas da backline que ainda estão ocultas
 *  Fim da rodada → todas as cartas da mesa vão ao cemitério (Realeza: exílio).
 *  Vitória     → 15 pontos (no máximo 29 turnos).
 */

// ─── Tipos ────────────────────────────────────────────────────────────────

export type PlayerId = 0 | 1;
export type Row = 'front' | 'back';
export type CoinSide = 'cara' | 'coroa';

export interface CardInst {
  uid: number;
  defId: string;
}

/** Carta na mesa. `revealed` = virada para cima (visível para os dois). */
export interface Placed {
  card: CardInst;
  revealed: boolean;
}

export interface PlayerState {
  name: string;
  deckName: string;
  points: number;
  charDeck: CardInst[];
  hand: CardInst[];
  trickDeck: CardInst[];
  trickHand: CardInst[];
  front: (Placed | null)[];
  back: (Placed | null)[];
  graveChars: CardInst[];
  graveTricks: CardInst[];
  exile: CardInst[];
  tricksUsedThisTurn: number;
  swapsThisTurn: number;
}

export type Phase = 'coin' | 'place' | 'trick' | 'choose' | 'flip' | 'swap' | 'over';

export interface ColumnState {
  resolved: boolean;
  winner: PlayerId | null;
}

export interface Clash {
  col: number;
  chooser: PlayerId;
  /** quem está vencendo após comparar as frontlines */
  leader: PlayerId;
  flipped: [boolean, boolean];
  /** quem decide agora: o perdedor primeiro, depois o vencedor */
  stage: 'loser' | 'winner';
}

export interface GameState {
  rng: number;
  players: [PlayerState, PlayerState];
  phase: Phase;
  /** quem precisa agir agora */
  actor: PlayerId;
  /** age primeiro em truques e trocas; passa para quem perdeu o último campo */
  initiative: PlayerId;
  round: number;
  turnInRound: number;
  turnTotal: number;
  columns: ColumnState[];
  clash: Clash | null;
  queue: PlayerId[];
  winner: PlayerId | 'empate' | null;
  coinWinner: PlayerId | null;
  nextUid: number;
}

export interface TrickTarget {
  side: PlayerId;
  row: Row;
  col: number;
}

export type Action =
  | { type: 'coin'; call: CoinSide }
  | { type: 'place'; front: number[]; back: (number | null)[] }
  | { type: 'trick'; uid: number; target: TrickTarget }
  | { type: 'pass' }
  | { type: 'choose'; col: number }
  | { type: 'flip'; flip: boolean }
  | { type: 'swap'; a: number; b: number }
  | { type: 'done' };

export type ClashReason = 'principio' | 'valor' | 'dados';

export type GameEvent =
  | { kind: 'coin'; call: CoinSide; result: CoinSide; winner: PlayerId }
  | { kind: 'round'; round: number }
  | { kind: 'reshuffle'; player: PlayerId; count: number }
  | { kind: 'draw'; player: PlayerId; uids: number[] }
  | { kind: 'trickDraw'; player: PlayerId; uids: number[] }
  | { kind: 'placed'; player: PlayerId }
  | { kind: 'turn'; round: number; turn: number; total: number }
  | { kind: 'trick'; player: PlayerId; uid: number; defId: string; target: TrickTarget; result: 'trocou' | 'roubou' | 'falhou'; revealedUid?: number; newUid?: number }
  | { kind: 'pass'; player: PlayerId }
  | { kind: 'roll'; rolls: [number, number][]; chooser: PlayerId }
  | { kind: 'choose'; player: PlayerId; col: number }
  | { kind: 'reveal'; col: number; uids: [number, number]; leader: PlayerId; byPrinciple: boolean }
  | { kind: 'flip'; player: PlayerId; col: number; flipped: boolean; uid?: number }
  | { kind: 'result'; col: number; winner: PlayerId; totals: [number, number]; reason: ClashReason; dice: [number, number][] }
  | { kind: 'point'; player: PlayerId; points: number }
  | { kind: 'swap'; player: PlayerId; a: number; b: number }
  | { kind: 'swapDone'; player: PlayerId; swaps: number }
  | { kind: 'roundEnd'; round: number; moved: { player: PlayerId; uid: number; to: 'cemiterio' | 'exilio' }[] }
  | { kind: 'win'; winner: PlayerId | 'empate'; reason: string };

// ─── Utilidades ───────────────────────────────────────────────────────────

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function principleOf(c: CardInst): Principle {
  return getDef(c.defId).principle;
}

export function beats(a: Principle, b: Principle): boolean {
  return PRINCIPLE_BEATS[a].includes(b);
}

export function rowOf(p: PlayerState, row: Row) {
  return row === 'front' ? p.front : p.back;
}

function emptyRow(): (Placed | null)[] {
  return Array.from({ length: RULES.columns }, () => null);
}

export function openColumns(s: GameState): number[] {
  return s.columns.map((c, i) => (c.resolved ? -1 : i)).filter((i) => i >= 0);
}

/** Uma casa da backline pode participar de troca se não tem carta revelada. */
export function backSwappable(p: PlayerState, col: number): boolean {
  const b = p.back[col];
  return !b || !b.revealed;
}

export function swapPairs(s: GameState, pid: PlayerId): [number, number][] {
  const p = s.players[pid];
  const out: [number, number][] = [];
  for (let a = 0; a < RULES.columns; a++) {
    for (let b = a + 1; b < RULES.columns; b++) {
      if (!backSwappable(p, a) || !backSwappable(p, b)) continue;
      if (!p.back[a] && !p.back[b]) continue;
      out.push([a, b]);
    }
  }
  return out;
}

// ─── Criação ──────────────────────────────────────────────────────────────

export interface NewGameOptions {
  seed: number;
  names?: [string, string];
  decks?: [DeckKey, DeckKey];
}

export function newGame(opts: NewGameOptions): GameState {
  const decks = opts.decks ?? ['vanguarda', 'tormenta'];
  const names = opts.names ?? ['Você', 'Bot de Treino'];
  const s: GameState = {
    rng: opts.seed >>> 0,
    players: [null!, null!],
    phase: 'coin',
    actor: 0,
    initiative: 0,
    round: 0,
    turnInRound: 0,
    turnTotal: 0,
    columns: [],
    clash: null,
    queue: [],
    winner: null,
    coinWinner: null,
    nextUid: 1,
  };
  for (const pid of [0, 1] as PlayerId[]) {
    const deck = DECKS[decks[pid]];
    const chars = shuffle(s, deck.cards.map((defId) => ({ uid: s.nextUid++, defId })));
    const tricks = shuffle(s, TRICK_DECK.map((defId) => ({ uid: s.nextUid++, defId })));
    s.players[pid] = {
      name: names[pid],
      deckName: deck.name,
      points: 0,
      charDeck: chars,
      hand: [],
      trickDeck: tricks,
      trickHand: [],
      front: emptyRow(),
      back: emptyRow(),
      graveChars: [],
      graveTricks: [],
      exile: [],
      tricksUsedThisTurn: 0,
      swapsThisTurn: 0,
    };
  }
  return s;
}

// ─── Clonagem e informação oculta ─────────────────────────────────────────

function cloneRow(r: (Placed | null)[]) {
  return r.map((x) => (x ? { card: x.card, revealed: x.revealed } : null));
}

function clonePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    charDeck: p.charDeck.slice(),
    hand: p.hand.slice(),
    trickDeck: p.trickDeck.slice(),
    trickHand: p.trickHand.slice(),
    front: cloneRow(p.front),
    back: cloneRow(p.back),
    graveChars: p.graveChars.slice(),
    graveTricks: p.graveTricks.slice(),
    exile: p.exile.slice(),
  };
}

export function cloneState(s: GameState): GameState {
  return {
    ...s,
    players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])],
    columns: s.columns.map((c) => ({ ...c })),
    clash: s.clash ? { ...s.clash, flipped: [...s.clash.flipped] as [boolean, boolean] } : null,
    queue: s.queue.slice(),
  };
}

/**
 * Determinização: sorteia um mundo possível do ponto de vista de `viewer`.
 * Tudo o que o rival esconde (mão, deck e cartas viradas para baixo na mesa)
 * é embaralhado e redistribuído nas mesmas posições. O bot nunca vê as reais.
 */
export function determinize(s: GameState, viewer: PlayerId, seed: number): GameState {
  const c = cloneState(s);
  c.rng = seed >>> 0;
  const opp = c.players[other(viewer)];
  const hiddenSlots: Placed[] = [];
  for (const row of [opp.front, opp.back]) for (const x of row) if (x && !x.revealed) hiddenSlots.push(x);
  const pool = shuffle(c, [...opp.hand, ...opp.charDeck, ...hiddenSlots.map((x) => x.card)]);
  let i = 0;
  opp.hand = pool.slice(i, (i += opp.hand.length));
  for (const x of hiddenSlots) x.card = pool[i++];
  opp.charDeck = pool.slice(i);
  const tpool = shuffle(c, [...opp.trickHand, ...opp.trickDeck]);
  opp.trickHand = tpool.slice(0, opp.trickHand.length);
  opp.trickDeck = tpool.slice(opp.trickHand.length);
  shuffle(c, c.players[viewer].charDeck);
  shuffle(c, c.players[viewer].trickDeck);
  return c;
}

// ─── Combate de um campo ──────────────────────────────────────────────────

export interface FrontCompare {
  leader: PlayerId | null; // null = empate
  byPrinciple: boolean;
  values: [number, number];
}

/** Compara as duas frontlines de um campo (princípio primeiro, depois ATK). */
export function compareFronts(a: CardInst, b: CardInst): FrontCompare {
  const pa = principleOf(a);
  const pb = principleOf(b);
  const aAdv = beats(pa, pb);
  const bAdv = beats(pb, pa);
  const va = getDef(a.defId).atk + (PRINCIPLE_MODE === 'bonus' && aAdv ? PRINCIPLE_BONUS : 0);
  const vb = getDef(b.defId).atk + (PRINCIPLE_MODE === 'bonus' && bAdv ? PRINCIPLE_BONUS : 0);
  if (PRINCIPLE_MODE === 'dominante' && aAdv !== bAdv) {
    return { leader: aAdv ? 0 : 1, byPrinciple: true, values: [va, vb] };
  }
  return { leader: va > vb ? 0 : vb > va ? 1 : null, byPrinciple: false, values: [va, vb] };
}

/** Total de um lado no campo: ATK da frontline (+bônus) + DEF da backline se virada. */
export function sideTotal(s: GameState, pid: PlayerId, col: number): number {
  const me = s.players[pid].front[col]!.card;
  const op = s.players[other(pid)].front[col]!.card;
  const cmp = compareFronts(me, op);
  let t = cmp.values[0];
  const back = s.players[pid].back[col];
  if (s.clash && s.clash.col === col && s.clash.flipped[pid] && back) t += getDef(back.card.defId).def;
  return t;
}

// ─── Fluxo ────────────────────────────────────────────────────────────────

function hasAnyChar(p: PlayerState) {
  return p.hand.length + p.charDeck.length + p.graveChars.length > 0;
}

function endGame(s: GameState, events: GameEvent[], reason: string) {
  const [a, b] = s.players;
  s.phase = 'over';
  s.winner = a.points === b.points ? 'empate' : a.points > b.points ? 0 : 1;
  s.queue = [];
  events.push({ kind: 'win', winner: s.winner, reason });
}

function drawChars(s: GameState, pid: PlayerId, events: GameEvent[]): boolean {
  const p = s.players[pid];
  const need = RULES.charsPerRound - p.hand.length;
  if (need > 0 && p.charDeck.length < need && RULES.reshuffleGraveyard && p.graveChars.length) {
    const back = p.graveChars.splice(0);
    p.charDeck.unshift(...shuffle(s, back));
    events.push({ kind: 'reshuffle', player: pid, count: back.length });
  }
  const uids: number[] = [];
  for (let i = 0; i < need && p.charDeck.length; i++) {
    const c = p.charDeck.pop()!;
    p.hand.push(c);
    uids.push(c.uid);
  }
  if (uids.length) events.push({ kind: 'draw', player: pid, uids });
  return p.hand.length >= RULES.columns; // precisa de ao menos 5 para a frontline
}

function drawTricks(s: GameState, pid: PlayerId, n: number, events: GameEvent[]) {
  const p = s.players[pid];
  const uids: number[] = [];
  for (let i = 0; i < n && p.trickDeck.length && p.trickHand.length < RULES.trickHandMax; i++) {
    const c = p.trickDeck.pop()!;
    p.trickHand.push(c);
    uids.push(c.uid);
  }
  if (uids.length) events.push({ kind: 'trickDraw', player: pid, uids });
}

function startRound(s: GameState, events: GameEvent[]) {
  s.round++;
  s.turnInRound = 0;
  s.columns = Array.from({ length: RULES.columns }, () => ({ resolved: false, winner: null }));
  s.clash = null;
  events.push({ kind: 'round', round: s.round });
  let ok = true;
  for (const pid of [0, 1] as PlayerId[]) {
    if (!drawChars(s, pid, events)) ok = false;
    drawTricks(s, pid, s.round === 1 ? RULES.trickHandStart : RULES.trickDrawPerRound, events);
  }
  if (!ok) return endGame(s, events, 'personagens insuficientes');
  s.phase = 'place';
  s.queue = [s.initiative, other(s.initiative)];
  s.actor = s.queue[0];
}

function startTurn(s: GameState, events: GameEvent[]) {
  s.turnInRound++;
  s.turnTotal++;
  s.clash = null;
  for (const p of s.players) {
    p.tricksUsedThisTurn = 0;
    p.swapsThisTurn = 0;
  }
  events.push({ kind: 'turn', round: s.round, turn: s.turnInRound, total: s.turnTotal });
  s.queue = [s.initiative, other(s.initiative)].filter((pid) => trickActions(s, pid).length > 0);
  if (s.queue.length) {
    s.phase = 'trick';
    s.actor = s.queue[0];
  } else rollForChoice(s, events);
}

function rollForChoice(s: GameState, events: GameEvent[]) {
  const rolls: [number, number][] = [];
  for (;;) {
    const a = rollD6(s);
    const b = rollD6(s);
    rolls.push([a, b]);
    if (a !== b) break;
  }
  const [a, b] = rolls[rolls.length - 1];
  const chooser: PlayerId = a > b ? 0 : 1;
  events.push({ kind: 'roll', rolls, chooser });
  s.phase = 'choose';
  s.actor = chooser;
  s.queue = [];
  s.clash = null;
  const open = openColumns(s);
  if (open.length === 1) applyChoose(s, open[0], events);
}

function applyChoose(s: GameState, col: number, events: GameEvent[]) {
  const chooser = s.actor;
  events.push({ kind: 'choose', player: chooser, col });
  const [p0, p1] = s.players;
  p0.front[col]!.revealed = true;
  p1.front[col]!.revealed = true;
  const cmp = compareFronts(p0.front[col]!.card, p1.front[col]!.card);
  const leader = cmp.leader ?? chooser; // empate nas frontlines: quem escolheu o campo fica à frente
  events.push({ kind: 'reveal', col, uids: [p0.front[col]!.card.uid, p1.front[col]!.card.uid], leader, byPrinciple: cmp.byPrinciple });
  s.clash = { col, chooser, leader, flipped: [false, false], stage: 'loser' };
  if (cmp.byPrinciple) return finishClash(s, events, 'principio');
  const loser = other(leader);
  if (canFlip(s, loser)) {
    s.phase = 'flip';
    s.actor = loser;
  } else finishClash(s, events);
}

function canFlip(s: GameState, pid: PlayerId): boolean {
  if (!s.clash) return false;
  const b = s.players[pid].back[s.clash.col];
  return !!b && !b.revealed;
}

function finishClash(s: GameState, events: GameEvent[], forced?: ClashReason) {
  const c = s.clash!;
  const t0 = sideTotal(s, 0, c.col);
  const t1 = sideTotal(s, 1, c.col);
  let winner: PlayerId;
  let reason: ClashReason;
  const dice: [number, number][] = [];
  if (forced === 'principio') {
    winner = c.leader;
    reason = 'principio';
  } else if (t0 !== t1) {
    winner = t0 > t1 ? 0 : 1;
    reason = 'valor';
  } else {
    for (;;) {
      const a = rollD6(s);
      const b = rollD6(s);
      dice.push([a, b]);
      if (a !== b) {
        winner = a > b ? 0 : 1;
        break;
      }
    }
    reason = 'dados';
  }
  events.push({ kind: 'result', col: c.col, winner, totals: [t0, t1], reason, dice });
  s.columns[c.col] = { resolved: true, winner };
  s.players[winner].points++;
  events.push({ kind: 'point', player: winner, points: s.players[winner].points });
  s.initiative = other(winner);

  if (s.players[winner].points >= RULES.pointsToWin) return endGame(s, events, `${RULES.pointsToWin} pontos`);
  if (s.turnTotal >= RULES.maxTurns) return endGame(s, events, 'limite de turnos');

  s.queue = [s.initiative, other(s.initiative)].filter((pid) => swapPairs(s, pid).length > 0);
  if (s.queue.length) {
    s.phase = 'swap';
    s.actor = s.queue[0];
  } else afterSwaps(s, events);
}

function afterSwaps(s: GameState, events: GameEvent[]) {
  if (openColumns(s).length === 0) {
    endRound(s, events);
    if (s.phase === 'over') return;
    for (const pid of [0, 1] as PlayerId[]) {
      if (!hasAnyChar(s.players[pid])) return endGame(s, events, 'sem personagens');
    }
    startRound(s, events);
  } else startTurn(s, events);
}

function endRound(s: GameState, events: GameEvent[]) {
  const moved: { player: PlayerId; uid: number; to: 'cemiterio' | 'exilio' }[] = [];
  for (const pid of [0, 1] as PlayerId[]) {
    const p = s.players[pid];
    for (const row of [p.front, p.back]) {
      row.forEach((x, i) => {
        if (!x) return;
        const ex = EXILE_ON_DEATH.includes(principleOf(x.card));
        (ex ? p.exile : p.graveChars).push(x.card);
        moved.push({ player: pid, uid: x.card.uid, to: ex ? 'exilio' : 'cemiterio' });
        row[i] = null;
      });
    }
  }
  events.push({ kind: 'roundEnd', round: s.round, moved });
}

function nextInQueue(s: GameState): boolean {
  s.queue.shift();
  if (s.queue.length) {
    s.actor = s.queue[0];
    return true;
  }
  return false;
}

// ─── Truques ──────────────────────────────────────────────────────────────

export function trickTargets(s: GameState, pid: PlayerId, defId: string): TrickTarget[] {
  const t = getTrick(defId);
  const out: TrickTarget[] = [];
  if (t.target === 'ownHiddenFront') {
    if (!s.players[pid].charDeck.length) return out;
    for (const col of openColumns(s)) {
      const f = s.players[pid].front[col];
      if (f && !f.revealed) out.push({ side: pid, row: 'front', col });
    }
  } else if (t.target === 'enemyHiddenBack') {
    const op = other(pid);
    s.players[op].back.forEach((b, col) => {
      if (b && !b.revealed) out.push({ side: op, row: 'back', col });
    });
  }
  return out;
}

export function trickActions(s: GameState, pid: PlayerId): Action[] {
  const p = s.players[pid];
  if (p.tricksUsedThisTurn >= RULES.tricksPerTurn) return [];
  const out: Action[] = [];
  const seen = new Set<string>();
  for (const c of p.trickHand) {
    if (seen.has(c.defId)) continue;
    seen.add(c.defId);
    for (const target of trickTargets(s, pid, c.defId)) out.push({ type: 'trick', uid: c.uid, target });
  }
  return out;
}

function applyTrick(s: GameState, pid: PlayerId, uid: number, target: TrickTarget, events: GameEvent[]) {
  const p = s.players[pid];
  const idx = p.trickHand.findIndex((c) => c.uid === uid);
  if (idx < 0) throw new Error('Truque não está na mão.');
  const card = p.trickHand[idx];
  if (!trickTargets(s, pid, card.defId).some((t) => t.side === target.side && t.row === target.row && t.col === target.col)) {
    throw new Error('Alvo inválido para o truque.');
  }
  p.trickHand.splice(idx, 1);
  p.graveTricks.push(card);
  p.tricksUsedThisTurn++;

  if (card.defId === 't-mapa-confuso') {
    const slot = p.front[target.col]!;
    const old = slot.card;
    const fresh = p.charDeck.pop()!;
    const pos = Math.floor(rand(s) * (p.charDeck.length + 1));
    p.charDeck.splice(pos, 0, old);
    slot.card = fresh;
    events.push({ kind: 'trick', player: pid, uid, defId: card.defId, target, result: 'trocou', newUid: fresh.uid });
  } else if (card.defId === 't-vara-de-pesca') {
    const enemy = s.players[target.side];
    const slot = enemy.back[target.col]!;
    if (!isTrick(slot.card.defId)) {
      enemy.back[target.col] = null;
      p.hand.push(slot.card);
      events.push({ kind: 'trick', player: pid, uid, defId: card.defId, target, result: 'roubou', revealedUid: slot.card.uid });
    } else {
      slot.revealed = true;
      events.push({ kind: 'trick', player: pid, uid, defId: card.defId, target, result: 'falhou', revealedUid: slot.card.uid });
    }
  }
}

// ─── Ações legais ─────────────────────────────────────────────────────────

/**
 * Ações legais para quem age agora. Na distribuição o espaço é grande demais
 * para listar (10! arranjos); use `validatePlace` e os geradores da IA.
 */
export function legalActions(s: GameState): Action[] {
  switch (s.phase) {
    case 'coin':
      return [{ type: 'coin', call: 'cara' }, { type: 'coin', call: 'coroa' }];
    case 'place':
      return [];
    case 'trick':
      return [{ type: 'pass' }, ...trickActions(s, s.actor)];
    case 'choose':
      return openColumns(s).map((col) => ({ type: 'choose', col }) as Action);
    case 'flip':
      return [{ type: 'flip', flip: true }, { type: 'flip', flip: false }];
    case 'swap': {
      const out: Action[] = [{ type: 'done' }];
      if (s.players[s.actor].swapsThisTurn < RULES.maxSwapsPerTurn) {
        for (const [a, b] of swapPairs(s, s.actor)) out.push({ type: 'swap', a, b });
      }
      return out;
    }
    case 'over':
      return [];
  }
}

export function validatePlace(s: GameState, a: Extract<Action, { type: 'place' }>): string | null {
  if (s.phase !== 'place') return 'Fora da fase de distribuição.';
  const hand = new Set(s.players[s.actor].hand.map((c) => c.uid));
  if (a.front.length !== RULES.columns || a.back.length !== RULES.columns) return 'Distribua 5 casas de cada linha.';
  const used = [...a.front, ...a.back.filter((x): x is number => x !== null)];
  if (new Set(used).size !== used.length) return 'Carta repetida.';
  if (used.some((u) => !hand.has(u))) return 'Carta fora da mão.';
  const expectedBack = Math.min(RULES.columns, hand.size - RULES.columns);
  if (a.back.filter((x) => x !== null).length !== expectedBack) return `Coloque ${expectedBack} carta(s) na backline.`;
  return null;
}

export function isLegal(s: GameState, a: Action): boolean {
  if (a.type === 'place') return validatePlace(s, a) === null;
  return legalActions(s).some((b) => JSON.stringify(b) === JSON.stringify(a));
}

// ─── Aplicar ação ─────────────────────────────────────────────────────────

export function applyAction(s: GameState, a: Action): GameEvent[] {
  const events: GameEvent[] = [];
  if (s.phase === 'over') return events;
  const pid = s.actor;

  switch (a.type) {
    case 'coin': {
      if (s.phase !== 'coin') throw new Error('A moeda já foi lançada.');
      const result: CoinSide = rand(s) < 0.5 ? 'cara' : 'coroa';
      const winner: PlayerId = result === a.call ? pid : other(pid);
      s.coinWinner = winner;
      s.initiative = winner;
      events.push({ kind: 'coin', call: a.call, result, winner });
      startRound(s, events);
      break;
    }
    case 'place': {
      const err = validatePlace(s, a);
      if (err) throw new Error(err);
      const p = s.players[pid];
      const take = (uid: number) => {
        const i = p.hand.findIndex((c) => c.uid === uid);
        return p.hand.splice(i, 1)[0];
      };
      a.front.forEach((uid, col) => (p.front[col] = { card: take(uid), revealed: false }));
      a.back.forEach((uid, col) => (p.back[col] = uid === null ? null : { card: take(uid), revealed: false }));
      events.push({ kind: 'placed', player: pid });
      if (!nextInQueue(s)) startTurn(s, events);
      break;
    }
    case 'trick':
    case 'pass': {
      if (s.phase !== 'trick') throw new Error('Fora da fase de truques.');
      if (a.type === 'trick') applyTrick(s, pid, a.uid, a.target, events);
      else events.push({ kind: 'pass', player: pid });
      if (!nextInQueue(s)) rollForChoice(s, events);
      break;
    }
    case 'choose': {
      if (s.phase !== 'choose') throw new Error('Fora da escolha de campo.');
      if (!openColumns(s).includes(a.col)) throw new Error('Campo já disputado.');
      applyChoose(s, a.col, events);
      break;
    }
    case 'flip': {
      if (s.phase !== 'flip' || !s.clash) throw new Error('Nada para virar agora.');
      const c = s.clash;
      if (a.flip) {
        if (!canFlip(s, pid)) throw new Error('Não há backline oculta neste campo.');
        c.flipped[pid] = true;
        s.players[pid].back[c.col]!.revealed = true;
      }
      events.push({ kind: 'flip', player: pid, col: c.col, flipped: a.flip, uid: a.flip ? s.players[pid].back[c.col]!.card.uid : undefined });
      if (c.stage === 'loser' && a.flip && canFlip(s, c.leader)) {
        c.stage = 'winner';
        s.actor = c.leader;
      } else finishClash(s, events);
      break;
    }
    case 'swap': {
      if (s.phase !== 'swap') throw new Error('Fora da fase de trocas.');
      if (!swapPairs(s, pid).some(([x, y]) => (x === a.a && y === a.b) || (x === a.b && y === a.a))) {
        throw new Error('Só cartas ocultas da backline podem trocar de lugar.');
      }
      const p = s.players[pid];
      [p.back[a.a], p.back[a.b]] = [p.back[a.b], p.back[a.a]];
      p.swapsThisTurn++;
      events.push({ kind: 'swap', player: pid, a: a.a, b: a.b });
      break;
    }
    case 'done': {
      if (s.phase !== 'swap') throw new Error('Fora da fase de trocas.');
      events.push({ kind: 'swapDone', player: pid, swaps: s.players[pid].swapsThisTurn });
      if (!nextInQueue(s)) afterSwaps(s, events);
      break;
    }
  }
  return events;
}

/** Encontra uma carta em qualquer lugar (para nomes no registro e na interface). */
export function findCard(s: GameState, uid: number): CardInst | null {
  for (const p of s.players) {
    for (const row of [p.front, p.back]) for (const x of row) if (x?.card.uid === uid) return x.card;
    for (const list of [p.hand, p.charDeck, p.graveChars, p.exile, p.trickHand, p.trickDeck, p.graveTricks]) {
      const c = list.find((x) => x.uid === uid);
      if (c) return c;
    }
  }
  return null;
}
