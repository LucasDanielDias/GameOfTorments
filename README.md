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
| Compra | No início de cada rodada, **1 truque/equipamento por duelo perdido na rodada anterior**. |
| Distribuição | Cada jogador coloca cartas **viradas**: 5 personagens na frontline (obrigatório) e, **se quiser**, até 5 na backline, que podem ser **personagens ou truques/equipamentos**. O que não for para a mesa fica na mão. |
| Duelo 1. Dado | Os dois rolam o d6 (empate rola de novo). Quem tirar mais escolhe um campo livre. |
| Duelo 2. Revelação | As frontlines daquele campo são viradas. **Vantagem de princípio vence.** Sem vantagem (mesmo princípio), ATK × ATK. |
| Duelo 3. Backline | Quem está perdendo decide se vira a backline do campo. Personagem soma a DEF; truque/equipamento dispara o efeito. Se virar, o outro decide se vira a dele. |
| Duelo 3b. Troca | Quem virou um personagem pode colocá-lo **na frente** do duelo, se o princípio dele **não vencer** o da frontline rival. A frontline antiga vai para trás e soma a DEF dela. |
| Duelo 4. Resultado | Maior total vence o duelo. Empate: d6 até desempatar. O campo fica travado. |
| Duelo 5. Mover | Cada jogador decide se troca de lugar as backlines ocultas **dos campos que ainda não lutaram** (ou não move nada). Campo disputado fica travado. |
| Rodada | De 3 a 5 duelos: **quem vencer 3 leva a rodada e 1 ponto**. Tudo vai ao cemitério; Realeza **revelada** vai ao exílio (oculta vai ao cemitério). |
| Vitória | 15 pontos (no máximo 29 rodadas). |

Princípios: Engenharia > QG > Infantaria > Engenharia. Realeza vence todos.

### Truques e equipamentos

Não têm ATK, DEF nem princípio. Vão virados na backline durante a distribuição e disparam quando o dono os vira no duelo
daquele campo. No fim da rodada vão ao cemitério 2.

| Carta | Tipo | Efeito ao ser virada |
| --- | --- | --- |
| Mapa Confuso | truque | troca a sua frontline do campo pela carta do topo do seu deck |
| Vara de Pesca | equipamento | se a backline inimiga do campo for personagem, você o rouba para a mão |
| Escudo de Torre | equipamento | +4 de defesa neste duelo |
| Lança de Cerco | equipamento | +3 de ATK neste duelo |
| Sabotagem | truque | a backline inimiga do campo vai ao cemitério sem efeito |
| Contra-ordem | truque | inverte a vantagem de princípio neste duelo |
| Coroa Falsa | truque | sua frontline conta como Realeza neste duelo |
| Tambor de Guerra | equipamento | +2 de ATK e o rival não pode mais virar a backline |

Deck provisório de truques: 14 cartas (2 de cada, 1 Contra-ordem e 1 Coroa Falsa).

### Decisões provisórias (ajustáveis em `src/config.ts`)

- Decks de 30 personagens e 10 truques; quando acabam, o cemitério volta embaralhado.
- Truques: 2 na mão no início da partida (+1 para quem perde a moeda).
- A cada distribuição a mão é completada até 10 personagens; os que sobram ficam para a próxima.
- Frontlines empatadas no ATK: quem escolheu o campo fica "à frente" e o outro decide primeiro se vira.
- Vara de Pesca que encontra um truque: o truque fica revelado e sem efeito.

## Palavras-chave dos personagens

A palavra-chave diz **quando** o efeito acontece; o efeito diz **o que** acontece. Cada carta é só dados em
`src/engine/cards.ts` (`abilities`), e o texto da regra na carta é gerado automaticamente.

| Palavra-chave | Quando |
| --- | --- |
| Revelação | quando a carta é revelada (frontline no duelo ou backline virada) |
| Prêmio de Consolação | se a carta perde o duelo |
| Fraqueza | enquanto o inimigo tem vantagem de princípio sobre você |
| Vigilante | se você foi virado na backline |
| Nostálgico | cresce com as cartas no seu cemitério |
| Bastardo | cresce com as cartas no exílio (dos dois jogadores) |
| Medroso | ativa se for revelado alguém com vantagem de princípio contra ele |

Efeitos disponíveis: `+ATK` / `+DEF` neste duelo, escala por cemitério/exílio, comprar truques ou personagens,
anular a vantagem de princípio no duelo, bônus por princípio até o fim da rodada, voltar para a mão no fim da
rodada e fugir (volta para a mão e o topo do deck entra no lugar).

### Personagens com palavra-chave (provisórios)

| Carta | Princípio | ATK/DEF | Habilidade |
| --- | --- | --- | --- |
| Inventor Distraído | Engenharia | 3/4 | Revelação: compre 1 truque |
| Torre de Vigia Móvel | Engenharia | 2/5 | Vigilante: +3 de defesa neste duelo |
| Mineiro Saudoso | Engenharia | 2/4 | Nostálgico: +1 ATK a cada 3 cartas no cemitério (máx. +4) |
| Aprendiz Assustado | Engenharia | 4/3 | Medroso: foge |
| Sabotador de Pontes | Engenharia | 3/3 | Vigilante: neste duelo não há vantagem de princípio |
| Recruta Teimoso | Infantaria | 3/3 | Fraqueza: neste duelo não há vantagem de princípio |
| Sentinela da Muralha | Infantaria | 2/5 | Vigilante: suas Infantarias ganham +1 DEF nesta rodada |
| Desertor Arrependido | Infantaria | 4/2 | Prêmio de Consolação: volta para a mão no fim da rodada |
| Viúva de Guerra | Infantaria | 3/4 | Nostálgico: +1 ATK a cada 2 cartas no cemitério (máx. +3) |
| Porta-Bandeira Caído | Infantaria | 3/3 | Prêmio de Consolação: suas Infantarias ganham +1 ATK nesta rodada |
| Oficial de Logística | QG | 2/5 | Prêmio de Consolação: compre 2 truques |
| Arauto do Comando | QG | 3/3 | Revelação: +2 ATK neste duelo |
| Tenente Covarde | QG | 5/2 | Medroso: foge |
| Conselheiro Velado | QG | 2/6 | Fraqueza: sem vantagem de princípio e +2 ATK |
| Herdeiro Bastardo | Realeza | 4/4 | Bastardo: +1 ATK por carta no exílio (máx. +4) |
| Rainha-Mãe Exilada | Realeza | 4/5 | Bastardo: +1 DEF por carta no exílio (máx. +4); Revelação: compre 1 truque |

## Interface

- A partida mostra cada passo e **espera terminar** antes de seguir: efeito de truque, placa de madeira com o
  placar de duelos ao fim de cada duelo e tela de fim de rodada com botão "Próxima rodada".
- Marcador de etapas na faixa central (Distribuição → Dado e campo → Backline → Resultado → Mover).
- **Arraste** as cartas da mão para as casas na distribuição e arraste backlines para movê-las (o clique também funciona).
- Passe o mouse sobre uma carta para vê-la numa janela com o que ela faz. No celular, toque na carta.
- O painel lateral (regras, dicas, registro) fica oculto até você clicar em "Painel".

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
