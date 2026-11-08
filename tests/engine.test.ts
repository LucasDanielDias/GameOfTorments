import { describe, expect, it } from 'vitest';
import { RULES } from '../src/config';
import { DECKS } from '../src/engine/cards';
import {
  applyAction,
  beats,
  compareFronts,
  duelStanding,
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

/** Vira a backline e, se aparecer a troca com a frontline, mantém a frontline. */
function flipKeep(s: GameState) {
  applyAction(s, { type: 'flip', flip: true });
  if (s.phase === 'exchange') applyAction(s, { type: 'exchange', exchange: false });
}

/** Apura o duelo pendente (a interface faz isso depois de mostrar os efeitos). */
function settle(s: GameState) {
  if (s.phase === 'resolve') applyAction(s, { type: 'resolve' });
}

/** Joga um duelo sem virar nada e sem trocar; avança a rodada se ela acabar. */
function quickDuel(s: GameState) {
  if (s.phase === 'choose') applyAction(s, { type: 'choose', col: openColumns(s)[0] });
  while (s.phase === 'flip') applyAction(s, { type: 'flip', flip: false });
  settle(s);
  while (s.phase === 'swap') applyAction(s, { type: 'done' });
  if (s.phase === 'roundOver') applyAction(s, { type: 'next' });
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
    flipKeep(s);
    applyAction(s, { type: 'flip', flip: false });
    expect(s.phase).toBe('resolve'); // a interface mostra tudo antes de apurar
    settle(s);
    expect(s.columns[0]).toEqual({ resolved: true, winner: 0 });
    expect(s.players[0].duelWins).toBe(1);
  });

  it('perdedor vira (soma DEF) e a pergunta passa para o vencedor', () => {
    const s = placed(9);
    setColumn(s, 1, 'i-escudeiro', 'i-batedora', 'q-intendente', 'i-arqueiro'); // 2 × 5; DEF 7 e 4
    applyAction(s, { type: 'choose', col: 1 });
    expect(s.actor).toBe(0);
    flipKeep(s); // 9 × 5
    expect(s.actor).toBe(1);
    flipKeep(s); // 9 × 9 → d6
    settle(s);
    expect(s.columns[1].resolved).toBe(true);
  });

  it('Mapa Confuso virado troca a frontline pelo topo do deck', () => {
    const s = placed(10);
    setColumn(s, 2, 'i-escudeiro', 'i-batedora', 't-mapa-confuso', 'i-arqueiro');
    const top = s.players[0].charDeck[s.players[0].charDeck.length - 1];
    applyAction(s, { type: 'choose', col: 2 });
    flipKeep(s);
    expect(s.players[0].front[2]!.card.uid).toBe(top.uid);
    expect(s.players[0].front[2]!.revealed).toBe(true);
  });

  it('Vara de Pesca virada rouba a backline inimiga do campo (e a DEF dela deixa de contar)', () => {
    const s = placed(11);
    setColumn(s, 3, 'i-batedora', 'i-escudeiro', 't-vara-de-pesca', 'q-intendente'); // 5 × 2
    const stolen = s.players[1].back[3]!.card.uid;
    applyAction(s, { type: 'choose', col: 3 });
    expect(s.actor).toBe(1);
    flipKeep(s); // rival vira Intendente: 2 + 7 = 9 × 5
    expect(s.actor).toBe(0);
    flipKeep(s); // Vara rouba o Intendente
    expect(s.players[1].back[3]).toBeNull();
    expect(s.players[0].hand.map((c) => c.uid)).toContain(stolen);
    settle(s);
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
    flipKeep(s); // bot vira Realeza da backline do campo 1
    applyAction(s, { type: 'flip', flip: false });
    settle(s);
    for (let guard = 0; s.round === 1 && guard < 50; guard++) quickDuel(s);
    expect(s.players[1].exile.length).toBe(1);
    expect(s.players[1].graveChars.map((c) => c.uid)).toContain(hiddenRoyal);
  });

  it('só backlines ocultas de campos que ainda não lutaram trocam de lugar', () => {
    const s = placed(14);
    setColumn(s, 0, 'i-escudeiro', 'i-batedora', 'q-intendente', 'i-arqueiro');
    applyAction(s, { type: 'choose', col: 0 });
    applyAction(s, { type: 'flip', flip: false });
    settle(s);
    expect(s.phase).toBe('swap');
    const pid = s.actor;
    // campo 1 já lutou: não entra nem sai carta da backline dele
    expect(() => applyAction(s, { type: 'swap', a: 0, b: 1 })).toThrow();
    const card2 = s.players[pid].back[2]!.card.uid;
    applyAction(s, { type: 'swap', a: 2, b: 4 });
    expect(s.players[pid].back[4]!.card.uid).toBe(card2);
  });

  it('a rodada decidida espera "next" com a mesa à mostra', () => {
    const s = placed(16);
    for (let guard = 0; s.phase !== 'roundOver' && guard < 50; guard++) {
      if (s.phase === 'choose') applyAction(s, { type: 'choose', col: openColumns(s)[0] });
      while (s.phase === 'flip') applyAction(s, { type: 'flip', flip: false });
      settle(s);
      while (s.phase === 'swap') applyAction(s, { type: 'done' });
    }
    expect(s.phase).toBe('roundOver');
    expect(s.players[0].front.every((x) => x !== null)).toBe(true);
    applyAction(s, { type: 'next' });
    expect(s.round).toBe(2);
  });
});

describe('truques novos', () => {
  function duelWith(seed: number, f0: string, f1: string, b0: string, b1?: string) {
    const s = placed(seed);
    setColumn(s, 2, f0, f1, b0, b1);
    applyAction(s, { type: 'choose', col: 2 });
    return s;
  }

  it('Contra-ordem inverte a vantagem de princípio', () => {
    const s = duelWith(30, 'q-capitao', 'e-sapador', 't-contra-ordem'); // Engenharia > QG
    flipKeep(s);
    settle(s);
    expect(s.columns[2].winner).toBe(0);
  });

  it('Coroa Falsa faz a frontline contar como Realeza', () => {
    const s = duelWith(31, 'i-escudeiro', 'q-capitao', 't-coroa-falsa'); // QG > Infantaria
    flipKeep(s);
    settle(s);
    expect(s.columns[2].winner).toBe(0);
  });

  it('Escudo de Torre soma 4 e Lança de Cerco soma 3', () => {
    const s = duelWith(32, 'i-escudeiro', 'i-lanceiro', 't-escudo-de-torre', 't-lanca-de-cerco'); // 2 × 4
    flipKeep(s); // 6 × 4
    flipKeep(s); // 6 × 7
    settle(s);
    expect(s.columns[2].winner).toBe(1);
  });

  it('Sabotagem manda a backline inimiga ao cemitério', () => {
    const s = duelWith(33, 'i-escudeiro', 'i-lanceiro', 't-sabotagem', 'q-intendente');
    const target = s.players[1].back[2]!.card.uid;
    flipKeep(s);
    expect(s.players[1].back[2]).toBeNull();
    expect(s.players[1].graveChars.map((c) => c.uid)).toContain(target);
  });

  it('Tambor de Guerra impede o rival de virar', () => {
    const s = duelWith(34, 'i-escudeiro', 'i-lanceiro', 't-tambor-de-guerra', 'q-intendente'); // 2+2 × 4
    flipKeep(s);
    expect(s.phase).toBe('resolve');
    settle(s);
    expect(s.players[1].back[2]!.revealed).toBe(false);
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

describe('regras de distribuição e compra', () => {
  it('backline é opcional: posso deixar casas vazias e guardar cartas na mão', () => {
    const s = newGame({ seed: 21 });
    applyAction(s, { type: 'coin', call: 'cara' });
    const p = s.players[s.actor];
    applyAction(s, { type: 'place', front: p.hand.slice(0, 5).map((c) => c.uid), back: [null, null, null, null, null] });
    expect(p.back.every((x) => x === null)).toBe(true);
    expect(p.hand).toHaveLength(5);
  });

  it('compra 1 truque por duelo perdido na rodada anterior', () => {
    const s = placed(22);
    const before = s.players.map((p) => p.trickHand.length); // ninguém usou truques na rodada 1
    const fromAbilities = [0, 0];
    const play = (a: Action) => {
      for (const ev of applyAction(s, a)) if (ev.kind === 'ability' && ev.drawn && isTrickDraw(ev.text)) fromAbilities[ev.player] += ev.drawn;
    };
    for (let guard = 0; s.round === 1 && guard < 80; guard++) {
      if (s.phase === 'choose') play({ type: 'choose', col: openColumns(s)[0] });
      else if (s.phase === 'flip') play({ type: 'flip', flip: false });
      else if (s.phase === 'resolve') play({ type: 'resolve' });
      else if (s.phase === 'swap') play({ type: 'done' });
      else if (s.phase === 'roundOver') play({ type: 'next' });
    }
    for (const pid of [0, 1] as PlayerId[]) {
      const lost = s.players[pid].lastRoundLosses;
      if (s.lastRoundWinner !== pid) expect(lost).toBe(3); // quem perdeu a rodada perdeu 3 duelos
      expect(s.players[pid].trickHand.length).toBe(before[pid] + lost + fromAbilities[pid]);
    }
  });

});

describe('troca backline ↔ frontline', () => {
  it('personagem virado pode ir para a frente e disputa com a DEF', () => {
    const s = placed(40);
    // eu: Escudeiro (Inf, ATK 2) na frente, Berserker (Inf, ATK 6) atrás; rival: Lanceiro (Inf, ATK 4)
    setColumn(s, 1, 'i-escudeiro', 'i-lanceiro', 'i-berserker');
    applyAction(s, { type: 'choose', col: 1 });
    expect(s.actor).toBe(0);
    applyAction(s, { type: 'flip', flip: true });
    expect(s.phase).toBe('exchange');
    applyAction(s, { type: 'exchange', exchange: true });
    expect(getDefName(s.players[0].front[1]!.card)).toBe('i-berserker');
    expect(getDefName(s.players[0].back[1]!.card)).toBe('i-escudeiro');
    settle(s);
    // depois da troca: Berserker disputa com DEF 1 + DEF do Escudeiro 6 = 7 × 4
    expect(s.columns[1].winner).toBe(0);
  });

  it('a troca vale em qualquer situação, mesmo se a backline vencer o rival no princípio', () => {
    const s = placed(41);
    setColumn(s, 2, 'i-batedora', 'i-berserker', 'q-capitao'); // Capitão (QG) vence Infantaria
    applyAction(s, { type: 'choose', col: 2 });
    applyAction(s, { type: 'flip', flip: true });
    expect(s.phase).toBe('exchange');
    applyAction(s, { type: 'exchange', exchange: true });
    settle(s);
    expect(s.columns[2].winner).toBe(0); // agora é QG contra Infantaria
  });

  it('exemplo das regras: QG perde para Engenharia, troca e vence pela defesa', () => {
    const s = placed(42);
    // eu: Capitão (QG 3/5) na frente, Artífice (Engenharia 2/5) atrás; rival: Balista (Engenharia 5/2)
    setColumn(s, 3, 'q-capitao', 'e-balista', 'e-artifice');
    applyAction(s, { type: 'choose', col: 3 });
    applyAction(s, { type: 'flip', flip: true });
    expect(duelStanding(s, 3).byPrinciple).toBe(true); // ainda perdendo pelo princípio
    applyAction(s, { type: 'exchange', exchange: true });
    const st = duelStanding(s, 3);
    expect(st.byPrinciple).toBe(false); // Engenharia × Engenharia
    expect(st.totals).toEqual([10, 5]); // DEF do Artífice 5 + DEF do Capitão 5 × ATK da Balista 5
    settle(s);
    expect(s.columns[3].winner).toBe(0);
  });
});

function getDefName(c: CardInst) {
  return c.defId;
}

function isTrickDraw(text: string) {
  return text.includes('truque');
}

describe('palavras-chave', () => {
  const duel = (seed: number, f0: string, f1: string, b0?: string, b1?: string, col = 0) => {
    const s = placed(seed);
    setColumn(s, col, f0, f1, b0, b1);
    return s;
  };

  it('Revelação: Arauto ganha +2 de ATK ao ser revelado', () => {
    const s = duel(50, 'q-arauto', 'q-comandante'); // QG 3+2 × QG 4
    applyAction(s, { type: 'choose', col: 0 });
    settle(s);
    expect(s.columns[0].winner).toBe(0);
  });

  it('Vigilante: Torre de Vigia virada na backline soma +3 além da DEF', () => {
    const s = duel(51, 'e-artifice', 'e-balista', 'e-torre-vigia'); // 2 × 5; virando: 2 + 5 + 3 = 10
    applyAction(s, { type: 'choose', col: 0 });
    flipKeep(s);
    settle(s);
    expect(s.columns[0].winner).toBe(0);
  });

  it('Medroso: foge para a mão quando o rival tem vantagem e o topo do deck entra', () => {
    const s = duel(52, 'q-tenente', 'e-sapador'); // Engenharia vence QG
    const top = s.players[0].charDeck[s.players[0].charDeck.length - 1];
    const ev = applyAction(s, { type: 'choose', col: 0 });
    expect(ev.some((e) => e.kind === 'ability' && e.keyword === 'medroso')).toBe(true);
    expect(s.players[0].front[0]!.card.uid).toBe(top.uid);
    expect(s.players[0].hand.some((c) => c.defId === 'q-tenente')).toBe(true);
  });

  it('Fraqueza: Recruta Teimoso anula a vantagem de princípio e compara ATK', () => {
    const s = duel(53, 'i-recruta', 'q-mensageiro'); // QG vence Infantaria; 3 × 4 no ATK
    applyAction(s, { type: 'choose', col: 0 });
    const st = duelStanding(s, 0);
    expect(st.byPrinciple).toBe(false);
    expect(st.totals).toEqual([3, 4]);
  });

  it('Prêmio de Consolação: Desertor que perde volta para a mão no fim da rodada', () => {
    const s = duel(54, 'i-desertor', 'q-capitao'); // QG vence Infantaria
    const uid = s.players[0].front[0]!.card.uid;
    applyAction(s, { type: 'choose', col: 0 });
    while (s.phase === 'flip') applyAction(s, { type: 'flip', flip: false });
    settle(s);
    expect(s.players[0].keepers).toContain(uid);
    for (let guard = 0; s.round === 1 && guard < 80; guard++) quickDuel(s);
    expect(s.players[0].graveChars.some((c) => c.uid === uid)).toBe(false);
  });

  it('Nostálgico: Mineiro ganha +1 de ATK a cada 3 cartas no cemitério', () => {
    const s = duel(55, 'e-mineiro', 'e-cerco'); // 2 × 4
    for (let i = 0; i < 9; i++) s.players[0].graveChars.push({ uid: 9000 + i, defId: 'e-sapador' }); // +3
    applyAction(s, { type: 'choose', col: 0 });
    expect(duelStanding(s, 0).totals[0]).toBe(5);
  });

  it('Bastardo: Herdeiro ganha +1 de ATK por carta no exílio', () => {
    const s = duel(56, 'r-herdeiro', 'r-princesa'); // Realeza × Realeza: 4 × 5
    s.players[1].exile.push({ uid: 9100, defId: 'r-regente' }, { uid: 9101, defId: 'r-regente' });
    applyAction(s, { type: 'choose', col: 0 });
    expect(duelStanding(s, 0).totals[0]).toBe(6);
  });
});
