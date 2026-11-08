# Game of Torments

Jogo de cartas solo (você × bot de treino), feito em **Vite + TypeScript**, sem framework.
A estética vem do protótipo *Solos de Runi*: papiro, couro, Playfair Display + Lora.

## Rodar

```bash
npm install
npm run dev          # abre em http://localhost:5173
npm test             # regras + IA
npm run build        # build normal em dist/
npm run build:single # um único index.html jogável em dist-single/
npm run sim -- --a dificil --b medio --games 100 --budget 30   # bot × bot
```

## O que já existe

- **Tabuleiro** com 10 casas por lado (5 frontline + 5 backline). À direita da frontline, o deck de
  personagens; à esquerda, o deck de truques/equipamentos; mais à direita, os 2 cemitérios
  (um acima do outro); o exílio fica ao lado da backline direita. O lado do bot é espelhado.
- **Moeda** (cara ou coroa decide quem começa) e **d6** (desempata combates).
- **Cartas de personagem**: ATK no canto superior esquerdo (vale na frontline), DEF no canto superior
  direito (vale na backline), descrição abaixo da imagem e a cor do princípio na moldura.
  Todos os versos são iguais.
- **Princípios**: Engenharia > QG > Infantaria > Engenharia. Realeza vence todos, mas vai para o exílio.
- **Bot de treino** com 3 níveis, botão de dica e explicação das jogadas no registro.

## Regras provisórias (ajustáveis em `src/config.ts`)

| Regra | Valor |
| --- | --- |
| Vida inicial | 20 |
| Mão inicial / máxima | 5 / 8 |
| Cartas baixadas por turno | 1 |
| Movimentos por turno | 1 (front ↔ back na mesma coluna, ou casa vizinha na mesma linha; troca se ocupada) |
| Alcance do ataque | frontline ataca a frente da própria coluna e das vizinhas |
| Backline | só pode ser atacada se a frente da coluna estiver vazia |
| Ataque direto | quando a coluna do rival está toda vazia; dano = ATK |
| Vantagem de princípio | +2 (ou modo `dominante`: vence direto) |
| Empate no combate | cada lado rola 1d6, maior vence |
| Perdedor do combate | cemitério 1 (Realeza → exílio) |
| Quem começa | não compra nem ataca no 1º turno |
| Carta recém-baixada | só ataca no turno seguinte |

O deck de truques/equipamentos e o cemitério 2 já estão na mesa, aguardando as regras.

## Bot de treino (`src/ai`)

- **Fácil**: ações legais aleatórias.
- **Médio**: guloso, escolhe a ação que mais melhora a avaliação imediata (`evaluate.ts`).
- **Difícil**: Monte Carlo com determinização. Sorteia a mão escondida do rival várias vezes,
  simula 2 turnos à frente e escolhe a ação de melhor média. Nunca olha a mão real do oponente.

Resultados atuais do simulador: Médio vence Fácil em ~100% das partidas; Difícil vence Médio em ~65–70%.

## Estrutura

```
src/
  config.ts          regras, princípios e balanceamento
  engine/            estado, ações, combate, RNG com seed (sem DOM)
  ai/                avaliação e bots
  ui/                interface, cartas, áudio sintetizado
  assets/            artes provisórias do protótipo
tests/               vitest
scripts/sim.ts       simulador bot × bot
```

## Trocar as cartas

Edite `src/engine/cards.ts` (`CHARACTERS` e `DECKS`). Para usar uma ilustração, coloque o arquivo em
`src/assets/`, registre em `src/ui/art.ts` e use a chave no campo `art` da carta.
