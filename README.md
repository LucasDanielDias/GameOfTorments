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
| Moeda | Quem acerta cara/coroa ganha a **iniciativa** (distribui e usa truques primeiro). Depois, a iniciativa passa para quem perdeu o último campo. |
| Rodada | Cada jogador recebe 10 personagens e os distribui **virados**: 5 na frontline e 5 na backline. Uma rodada tem 5 turnos, um por campo. |
| 1. Truques | Cada jogador pode usar 1 truque/equipamento (ou passar). |
| 2. Dado | Os dois rolam o d6 (empate rola de novo). Quem tirar mais escolhe um campo livre. |
| 3. Revelação | As frontlines daquele campo são viradas. **Vantagem de princípio vence direto.** Sem vantagem (mesmo princípio), compara ATK × ATK. |
| 4. Backline | Quem está perdendo decide se vira a backline do campo (soma a DEF). Se virar, o vencedor decide se vira a dele. |
| 5. Ponto | Maior total leva 1 ponto. Empate: d6 até desempatar. O campo fica travado até o fim da rodada. |
| 6. Fim do turno | Cada jogador pode trocar de lugar as cartas da backline que ainda estão ocultas. |
| Fim da rodada | Todas as cartas da mesa vão ao cemitério 1 (Realeza vai ao exílio). |
| Vitória | 15 pontos. No máximo 29 turnos (15 + 14). |

Princípios: Engenharia > QG > Infantaria > Engenharia. Realeza vence todos.

### Truques e equipamentos

Não têm ATK, DEF nem princípio. Ficam num deck próprio; depois de usados vão ao cemitério 2.

- **Mapa Confuso** (truque): troca uma frontline oculta sua, de campo ainda livre, pela carta do topo do seu deck.
- **Vara de Pesca** (equipamento): escolhe uma backline oculta do rival; se for personagem, você a rouba para a sua mão.

### Decisões provisórias (ajustáveis em `src/config.ts`)

- Decks de 30 personagens; quando o deck acaba, o cemitério 1 volta embaralhado.
- Truques: 2 na mão no início, +1 por rodada, máximo 3, 1 por turno, antes do dado.
- Frontlines empatadas no ATK: quem escolheu o campo fica "à frente" e o outro decide primeiro se vira.
- Carta roubada pela Vara de Pesca vai para a mão e entra na próxima distribuição.

## Bot de treino (`src/ai`)

- **Fácil**: decisões aleatórias.
- **Médio**: heurísticas (chance de cada carta na frente, defesas fortes guardadas ocultas, só vira quando muda o resultado).
- **Difícil**: Monte Carlo. Sorteia vários mundos possíveis para as cartas ocultas do rival, joga o resto da rodada
  com a política do Médio e escolhe a melhor média. Nunca vê as cartas viradas do oponente.

No simulador: Médio vence Fácil em ~96%; Difícil vence Médio em ~60% mesmo com pouco tempo de pensamento.
Partidas duram em média 26 turnos.

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
