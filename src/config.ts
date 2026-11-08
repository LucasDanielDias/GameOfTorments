/**
 * Game of Torments — regras e balanceamento.
 *
 * Tudo que é ajustável mora aqui. Os itens marcados com (provisório) foram
 * escolhidos para o jogo funcionar e podem mudar quando a regra oficial chegar.
 */

export type Principle = 'engenharia' | 'infantaria' | 'qg' | 'realeza';

export const PRINCIPLES: Principle[] = ['engenharia', 'infantaria', 'qg', 'realeza'];

export const PRINCIPLE_LABEL: Record<Principle, string> = {
  engenharia: 'Engenharia',
  infantaria: 'Infantaria',
  qg: 'QG',
  realeza: 'Realeza',
};

/**
 * Pedra, papel e tesoura dos princípios.
 * Ciclo: Engenharia > QG > Infantaria > Engenharia.
 * Realeza vence todos, mas vai para o EXÍLIO em vez do cemitério.
 * ("Inteligência" foi tratada como Engenharia, único jeito de o ciclo fechar.)
 */
export const PRINCIPLE_BEATS: Record<Principle, Principle[]> = {
  engenharia: ['qg'],
  qg: ['infantaria'],
  infantaria: ['engenharia'],
  realeza: ['engenharia', 'infantaria', 'qg'],
};

/** Princípios cujas cartas, se REVELADAS, vão para o exílio no fim da rodada (ocultas vão ao cemitério). */
export const EXILE_ON_DEATH: Principle[] = ['realeza'];

/**
 * Como o princípio entra no confronto das frontlines:
 *  - 'dominante' → quem tem vantagem vence a coluna direto (regra atual).
 *  - 'bonus'     → quem tem vantagem soma PRINCIPLE_BONUS e os valores decidem.
 */
export const PRINCIPLE_MODE: 'dominante' | 'bonus' = 'dominante';
export const PRINCIPLE_BONUS = 2;

export const RULES = {
  /** Pontos para vencer. Cada RODADA vencida vale 1 ponto. */
  pointsToWin: 15,
  /** Limite de rodadas: 15 + 14 = 29. */
  maxRounds: 29,
  /** Campos por lado: 5 na frontline + 5 na backline. */
  columns: 5,
  /** Duelos vencidos para levar a rodada (maioria de 5). A rodada tem de 3 a 5 duelos. */
  duelsToWinRound: 3,
  /** Personagens na mão a cada distribuição (completa até este número). */
  charsPerRound: 10,
  /** (provisório) Quando o deck acaba, o cemitério 1 é embaralhado de volta. */
  reshuffleGraveyard: true,
  /** (provisório) Truques/equipamentos na mão no início da partida. */
  trickHandStart: 2,
  /** Quem perde no cara ou coroa compra este número de truques a mais no início. */
  coinLoserExtraTricks: 1,
  /** No início de cada rodada, compra 1 truque por duelo perdido na rodada anterior. */
  trickDrawPerDuelLost: 1,
  /** Limite de segurança da mão de truques. */
  trickHandMax: 20,
  /** Trocas de backlines ocultas por jogador em cada fim de duelo (limite de segurança). */
  maxSwapsPerTurn: 10,
};

/** Velocidade do bot na interface (ms entre ações). */
export const BOT_DELAY_MS = 700;

export type Difficulty = 'facil' | 'medio' | 'dificil';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  facil: 'Fácil',
  medio: 'Médio',
  dificil: 'Difícil',
};

/** Orçamento de pensamento do bot difícil. */
export const AI = {
  hardTimeBudgetMs: 350,
  hardMinRollouts: 8,
  placeCandidates: 8,
};
