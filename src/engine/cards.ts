import { PRINCIPLE_LABEL, type Principle } from '../config';

// ─── Palavras-chave ───────────────────────────────────────────────────────

/**
 * Palavras-chave dos personagens: dizem QUANDO o efeito acontece.
 * O QUE acontece fica nos efeitos (Effect). Assim uma carta nova é só dados.
 */
export type Keyword = 'revelacao' | 'consolacao' | 'fraqueza' | 'vigilante' | 'nostalgico' | 'bastardo' | 'medroso';

export const KEYWORDS: Record<Keyword, { name: string; rule: string }> = {
  revelacao: { name: 'Revelação', rule: 'Quando a carta é revelada (frontline no duelo ou backline virada).' },
  consolacao: { name: 'Prêmio de Consolação', rule: 'Se a carta perde o duelo.' },
  fraqueza: { name: 'Fraqueza', rule: 'Enquanto o inimigo tem vantagem de princípio sobre você.' },
  vigilante: { name: 'Vigilante', rule: 'Se você foi virado na backline.' },
  nostalgico: { name: 'Nostálgico', rule: 'Fica mais forte conforme as cartas no seu cemitério.' },
  bastardo: { name: 'Bastardo', rule: 'Fica mais forte conforme as cartas no exílio (dos dois jogadores).' },
  medroso: { name: 'Medroso', rule: 'Ativa se for revelado alguém com vantagem de princípio contra ele.' },
};

/**
 * Efeitos disponíveis. "Neste duelo" vale só para o campo em disputa;
 * "nesta rodada" vale até as cartas irem ao cemitério.
 */
export type Effect =
  | { kind: 'atk'; n: number } // +n de ATK para o seu lado neste duelo
  | { kind: 'def'; n: number } // +n de defesa para o seu lado neste duelo
  | { kind: 'scale'; stat: 'atk' | 'def'; source: 'grave' | 'exile'; per: number; max: number } // Nostálgico/Bastardo
  | { kind: 'drawTrick'; n: number } // compra truques/equipamentos
  | { kind: 'drawChar'; n: number } // compra personagens para a mão
  | { kind: 'noPrinciple' } // neste duelo ninguém tem vantagem de princípio
  | { kind: 'teamBuff'; principle: Principle; atk?: number; def?: number } // nesta rodada
  | { kind: 'toHand' } // no fim da rodada volta para a mão em vez do cemitério
  | { kind: 'flee' }; // foge: volta para a mão e a carta do topo do deck entra no lugar

export interface Ability {
  keyword: Keyword;
  effects: Effect[];
}

export function effectText(e: Effect): string {
  switch (e.kind) {
    case 'atk':
      return `+${e.n} de ATK neste duelo`;
    case 'def':
      return `+${e.n} de defesa neste duelo`;
    case 'scale': {
      const where = e.source === 'grave' ? 'no seu cemitério' : 'no exílio';
      const stat = e.stat === 'atk' ? 'ATK' : 'DEF';
      return `+1 de ${stat} para cada ${e.per === 1 ? 'carta' : `${e.per} cartas`} ${where} (máx. +${e.max})`;
    }
    case 'drawTrick':
      return `compre ${e.n} truque${e.n > 1 ? 's' : ''}/equipamento${e.n > 1 ? 's' : ''}`;
    case 'drawChar':
      return `compre ${e.n} personage${e.n > 1 ? 'ns' : 'm'} para a mão`;
    case 'noPrinciple':
      return 'neste duelo não há vantagem de princípio (compara ATK)';
    case 'teamBuff': {
      const parts = [e.atk ? `+${e.atk} de ATK` : '', e.def ? `+${e.def} de DEF` : ''].filter(Boolean).join(' e ');
      return `suas cartas de ${PRINCIPLE_LABEL[e.principle]} ganham ${parts} nesta rodada`;
    }
    case 'toHand':
      return 'no fim da rodada, volta para a sua mão em vez de ir ao cemitério';
    case 'flee':
      return 'foge para a sua mão e a carta do topo do seu deck entra no lugar';
  }
}

export function abilityText(a: Ability): string {
  const body = a.effects.map(effectText).join('; ');
  return `${KEYWORDS[a.keyword].name}: ${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
}

/**
 * Cartas de personagem PROVISÓRIAS — inventadas para testar o jogo.
 * Quando as cartas oficiais chegarem, substitua esta lista.
 *
 * atk  = valor de ATAQUE (vale quando a carta está na frontline)
 * def  = valor de DEFESA (vale quando a carta está na backline)
 * text = ambientação (o efeito vem de `abilities`, que gera o texto da regra)
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
  /** Habilidades com palavra-chave (ver KEYWORDS e Effect). */
  abilities?: Ability[];
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
    text: 'Tem o sangue certo e o nome errado.',
    abilities: [{ keyword: 'bastardo', effects: [{ kind: 'scale', stat: 'atk', source: 'exile', per: 1, max: 4 }] }] },
  { id: 'r-rainha-mae', name: 'Rainha-Mãe Exilada', principle: 'realeza', atk: 4, def: 5,
    text: 'Governou dois reinos. Agora governa um acampamento, e ninguém ousa rir.',
    abilities: [{ keyword: 'bastardo', effects: [{ kind: 'scale', stat: 'def', source: 'exile', per: 1, max: 4 }] },
      { keyword: 'revelacao', effects: [{ kind: 'drawTrick', n: 1 }] }] },

  // ── Personagens com palavras-chave ─────────────────────────
  { id: 'e-inventor', name: 'Inventor Distraído', principle: 'engenharia', atk: 3, def: 4,
    text: 'Esqueceu o que estava construindo, mas trouxe outra coisa no bolso.',
    abilities: [{ keyword: 'revelacao', effects: [{ kind: 'drawTrick', n: 1 }] }] },
  { id: 'e-torre-vigia', name: 'Torre de Vigia Móvel', principle: 'engenharia', atk: 2, def: 5,
    text: 'Rodas de carroça, olhos de coruja.',
    abilities: [{ keyword: 'vigilante', effects: [{ kind: 'def', n: 3 }] }] },
  { id: 'e-mineiro', name: 'Mineiro Saudoso', principle: 'engenharia', atk: 2, def: 4,
    text: 'Cava fundo para lembrar de cada amigo que a montanha levou.',
    abilities: [{ keyword: 'nostalgico', effects: [{ kind: 'scale', stat: 'atk', source: 'grave', per: 3, max: 4 }] }] },
  { id: 'e-medroso', name: 'Aprendiz Assustado', principle: 'engenharia', atk: 4, def: 3,
    text: 'Bom com as mãos. Melhor ainda com as pernas.',
    abilities: [{ keyword: 'medroso', effects: [{ kind: 'flee' }] }] },
  { id: 'i-recruta', name: 'Recruta Teimoso', principle: 'infantaria', atk: 3, def: 3,
    text: 'Ninguém explicou a ele que não podia vencer. Então venceu.',
    abilities: [{ keyword: 'fraqueza', effects: [{ kind: 'noPrinciple' }] }] },
  { id: 'i-sentinela', name: 'Sentinela da Muralha', principle: 'infantaria', atk: 2, def: 5,
    text: 'Quando ela grita, a muralha inteira acorda.',
    abilities: [{ keyword: 'vigilante', effects: [{ kind: 'teamBuff', principle: 'infantaria', def: 1 }] }] },
  { id: 'i-desertor', name: 'Desertor Arrependido', principle: 'infantaria', atk: 4, def: 2,
    text: 'Fugiu uma vez. Volta sempre.',
    abilities: [{ keyword: 'consolacao', effects: [{ kind: 'toHand' }] }] },
  { id: 'i-viuva', name: 'Viúva de Guerra', principle: 'infantaria', atk: 3, def: 4,
    text: 'Carrega o escudo do marido e a raiva dos dois.',
    abilities: [{ keyword: 'nostalgico', effects: [{ kind: 'scale', stat: 'atk', source: 'grave', per: 2, max: 3 }] }] },
  { id: 'q-oficial', name: 'Oficial de Logística', principle: 'qg', atk: 2, def: 5,
    text: 'Perder uma batalha é ruim. Perder a carroça de suprimentos é pior.',
    abilities: [{ keyword: 'consolacao', effects: [{ kind: 'drawTrick', n: 2 }] }] },
  { id: 'q-arauto', name: 'Arauto do Comando', principle: 'qg', atk: 3, def: 3,
    text: 'Chega antes da ordem e grita mais alto que ela.',
    abilities: [{ keyword: 'revelacao', effects: [{ kind: 'atk', n: 2 }] }] },
  { id: 'q-tenente', name: 'Tenente Covarde', principle: 'qg', atk: 5, def: 2,
    text: 'Conhece todas as rotas de fuga do mapa. Desenhou algumas.',
    abilities: [{ keyword: 'medroso', effects: [{ kind: 'flee' }] }] },
  { id: 'q-conselheiro', name: 'Conselheiro Velado', principle: 'qg', atk: 2, def: 6,
    text: 'Fala baixo, e o salão inteiro se cala para ouvir.',
    abilities: [{ keyword: 'fraqueza', effects: [{ kind: 'noPrinciple' }, { kind: 'atk', n: 2 }] }] },
  { id: 'i-porta-bandeira', name: 'Porta-Bandeira Caído', principle: 'infantaria', atk: 3, def: 3,
    text: 'A bandeira caiu com ele. A tropa a levantou.',
    abilities: [{ keyword: 'consolacao', effects: [{ kind: 'teamBuff', principle: 'infantaria', atk: 1 }] }] },
  { id: 'e-sabotador', name: 'Sabotador de Pontes', principle: 'engenharia', atk: 3, def: 3,
    text: 'Constrói pontes de dia. À noite, as desfaz.',
    abilities: [{ keyword: 'vigilante', effects: [{ kind: 'noPrinciple' }] }] },
];

export const CHARACTER_BY_ID: Record<string, CharacterDef> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
);

export function getDef(id: string): CharacterDef {
  const d = CHARACTER_BY_ID[id];
  if (!d) throw new Error(`Carta desconhecida: ${id}`);
  return d;
}

/** Os 18 personagens básicos, sem palavra-chave. */
const COMMONS = CHARACTERS.filter((c) => c.principle !== 'realeza' && !c.abilities).map((c) => c.id);

/**
 * Decks provisórios de 30 personagens: os 18 comuns, 10 com palavras-chave
 * e 2 Realezas. Uma rodada consome 10 cartas; o cemitério volta ao deck quando acaba.
 */
export const DECKS = {
  vanguarda: {
    name: 'Vanguarda de Runi',
    cards: [
      ...COMMONS,
      'e-inventor', 'e-torre-vigia', 'e-mineiro', 'e-sabotador',
      'i-recruta', 'i-sentinela', 'i-porta-bandeira',
      'q-oficial', 'q-arauto', 'q-conselheiro',
      'r-regente', 'r-herdeiro',
    ],
  },
  tormenta: {
    name: 'Legião das Tormentas',
    cards: [
      ...COMMONS,
      'e-medroso', 'e-mineiro', 'e-inventor',
      'i-desertor', 'i-recruta', 'i-viuva', 'i-sentinela',
      'q-tenente', 'q-oficial', 'q-arauto',
      'r-princesa', 'r-rainha-mae',
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
