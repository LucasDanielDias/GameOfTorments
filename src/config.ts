/**
 * Game of Torments — regras e balanceamento.
 *
 * Tudo que é "regra provisória" mora aqui, para a gente ir ajustando sem
 * mexer no motor. Quando uma regra oficial chegar, troque o valor/flag.
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
 * Ciclo básico: Engenharia > QG > Infantaria > Engenharia.
 * Realeza vence todos os outros, mas ao ser derrotada vai para o EXÍLIO.
 *
 * Obs.: na explicação original apareceu "Inteligência" no lugar de
 * Engenharia em uma frase. Tratamos como Engenharia porque é o único jeito
 * do ciclo fechar com as 4 cores informadas. Se "Inteligência" for um quinto
 * princípio, é só adicioná-lo aqui.
 */
export const PRINCIPLE_BEATS: Record<Principle, Principle[]> = {
  engenharia: ['qg'],
  qg: ['infantaria'],
  infantaria: ['engenharia'],
  realeza: ['engenharia', 'infantaria', 'qg'],
};

/** Princípios cujas cartas vão para o exílio (e não para o cemitério) ao morrer. */
export const EXILE_ON_DEATH: Principle[] = ['realeza'];

/**
 * Como a vantagem de princípio entra no combate:
 *  - 'bonus'     → quem tem vantagem soma PRINCIPLE_BONUS ao seu valor.
 *  - 'dominante' → quem tem vantagem vence o combate direto (ordem de grandeza).
 */
export const PRINCIPLE_MODE: 'bonus' | 'dominante' = 'bonus';
export const PRINCIPLE_BONUS = 2;

export const RULES = {
  startingLife: 20,
  startingHand: 5,
  maxHand: 8,
  /** Cartas de personagem que podem ser baixadas por turno. */
  playsPerTurn: 1,
  /** Reposicionamentos (front ↔ back ou troca de casa) por turno. */
  movesPerTurn: 1,
  /** Quem começa não compra nem ataca no primeiro turno. */
  firstTurnNoDraw: true,
  firstTurnNoAttack: true,
  /** Carta baixada neste turno ainda não ataca. */
  summoningSickness: true,
  /** Front ataca a coluna da frente e as duas vizinhas. */
  attackReach: 1,
  /** Limite de segurança: após isso, vence quem tiver mais vida. */
  maxTurns: 60,
  boardColumns: 5,
};

/** Velocidade do bot na interface (ms entre ações). */
export const BOT_DELAY_MS = 650;

export type Difficulty = 'facil' | 'medio' | 'dificil';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  facil: 'Fácil',
  medio: 'Médio',
  dificil: 'Difícil',
};

/** Orçamento de pensamento do bot difícil. */
export const AI = {
  hardTimeBudgetMs: 450,
  hardCandidates: 6,
  hardMinRollouts: 6,
  rolloutTurns: 2,
};
