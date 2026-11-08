import { RULES } from '../config';
import { getDef } from '../engine/cards';
import {
  activeValue,
  cardsOnField,
  other,
  previewCombat,
  type CardInst,
  type GameState,
  type PlayerId,
  type PlayerState,
  type Row,
} from '../engine/game';

/**
 * Função de avaliação: quão bom é o estado para `me`.
 * Positivo = vantagem minha. É a "intuição" usada por todos os níveis do bot.
 * Os pesos ficam juntos para facilitar o ajuste depois de rodar `npm run sim`.
 */
export const WEIGHTS = {
  win: 10_000,
  life: 1.3,
  lowLifePanic: 1.5, // peso extra para cada ponto de vida abaixo de 8
  unitBase: 1.0,
  realezaBonus: 1.5,
  hand: 0.9,
  deck: 0.08,
  threatToUnit: 0.55,
  threatToLife: 0.7,
  opportunity: 0.25,
  directPressure: 0.35,
};

export function cardValue(c: CardInst, row: Row): number {
  const d = getDef(c.defId);
  const v = (d.atk + d.def) / 2 + activeValue(c, row) * 0.5;
  return v * WEIGHTS.unitBase + (d.principle === 'realeza' ? WEIGHTS.realezaBonus : 0);
}

function lifeScore(life: number): number {
  const panic = Math.max(0, 8 - life) * WEIGHTS.lowLifePanic;
  return life * WEIGHTS.life - panic;
}

/** Atacantes de `atkSide` que poderiam alcançar a casa (row,col) de `defSide`. */
function reachers(atkSide: PlayerState, defSide: PlayerState, row: Row, col: number): CardInst[] {
  const out: CardInst[] = [];
  if (row === 'back' && defSide.front[col]) return out; // protegido pela frente
  const from = row === 'front' ? col - RULES.attackReach : col;
  const to = row === 'front' ? col + RULES.attackReach : col;
  for (let c = Math.max(0, from); c <= Math.min(RULES.boardColumns - 1, to); c++) {
    const u = atkSide.front[c];
    if (u) out.push(u.card);
  }
  return out;
}

/** Pressão de um lado sobre o outro: perigo a unidades e à vida. */
function pressure(atk: PlayerState, def: PlayerState): { unitThreat: number; lifeThreat: number; opportunities: number } {
  let unitThreat = 0;
  let opportunities = 0;
  for (const f of cardsOnField(def)) {
    const rs = reachers(atk, def, f.row, f.col);
    if (rs.length === 0) continue;
    let best = 0;
    for (const r of rs) best = Math.max(best, previewCombat(r, f.unit.card, f.row).pAttWins);
    unitThreat += best * cardValue(f.unit.card, f.row);
    opportunities += best;
  }
  let lifeThreat = 0;
  for (let c = 0; c < RULES.boardColumns; c++) {
    const u = atk.front[c];
    if (u && !def.front[c] && !def.back[c]) lifeThreat += activeValue(u.card, 'front');
  }
  return { unitThreat, lifeThreat, opportunities };
}

export function evaluate(s: GameState, me: PlayerId): number {
  if (s.phase === 'over') {
    if (s.winner === 'empate') return 0;
    return s.winner === me ? WEIGHTS.win - s.turn : -WEIGHTS.win + s.turn;
  }
  const P = s.players[me];
  const O = s.players[other(me)];
  let score = lifeScore(P.life) - lifeScore(O.life);

  for (const f of cardsOnField(P)) score += cardValue(f.unit.card, f.row);
  for (const f of cardsOnField(O)) score -= cardValue(f.unit.card, f.row);

  score += Math.min(P.hand.length, RULES.maxHand) * WEIGHTS.hand;
  score -= Math.min(O.hand.length, RULES.maxHand) * WEIGHTS.hand;
  score += (P.charDeck.length - O.charDeck.length) * WEIGHTS.deck;

  // Quem joga em seguida transforma ameaça em realidade; pesa mais.
  const nextIsOpp = s.current !== me;
  const theirs = pressure(O, P);
  const mine = pressure(P, O);
  const tf = nextIsOpp ? 1 : 0.6;
  const mf = nextIsOpp ? 0.6 : 1;
  score -= theirs.unitThreat * WEIGHTS.threatToUnit * tf;
  score -= theirs.lifeThreat * WEIGHTS.threatToLife * tf;
  score += mine.unitThreat * WEIGHTS.opportunity * mf;
  score += mine.lifeThreat * WEIGHTS.directPressure * mf;
  return score;
}
