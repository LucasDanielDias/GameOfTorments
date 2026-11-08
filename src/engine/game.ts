import {
  EXILE_ON_DEATH,
  PRINCIPLE_BEATS,
  PRINCIPLE_BONUS,
  PRINCIPLE_MODE,
  RULES,
  type Principle,
} from '../config';
import { DECKS, TRICK_DECK_PLACEHOLDER_SIZE, getDef, type DeckKey } from './cards';
import { rand, rollD6, shuffle } from './rng';

// ─── Tipos ────────────────────────────────────────────────────────────────

export type PlayerId = 0 | 1;
export type Row = 'front' | 'back';
export type CoinSide = 'cara' | 'coroa';

export interface CardInst {
  uid: number;
  defId: string;
  owner: PlayerId;
}

/** Uma carta de personagem em campo. */
export interface Unit {
  card: CardInst;
  enteredTurn: number;
  attacked: boolean;
}

export interface PlayerState {
  name: string;
  deckName: string;
  life: number;
  charDeck: CardInst[];
  /** Deck de truques/equipamentos: ainda sem regras, guardamos só a contagem. */
  trickDeck: number;
  hand: CardInst[];
  front: (Unit | null)[];
  back: (Unit | null)[];
  graveChars: CardInst[];
  graveTricks: CardInst[];
  exile: CardInst[];
  playsLeft: number;
  movesLeft: number;
}

export type Phase = 'coin' | 'main' | 'over';

export interface GameState {
  rng: number;
  players: [PlayerState, PlayerState];
  current: PlayerId;
  /** Turno global, começa em 1 com o primeiro jogador. */
  turn: number;
  phase: Phase;
  winner: PlayerId | 'empate' | null;
  starter: PlayerId | null;
  nextUid: number;
}

export type Target = { kind: 'unit'; row: Row; col: number } | { kind: 'player' };

export type Action =
  | { type: 'coin'; call: CoinSide }
  | { type: 'play'; uid: number; row: Row; col: number }
  | { type: 'move'; fromRow: Row; fromCol: number; toRow: Row; toCol: number }
  | { type: 'attack'; col: number; target: Target }
  | { type: 'end' };

export interface CombatInfo {
  attackerUid: number;
  defenderUid: number | null;
  attValue: number;
  defValue: number;
  attBonus: number;
  defBonus: number;
  dice: [number, number][];
  winner: 'att' | 'def' | 'direct';
  reason: 'valor' | 'dados' | 'dominante' | 'direto';
}

export type GameEvent =
  | { kind: 'coin'; call: CoinSide; result: CoinSide; starter: PlayerId }
  | { kind: 'turn'; player: PlayerId; turn: number }
  | { kind: 'draw'; player: PlayerId; uid: number }
  | { kind: 'handFull'; player: PlayerId }
  | { kind: 'play'; player: PlayerId; uid: number; row: Row; col: number }
  | { kind: 'move'; player: PlayerId; uid: number; fromRow: Row; fromCol: number; toRow: Row; toCol: number; swappedUid: number | null }
  | { kind: 'attack'; player: PlayerId; col: number; target: Target; combat: CombatInfo }
  | { kind: 'destroy'; owner: PlayerId; uid: number; row: Row; col: number; to: 'cemiterio' | 'exilio' }
  | { kind: 'damage'; player: PlayerId; amount: number; life: number }
  | { kind: 'win'; winner: PlayerId | 'empate'; reason: string };

// ─── Utilidades ───────────────────────────────────────────────────────────

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function principleOf(c: CardInst): Principle {
  return getDef(c.defId).principle;
}

export function beats(a: Principle, b: Principle): boolean {
  return PRINCIPLE_BEATS[a].includes(b);
}

/** Valor ativo da carta: ATK na frontline, DEF na backline. */
export function activeValue(c: CardInst, row: Row): number {
  const d = getDef(c.defId);
  return row === 'front' ? d.atk : d.def;
}

export function rowOf(p: PlayerState, row: Row) {
  return row === 'front' ? p.front : p.back;
}

export function unitAt(p: PlayerState, row: Row, col: number): Unit | null {
  return rowOf(p, row)[col] ?? null;
}

export function cardsOnField(p: PlayerState): { unit: Unit; row: Row; col: number }[] {
  const out: { unit: Unit; row: Row; col: number }[] = [];
  for (const row of ['front', 'back'] as Row[]) {
    rowOf(p, row).forEach((u, col) => {
      if (u) out.push({ unit: u, row, col });
    });
  }
  return out;
}

export function findUnit(s: GameState, uid: number) {
  for (const pid of [0, 1] as PlayerId[]) {
    for (const f of cardsOnField(s.players[pid])) {
      if (f.unit.card.uid === uid) return { pid, ...f };
    }
  }
  return null;
}

function emptyRow(): (Unit | null)[] {
  return Array.from({ length: RULES.boardColumns }, () => null);
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
    current: 0,
    turn: 0,
    phase: 'coin',
    winner: null,
    starter: null,
    nextUid: 1,
  };
  for (const pid of [0, 1] as PlayerId[]) {
    const deck = DECKS[decks[pid]];
    const cards: CardInst[] = deck.cards.map((defId) => ({ uid: s.nextUid++, defId, owner: pid }));
    shuffle(s, cards);
    s.players[pid] = {
      name: names[pid],
      deckName: deck.name,
      life: RULES.startingLife,
      charDeck: cards,
      trickDeck: TRICK_DECK_PLACEHOLDER_SIZE,
      hand: [],
      front: emptyRow(),
      back: emptyRow(),
      graveChars: [],
      graveTricks: [],
      exile: [],
      playsLeft: 0,
      movesLeft: 0,
    };
    for (let i = 0; i < RULES.startingHand; i++) {
      const c = s.players[pid].charDeck.pop();
      if (c) s.players[pid].hand.push(c);
    }
  }
  return s;
}

// ─── Clonagem e informação oculta ─────────────────────────────────────────

function cloneRow(r: (Unit | null)[]) {
  return r.map((u) => (u ? { card: u.card, enteredTurn: u.enteredTurn, attacked: u.attacked } : null));
}

function clonePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    charDeck: p.charDeck.slice(),
    hand: p.hand.slice(),
    front: cloneRow(p.front),
    back: cloneRow(p.back),
    graveChars: p.graveChars.slice(),
    graveTricks: p.graveTricks.slice(),
    exile: p.exile.slice(),
  };
}

/** Clone rápido (as CardInst são imutáveis e podem ser compartilhadas). */
export function cloneState(s: GameState): GameState {
  return { ...s, players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])] };
}

/**
 * Determinização: o bot não pode ver a mão nem a ordem do deck do rival.
 * Embaralha (mão + deck) do oponente e redistribui com os mesmos tamanhos,
 * e embaralha o próprio deck do observador. Assim a IA joga sem trapacear.
 */
export function determinize(s: GameState, viewer: PlayerId, seed: number): GameState {
  const c = cloneState(s);
  c.rng = seed >>> 0;
  const opp = c.players[other(viewer)];
  const pool = shuffle(c, [...opp.hand, ...opp.charDeck]);
  opp.hand = pool.slice(0, opp.hand.length);
  opp.charDeck = pool.slice(opp.hand.length);
  shuffle(c, c.players[viewer].charDeck);
  return c;
}

// ─── Regras: o que pode ser feito ─────────────────────────────────────────

export function canAttackWith(s: GameState, col: number): boolean {
  if (s.phase !== 'main') return false;
  if (RULES.firstTurnNoAttack && s.turn === 1) return false;
  const u = s.players[s.current].front[col];
  if (!u || u.attacked) return false;
  if (RULES.summoningSickness && u.enteredTurn === s.turn) return false;
  return true;
}

export function attackTargets(s: GameState, col: number): Target[] {
  if (!canAttackWith(s, col)) return [];
  const enemy = s.players[other(s.current)];
  const out: Target[] = [];
  for (let c = col - RULES.attackReach; c <= col + RULES.attackReach; c++) {
    if (c < 0 || c >= RULES.boardColumns) continue;
    if (enemy.front[c]) out.push({ kind: 'unit', row: 'front', col: c });
  }
  if (!enemy.front[col]) {
    if (enemy.back[col]) out.push({ kind: 'unit', row: 'back', col });
    else out.push({ kind: 'player' });
  }
  return out;
}

export function moveTargets(s: GameState, row: Row, col: number): { row: Row; col: number }[] {
  if (s.phase !== 'main') return [];
  const me = s.players[s.current];
  if (me.movesLeft <= 0 || !unitAt(me, row, col)) return [];
  const out: { row: Row; col: number }[] = [{ row: row === 'front' ? 'back' : 'front', col }];
  if (col > 0) out.push({ row, col: col - 1 });
  if (col < RULES.boardColumns - 1) out.push({ row, col: col + 1 });
  return out;
}

export function playSlots(s: GameState): { row: Row; col: number }[] {
  if (s.phase !== 'main') return [];
  const me = s.players[s.current];
  if (me.playsLeft <= 0) return [];
  const out: { row: Row; col: number }[] = [];
  for (const row of ['front', 'back'] as Row[]) {
    rowOf(me, row).forEach((u, col) => {
      if (!u) out.push({ row, col });
    });
  }
  return out;
}

export function legalActions(s: GameState): Action[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'coin') return [{ type: 'coin', call: 'cara' }, { type: 'coin', call: 'coroa' }];
  const me = s.players[s.current];
  const out: Action[] = [];
  const slots = playSlots(s);
  const seen = new Set<string>();
  for (const c of me.hand) {
    if (seen.has(c.defId)) continue; // cópias iguais geram as mesmas jogadas
    seen.add(c.defId);
    for (const sl of slots) out.push({ type: 'play', uid: c.uid, row: sl.row, col: sl.col });
  }
  for (const f of cardsOnField(me)) {
    for (const t of moveTargets(s, f.row, f.col)) {
      out.push({ type: 'move', fromRow: f.row, fromCol: f.col, toRow: t.row, toCol: t.col });
    }
  }
  for (let col = 0; col < RULES.boardColumns; col++) {
    for (const t of attackTargets(s, col)) out.push({ type: 'attack', col, target: t });
  }
  out.push({ type: 'end' });
  return out;
}

export function isLegal(s: GameState, a: Action): boolean {
  return legalActions(s).some((b) => sameAction(a, b, s));
}

export function sameAction(a: Action, b: Action, s?: GameState): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'coin':
      return a.call === (b as typeof a).call;
    case 'play': {
      const bb = b as typeof a;
      if (a.row !== bb.row || a.col !== bb.col) return false;
      if (a.uid === bb.uid) return true;
      // mesma carta (cópia) conta como a mesma jogada
      if (!s) return false;
      const hand = s.players[s.current].hand;
      const ca = hand.find((c) => c.uid === a.uid);
      const cb = hand.find((c) => c.uid === bb.uid);
      return !!ca && !!cb && ca.defId === cb.defId;
    }
    case 'move': {
      const bb = b as typeof a;
      return a.fromRow === bb.fromRow && a.fromCol === bb.fromCol && a.toRow === bb.toRow && a.toCol === bb.toCol;
    }
    case 'attack': {
      const bb = b as typeof a;
      if (a.col !== bb.col || a.target.kind !== bb.target.kind) return false;
      if (a.target.kind === 'player') return true;
      const ta = a.target;
      const tb = bb.target as typeof ta;
      return ta.row === tb.row && ta.col === tb.col;
    }
    case 'end':
      return true;
  }
}

// ─── Combate ──────────────────────────────────────────────────────────────

export interface CombatPreview {
  attValue: number;
  defValue: number;
  attBonus: number;
  defBonus: number;
  /** Probabilidade de o atacante vencer (empate = 50% nos dados). */
  pAttWins: number;
  dominant: 'att' | 'def' | null;
}

export function previewCombat(att: CardInst, def: CardInst, defRow: Row): CombatPreview {
  const pa = principleOf(att);
  const pd = principleOf(def);
  const attAdv = beats(pa, pd);
  const defAdv = beats(pd, pa);
  const attValue = activeValue(att, 'front');
  const defValue = activeValue(def, defRow);
  if (PRINCIPLE_MODE === 'dominante' && attAdv !== defAdv) {
    return { attValue, defValue, attBonus: 0, defBonus: 0, pAttWins: attAdv ? 1 : 0, dominant: attAdv ? 'att' : 'def' };
  }
  const attBonus = PRINCIPLE_MODE === 'bonus' && attAdv ? PRINCIPLE_BONUS : 0;
  const defBonus = PRINCIPLE_MODE === 'bonus' && defAdv ? PRINCIPLE_BONUS : 0;
  const a = attValue + attBonus;
  const d = defValue + defBonus;
  return { attValue, defValue, attBonus, defBonus, pAttWins: a > d ? 1 : a < d ? 0 : 0.5, dominant: null };
}

/**
 * `forceTie` serve à IA: resolve um empate sem gastar dados, para calcular
 * os dois desfechos possíveis de forma exata.
 */
function resolveCombat(s: GameState, att: CardInst, def: CardInst, defRow: Row, forceTie?: 'att' | 'def'): CombatInfo {
  const p = previewCombat(att, def, defRow);
  const base = {
    attackerUid: att.uid,
    defenderUid: def.uid,
    attValue: p.attValue,
    defValue: p.defValue,
    attBonus: p.attBonus,
    defBonus: p.defBonus,
    dice: [] as [number, number][],
  };
  if (p.dominant) return { ...base, winner: p.dominant, reason: 'dominante' };
  if (p.pAttWins === 1) return { ...base, winner: 'att', reason: 'valor' };
  if (p.pAttWins === 0) return { ...base, winner: 'def', reason: 'valor' };
  if (forceTie) return { ...base, winner: forceTie, reason: 'dados' };
  // Empate: cada lado rola 1d6; maior vence, empate rola de novo.
  for (let i = 0; i < 20; i++) {
    const a = rollD6(s);
    const d = rollD6(s);
    base.dice.push([a, d]);
    if (a !== d) return { ...base, winner: a > d ? 'att' : 'def', reason: 'dados' };
  }
  return { ...base, winner: rand(s) < 0.5 ? 'att' : 'def', reason: 'dados' };
}

function destroy(s: GameState, owner: PlayerId, row: Row, col: number, events: GameEvent[]) {
  const p = s.players[owner];
  const u = rowOf(p, row)[col];
  if (!u) return;
  rowOf(p, row)[col] = null;
  const toExile = EXILE_ON_DEATH.includes(principleOf(u.card));
  (toExile ? p.exile : p.graveChars).push(u.card);
  events.push({ kind: 'destroy', owner, uid: u.card.uid, row, col, to: toExile ? 'exilio' : 'cemiterio' });
}

// ─── Fluxo de turno ───────────────────────────────────────────────────────

function hasAnything(p: PlayerState): boolean {
  return p.charDeck.length > 0 || p.hand.length > 0 || cardsOnField(p).length > 0;
}

function checkWin(s: GameState, events: GameEvent[]): boolean {
  if (s.phase === 'over') return true;
  const dead = ([0, 1] as PlayerId[]).filter((pid) => s.players[pid].life <= 0 || !hasAnything(s.players[pid]));
  if (dead.length === 0) return false;
  s.phase = 'over';
  s.winner = dead.length === 2 ? 'empate' : other(dead[0]);
  const reason = s.players[dead[0]].life <= 0 ? 'vida zerada' : 'sem personagens';
  events.push({ kind: 'win', winner: s.winner, reason });
  return true;
}

function startTurn(s: GameState, events: GameEvent[]) {
  const me = s.players[s.current];
  me.playsLeft = RULES.playsPerTurn;
  me.movesLeft = RULES.movesPerTurn;
  for (const f of cardsOnField(me)) f.unit.attacked = false;
  events.push({ kind: 'turn', player: s.current, turn: s.turn });
  const skipDraw = RULES.firstTurnNoDraw && s.turn === 1;
  if (!skipDraw && me.charDeck.length > 0) {
    if (me.hand.length >= RULES.maxHand) {
      events.push({ kind: 'handFull', player: s.current });
    } else {
      const c = me.charDeck.pop()!;
      me.hand.push(c);
      events.push({ kind: 'draw', player: s.current, uid: c.uid });
    }
  }
  checkWin(s, events);
}

function endTurn(s: GameState, events: GameEvent[]) {
  if (s.turn >= RULES.maxTurns) {
    const [a, b] = s.players;
    s.phase = 'over';
    s.winner = a.life === b.life ? 'empate' : a.life > b.life ? 0 : 1;
    events.push({ kind: 'win', winner: s.winner, reason: 'limite de turnos' });
    return;
  }
  s.current = other(s.current);
  s.turn++;
  startTurn(s, events);
}

// ─── Aplicar ação ─────────────────────────────────────────────────────────

export interface ApplyOptions {
  /** Só para a IA: decide empates sem rolar dados. */
  forceTie?: 'att' | 'def';
}

/** Aplica a ação no estado (mutando) e devolve os eventos para a interface. */
export function applyAction(s: GameState, a: Action, opts: ApplyOptions = {}): GameEvent[] {
  const events: GameEvent[] = [];
  if (s.phase === 'over') return events;

  if (a.type === 'coin') {
    if (s.phase !== 'coin') throw new Error('A moeda já foi lançada.');
    const result: CoinSide = rand(s) < 0.5 ? 'cara' : 'coroa';
    const starter: PlayerId = result === a.call ? s.current : other(s.current);
    s.starter = starter;
    s.current = starter;
    s.turn = 1;
    s.phase = 'main';
    events.push({ kind: 'coin', call: a.call, result, starter });
    startTurn(s, events);
    return events;
  }

  if (s.phase !== 'main') throw new Error('Ação fora de hora.');
  const pid = s.current;
  const me = s.players[pid];
  const enemyId = other(pid);
  const enemy = s.players[enemyId];

  switch (a.type) {
    case 'play': {
      if (me.playsLeft <= 0) throw new Error('Você já baixou uma carta neste turno.');
      const idx = me.hand.findIndex((c) => c.uid === a.uid);
      if (idx < 0) throw new Error('Carta não está na mão.');
      if (unitAt(me, a.row, a.col)) throw new Error('Casa ocupada.');
      const [card] = me.hand.splice(idx, 1);
      rowOf(me, a.row)[a.col] = { card, enteredTurn: s.turn, attacked: false };
      me.playsLeft--;
      events.push({ kind: 'play', player: pid, uid: card.uid, row: a.row, col: a.col });
      break;
    }
    case 'move': {
      const ok = moveTargets(s, a.fromRow, a.fromCol).some((t) => t.row === a.toRow && t.col === a.toCol);
      if (!ok) throw new Error('Movimento inválido.');
      const u = unitAt(me, a.fromRow, a.fromCol)!;
      const other_ = unitAt(me, a.toRow, a.toCol);
      rowOf(me, a.toRow)[a.toCol] = u;
      rowOf(me, a.fromRow)[a.fromCol] = other_;
      me.movesLeft--;
      events.push({
        kind: 'move', player: pid, uid: u.card.uid, fromRow: a.fromRow, fromCol: a.fromCol,
        toRow: a.toRow, toCol: a.toCol, swappedUid: other_ ? other_.card.uid : null,
      });
      break;
    }
    case 'attack': {
      const targets = attackTargets(s, a.col);
      if (!targets.some((t) => sameAction({ type: 'attack', col: a.col, target: t }, a))) {
        throw new Error('Ataque inválido.');
      }
      const att = me.front[a.col]!;
      att.attacked = true;
      if (a.target.kind === 'player') {
        const dmg = activeValue(att.card, 'front');
        enemy.life -= dmg;
        events.push({
          kind: 'attack', player: pid, col: a.col, target: a.target,
          combat: { attackerUid: att.card.uid, defenderUid: null, attValue: dmg, defValue: 0, attBonus: 0, defBonus: 0, dice: [], winner: 'direct', reason: 'direto' },
        });
        events.push({ kind: 'damage', player: enemyId, amount: dmg, life: enemy.life });
      } else {
        const t = a.target;
        const def = unitAt(enemy, t.row, t.col)!;
        const combat = resolveCombat(s, att.card, def.card, t.row, opts.forceTie);
        events.push({ kind: 'attack', player: pid, col: a.col, target: t, combat });
        if (combat.winner === 'att') destroy(s, enemyId, t.row, t.col, events);
        else destroy(s, pid, 'front', a.col, events);
      }
      break;
    }
    case 'end':
      endTurn(s, events);
      return events;
  }
  checkWin(s, events);
  return events;
}

/** Se a ação é um ataque que pode empatar, devolve true. Usado pela IA. */
export function attackCanTie(s: GameState, a: Action): boolean {
  if (a.type !== 'attack' || a.target.kind !== 'unit') return false;
  const att = s.players[s.current].front[a.col];
  const def = unitAt(s.players[other(s.current)], a.target.row, a.target.col);
  if (!att || !def) return false;
  return previewCombat(att.card, def.card, a.target.row).pAttWins === 0.5;
}
