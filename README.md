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

## Como se joga

| Etapa | O que acontece |
| --- | --- |
| Moeda | Quem acerta cara/coroa ganha a **iniciativa**. Quem erra compra **1 truque a mais** no início. |
| Distribuição | Cada jogador coloca cartas **viradas**: 5 personagens na frontline e 5 cartas na backline, que podem ser **personagens ou truques/equipamentos**. |
| Duelo 1. Dado | Os dois rolam o d6 (empate rola de novo). Quem tirar mais escolhe um campo livre. |
| Duelo 2. Revelação | As frontlines daquele campo são viradas. **Vantagem de princípio vence.** Sem vantagem (mesmo princípio), ATK × ATK. |
| Duelo 3. Backline | Quem está perdendo decide se vira a backline do campo. Personagem soma a DEF; truque/equipamento dispara o efeito. Se virar, o outro decide se vira a dele. |
| Duelo 4. Resultado | Maior total vence o duelo. Empate: d6 até desempatar. O campo fica travado. |
| Duelo 5. Trocas | Cada jogador pode trocar de lugar as cartas da backline que ainda estão ocultas. |
| Rodada | De 3 a 5 duelos: **quem vencer 3 leva a rodada e 1 ponto**. Tudo vai ao cemitério; Realeza **revelada** vai ao exílio (oculta vai ao cemitério). |
| Vitória | 15 pontos (no máximo 29 rodadas). |

Princípios: Engenharia > QG > Infantaria > Engenharia. Realeza vence todos.

### Truques e equipamentos

Não têm ATK, DEF nem princípio. Vão virados na backline durante a distribuição e disparam quando o dono os vira no duelo
daquele campo. No fim da rodada vão ao cemitério 2.

- **Mapa Confuso** (truque): troca a sua frontline do campo pela carta do topo do seu deck.
- **Vara de Pesca** (equipamento): se a backline inimiga do campo for um personagem, você o rouba para a sua mão.

### Decisões provisórias (ajustáveis em `src/config.ts`)

- Decks de 30 personagens e 10 truques; quando acabam, o cemitério volta embaralhado.
- Truques: 2 na mão no início (+1 para quem perde a moeda), +1 por rodada, máximo 4.
- A cada distribuição a mão é completada até 10 personagens; os que sobram ficam para a próxima.
- Frontlines empatadas no ATK: quem escolheu o campo fica "à frente" e o outro decide primeiro se vira.
- Vara de Pesca que encontra um truque: o truque fica revelado e sem efeito.

## Bot de treino (`src/ai`)

- **Fácil**: decisões aleatórias.
- **Médio**: heurísticas (chance de cada carta na frente, defesas fortes guardadas ocultas, só vira quando muda o resultado).
- **Difícil**: Monte Carlo. Sorteia vários mundos possíveis para as cartas ocultas do rival, joga o resto da rodada
  com a política do Médio e escolhe a melhor média. Nunca vê as cartas viradas do oponente.

No simulador: Médio vence Fácil em ~100%; Difícil vence Médio em ~60% mesmo com pouco tempo de pensamento.
Partidas duram em média 25 rodadas.

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
