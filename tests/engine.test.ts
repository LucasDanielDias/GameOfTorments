import { describe, expect, it } from 'vitest';
import { RULES } from '../src/config';
import { DECKS } from '../src/engine/cards';
import {
  applyAction,
  beats,
  compareFronts,
  determinize,
  newGame,
  openColumns,
  type Action,
  type CardInst,
  type GameState,
  type PlayerId,
} from '../src/engine/game';

function autoPlace(s: GameState): Extract<Action, { type: 'place' }> {
  const h = s.players[s.actor].hand;
  return { type: 'place', front: h.slice(0, 5).map((c) => c.uid), back: h.slice(5, 10).map((c) => c.uid) };
}

/** Moeda + as duas distribuições (só personagens). Para no primeiro duelo. */
function placed(seed = 1): GameState {
  const s = newGame({ seed });
  applyAction(s, { type: 'coin', call: 'cara' });
  for (let i = 0; i < 2; i++) applyAction(s, autoPlace(s));
  expect(s.phase).toBe('choose');
  return s;
}

const mk = (s: GameState, defId: string): CardInst => ({ uid: s.nextUid++, defId });

/** Força cartas específicas num campo (para testar o duelo). */
function setColumn(s: GameState, col: number, f0: string, f1: string, b0?: string, b1?: string) {
  s.players[0].front[col] = { card: mk(s, f0), revealed: false };
  s.players[1].front[col] = { card: mk(s, f1), revealed: false };
  s.players[0].back[col] = b0 ? { card: mk(s, b0), revealed: false } : null;
  s.players[1].back[col] = b1 ? { card: mk(s, b1), revealed: false } : null;
}

/** Joga um duelo sem virar nada e sem trocar. */
function quickDuel(s: GameState) {
  if (s.phase === 'choose') applyAction(s, { type: 'choose', col: openColumns(s)[0] });
  while (s.phase === 'flip') applyAction(s, { type: 'flip', flip: false });
  while (s.phase === 'swap') applyAction(s, { type: 'done' });
}

describe('princípios', () => {
  it('ciclo Engenharia > QG > Infantaria > Engenharia; Realeza vence todos', () => {
    expect(beats('engenharia', 'qg')).toBe(true);
    expect(beats('qg', 'infantaria')).toBe(true);
    expect(beats('infantaria', 'engenharia')).toBe(true);
    for (const p of ['engenharia', 'infantaria', 'qg'] as const) expect(beats('realeza', p)).toBe(true);
  });

  it('vantagem de princípio vence direto, mesmo com ATK menor', () => {
    const c = compareFronts({ uid: 1, defId: 'q-intendente' }, { uid: 2, defId: 'i-berserker' });
    expect(c.leader).toBe(0);
    expect(c.byPrinciple).toBe(true);
  });
});

describe('preparação', () => {
  it('quem perde na moeda compra 1 truque a mais', () => {
    const s = newGame({ seed: 4 });
    expect(DECKS.vanguarda.cards).toHaveLength(30);
    applyAction(s, { type: 'coin', call: 'coroa' });
    const w = s.coinWinner!;
    const l: PlayerId = w === 0 ? 1 : 0;
    expect(s.players[w].trickHand).toHaveLength(RULES.trickHandStart);
    expect(s.players[l].trickHand).toHaveLength(RULES.trickHandStart + RULES.coinLoserExtraTricks);
    for (const p of s.players) expect(p.hand).toHaveLength(RULES.charsPerRound);
  });

  it('truques podem ocupar a backline; personagens que sobram ficam na mão', () => {
    const s = newGame({ seed: 5 });
    applyAction(s, { type: 'coin', call: 'cara' });
    const p = s.players[s.actor];
    const h = p.hand;
    const t = p.trickHand[0];
    applyAction(s, {
      type: 'place',
      front: h.slice(0, 5).map((c) => c.uid),
      back: [t.uid, ...h.slice(5, 9).map((c) => c.uid)],
    });
    expect(p.back[0]!.card.uid).toBe(t.uid);
    expect(p.hand).toHaveLength(1);
  });

  it('frontline não aceita truque', () => {
    const s = newGame({ seed: 6 });
    applyAction(s, { type: 'coin', call: 'cara' });
    const p = s.players[s.actor];
    const front = [p.trickHand[0].uid, ...p.hand.slice(0, 4).map((c) => c.uid)];
    expect(() => applyAction(s, { type: 'place', front, back: p.hand.slice(4, 9).map((c) => c.uid) })).toThrow();
  });
});

describe('duelo', () => {
  it('vantagem de princípio: o perdedor ainda pode virar, mas DEF não muda o resultado', () => {
    const s = placed(8);
    setColumn(s, 0, 'e-sapador', 'q-intendente', 'i-escudeiro', 'q-estrategista'); // Engenharia > QG
    applyAction(s, { type: 'choose', col: 0 });
    expect(s.phase).toBe('flip');
    expect(s.actor).toBe(1);
    applyAction(s, { type: 'flip', flip: true });
    applyAction(s, { type: 'flip', flip: false });
    expect(s.columns[0]).toEqual({ resolved: true, winner: 0 });
    expect(s.players[0].duelWins).toBe(1);
  });

  it('perdedor vira (soma DEF) e a pergunta passa para o vencedor', () => {
    const s = placed(9);
    setColumn(s, 1, 'i-escudeiro', 'i-batedora', 'q-intendente', 'i-arqueiro'); // 2 × 5; DEF 7 e 4
    applyAction(s, { type: 'choose', col: 1 });
    expect(s.actor).toBe(0);
    applyAction(s, { type: 'flip', flip: true }); // 9 × 5
    expect(s.actor).toBe(1);
    applyAction(s, { type: 'flip', flip: true }); // 9 × 9 → d6
    expect(s.columns[1].resolved).toBe(true);
  });

  it('Mapa Confuso virado troca a frontline pelo topo do deck', () => {
    const s = placed(10);
    setColumn(s, 2, 'i-escudeiro', 'i-batedora', 't-mapa-confuso', 'i-arqueiro');
    const top = s.players[0].charDeck[s.players[0].charDeck.length - 1];
    applyAction(s, { type: 'choose', col: 2 });
    applyAction(s, { type: 'flip', flip: true });
    expect(s.players[0].front[2]!.card.uid).toBe(top.uid);
    expect(s.players[0].front[2]!.revealed).toBe(true);
  });

  it('Vara de Pesca virada rouba a backline inimiga do campo (e a DEF dela deixa de contar)', () => {
    const s = placed(11);
    setColumn(s, 3, 'i-batedora', 'i-escudeiro', 't-vara-de-pesca', 'q-intendente'); // 5 × 2
    const stolen = s.players[1].back[3]!.card.uid;
    applyAction(s, { type: 'choose', col: 3 });
    expect(s.actor).toBe(1);
    applyAction(s, { type: 'flip', flip: true }); // rival vira Intendente: 2 + 7 = 9 × 5
    expect(s.actor).toBe(0);
    applyAction(s, { type: 'flip', flip: true }); // Vara rouba o Intendente
    expect(s.players[1].back[3]).toBeNull();
    expect(s.players[0].hand.map((c) => c.uid)).toContain(stolen);
    expect(s.columns[3]).toEqual({ resolved: true, winner: 0 });
  });
});

describe('rodada', () => {
  it('termina quando alguém vence 3 duelos; vencedor leva 1 ponto', () => {
    const s = placed(12);
    for (let guard = 0; s.round === 1 && guard < 50; guard++) quickDuel(s);
    expect(s.round).toBe(2);
    const pts = s.players[0].points + s.players[1].points;
    expect(pts).toBe(1);
    expect(s.players[0].duelWins + s.players[1].duelWins).toBe(0);
    expect(s.phase).toBe('place');
  });

  it('Realeza revelada vai ao exílio; Realeza oculta vai ao cemitério', () => {
    const s = placed(13);
    for (let col = 0; col < 5; col++) setColumn(s, col, 'e-sapador', 'q-intendente', 'r-herdeiro', 'r-regente');
    const hiddenRoyal = s.players[1].back[4]!.card.uid;
    applyAction(s, { type: 'choose', col: 0 });
    applyAction(s, { type: 'flip', flip: true }); // bot vira Realeza da backline do campo 1
    applyAction(s, { type: 'flip', flip: false });
    for (let guard = 0; s.round === 1 && guard < 50; guard++) quickDuel(s);
    expect(s.players[1].exile.length).toBe(1);
    expect(s.players[1].graveChars.map((c) => c.uid)).toContain(hiddenRoyal);
  });

  it('só backlines ocultas trocam de lugar', () => {
    const s = placed(14);
    setColumn(s, 0, 'i-escudeiro', 'i-batedora', 'q-intendente', 'i-arqueiro');
    applyAction(s, { type: 'choose', col: 0 });
    applyAction(s, { type: 'flip', flip: true });
    if (s.phase === 'flip') applyAction(s, { type: 'flip', flip: false });
    expect(s.phase).toBe('swap');
    const pid = s.actor;
    if (s.players[pid].back[0]!.revealed) expect(() => applyAction(s, { type: 'swap', a: 0, b: 1 })).toThrow();
    const card2 = s.players[pid].back[2]!.card.uid;
    applyAction(s, { type: 'swap', a: 2, b: 4 });
    expect(s.players[pid].back[4]!.card.uid).toBe(card2);
  });
});

describe('informação oculta', () => {
  it('determinizar preserva o que é público e quantos truques há escondidos', () => {
    const s = newGame({ seed: 15 });
    applyAction(s, { type: 'coin', call: 'cara' });
    for (let i = 0; i < 2; i++) {
      const p = s.players[s.actor];
      applyAction(s, { type: 'place', front: p.hand.slice(0, 5).map((c) => c.uid), back: [p.trickHand[0].uid, ...p.hand.slice(5, 9).map((c) => c.uid)] });
    }
    const d = determinize(s, 0, 77);
    expect(d.players[0].back.map((x) => x!.card.uid)).toEqual(s.players[0].back.map((x) => x!.card.uid));
    const trickCount = (st: GameState) => st.players[1].back.filter((x) => x!.card.defId.startsWith('t-')).length;
    expect(trickCount(d)).toBe(trickCount(s));
    expect(d.players[1].front.every((x) => !x!.card.defId.startsWith('t-'))).toBe(true);
  });
});
