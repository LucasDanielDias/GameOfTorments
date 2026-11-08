import { describe, expect, it } from 'vitest';
import { RULES } from '../src/config';
import {
  applyAction,
  attackTargets,
  beats,
  cloneState,
  determinize,
  legalActions,
  newGame,
  previewCombat,
  type CardInst,
  type GameState,
  type PlayerId,
} from '../src/engine/game';
import { DECKS } from '../src/engine/cards';

function started(seed = 1): GameState {
  const s = newGame({ seed });
  applyAction(s, { type: 'coin', call: 'cara' });
  return s;
}

/** Coloca uma carta específica direto no campo (para testes de combate). */
function put(s: GameState, pid: PlayerId, defId: string, row: 'front' | 'back', col: number, enteredTurn = -1) {
  const card: CardInst = { uid: s.nextUid++, defId, owner: pid };
  (row === 'front' ? s.players[pid].front : s.players[pid].back)[col] = { card, enteredTurn, attacked: false };
  return card;
}

describe('princípios', () => {
  it('fecha o ciclo Engenharia > QG > Infantaria > Engenharia', () => {
    expect(beats('engenharia', 'qg')).toBe(true);
    expect(beats('qg', 'infantaria')).toBe(true);
    expect(beats('infantaria', 'engenharia')).toBe(true);
    expect(beats('qg', 'engenharia')).toBe(false);
  });
  it('Realeza vence todos', () => {
    for (const p of ['engenharia', 'infantaria', 'qg'] as const) {
      expect(beats('realeza', p)).toBe(true);
      expect(beats(p, 'realeza')).toBe(false);
    }
  });
});

describe('preparação', () => {
  it('cria dois decks de 20, mão inicial e moeda', () => {
    const s = newGame({ seed: 42 });
    expect(DECKS.vanguarda.cards).toHaveLength(20);
    expect(s.phase).toBe('coin');
    for (const p of s.players) {
      expect(p.hand).toHaveLength(RULES.startingHand);
      expect(p.charDeck).toHaveLength(20 - RULES.startingHand);
      expect(p.life).toBe(RULES.startingLife);
    }
    const ev = applyAction(s, { type: 'coin', call: 'cara' });
    expect(ev[0].kind).toBe('coin');
    expect(s.phase).toBe('main');
    expect(s.turn).toBe(1);
  });

  it('é determinístico com a mesma seed', () => {
    const a = started(7);
    const b = started(7);
    expect(a.players[0].hand.map((c) => c.defId)).toEqual(b.players[0].hand.map((c) => c.defId));
    expect(a.current).toBe(b.current);
  });
});

describe('turno', () => {
  it('permite 1 carta por turno e não ataca no turno 1', () => {
    const s = started(3);
    const me = s.players[s.current];
    const c = me.hand[0];
    applyAction(s, { type: 'play', uid: c.uid, row: 'front', col: 2 });
    expect(legalActions(s).filter((a) => a.type === 'play')).toHaveLength(0);
    expect(legalActions(s).filter((a) => a.type === 'attack')).toHaveLength(0);
  });

  it('o segundo jogador compra ao começar', () => {
    const s = started(3);
    const second = s.current === 0 ? 1 : 0;
    const before = s.players[second].hand.length;
    applyAction(s, { type: 'end' });
    expect(s.current).toBe(second);
    expect(s.players[second].hand.length).toBe(before + 1);
  });
});

describe('combate', () => {
  it('front ataca vizinhos; back só se a frente da coluna estiver vazia; jogador se a coluna estiver aberta', () => {
    const s = started(5);
    s.turn = 3;
    const me = s.current;
    const op = me === 0 ? 1 : 0;
    put(s, me, 'i-lanceiro', 'front', 2);
    put(s, op, 'e-sapador', 'front', 1);
    put(s, op, 'q-capitao', 'back', 2);
    const t = attackTargets(s, 2);
    expect(t).toContainEqual({ kind: 'unit', row: 'front', col: 1 });
    expect(t).toContainEqual({ kind: 'unit', row: 'back', col: 2 });
    expect(t).not.toContainEqual({ kind: 'player' });
    s.players[op].back[2] = null;
    expect(attackTargets(s, 2)).toContainEqual({ kind: 'player' });
  });

  it('aplica bônus de princípio e manda o perdedor ao cemitério', () => {
    const s = started(9);
    s.turn = 3;
    const me = s.current;
    const op = me === 0 ? 1 : 0;
    const att = put(s, me, 'i-lanceiro', 'front', 0); // Infantaria 4 (+2) vs Engenharia
    const def = put(s, op, 'e-cerco', 'front', 0); // ATK 4
    const p = previewCombat(att, def, 'front');
    expect(p.attBonus).toBe(2);
    expect(p.pAttWins).toBe(1);
    applyAction(s, { type: 'attack', col: 0, target: { kind: 'unit', row: 'front', col: 0 } });
    expect(s.players[op].front[0]).toBeNull();
    expect(s.players[op].graveChars.map((c) => c.uid)).toContain(def.uid);
  });

  it('defensor na backline usa a DEFESA e pode destruir o atacante', () => {
    const s = started(11);
    s.turn = 3;
    const me = s.current;
    const op = me === 0 ? 1 : 0;
    const att = put(s, me, 'e-balista', 'front', 1); // ATK 5, Engenharia
    put(s, op, 'i-escudeiro', 'back', 1); // DEF 6 +2 (Infantaria > Engenharia)
    applyAction(s, { type: 'attack', col: 1, target: { kind: 'unit', row: 'back', col: 1 } });
    expect(s.players[me].front[1]).toBeNull();
    expect(s.players[me].graveChars.map((c) => c.uid)).toContain(att.uid);
  });

  it('Realeza derrotada vai para o exílio', () => {
    const s = started(13);
    s.turn = 3;
    const me = s.current;
    const op = me === 0 ? 1 : 0;
    put(s, me, 'r-princesa', 'front', 3); // 5 +2
    const king = put(s, op, 'r-herdeiro', 'front', 3); // 4, sem bônus (Realeza x Realeza)
    applyAction(s, { type: 'attack', col: 3, target: { kind: 'unit', row: 'front', col: 3 } });
    expect(s.players[op].exile.map((c) => c.uid)).toContain(king.uid);
    expect(s.players[op].graveChars).toHaveLength(0);
  });

  it('empate é decidido no d6', () => {
    const s = started(17);
    s.turn = 3;
    const me = s.current;
    const op = me === 0 ? 1 : 0;
    put(s, me, 'e-cerco', 'front', 0); // 4
    put(s, op, 'e-sapador', 'back', 0); // DEF 4
    const ev = applyAction(s, { type: 'attack', col: 0, target: { kind: 'unit', row: 'back', col: 0 } });
    const atk = ev.find((e) => e.kind === 'attack');
    expect(atk && atk.kind === 'attack' && atk.combat.dice.length).toBeGreaterThan(0);
  });

  it('ataque direto tira vida e pode encerrar o jogo', () => {
    const s = started(19);
    s.turn = 3;
    const me = s.current;
    const op = me === 0 ? 1 : 0;
    put(s, me, 'i-berserker', 'front', 4);
    s.players[op].life = 5;
    applyAction(s, { type: 'attack', col: 4, target: { kind: 'player' } });
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(me);
  });
});

describe('informação oculta', () => {
  it('determinizar preserva o que é público e o tamanho da mão do rival', () => {
    const s = started(23);
    const d = determinize(s, 0, 99);
    expect(d.players[1].hand).toHaveLength(s.players[1].hand.length);
    expect(d.players[0].hand).toEqual(s.players[0].hand);
    const all = (st: GameState) => [...st.players[1].hand, ...st.players[1].charDeck].map((c) => c.uid).sort();
    expect(all(d)).toEqual(all(s));
  });

  it('clonar não compartilha arrays mutáveis', () => {
    const s = started(29);
    const before = s.players[0].hand.length;
    const c = cloneState(s);
    c.players[0].hand.pop();
    c.players[0].life = 1;
    expect(s.players[0].hand.length).toBe(before);
    expect(s.players[0].life).toBe(RULES.startingLife);
  });
});
