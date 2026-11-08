import {
  EXILE_ON_DEATH,
  PRINCIPLE_BEATS,
  PRINCIPLE_BONUS,
  PRINCIPLE_MODE,
  RULES,
  type Principle,
} from '../config';
import { DECKS, TRICK_DECK, getDef, isTrick, type DeckKey } from './cards';
import { rand, rollD6, shuffle } from './rng';

/*
 * ESTRUTURA DA PARTIDA
 *
 *  Moeda        → quem acerta ganha a iniciativa; quem erra compra 1 truque a mais.
 *  Rodada       → cada jogador distribui cartas VIRADAS: 5 personagens na frontline
 *                 e, se quiser, até 5 na backline (personagens OU truques/equipamentos).
 *                 Começa comprando 1 truque por duelo perdido na rodada anterior.
 *                 Uma rodada tem de 3 a 5 duelos: quem vencer 3 leva a rodada (1 ponto).
 *  Duelo        → 1) os dois rolam o d6; o maior escolhe um campo livre
 *                 2) as frontlines daquele campo são reveladas:
 *                    vantagem de princípio vence; senão, ATK × ATK
 *                 3) quem está perdendo decide se vira a backline do campo;
 *                    se virar, o outro decide se vira a dele.
 *                    Personagem virado soma a DEF; truque virado dispara o efeito.
 *                 4) maior total vence o duelo; empate → d6 até desempatar
 *                 5) fim do duelo: cada um decide se troca de lugar as backlines ocultas
 *                    dos campos que ainda não lutaram (campo disputado fica travado)
 *  Fim da rodada → tudo vai ao cemitério; Realeza REVELADA vai ao exílio.
 *  Vitória      → 15 pontos (no máximo 29 rodadas).
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
  /** rodadas vencidas */
  points: number;
  /** duelos vencidos na rodada atual */
  duelWins: number;
  /** duelos perdidos na rodada anterior (vira compra de truques) */
  lastRoundLosses: number;
  charDeck: CardInst[];
  hand: CardInst[];
  trickDeck: CardInst[];
  trickHand: CardInst[];
  front: (Placed | null)[];
  back: (Placed | null)[];
  graveChars: CardInst[];
  graveTricks: CardInst[];
  exile: CardInst[];
  swapsThisTurn: number;
}

/**
 * 'resolve'   → backlines decididas; falta apurar o duelo (a interface mostra os efeitos antes).
 * 'roundOver' → alguém fez 3 duelos; a mesa fica à mostra até alguém avançar.
 */
export type Phase = 'coin' | 'place' | 'choose' | 'flip' | 'resolve' | 'swap' | 'roundOver' | 'over';

export interface ColumnState {
  resolved: boolean;
  winner: PlayerId | null;
}

export interface Clash {
  col: number;
  chooser: PlayerId;
  /** quem estava vencendo quando as frontlines foram reveladas */
  leader: PlayerId;
  flipped: [boolean, boolean];
  stage: 'loser' | 'winner';
  /** efeitos de truques/equipamentos válidos só neste duelo */
  mods: DuelMods;
}

export interface DuelMods {
  atk: [number, number];
  def: [number, number];
  /** Contra-ordem: inverte a vantagem de princípio (duas anulam) */
  invert: boolean;
  /** Coroa Falsa: a frontline conta como Realeza */
  royal: [boolean, boolean];
  /** Tambor de Guerra: o lado marcado não pode mais virar a backline */
  noFlip: [boolean, boolean];
}

export function emptyMods(): DuelMods {
  return { atk: [0, 0], def: [0, 0], invert: false, royal: [false, false], noFlip: [false, false] };
}

export interface GameState {
  rng: number;
  players: [PlayerState, PlayerState];
  phase: Phase;
  /** quem precisa agir agora */
  actor: PlayerId;
  /** distribui e troca primeiro; passa para quem perdeu o último duelo */
  initiative: PlayerId;
  round: number;
  duelInRound: number;
  duelTotal: number;
  columns: ColumnState[];
  clash: Clash | null;
  queue: PlayerId[];
  winner: PlayerId | 'empate' | null;
  coinWinner: PlayerId | null;
  lastRoundWinner: PlayerId | null;
  nextUid: number;
}

export type Action =
  | { type: 'coin'; call: CoinSide }
  | { type: 'place'; front: number[]; back: (number | null)[] }
  | { type: 'choose'; col: number }
  | { type: 'flip'; flip: boolean }
  | { type: 'swap'; a: number; b: number }
  | { type: 'done' }
  | { type: 'resolve' }
  | { type: 'next' };

export type DuelReason = 'principio' | 'valor' | 'dados';

export type GameEvent =
  | { kind: 'coin'; call: CoinSide; result: CoinSide; winner: PlayerId }
  | { kind: 'round'; round: number }
  | { kind: 'reshuffle'; player: PlayerId; count: number }
  | { kind: 'draw'; player: PlayerId; uids: number[] }
  | { kind: 'trickDraw'; player: PlayerId; uids: number[]; extra: number; round: number }
  | { kind: 'placed'; player: PlayerId; tricks: number }
  | { kind: 'duel'; round: number; duel: number; total: number }
  | { kind: 'roll'; rolls: [number, number][]; chooser: PlayerId }
  | { kind: 'choose'; player: PlayerId; col: number }
  | { kind: 'reveal'; col: number; uids: [number, number]; leader: PlayerId; byPrinciple: boolean }
  | { kind: 'flip'; player: PlayerId; col: number; flipped: boolean; uid?: number }
  | { kind: 'trigger'; player: PlayerId; col: number; defId: string; result: 'trocou' | 'roubou' | 'falhou' | 'sabotou' | 'bonus'; oldUid?: number; newUid?: number; stolenUid?: number; revealedUid?: number; destroyedUid?: number; text?: string }
  | { kind: 'result'; col: number; winner: PlayerId; totals: [number, number]; reason: DuelReason; dice: [number, number][]; duelWins: [number, number] }
  | { kind: 'swap'; player: PlayerId; a: number; b: number }
  | { kind: 'swapDone'; player: PlayerId; swaps: number }
  | { kind: 'roundWon'; round: number; winner: PlayerId; points: [number, number]; duelWins: [number, number] }
  | { kind: 'roundEnd'; round: number; winner: PlayerId; points: [number, number]; moved: { player: PlayerId; uid: number; to: 'cemiterio' | 'cemiterio2' | 'exilio' }[] }
  | { kind: 'win'; winner: PlayerId | 'empate'; reason: string };

// ─── Utilidades ───────────────────────────────────────────────────────────

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function principleOf(c: CardInst): Principle {
  return getDef(c.defId).principle;
}

export function beats(a: Principle, b: Principle): boolean {
  return PRINCIPLE_BEATS[a].includes(b);
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
      if (s.columns[a]?.resolved || s.columns[b]?.resolved) continue; // campo que já lutou fica travado
      if (!backSwappable(p, a) || !backSwappable(p, b)) continue;
      if (!p.back[a] && !p.back[b]) continue;
      out.push([a, b]);
    }
  }
  return out;
}

/** Máximo de cartas que cabem na backline (ela é opcional: de 0 até este número). */
export function maxBack(p: PlayerState): number {
  return Math.min(RULES.columns, Math.max(0, p.hand.length - RULES.columns) + p.trickHand.length);
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
    duelInRound: 0,
    duelTotal: 0,
    columns: [],
    clash: null,
    queue: [],
    winner: null,
    coinWinner: null,
    lastRoundWinner: null,
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
      duelWins: 0,
      lastRoundLosses: 0,
      charDeck: chars,
      hand: [],
      trickDeck: tricks,
      trickHand: [],
      front: emptyRow(),
      back: emptyRow(),
      graveChars: [],
      graveTricks: [],
      exile: [],
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
    clash: s.clash
      ? {
          ...s.clash,
          flipped: [...s.clash.flipped] as [boolean, boolean],
          mods: {
            atk: [...s.clash.mods.atk] as [number, number],
            def: [...s.clash.mods.def] as [number, number],
            invert: s.clash.mods.invert,
            royal: [...s.clash.mods.royal] as [boolean, boolean],
            noFlip: [...s.clash.mods.noFlip] as [boolean, boolean],
          },
        }
      : null,
    queue: s.queue.slice(),
  };
}

/**
 * Determinização: sorteia um mundo possível do ponto de vista de `viewer`.
 * Tudo o que o rival esconde é embaralhado: mão, decks e cartas viradas na mesa.
 * O número de truques escondidos na backline dele é público (deck e mão de
 * truques têm contagem visível), mas QUAIS casas têm truque é sorteado.
 */
export function determinize(s: GameState, viewer: PlayerId, seed: number): GameState {
  const c = cloneState(s);
  c.rng = seed >>> 0;
  const opp = c.players[other(viewer)];
  const hiddenFront = opp.front.filter((x): x is Placed => !!x && !x.revealed);
  const hiddenBack = opp.back.filter((x): x is Placed => !!x && !x.revealed);
  const backTricks = hiddenBack.filter((x) => isTrick(x.card.defId)).length;

  const chars = shuffle(c, [
    ...opp.hand, ...opp.charDeck, ...hiddenFront.map((x) => x.card),
    ...hiddenBack.filter((x) => !isTrick(x.card.defId)).map((x) => x.card),
  ]);
  const tricks = shuffle(c, [
    ...opp.trickHand, ...opp.trickDeck,
    ...hiddenBack.filter((x) => isTrick(x.card.defId)).map((x) => x.card),
  ]);
  const backOrder = shuffle(c, hiddenBack.slice());
  let ci = 0;
  let ti = 0;
  backOrder.forEach((slot, i) => (slot.card = i < backTricks ? tricks[ti++] : chars[ci++]));
  for (const slot of hiddenFront) slot.card = chars[ci++];
  opp.hand = chars.slice(ci, (ci += opp.hand.length));
  opp.charDeck = chars.slice(ci);
  opp.trickHand = tricks.slice(ti, (ti += opp.trickHand.length));
  opp.trickDeck = tricks.slice(ti);
  shuffle(c, c.players[viewer].charDeck);
  shuffle(c, c.players[viewer].trickDeck);
  return c;
}

// ─── Duelo ────────────────────────────────────────────────────────────────

export interface FrontCompare {
  leader: PlayerId | null; // null = empate
  byPrinciple: boolean;
  values: [number, number];
}

/** Compara duas frontlines (princípio primeiro, depois ATK), com os efeitos do duelo. */
export function compareFronts(a: CardInst, b: CardInst, mods: DuelMods = emptyMods()): FrontCompare {
  const pa: Principle = mods.royal[0] ? 'realeza' : principleOf(a);
  const pb: Principle = mods.royal[1] ? 'realeza' : principleOf(b);
  let aAdv = beats(pa, pb);
  let bAdv = beats(pb, pa);
  if (mods.invert) [aAdv, bAdv] = [bAdv, aAdv];
  const va = getDef(a.defId).atk + mods.atk[0] + (PRINCIPLE_MODE === 'bonus' && aAdv ? PRINCIPLE_BONUS : 0);
  const vb = getDef(b.defId).atk + mods.atk[1] + (PRINCIPLE_MODE === 'bonus' && bAdv ? PRINCIPLE_BONUS : 0);
  if (PRINCIPLE_MODE === 'dominante' && aAdv !== bAdv) {
    return { leader: aAdv ? 0 : 1, byPrinciple: true, values: [va, vb] };
  }
  return { leader: va > vb ? 0 : vb > va ? 1 : null, byPrinciple: false, values: [va, vb] };
}

/** DEF somada por um lado: personagem virado neste duelo (ainda na casa) + equipamentos. */
function backBonus(s: GameState, pid: PlayerId, col: number): number {
  if (!s.clash || s.clash.col !== col) return 0;
  let v = s.clash.mods.def[pid];
  const b = s.players[pid].back[col];
  if (s.clash.flipped[pid] && b && !isTrick(b.card.defId)) v += getDef(b.card.defId).def;
  return v;
}

export interface DuelStanding {
  leader: PlayerId | null;
  byPrinciple: boolean;
  totals: [number, number];
}

/** Situação atual do duelo no campo `col` (frontlines, backlines viradas e efeitos). */
export function duelStanding(s: GameState, col: number): DuelStanding {
  const f0 = s.players[0].front[col]!.card;
  const f1 = s.players[1].front[col]!.card;
  const mods = s.clash && s.clash.col === col ? s.clash.mods : emptyMods();
  const cmp = compareFronts(f0, f1, mods);
  const totals: [number, number] = [cmp.values[0] + backBonus(s, 0, col), cmp.values[1] + backBonus(s, 1, col)];
  if (cmp.byPrinciple) return { leader: cmp.leader, byPrinciple: true, totals };
  return { leader: totals[0] > totals[1] ? 0 : totals[1] > totals[0] ? 1 : null, byPrinciple: false, totals };
}

// ─── Fluxo ────────────────────────────────────────────────────────────────

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
  return p.hand.length >= RULES.columns;
}

function drawTricks(s: GameState, pid: PlayerId, n: number, extra: number, events: GameEvent[]) {
  const p = s.players[pid];
  if (!p.trickDeck.length && p.graveTricks.length && RULES.reshuffleGraveyard) {
    p.trickDeck.push(...shuffle(s, p.graveTricks.splice(0)));
  }
  const uids: number[] = [];
  for (let i = 0; i < n + extra && p.trickDeck.length && p.trickHand.length < RULES.trickHandMax; i++) {
    const c = p.trickDeck.pop()!;
    p.trickHand.push(c);
    uids.push(c.uid);
  }
  if (uids.length) events.push({ kind: 'trickDraw', player: pid, uids, extra, round: s.round });
}

function startRound(s: GameState, events: GameEvent[]) {
  s.round++;
  s.duelInRound = 0;
  s.columns = Array.from({ length: RULES.columns }, () => ({ resolved: false, winner: null }));
  s.clash = null;
  for (const p of s.players) p.duelWins = 0;
  events.push({ kind: 'round', round: s.round });
  let ok = true;
  for (const pid of [0, 1] as PlayerId[]) {
    if (!drawChars(s, pid, events)) ok = false;
    if (s.round === 1) {
      const extra = s.coinWinner !== null && pid !== s.coinWinner ? RULES.coinLoserExtraTricks : 0;
      drawTricks(s, pid, RULES.trickHandStart, extra, events);
    } else drawTricks(s, pid, s.players[pid].lastRoundLosses * RULES.trickDrawPerDuelLost, 0, events);
  }
  if (!ok) return endGame(s, events, 'personagens insuficientes');
  s.phase = 'place';
  s.queue = [s.initiative, other(s.initiative)];
  s.actor = s.queue[0];
}

function startDuel(s: GameState, events: GameEvent[]) {
  s.duelInRound++;
  s.duelTotal++;
  s.clash = null;
  for (const p of s.players) p.swapsThisTurn = 0;
  events.push({ kind: 'duel', round: s.round, duel: s.duelInRound, total: s.duelTotal });
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
  const leader = cmp.leader ?? chooser; // frontlines empatadas: quem escolheu o campo fica à frente
  events.push({ kind: 'reveal', col, uids: [p0.front[col]!.card.uid, p1.front[col]!.card.uid], leader, byPrinciple: cmp.byPrinciple });
  s.clash = { col, chooser, leader, flipped: [false, false], stage: 'loser', mods: emptyMods() };
  const loser = other(leader);
  if (canFlip(s, loser)) {
    s.phase = 'flip';
    s.actor = loser;
  } else toResolve(s);
}

export function canFlip(s: GameState, pid: PlayerId): boolean {
  if (!s.clash) return false;
  if (s.clash.mods.noFlip[pid]) return false;
  const b = s.players[pid].back[s.clash.col];
  return !!b && !b.revealed;
}

/** Fim das decisões de backline: o duelo espera a apuração ('resolve'). */
function toResolve(s: GameState) {
  s.phase = 'resolve';
  s.actor = s.clash!.chooser;
}

/** Vira a backline de `pid` no campo do duelo e dispara o efeito, sem avançar o fluxo. */
export function doFlip(s: GameState, pid: PlayerId, events: GameEvent[]) {
  const c = s.clash!;
  const slot = s.players[pid].back[c.col]!;
  slot.revealed = true;
  c.flipped[pid] = true;
  events.push({ kind: 'flip', player: pid, col: c.col, flipped: true, uid: slot.card.uid });
  if (isTrick(slot.card.defId)) triggerTrick(s, pid, c.col, slot.card, events);
}

/** Efeito de um truque/equipamento virado na backline do campo do duelo. */
function triggerTrick(s: GameState, pid: PlayerId, col: number, card: CardInst, events: GameEvent[]) {
  const me = s.players[pid];
  const op = s.players[other(pid)];
  if (card.defId === 't-mapa-confuso') {
    if (!me.charDeck.length && RULES.reshuffleGraveyard && me.graveChars.length) {
      me.charDeck.push(...shuffle(s, me.graveChars.splice(0)));
    }
    const slot = me.front[col]!;
    if (!me.charDeck.length) {
      events.push({ kind: 'trigger', player: pid, col, defId: card.defId, result: 'falhou' });
      return;
    }
    const old = slot.card;
    const fresh = me.charDeck.pop()!;
    me.charDeck.splice(Math.floor(rand(s) * (me.charDeck.length + 1)), 0, old);
    me.front[col] = { card: fresh, revealed: true };
    events.push({ kind: 'trigger', player: pid, col, defId: card.defId, result: 'trocou', oldUid: old.uid, newUid: fresh.uid });
  } else if (card.defId === 't-vara-de-pesca') {
    const target = op.back[col];
    if (target && !isTrick(target.card.defId)) {
      op.back[col] = null;
      me.hand.push(target.card);
      events.push({ kind: 'trigger', player: pid, col, defId: card.defId, result: 'roubou', stolenUid: target.card.uid });
    } else {
      if (target) target.revealed = true; // pescou um truque: fica à mostra e sem efeito
      events.push({ kind: 'trigger', player: pid, col, defId: card.defId, result: 'falhou', revealedUid: target?.card.uid });
    }
  } else if (card.defId === 't-sabotagem') {
    const target = op.back[col];
    if (target) {
      op.back[col] = null;
      (isTrick(target.card.defId) ? op.graveTricks : op.graveChars).push(target.card);
      events.push({ kind: 'trigger', player: pid, col, defId: card.defId, result: 'sabotou', destroyedUid: target.card.uid });
    } else events.push({ kind: 'trigger', player: pid, col, defId: card.defId, result: 'falhou' });
  } else {
    const m = s.clash!.mods;
    let text = '';
    if (card.defId === 't-escudo-de-torre') {
      m.def[pid] += 4;
      text = '+4 de defesa';
    } else if (card.defId === 't-lanca-de-cerco') {
      m.atk[pid] += 3;
      text = '+3 de ATK';
    } else if (card.defId === 't-contra-ordem') {
      m.invert = !m.invert;
      text = 'vantagem de princípio invertida';
    } else if (card.defId === 't-coroa-falsa') {
      m.royal[pid] = true;
      text = 'frontline conta como Realeza';
    } else if (card.defId === 't-tambor-de-guerra') {
      m.atk[pid] += 2;
      m.noFlip[other(pid)] = true;
      text = '+2 de ATK e o rival não pode mais virar';
    }
    events.push({ kind: 'trigger', player: pid, col, defId: card.defId, result: 'bonus', text });
  }
}

function finishDuel(s: GameState, events: GameEvent[]) {
  const c = s.clash!;
  const st = duelStanding(s, c.col);
  let winner: PlayerId;
  let reason: DuelReason;
  const dice: [number, number][] = [];
  if (st.leader !== null) {
    winner = st.leader;
    reason = st.byPrinciple ? 'principio' : 'valor';
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
  s.columns[c.col] = { resolved: true, winner };
  s.players[winner].duelWins++;
  s.initiative = other(winner);
  events.push({
    kind: 'result', col: c.col, winner, totals: st.totals, reason, dice,
    duelWins: [s.players[0].duelWins, s.players[1].duelWins],
  });

  if (s.players[winner].duelWins >= RULES.duelsToWinRound) return roundOver(s, winner, events);

  s.queue = [s.initiative, other(s.initiative)].filter((pid) => swapPairs(s, pid).length > 0);
  if (s.queue.length) {
    s.phase = 'swap';
    s.actor = s.queue[0];
  } else startDuel(s, events);
}

/** Rodada decidida: marca o ponto e deixa a mesa à mostra até alguém avançar ('next'). */
function roundOver(s: GameState, winner: PlayerId, events: GameEvent[]) {
  s.players[winner].points++;
  s.lastRoundWinner = winner;
  s.players[0].lastRoundLosses = s.players[1].duelWins;
  s.players[1].lastRoundLosses = s.players[0].duelWins;
  s.phase = 'roundOver';
  s.actor = s.initiative;
  s.queue = [];
  events.push({ kind: 'roundWon', round: s.round, winner, points: [s.players[0].points, s.players[1].points], duelWins: [s.players[0].duelWins, s.players[1].duelWins] });
}

function endRound(s: GameState, events: GameEvent[]) {
  const winner = s.lastRoundWinner!;
  const moved: { player: PlayerId; uid: number; to: 'cemiterio' | 'cemiterio2' | 'exilio' }[] = [];
  for (const pid of [0, 1] as PlayerId[]) {
    const p = s.players[pid];
    for (const row of [p.front, p.back]) {
      row.forEach((x, i) => {
        if (!x) return;
        let to: 'cemiterio' | 'cemiterio2' | 'exilio';
        if (isTrick(x.card.defId)) to = 'cemiterio2';
        else {
          const d = getDef(x.card.defId);
          const exiles = EXILE_ON_DEATH.includes(d.principle) || d.exile === true;
          to = exiles && x.revealed ? 'exilio' : 'cemiterio';
        }
        (to === 'exilio' ? p.exile : to === 'cemiterio2' ? p.graveTricks : p.graveChars).push(x.card);
        moved.push({ player: pid, uid: x.card.uid, to });
        row[i] = null;
      });
    }
  }
  s.clash = null;
  events.push({ kind: 'roundEnd', round: s.round, winner, points: [s.players[0].points, s.players[1].points], moved });
  if (s.players[winner].points >= RULES.pointsToWin) return endGame(s, events, `${RULES.pointsToWin} rodadas vencidas`);
  if (s.round >= RULES.maxRounds) return endGame(s, events, 'limite de rodadas');
  startRound(s, events);
}

function nextInQueue(s: GameState): boolean {
  s.queue.shift();
  if (s.queue.length) {
    s.actor = s.queue[0];
    return true;
  }
  return false;
}

// ─── Ações legais ─────────────────────────────────────────────────────────

/**
 * Ações legais para quem age agora. Na distribuição o espaço é grande demais
 * para listar; use `validatePlace` e os geradores da IA.
 */
export function legalActions(s: GameState): Action[] {
  switch (s.phase) {
    case 'coin':
      return [{ type: 'coin', call: 'cara' }, { type: 'coin', call: 'coroa' }];
    case 'place':
      return [];
    case 'choose':
      return openColumns(s).map((col) => ({ type: 'choose', col }) as Action);
    case 'flip':
      return [{ type: 'flip', flip: true }, { type: 'flip', flip: false }];
    case 'resolve':
      return [{ type: 'resolve' }];
    case 'roundOver':
      return [{ type: 'next' }];
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
  const p = s.players[s.actor];
  const chars = new Set(p.hand.map((c) => c.uid));
  const tricks = new Set(p.trickHand.map((c) => c.uid));
  if (a.front.length !== RULES.columns || a.back.length !== RULES.columns) return 'Distribua as 5 casas de cada linha.';
  if (a.front.some((u) => !chars.has(u))) return 'A frontline só recebe personagens.';
  const backs = a.back.filter((x): x is number => x !== null);
  if (backs.some((u) => !chars.has(u) && !tricks.has(u))) return 'Carta fora da mão.';
  const used = [...a.front, ...backs];
  if (new Set(used).size !== used.length) return 'Carta repetida.';
  if (backs.length > maxBack(p)) return 'Cartas demais na backline.';
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
        let i = p.hand.findIndex((c) => c.uid === uid);
        if (i >= 0) return p.hand.splice(i, 1)[0];
        i = p.trickHand.findIndex((c) => c.uid === uid);
        return p.trickHand.splice(i, 1)[0];
      };
      a.front.forEach((uid, col) => (p.front[col] = { card: take(uid), revealed: false }));
      a.back.forEach((uid, col) => (p.back[col] = uid === null ? null : { card: take(uid), revealed: false }));
      events.push({ kind: 'placed', player: pid, tricks: p.back.filter((x) => x && isTrick(x.card.defId)).length });
      if (!nextInQueue(s)) startDuel(s, events);
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
        doFlip(s, pid, events);
      } else {
        events.push({ kind: 'flip', player: pid, col: c.col, flipped: false });
      }
      const next = other(pid);
      if (c.stage === 'loser' && a.flip && canFlip(s, next)) {
        c.stage = 'winner';
        s.actor = next;
      } else toResolve(s);
      break;
    }
    case 'resolve': {
      if (s.phase !== 'resolve') throw new Error('Nada para apurar agora.');
      finishDuel(s, events);
      break;
    }
    case 'next': {
      if (s.phase !== 'roundOver') throw new Error('A rodada ainda não acabou.');
      endRound(s, events);
      break;
    }
    case 'swap': {
      if (s.phase !== 'swap') throw new Error('Fora da fase de trocas.');
      if (!swapPairs(s, pid).some(([x, y]) => (x === a.a && y === a.b) || (x === a.b && y === a.a))) {
        throw new Error('Só backlines ocultas de campos ainda não disputados podem trocar de lugar.');
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
      if (!nextInQueue(s)) startDuel(s, events);
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
