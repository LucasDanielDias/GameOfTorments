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

/** Começa uma partida e distribui as mãos na ordem em que vieram. */
function placed(seed = 1): GameState {
  const s = newGame({ seed });
  applyAction(s, { type: 'coin', call: 'cara' });
  for (let i = 0; i < 2; i++) applyAction(s, autoPlace(s));
  return s;
}

function autoPlace(s: GameState): Extract<Action, { type: 'place' }> {
  const h = s.players[s.actor].hand;
  return { type: 'place', front: h.slice(0, 5).map((c) => c.uid), back: h.slice(5, 10).map((c) => c.uid) };
}

/** Força cartas específicas num campo (para testar o confronto). */
function setColumn(s: GameState, col: number, f0: string, f1: string, b0?: string, b1?: string) {
  const mk = (defId: string): CardInst => ({ uid: s.nextUid++, defId });
  s.players[0].front[col] = { card: mk(f0), revealed: false };
  s.players[1].front[col] = { card: mk(f1), revealed: false };
  s.players[0].back[col] = b0 ? { card: mk(b0), revealed: false } : null;
  s.players[1].back[col] = b1 ? { card: mk(b1), revealed: false } : null;
}

/** Passa os truques até chegar na escolha de campo. */
function toChoose(s: GameState) {
  while (s.phase === 'trick') applyAction(s, { type: 'pass' });
  expect(s.phase).toBe('choose');
}

function finishSwaps(s: GameState) {
  while (s.phase === 'swap') applyAction(s, { type: 'done' });
}

describe('princípios', () => {
  it('ciclo Engenharia > QG > Infantaria > Engenharia, Realeza vence todos', () => {
    expect(beats('engenharia', 'qg')).toBe(true);
    expect(beats('qg', 'infantaria')).toBe(true);
    expect(beats('infantaria', 'engenharia')).toBe(true);
    for (const p of ['engenharia', 'infantaria', 'qg'] as const) expect(beats('realeza', p)).toBe(true);
  });

  it('vantagem de princípio vence direto, mesmo com ATK menor', () => {
    const c = compareFronts({ uid: 1, defId: 'q-intendente' }, { uid: 2, defId: 'i-berserker' }); // QG 1 × Infantaria 6
    expect(c.leader).toBe(0);
    expect(c.byPrinciple).toBe(true);
  });
});

describe('preparação', () => {
  it('moeda → cada um recebe 10 personagens e 2 truques', () => {
    const s = newGame({ seed: 4 });
    expect(DECKS.vanguarda.cards).toHaveLength(30);
    applyAction(s, { type: 'coin', call: 'coroa' });
    expect(s.phase).toBe('place');
    for (const p of s.players) {
      expect(p.hand).toHaveLength(RULES.charsPerRound);
      expect(p.trickHand).toHaveLength(RULES.trickHandStart);
    }
    expect(s.actor).toBe(s.coinWinner);
  });

  it('distribuição deixa tudo virado para baixo', () => {
    const s = placed(5);
    for (const p of s.players) {
      expect(p.front.every((x) => x && !x.revealed)).toBe(true);
      expect(p.back.every((x) => x && !x.revealed)).toBe(true);
      expect(p.hand).toHaveLength(0);
    }
    expect(['trick', 'choose']).toContain(s.phase);
  });

  it('rejeita distribuição incompleta', () => {
    const s = newGame({ seed: 6 });
    applyAction(s, { type: 'coin', call: 'cara' });
    const h = s.players[s.actor].hand;
    expect(() => applyAction(s, { type: 'place', front: h.slice(0, 5).map((c) => c.uid), back: [null, null, null, null, null] })).toThrow();
  });
});

describe('confronto de um campo', () => {
  it('quem vence no d6 escolhe o campo; as frontlines são reveladas', () => {
    const s = placed(7);
    toChoose(s);
    const chooser = s.actor;
    applyAction(s, { type: 'choose', col: 2 });
    expect(s.players[0].front[2]!.revealed).toBe(true);
    expect(s.players[1].front[2]!.revealed).toBe(true);
    expect(s.columns[2].resolved || s.phase === 'flip').toBe(true);
    void chooser;
  });

  it('vantagem de princípio decide sem perguntar sobre a backline', () => {
    const s = placed(8);
    setColumn(s, 0, 'e-sapador', 'q-intendente', 'i-escudeiro', 'q-estrategista'); // Engenharia > QG
    toChoose(s);
    const before = s.players[0].points;
    applyAction(s, { type: 'choose', col: 0 });
    expect(s.columns[0]).toEqual({ resolved: true, winner: 0 });
    expect(s.players[0].points).toBe(before + 1);
    expect(s.players[0].back[0]!.revealed).toBe(false);
  });

  it('perdedor vira a backline (soma DEF) e o vencedor pode responder', () => {
    const s = placed(9);
    // mesmo princípio: Infantaria 2 × Infantaria 5
    setColumn(s, 1, 'i-escudeiro', 'i-batedora', 'q-intendente', 'i-arqueiro'); // backs: DEF 7 e DEF 4
    toChoose(s);
    applyAction(s, { type: 'choose', col: 1 });
    expect(s.phase).toBe('flip');
    expect(s.actor).toBe(0); // perdedor decide primeiro
    applyAction(s, { type: 'flip', flip: true }); // 2 + 7 = 9 × 5
    expect(s.phase).toBe('flip');
    expect(s.actor).toBe(1); // agora o vencedor decide
    applyAction(s, { type: 'flip', flip: true }); // 5 + 4 = 9 → empate → d6
    expect(s.columns[1].resolved).toBe(true);
  });

  it('se o perdedor não vira, o vencedor nem é perguntado', () => {
    const s = placed(10);
    setColumn(s, 3, 'q-mensageiro', 'q-marechal', 'e-balista', 'q-capitao');
    toChoose(s);
    applyAction(s, { type: 'choose', col: 3 });
    applyAction(s, { type: 'flip', flip: false });
    expect(s.columns[3]).toEqual({ resolved: true, winner: 1 });
    expect(s.players[1].back[3]!.revealed).toBe(false);
  });
});

describe('trocas e fim de rodada', () => {
  it('só backlines ocultas trocam de lugar', () => {
    const s = placed(11);
    setColumn(s, 0, 'i-escudeiro', 'i-batedora', 'q-intendente', 'i-arqueiro');
    toChoose(s);
    applyAction(s, { type: 'choose', col: 0 });
    applyAction(s, { type: 'flip', flip: true });
    if (s.phase === 'flip') applyAction(s, { type: 'flip', flip: false });
    expect(s.phase).toBe('swap');
    const pid = s.actor;
    if (s.players[pid].back[0]!.revealed) {
      expect(() => applyAction(s, { type: 'swap', a: 0, b: 1 })).toThrow();
    }
    const card2 = s.players[pid].back[2]!.card.uid;
    applyAction(s, { type: 'swap', a: 2, b: 4 });
    expect(s.players[pid].back[4]!.card.uid).toBe(card2);
  });

  it('após 5 campos, as cartas vão ao cemitério (Realeza ao exílio) e nova rodada começa', () => {
    const s = placed(12);
    // no último campo livre a escolha é automática
    for (let guard = 0; s.round === 1 && guard < 100; guard++) {
      if (s.phase === 'trick') applyAction(s, { type: 'pass' });
      else if (s.phase === 'choose') applyAction(s, { type: 'choose', col: openColumns(s)[0] });
      else if (s.phase === 'flip') applyAction(s, { type: 'flip', flip: false });
      else finishSwaps(s);
    }
    expect(s.round).toBe(2);
    expect(s.phase).toBe('place');
    const total = (pid: PlayerId) => s.players[pid].graveChars.length + s.players[pid].exile.length;
    expect(total(0)).toBe(10);
    expect(total(1)).toBe(10);
    expect(s.players[0].points + s.players[1].points).toBe(5);
  });
});

describe('truques', () => {
  it('Mapa Confuso troca uma frontline oculta pelo topo do deck', () => {
    const s = placed(13);
    expect(s.phase).toBe('trick');
    const pid = s.actor;
    const p = s.players[pid];
    p.trickHand = [{ uid: 9001, defId: 't-mapa-confuso' }];
    const oldUid = p.front[0]!.card.uid;
    const topUid = p.charDeck[p.charDeck.length - 1].uid;
    applyAction(s, { type: 'trick', uid: 9001, target: { side: pid, row: 'front', col: 0 } });
    expect(p.front[0]!.card.uid).toBe(topUid);
    expect(p.charDeck.some((c) => c.uid === oldUid)).toBe(true);
    expect(p.graveTricks.map((c) => c.uid)).toContain(9001);
  });

  it('Vara de Pesca rouba a backline oculta do rival para a mão', () => {
    const s = placed(14);
    const pid = s.actor;
    const op: PlayerId = pid === 0 ? 1 : 0;
    s.players[pid].trickHand = [{ uid: 9002, defId: 't-vara-de-pesca' }];
    const stolen = s.players[op].back[3]!.card.uid;
    applyAction(s, { type: 'trick', uid: 9002, target: { side: op, row: 'back', col: 3 } });
    expect(s.players[op].back[3]).toBeNull();
    expect(s.players[pid].hand.map((c) => c.uid)).toContain(stolen);
  });
});

describe('informação oculta', () => {
  it('determinizar embaralha só o que o rival esconde', () => {
    const s = placed(15);
    const d = determinize(s, 0, 77);
    expect(d.players[0].front.map((x) => x!.card.uid)).toEqual(s.players[0].front.map((x) => x!.card.uid));
    const all = (st: GameState) =>
      [...st.players[1].charDeck, ...st.players[1].front.map((x) => x!.card), ...st.players[1].back.map((x) => x!.card)].map((c) => c.uid).sort();
    expect(all(d)).toEqual(all(s));
  });
});
