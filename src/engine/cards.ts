import type { Principle } from '../config';

/**
 * Cartas de personagem PROVISÓRIAS — inventadas para testar o jogo.
 * Quando as cartas oficiais chegarem, substitua esta lista.
 *
 * atk  = valor de ATAQUE (vale quando a carta está na frontline)
 * def  = valor de DEFESA (vale quando a carta está na backline)
 * text = descrição (por enquanto só ambientação; efeitos virão depois)
 * art  = chave da ilustração (ver ui/art.ts). Sem arte → emblema do princípio.
 */
export interface CharacterDef {
  id: string;
  name: string;
  principle: Principle;
  atk: number;
  def: number;
  text: string;
  art?: string;
  /** Mecânica de exílio própria: se revelada, vai ao exílio no fim da rodada. */
  exile?: boolean;
}

export const CHARACTERS: CharacterDef[] = [
  // ── Engenharia ─────────────────────────────────────────────
  { id: 'e-sapador', name: 'Sapador das Minas Cinzentas', principle: 'engenharia', atk: 3, def: 4,
    text: 'Cava por baixo das muralhas enquanto os outros discutem por cima delas.' },
  { id: 'e-artifice', name: 'Artífice de Engrenagens', principle: 'engenharia', atk: 2, def: 5,
    text: 'Cada parafuso que aperta é uma promessa de que a linha não cai.' },
  { id: 'e-balista', name: 'Balista Viva', principle: 'engenharia', atk: 5, def: 2,
    text: 'Madeira, corda e um operador que já não sabe onde termina a máquina.' },
  { id: 'e-cerco', name: 'Mestre de Cerco', principle: 'engenharia', atk: 4, def: 4,
    text: 'Mede a muralha com os olhos e calcula quantos dias ela ainda tem.' },
  { id: 'e-alquimista', name: 'Alquimista de Brasa', principle: 'engenharia', atk: 5, def: 3, art: 'alquimista',
    text: 'Carrega o fogo na palma da mão como quem carrega uma ferramenta.' },
  { id: 'e-calculista', name: 'Calculista de Linford', principle: 'engenharia', atk: 3, def: 5, art: 'calculista',
    text: 'Já previu esta batalha três vezes. Perdeu em nenhuma.' },

  // ── Infantaria ─────────────────────────────────────────────
  { id: 'i-lanceiro', name: 'Lanceiro da Fronteira', principle: 'infantaria', atk: 4, def: 3,
    text: 'A lança é mais velha que ele, e a fronteira, mais velha que a lança.' },
  { id: 'i-escudeiro', name: 'Escudeiro de Ferro', principle: 'infantaria', atk: 2, def: 6,
    text: 'Não sabe atacar direito. Ninguém nunca conseguiu passar por ele.' },
  { id: 'i-batedora', name: 'Batedora Rubra', principle: 'infantaria', atk: 5, def: 2, art: 'batedora',
    text: 'Chega antes do aviso e vai embora antes do eco.' },
  { id: 'i-veterano', name: 'Veterano Encurvado', principle: 'infantaria', atk: 4, def: 4, art: 'veterano',
    text: 'Sorri porque já viu campos piores do que este.' },
  { id: 'i-arqueiro', name: 'Arqueiro do Pântano', principle: 'infantaria', atk: 3, def: 4,
    text: 'Atira de onde a névoa é mais densa e o chão, mais traiçoeiro.' },
  { id: 'i-berserker', name: 'Berserker das Tormentas', principle: 'infantaria', atk: 6, def: 1,
    text: 'Corre na direção do trovão. Nunca olhou para trás.' },

  // ── QG ─────────────────────────────────────────────────────
  { id: 'q-capitao', name: 'Capitão de Estandarte', principle: 'qg', atk: 3, def: 5,
    text: 'Enquanto a bandeira estiver de pé, a tropa também estará.' },
  { id: 'q-estrategista', name: 'Estrategista Grisalho', principle: 'qg', atk: 2, def: 6, art: 'estrategista',
    text: 'Move peças num mapa de couro que só ele sabe ler.' },
  { id: 'q-mensageiro', name: 'Mensageiro Veloz', principle: 'qg', atk: 4, def: 2,
    text: 'Leva ordens entre as linhas — e às vezes uma adaga também.' },
  { id: 'q-comandante', name: 'Comandante da Torre', principle: 'qg', atk: 4, def: 4,
    text: 'Do alto da torre, cada soldado é um número que ele se recusa a perder.' },
  { id: 'q-marechal', name: 'Marechal Pele-de-Lobo', principle: 'qg', atk: 5, def: 3, art: 'marechal',
    text: 'O manto foi de um lobo que tentou caçá-lo no inverno errado.' },
  { id: 'q-intendente', name: 'Intendente do Forte', principle: 'qg', atk: 1, def: 7,
    text: 'Sem pão não há exército. Sem ele não há pão.' },

  // ── Realeza ────────────────────────────────────────────────
  { id: 'r-regente', name: 'Regente Sem Coroa', principle: 'realeza', atk: 6, def: 5, art: 'regente',
    text: 'Perdeu o trono, não a autoridade. Quando cai, cai para o exílio.' },
  { id: 'r-princesa', name: 'Princesa da Lua Partida', principle: 'realeza', atk: 5, def: 6,
    text: 'Nasceu na noite em que a lua rachou. Ninguém ousa lembrá-la disso.' },
  { id: 'r-herdeiro', name: 'Herdeiro Bastardo', principle: 'realeza', atk: 4, def: 4,
    text: 'Tem o sangue certo e o nome errado.' },
];

export const CHARACTER_BY_ID: Record<string, CharacterDef> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
);

export function getDef(id: string): CharacterDef {
  const d = CHARACTER_BY_ID[id];
  if (!d) throw new Error(`Carta desconhecida: ${id}`);
  return d;
}

const COMMONS = CHARACTERS.filter((c) => c.principle !== 'realeza').map((c) => c.id);

/**
 * Decks provisórios de 30 personagens: os 18 comuns, mais 10 segundas cópias
 * e 2 Realezas. Uma rodada consome 10 cartas; o cemitério volta ao deck quando acaba.
 */
export const DECKS = {
  vanguarda: {
    name: 'Vanguarda de Runi',
    cards: [
      ...COMMONS,
      'e-sapador', 'e-cerco', 'e-calculista', 'i-lanceiro', 'i-escudeiro', 'i-veterano',
      'q-capitao', 'q-comandante', 'q-marechal', 'q-intendente',
      'r-regente', 'r-herdeiro',
    ],
  },
  tormenta: {
    name: 'Legião das Tormentas',
    cards: [
      ...COMMONS,
      'e-balista', 'e-alquimista', 'e-artifice', 'i-batedora', 'i-berserker', 'i-arqueiro',
      'q-mensageiro', 'q-estrategista', 'q-comandante', 'q-capitao',
      'r-princesa', 'r-herdeiro',
    ],
  },
} as const;

export type DeckKey = keyof typeof DECKS;

// ─── Truques e equipamentos ───────────────────────────────────────────────

export type TrickKind = 'truque' | 'equipamento';

/**
 * Cartas de truque/equipamento: não têm ATK, DEF nem princípio.
 * São colocadas viradas no lugar de uma backline durante a distribuição e
 * disparam o efeito quando o dono as vira no duelo daquele campo.
 * O efeito está implementado em engine/game.ts (triggerTrick).
 */
export interface TrickDef {
  id: string;
  name: string;
  kind: TrickKind;
  text: string;
}

export const TRICKS: TrickDef[] = [
  {
    id: 't-mapa-confuso', name: 'Mapa Confuso', kind: 'truque',
    text: 'Ao ser virado: troque a sua frontline deste campo pela carta do topo do seu deck.',
  },
  {
    id: 't-vara-de-pesca', name: 'Vara de Pesca', kind: 'equipamento',
    text: 'Ao ser virado: se a backline inimiga deste campo for um personagem, você o rouba para a sua mão.',
  },
  {
    id: 't-escudo-de-torre', name: 'Escudo de Torre', kind: 'equipamento',
    text: 'Ao ser virado: sua frontline deste campo ganha +4 de defesa neste duelo.',
  },
  {
    id: 't-lanca-de-cerco', name: 'Lança de Cerco', kind: 'equipamento',
    text: 'Ao ser virado: sua frontline deste campo ganha +3 de ATK neste duelo.',
  },
  {
    id: 't-sabotagem', name: 'Sabotagem', kind: 'truque',
    text: 'Ao ser virado: a backline inimiga deste campo vai para o cemitério sem fazer efeito.',
  },
  {
    id: 't-contra-ordem', name: 'Contra-ordem', kind: 'truque',
    text: 'Ao ser virado: neste duelo, a vantagem de princípio se inverte.',
  },
  {
    id: 't-coroa-falsa', name: 'Coroa Falsa', kind: 'truque',
    text: 'Ao ser virado: neste duelo, sua frontline conta como Realeza.',
  },
  {
    id: 't-tambor-de-guerra', name: 'Tambor de Guerra', kind: 'equipamento',
    text: 'Ao ser virado: neste duelo, sua frontline ganha +2 de ATK e o rival não pode mais virar a backline dele.',
  },
];

export const TRICK_BY_ID: Record<string, TrickDef> = Object.fromEntries(TRICKS.map((c) => [c.id, c]));

export function isTrick(defId: string): boolean {
  return defId in TRICK_BY_ID;
}

export function getTrick(id: string): TrickDef {
  const d = TRICK_BY_ID[id];
  if (!d) throw new Error(`Truque desconhecido: ${id}`);
  return d;
}

/** Deck provisório de truques/equipamentos: 14 cartas. */
export const TRICK_DECK: string[] = [
  't-mapa-confuso', 't-mapa-confuso',
  't-vara-de-pesca', 't-vara-de-pesca',
  't-escudo-de-torre', 't-escudo-de-torre',
  't-lanca-de-cerco', 't-lanca-de-cerco',
  't-sabotagem', 't-sabotagem',
  't-contra-ordem',
  't-coroa-falsa',
  't-tambor-de-guerra', 't-tambor-de-guerra',
];
