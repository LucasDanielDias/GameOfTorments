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

/** Princípios cujas cartas vão para o exílio (e não para o cemitério). */
export const EXILE_ON_DEATH: Principle[] = ['realeza'];

/**
 * Como o princípio entra no confronto das frontlines:
 *  - 'dominante' → quem tem vantagem vence a coluna direto (regra atual).
 *  - 'bonus'     → quem tem vantagem soma PRINCIPLE_BONUS e os valores decidem.
 */
export const PRINCIPLE_MODE: 'dominante' | 'bonus' = 'dominante';
export const PRINCIPLE_BONUS = 2;

export const RULES = {
  /** Pontos para vencer. Cada campo (coluna) vencido vale 1 ponto. */
  pointsToWin: 15,
  /** Limite de turnos (confrontos): 15 + 14 = 29. */
  maxTurns: 29,
  /** Campos por lado: 5 na frontline + 5 na backline. Uma rodada = 5 turnos. */
  columns: 5,
  /** Personagens distribuídos por rodada (5 front + 5 back). */
  charsPerRound: 10,
  /** (provisório) Quando o deck acaba, o cemitério 1 é embaralhado de volta. */
  reshuffleGraveyard: true,
  /** (provisório) Truques/equipamentos na mão no início, compra por rodada e limite. */
  trickHandStart: 2,
  trickDrawPerRound: 1,
  trickHandMax: 3,
  /** (provisório) Cada jogador pode usar 1 truque/equipamento por turno, antes do dado. */
  tricksPerTurn: 1,
  /** Trocas de backlines ocultas por jogador em cada fim de turno (limite de segurança). */
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
