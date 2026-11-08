import {
  BOT_DELAY_MS,
  DIFFICULTY_LABEL,
  PRINCIPLE_BEATS,
  PRINCIPLE_LABEL,
  PRINCIPLE_MODE,
  PRINCIPLE_BONUS,
  RULES,
  type Difficulty,
  type Principle,
} from '../config';
import { createBot, describeAction, heuristicPlace, type Bot, type BotDecision } from '../ai/bot';
import { getDef, getTrick, isTrick } from '../engine/cards';
import {
  applyAction,
  compareFronts,
  findCard,
  newGame,
  openColumns,
  sideTotal,
  swapPairs,
  trickTargets,
  validatePlace,
  type Action,
  type CardInst,
  type CoinSide,
  type GameEvent,
  type GameState,
  type PlayerId,
  type Row,
} from '../engine/game';
import { randomSeed } from '../engine/rng';
import { ICON, dieSvg } from './art';
import { backHtml, cardHtml } from './cardView';
import { loadPrefs, loadStats, savePrefs, saveStats, sleep, sound } from './support';

const ME: PlayerId = 0;
const BOT: PlayerId = 1;
const ROW_PT: Record<Row, string> = { front: 'frontline', back: 'backline' };
const PHASE_PT: Record<GameState['phase'], string> = {
  coin: 'Cara ou coroa',
  place: 'Distribuição',
  trick: 'Truques',
  choose: 'Escolha do campo',
  flip: 'Virar backline?',
  swap: 'Fim do turno',
  over: 'Fim de jogo',
};

type Sel =
  | { kind: 'hand'; uid: number }
  | { kind: 'draft'; row: Row; col: number }
  | { kind: 'trick'; uid: number }
  | { kind: 'swap'; col: number }
  | null;
type PileKind = 'deck' | 'tricks' | 'grave' | 'graveTricks' | 'exile';
type Draft = { front: (number | null)[]; back: (number | null)[] };

interface LogItem {
  cls: string;
  text: string;
}

export class App {
  private s!: GameState;
  private prefs = loadPrefs();
  private stats = loadStats();
  private bot!: Bot;
  private sel: Sel = null;
  private draft: Draft | null = null;
  private busy = false;
  private hint: { d: BotDecision; text: string } | null = null;
  private inspectUid: number | null = null;
  private fx = new Map<number, string>();
  private pulse = new Set<string>();
  private matchId = 0;
  private log: LogItem[] = [];
  private dice: [number, number] = [6, 6];
  private diceText = '';
  private recorded = false;
  private el: Record<string, HTMLElement> = {};

  constructor(private root: HTMLElement) {
    sound.muted = this.prefs.muted;
    this.build();
    this.bind();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.el.table);
    window.addEventListener('resize', () => this.resize());
    const hot = (window as unknown as { claude?: { hot?: { snapshot?: (fn: () => unknown) => void } } }).claude?.hot;
    hot?.snapshot?.(() => ({ s: this.s, log: this.log }));
  }

  // ─── Estrutura ─────────────────────────────────────────────────────────

  private build() {
    this.root.innerHTML = `
    <div class="app" id="app-root">
      <header class="top">
        <div class="brand"><h1>Game of Torments</h1><span>Treino solo · protótipo</span></div>
        <div class="controls">
          <div class="seg" role="group" aria-label="Dificuldade do bot">
            ${(['facil', 'medio', 'dificil'] as Difficulty[]).map((d) => `<button data-diff="${d}">${DIFFICULTY_LABEL[d]}</button>`).join('')}
          </div>
          <button class="btn ghost" data-act="new">Nova partida</button>
          <button class="icon-btn" data-act="mute" id="mute-btn"></button>
        </div>
      </header>
      <main class="layout">
        <section class="table" id="table" aria-label="Mesa">
          <div class="hand opp" id="hand-opp" aria-label="Mão do bot"></div>
          <div class="mat">
            <div class="side opp" id="side-opp" aria-label="Lado do bot"></div>
            <div class="strip">
              <div class="turn-info">
                <div class="turn-no" id="turn-no"></div>
                <div class="turn-who" id="turn-who"></div>
                <div class="clash-line" id="clash-line"></div>
              </div>
              <div class="tokens">
                <div><div class="coin-mini" id="coin-mini"></div><div class="token-label">Moeda</div></div>
                <div class="dice-pair">
                  <div><div class="die" id="die-me"></div><div class="token-label">Você</div></div>
                  <div><div class="die" id="die-bot"></div><div class="token-label">Bot</div></div>
                </div>
              </div>
              <div class="actions" id="actions"></div>
            </div>
            <div class="side me" id="side-me" aria-label="Seu lado"></div>
          </div>
          <div class="dice-readout" id="dice-readout"></div>
          <div class="hand me" id="hand-me" aria-label="Sua mão"></div>
        </section>
        <aside class="panel">
          <div class="box"><h2>Carta</h2><div class="inspector" id="inspector"></div></div>
          <div class="box coach"><h2>Treino</h2><div id="coach"></div>
            <label class="check"><input type="checkbox" id="explain"> Explicar as jogadas do bot no registro</label>
            <label class="check"><input type="checkbox" id="reduce"> Reduzir animações</label>
          </div>
          <div class="box wheel"><h2>Regras</h2>${wheelSvg()}${rulesHtml()}</div>
          <div class="box"><h2>Registro</h2><div class="log" id="log" aria-live="polite"></div></div>
        </aside>
      </main>
      <div id="overlay-root"></div>
      <div class="toast" id="toast" hidden></div>
    </div>`;
    const q = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;
    for (const id of ['app-root', 'table', 'hand-opp', 'hand-me', 'side-opp', 'side-me', 'turn-no', 'turn-who', 'clash-line', 'coin-mini', 'die-me', 'die-bot', 'dice-readout', 'actions', 'inspector', 'coach', 'log', 'overlay-root', 'toast', 'mute-btn']) {
      this.el[id] = q(id);
    }
    (q('explain') as HTMLInputElement).checked = this.prefs.explain;
    (q('reduce') as HTMLInputElement).checked = this.prefs.reduceMotion;
    this.el['app-root'].classList.toggle('reduce-motion', this.prefs.reduceMotion);
  }

  private bind() {
    const r = this.root;
    r.addEventListener('pointerdown', () => sound.unlock());
    r.addEventListener('click', (e) => this.onClick(e));
    r.addEventListener('mouseover', (e) => {
      if (!matchMedia('(hover: hover)').matches) return;
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-uid]');
      if (c && !c.closest('.overlay')) {
        const uid = Number(c.dataset.uid);
        if (uid !== this.inspectUid) {
          this.inspectUid = uid;
          this.renderInspector();
        }
      }
    });
    r.querySelector('#explain')!.addEventListener('change', (e) => {
      this.prefs.explain = (e.target as HTMLInputElement).checked;
      savePrefs(this.prefs);
    });
    r.querySelector('#reduce')!.addEventListener('change', (e) => {
      this.prefs.reduceMotion = (e.target as HTMLInputElement).checked;
      this.el['app-root'].classList.toggle('reduce-motion', this.prefs.reduceMotion);
      savePrefs(this.prefs);
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') {
        if (this.el['overlay-root'].querySelector('[data-dismiss]')) this.closeOverlay();
        this.sel = null;
        this.render();
      } else if (e.key === 'h' || e.key === 'H') this.askHint();
    });
  }

  private resize() {
    const table = this.el.table;
    const narrow = table.clientWidth < 640;
    const gap = narrow ? 3 : 8;
    const pad = narrow ? 6 : 14;
    const availW = table.clientWidth - 2 * pad - 2 - 8 * gap;
    let cw = Math.floor(availW / 9);
    if (window.innerWidth > 980) cw = Math.min(cw, Math.floor((window.innerHeight - 350) / 7.7));
    cw = Math.max(28, Math.min(104, cw));
    this.root.style.setProperty('--cw', `${cw}px`);
    this.root.style.setProperty('--gap', `${gap}px`);
    this.root.style.setProperty('--mat-pad', `${pad}px`);
    this.el['app-root'].classList.toggle('tiny', cw < 62);
  }

  // ─── Partida ───────────────────────────────────────────────────────────

  start(restore?: { s?: GameState; log?: LogItem[] }) {
    if (restore?.s && 'columns' in restore.s) {
      this.s = restore.s;
      this.log = restore.log ?? [];
      this.matchId++;
      this.bot = createBot({ difficulty: this.prefs.difficulty });
      this.recorded = this.s.phase === 'over';
      this.prepareDraft();
      this.render();
      if (this.s.phase === 'coin') this.showCoin();
      else void this.runBots();
      return;
    }
    this.newMatch();
  }

  private newMatch() {
    this.matchId++;
    this.s = newGame({ seed: randomSeed(), names: ['Você', 'Bot de Treino'] });
    this.bot = createBot({ difficulty: this.prefs.difficulty });
    this.sel = null;
    this.draft = null;
    this.hint = null;
    this.inspectUid = null;
    this.log = [];
    this.diceText = '';
    this.recorded = false;
    this.busy = false;
    this.closeOverlay();
    this.pushLog('turn-mark', `Nova partida · bot ${DIFFICULTY_LABEL[this.prefs.difficulty]}`);
    this.render();
    this.showCoin();
  }

  private myMove() {
    return this.s.phase !== 'over' && this.s.phase !== 'coin' && this.s.actor === ME && !this.busy;
  }

  private prepareDraft() {
    if (this.s.phase === 'place' && this.s.actor === ME) {
      if (!this.draft) this.draft = { front: Array(RULES.columns).fill(null), back: Array(RULES.columns).fill(null) };
    } else this.draft = null;
  }

  private async perform(a: Action) {
    this.busy = true;
    this.sel = null;
    this.hint = null;
    const id = this.matchId;
    let events: GameEvent[];
    try {
      events = applyAction(this.s, a);
    } catch (err) {
      this.busy = false;
      this.toast((err as Error).message);
      this.render();
      return;
    }
    await this.animate(events);
    if (id !== this.matchId) return;
    this.logEvents(events);
    this.busy = false;
    this.prepareDraft();
    this.render();
    if (this.s.phase === 'over') this.finish();
  }

  private async act(a: Action) {
    if (!this.myMove()) return;
    await this.perform(a);
    void this.runBots();
  }

  private botRunning = false;
  private async runBots() {
    if (this.botRunning) return;
    this.botRunning = true;
    const id = this.matchId;
    try {
      while (this.s.phase !== 'over' && this.s.phase !== 'coin' && this.s.actor === BOT && id === this.matchId) {
        this.busy = true;
        this.renderStrip();
        await sleep(this.prefs.reduceMotion ? 150 : BOT_DELAY_MS);
        if (id !== this.matchId) return;
        const d = this.bot.decide(this.s);
        if (this.prefs.explain && d.reason && d.action.type !== 'done') {
          const what = d.action.type === 'place' ? 'distribuir as cartas viradas' : describeAction(this.s, d.action);
          this.pushLog('why', `Bot pensou: ${what.charAt(0).toLowerCase()}${what.slice(1)}. ${d.reason}`);
        }
        await this.perform(d.action);
      }
    } finally {
      this.botRunning = false;
      if (id === this.matchId) {
        this.busy = false;
        this.prepareDraft();
        this.render();
      }
    }
  }

  private askHint() {
    if (!this.myMove()) return;
    const helper = createBot({ difficulty: 'dificil', budgetMs: 200 });
    const d = helper.decide(this.s);
    if (d.action.type === 'place') {
      this.draft = { front: d.action.front.slice(), back: d.action.back.slice() };
      this.hint = { d, text: 'Distribuí sua mão como o bot difícil faria. Ajuste o que quiser e confirme' };
    } else {
      this.hint = { d, text: describeAction(this.s, d.action) };
    }
    this.render();
  }

  // ─── Entrada ───────────────────────────────────────────────────────────

  private onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    sound.unlock();

    const actEl = t.closest<HTMLElement>('[data-act]');
    if (actEl) return this.onAct(actEl.dataset.act!, actEl);

    const diff = t.closest<HTMLElement>('[data-diff]')?.dataset.diff as Difficulty | undefined;
    if (diff) {
      this.prefs.difficulty = diff;
      savePrefs(this.prefs);
      this.bot = createBot({ difficulty: diff });
      this.toast(`Bot no nível ${DIFFICULTY_LABEL[diff]}.`);
      this.render();
      return;
    }

    const pile = t.closest<HTMLElement>('[data-pile]');
    if (pile) {
      const [pid, kind] = pile.dataset.pile!.split(':');
      return this.showPile(Number(pid) as PlayerId, kind as PileKind);
    }

    const trickEl = t.closest<HTMLElement>('[data-trick]');
    if (trickEl) {
      const uid = Number(trickEl.dataset.trick);
      this.inspectUid = uid;
      if (this.myMove() && this.s.phase === 'trick') {
        const card = this.s.players[ME].trickHand.find((c) => c.uid === uid)!;
        if (!trickTargets(this.s, ME, card.defId).length) this.toast('Este truque não tem alvo válido agora.');
        else this.sel = this.sel?.kind === 'trick' && this.sel.uid === uid ? null : { kind: 'trick', uid };
      } else if (this.myMove()) this.toast('Truques só na fase de truques, antes do dado.');
      return this.render();
    }

    const handCard = t.closest<HTMLElement>('[data-hand]');
    if (handCard) {
      const uid = Number(handCard.dataset.hand);
      this.inspectUid = uid;
      if (this.myMove() && this.s.phase === 'place') {
        this.sel = this.sel?.kind === 'hand' && this.sel.uid === uid ? null : { kind: 'hand', uid };
      }
      return this.render();
    }

    const slot = t.closest<HTMLElement>('[data-slot]');
    if (slot) {
      const [pidS, row, colS] = slot.dataset.slot!.split(':');
      this.onSlot(Number(pidS) as PlayerId, row as Row, Number(colS));
    }
  }

  private onAct(act: string, el: HTMLElement) {
    switch (act) {
      case 'new':
        if (this.s.phase !== 'over' && this.s.turnTotal > 2) return this.confirmNew();
        return this.newMatch();
      case 'new-confirm':
        return this.newMatch();
      case 'close':
        return this.closeOverlay();
      case 'mute':
        this.prefs.muted = !this.prefs.muted;
        sound.muted = this.prefs.muted;
        savePrefs(this.prefs);
        return this.render();
      case 'hint':
        return this.askHint();
      case 'coin':
        return void this.flipCoin(el.dataset.call as CoinSide);
      case 'auto':
        if (this.draft) {
          const a = heuristicPlace(this.s, ME, { rng: randomSeed() });
          this.draft = { front: a.front.slice(), back: a.back.slice() };
          this.sel = null;
          this.render();
        }
        return;
      case 'clear':
        if (this.draft) this.draft = { front: Array(RULES.columns).fill(null), back: Array(RULES.columns).fill(null) };
        this.sel = null;
        return this.render();
      case 'confirm': {
        if (!this.draft) return;
        const a = { type: 'place' as const, front: this.draft.front as number[], back: this.draft.back };
        const err = this.draft.front.includes(null) ? 'Preencha as 5 casas da frontline.' : validatePlace(this.s, a);
        if (err) return this.toast(err);
        this.draft = null;
        return void this.act(a);
      }
      case 'pass':
        return void this.act({ type: 'pass' });
      case 'flip-yes':
        return void this.act({ type: 'flip', flip: true });
      case 'flip-no':
        return void this.act({ type: 'flip', flip: false });
      case 'done':
        return void this.act({ type: 'done' });
    }
  }

  private onSlot(pid: PlayerId, row: Row, col: number) {
    const s = this.s;
    const slot = s.players[pid][row][col];
    if (slot && (pid === ME || slot.revealed)) this.inspectUid = slot.card.uid;
    if (this.draft && pid === ME) {
      const uid = this.draft[row][col];
      if (uid !== null) this.inspectUid = uid;
    }
    if (!this.myMove()) return this.render();

    switch (s.phase) {
      case 'place': {
        if (pid !== ME || !this.draft) break;
        const here = this.draft[row][col];
        if (this.sel?.kind === 'hand' && here === null) {
          this.draft[row][col] = this.sel.uid;
          this.sel = null;
        } else if (this.sel?.kind === 'draft') {
          const from = this.sel;
          const moving = this.draft[from.row][from.col];
          this.draft[from.row][from.col] = here;
          this.draft[row][col] = moving;
          this.sel = null;
        } else if (here !== null) {
          this.sel = { kind: 'draft', row, col };
        }
        break;
      }
      case 'trick': {
        if (this.sel?.kind !== 'trick') break;
        const card = s.players[ME].trickHand.find((c) => c.uid === (this.sel as { uid: number }).uid)!;
        const ok = trickTargets(s, ME, card.defId).some((t) => t.side === pid && t.row === row && t.col === col);
        if (ok) return void this.act({ type: 'trick', uid: card.uid, target: { side: pid, row, col } });
        this.toast(getTrick(card.defId).target === 'ownHiddenFront' ? 'Escolha uma frontline sua, oculta, em campo livre.' : 'Escolha uma backline oculta do bot.');
        break;
      }
      case 'choose':
        if (openColumns(s).includes(col)) return void this.act({ type: 'choose', col });
        this.toast('Este campo já foi disputado nesta rodada.');
        break;
      case 'swap': {
        if (pid !== ME || row !== 'back') break;
        const sw = swapPairs(s, ME);
        if (this.sel?.kind === 'swap') {
          const a = this.sel.col;
          if (a === col) this.sel = null;
          else if (sw.some(([x, y]) => (x === a && y === col) || (x === col && y === a))) {
            return void this.act({ type: 'swap', a: Math.min(a, col), b: Math.max(a, col) });
          } else this.toast('Só cartas ocultas da backline trocam de lugar.');
        } else if (sw.some(([x, y]) => x === col || y === col)) this.sel = { kind: 'swap', col };
        else this.toast('Esta casa não pode trocar: a carta já foi revelada.');
        break;
      }
    }
    this.render();
  }

  // ─── Animações ─────────────────────────────────────────────────────────

  private q(sel: string) {
    return this.root.querySelector<HTMLElement>(sel);
  }

  private async animate(events: GameEvent[]) {
    const fast = this.prefs.reduceMotion;
    const wait = (ms: number) => sleep(fast ? Math.min(ms, 60) : ms);
    let rerender = false;
    for (const ev of events) {
      switch (ev.kind) {
        case 'roll':
          await this.rollDice(ev.rolls);
          this.diceText = `d6: você ${ev.rolls.at(-1)![0]} × ${ev.rolls.at(-1)![1]} bot${ev.rolls.length > 1 ? ' (após empate)' : ''} · ${ev.chooser === ME ? 'você escolhe o campo' : 'o bot escolhe o campo'}`;
          break;
        case 'reveal':
          ev.uids.forEach((u) => this.fx.set(u, 'flip-in'));
          sound.play('card');
          rerender = true;
          break;
        case 'flip':
          if (ev.flipped && ev.uid) {
            this.fx.set(ev.uid, 'flip-in');
            sound.play('card');
            this.render();
            await wait(500);
          }
          break;
        case 'result':
          if (rerender) {
            this.render();
            rerender = false;
            await wait(700);
          }
          if (ev.dice.length) {
            await this.rollDice(ev.dice);
            this.diceText = `Empate em ${ev.totals[0]}: d6 ${ev.dice.map(([a, b]) => `${a}×${b}`).join(', ')}`;
          }
          sound.play(ev.winner === ME ? 'coin' : 'hit');
          this.pulse.add(`plate:${ev.winner}`);
          break;
        case 'trick':
          sound.play('move');
          if (ev.newUid) this.fx.set(ev.newUid, 'enter');
          if (ev.player === BOT) {
            const name = getTrick(ev.defId).name;
            const stolen = ev.revealedUid ? findCard(this.s, ev.revealedUid) : null;
            this.toast(ev.result === 'roubou' && stolen ? `O bot usou ${name} e roubou ${getDef(stolen.defId).name} da sua backline!` : `O bot usou ${name}.`);
          }
          break;
        case 'swap':
          sound.play('move');
          break;
        case 'roundEnd':
          this.render();
          await wait(500);
          sound.play('break');
          this.pulse.add(`${ME}:grave`).add(`${BOT}:grave`);
          break;
        case 'placed':
          if (ev.player === BOT) sound.play('card');
          break;
        case 'turn':
          if (this.s.actor === ME) sound.play('turn');
          break;
      }
    }
  }

  private async rollDice(rolls: [number, number][]) {
    sound.play('dice');
    const a = this.el['die-me'];
    const b = this.el['die-bot'];
    for (const [x, y] of rolls) {
      if (!this.prefs.reduceMotion) {
        a.classList.add('rolling');
        b.classList.add('rolling');
        for (let i = 0; i < 6; i++) {
          a.innerHTML = dieSvg(1 + Math.floor(Math.random() * 6));
          b.innerHTML = dieSvg(1 + Math.floor(Math.random() * 6));
          await sleep(55);
        }
        a.classList.remove('rolling');
        b.classList.remove('rolling');
      }
      a.innerHTML = dieSvg(x);
      b.innerHTML = dieSvg(y);
      this.dice = [x, y];
      await sleep(this.prefs.reduceMotion ? 40 : 350);
    }
  }

  // ─── Moeda ─────────────────────────────────────────────────────────────

  private showCoin() {
    this.openOverlay(`
      <div class="modal" role="dialog" aria-label="Cara ou coroa">
        <div class="eyebrow">Iniciativa</div>
        <h2>Cara ou coroa</h2>
        <div class="coin3d" id="coin3d"><div class="coin-inner">
          <div class="coin-face">${coinSvg('cara')}</div>
          <div class="coin-face tails">${coinSvg('coroa')}</div>
        </div></div>
        <p id="coin-text">Quem acertar ganha a iniciativa: distribui as cartas e usa truques primeiro. Depois, a cada campo perdido, a iniciativa passa para quem perdeu.</p>
        <div class="row" id="coin-buttons">
          <button class="btn" data-act="coin" data-call="cara">Cara</button>
          <button class="btn" data-act="coin" data-call="coroa">Coroa</button>
        </div>
      </div>`, false);
  }

  private async flipCoin(call: CoinSide) {
    if (this.s.phase !== 'coin' || this.busy) return;
    this.busy = true;
    const id = this.matchId;
    const events = applyAction(this.s, { type: 'coin', call });
    const ev = events.find((e) => e.kind === 'coin') as Extract<GameEvent, { kind: 'coin' }>;
    const coin = this.q('#coin3d')!;
    coin.style.setProperty('--flip-to', ev.result === 'cara' ? '1800deg' : '1980deg');
    coin.classList.add('flipping');
    this.q('#coin-buttons')!.innerHTML = '';
    sound.play('coin');
    await sleep(this.prefs.reduceMotion ? 100 : 1450);
    if (id !== this.matchId) return;
    this.q('#coin-text')!.textContent = `Você pediu ${call}, deu ${ev.result}. ${ev.winner === ME ? 'A iniciativa é sua.' : 'A iniciativa é do bot.'}`;
    this.q('#coin-buttons')!.innerHTML = `<button class="btn" id="coin-go">Para a mesa</button>`;
    this.logEvents(events);
    this.busy = false;
    this.prepareDraft();
    this.render();
    this.q('#coin-go')!.addEventListener('click', () => {
      if (id !== this.matchId) return;
      this.closeOverlay();
      void this.runBots();
    }, { once: true });
  }

  // ─── Fim de jogo e janelas ─────────────────────────────────────────────

  private finish() {
    if (this.recorded) return;
    this.recorded = true;
    const w = this.s.winner;
    const rec = this.stats[this.prefs.difficulty];
    if (w === ME) rec.wins++;
    else if (w === BOT) rec.losses++;
    saveStats(this.stats);
    sound.play(w === ME ? 'win' : 'lose');
    const [me, bot] = this.s.players;
    const title = w === ME ? 'Vitória' : w === BOT ? 'Derrota' : 'Empate';
    this.openOverlay(`
      <div class="modal" role="dialog" aria-label="${title}">
        <div class="eyebrow">Fim da partida · ${this.s.turnTotal} turnos</div>
        <h2>${title}</h2>
        <p>Placar final: você ${me.points} × ${bot.points} bot.
        No nível ${DIFFICULTY_LABEL[this.prefs.difficulty]}: ${rec.wins} vitória(s), ${rec.losses} derrota(s).</p>
        <div class="row">
          <button class="btn" data-act="new-confirm">Jogar de novo</button>
          <button class="btn ghost" data-act="close" data-dismiss>Ver a mesa</button>
        </div>
      </div>`);
  }

  private confirmNew() {
    this.openOverlay(`
      <div class="modal" role="dialog" aria-label="Nova partida">
        <div class="eyebrow">Partida em andamento</div>
        <h2>Começar outra?</h2>
        <p>A partida atual será abandonada e não conta no placar.</p>
        <div class="row">
          <button class="btn" data-act="new-confirm">Começar nova</button>
          <button class="btn ghost" data-act="close" data-dismiss>Continuar jogando</button>
        </div>
      </div>`);
  }

  private showPile(pid: PlayerId, kind: PileKind) {
    const p = this.s.players[pid];
    const owner = pid === ME ? 'Seu' : 'Do bot';
    if (kind === 'deck') return this.toast(`${pid === ME ? 'Seu deck' : 'Deck do bot'} de personagens: ${p.charDeck.length} carta(s).`);
    if (kind === 'tricks') return this.toast(`${pid === ME ? 'Seu deck' : 'Deck do bot'} de truques e equipamentos: ${p.trickDeck.length} carta(s).`);
    const list: CardInst[] = kind === 'grave' ? p.graveChars : kind === 'exile' ? p.exile : p.graveTricks;
    const name = kind === 'grave' ? 'Cemitério de personagens' : kind === 'exile' ? 'Exílio' : 'Cemitério de truques';
    this.openOverlay(`
      <div class="modal" role="dialog" aria-label="${name}">
        <div class="eyebrow">${owner}</div>
        <h2>${name}</h2>
        <div class="pile-grid">${list.length ? list.map((c) => cardHtml(c)).join('') : '<span class="empty">Vazio por enquanto.</span>'}</div>
        <div class="row" style="margin-top:18px"><button class="btn ghost" data-act="close" data-dismiss>Fechar</button></div>
      </div>`);
  }

  private openOverlay(html: string, dismissable = true) {
    const root = this.el['overlay-root'];
    root.innerHTML = `<div class="overlay">${html}</div>`;
    const ov = root.firstElementChild as HTMLElement;
    if (dismissable) ov.addEventListener('click', (e) => { if (e.target === ov) this.closeOverlay(); });
    ov.querySelector<HTMLElement>('button')?.focus();
  }

  private closeOverlay() {
    this.el['overlay-root'].innerHTML = '';
  }

  private toastTimer = 0;
  private toast(msg: string) {
    const t = this.el.toast;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), 2800);
  }

  // ─── Registro ──────────────────────────────────────────────────────────

  private pushLog(cls: string, text: string) {
    this.log.push({ cls, text });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  private logEvents(events: GameEvent[]) {
    const nm = (uid: number | undefined) => {
      const c = uid ? findCard(this.s, uid) : null;
      if (!c) return 'carta';
      return isTrick(c.defId) ? getTrick(c.defId).name : getDef(c.defId).name;
    };
    const who = (p: PlayerId) => (p === ME ? 'Você' : 'O bot');
    const cls = (p: PlayerId) => (p === ME ? 'me' : 'bot');
    for (const ev of events) {
      switch (ev.kind) {
        case 'coin':
          this.pushLog('big', `Moeda: você pediu ${ev.call}, deu ${ev.result}. Iniciativa ${ev.winner === ME ? 'sua' : 'do bot'}.`);
          break;
        case 'round':
          this.pushLog('turn-mark', `Rodada ${ev.round}`);
          break;
        case 'reshuffle':
          this.pushLog(cls(ev.player), `${who(ev.player)} embaralhou ${ev.count} carta(s) do cemitério de volta no deck.`);
          break;
        case 'draw':
          this.pushLog(cls(ev.player), `${who(ev.player)} recebeu ${ev.uids.length} personagem(ns).`);
          break;
        case 'trickDraw':
          this.pushLog(cls(ev.player), `${who(ev.player)} comprou ${ev.uids.length} truque(s)/equipamento(s).`);
          break;
        case 'placed':
          this.pushLog(cls(ev.player), `${who(ev.player)} distribuiu as cartas viradas.`);
          break;
        case 'turn':
          this.pushLog('turn-mark', `Turno ${ev.turn}/5 · confronto ${ev.total} de até ${RULES.maxTurns}`);
          break;
        case 'pass':
          this.pushLog(cls(ev.player), `${who(ev.player)} passou os truques.`);
          break;
        case 'trick': {
          const name = getTrick(ev.defId).name;
          const where = `${ROW_PT[ev.target.row]} ${ev.target.side === ev.player ? 'própria' : 'rival'}, campo ${ev.target.col + 1}`;
          const res = ev.result === 'roubou' ? `: roubou ${nm(ev.revealedUid)}` : ev.result === 'trocou' ? ': carta trocada pelo topo do deck' : ': não era personagem';
          this.pushLog(cls(ev.player), `${who(ev.player)} usou ${name} (${where})${res}.`);
          break;
        }
        case 'roll': {
          const [a, b] = ev.rolls.at(-1)!;
          this.pushLog('', `d6: você ${a} × ${b} bot${ev.rolls.length > 1 ? ' (após empate)' : ''}.`);
          break;
        }
        case 'choose':
          this.pushLog(cls(ev.player), `${who(ev.player)} escolheu o campo ${ev.col + 1}.`);
          break;
        case 'reveal': {
          const [a, b] = ev.uids.map((u) => findCard(this.s, u)!);
          const pa = PRINCIPLE_LABEL[getDef(a.defId).principle];
          const pb = PRINCIPLE_LABEL[getDef(b.defId).principle];
          this.pushLog('', `Revelação: ${getDef(a.defId).name} (${pa}, ATK ${getDef(a.defId).atk}) × ${getDef(b.defId).name} (${pb}, ATK ${getDef(b.defId).atk})${ev.byPrinciple ? ` → vantagem de princípio para ${ev.leader === ME ? 'você' : 'o bot'}` : ''}.`);
          break;
        }
        case 'flip':
          this.pushLog(cls(ev.player), ev.flipped ? `${who(ev.player)} virou a backline: ${nm(ev.uid)} (DEF ${ev.uid ? getDef(findCard(this.s, ev.uid)!.defId).def : '?'}).` : `${who(ev.player)} não virou a backline.`);
          break;
        case 'result': {
          const why = ev.reason === 'principio' ? 'princípio' : ev.reason === 'dados' ? `empate em ${ev.totals[0]}, decidido no d6` : `${ev.totals[0]} × ${ev.totals[1]}`;
          this.pushLog('big', `Campo ${ev.col + 1}: ponto ${ev.winner === ME ? 'seu' : 'do bot'} (${why}).`);
          break;
        }
        case 'point':
          break;
        case 'swap':
          this.pushLog(cls(ev.player), `${who(ev.player)} trocou de lugar as backlines dos campos ${ev.a + 1} e ${ev.b + 1}.`);
          break;
        case 'swapDone':
          break;
        case 'roundEnd':
          this.pushLog('', `Fim da rodada ${ev.round}: todas as cartas da mesa foram ao cemitério${ev.moved.some((m) => m.to === 'exilio') ? ' (Realeza ao exílio)' : ''}.`);
          break;
        case 'win':
          this.pushLog('big', ev.winner === 'empate' ? `Empate (${ev.reason}).` : `${ev.winner === ME ? 'Você venceu' : 'O bot venceu'} (${ev.reason}).`);
          break;
      }
    }
  }

  // ─── Renderização ──────────────────────────────────────────────────────

  render() {
    if (!this.s) return;
    this.renderSides();
    this.renderHands();
    this.renderStrip();
    this.renderInspector();
    this.renderCoach();
    this.renderLog();
    this.root.querySelectorAll<HTMLElement>('[data-diff]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.diff === this.prefs.difficulty)));
    this.el['mute-btn'].innerHTML = this.prefs.muted ? ICON.mute : ICON.sound;
    this.el['mute-btn'].setAttribute('aria-label', this.prefs.muted ? 'Ligar som' : 'Desligar som');
    this.fx.clear();
    this.pulse.clear();
  }

  /** Conjunto de destaques (chaves "pid:row:col") para a fase atual. */
  private highlights() {
    const s = this.s;
    const h = { play: new Set<string>(), choose: new Set<number>(), trick: new Set<string>(), swap: new Set<string>(), hinted: new Set<string>() };
    if (this.myMove()) {
      if (s.phase === 'place' && this.sel?.kind === 'hand' && this.draft) {
        for (const row of ['front', 'back'] as Row[]) this.draft[row].forEach((u, c) => u === null && h.play.add(`${ME}:${row}:${c}`));
      }
      if (s.phase === 'choose') openColumns(s).forEach((c) => h.choose.add(c));
      if (s.phase === 'trick' && this.sel?.kind === 'trick') {
        const card = s.players[ME].trickHand.find((c) => c.uid === (this.sel as { uid: number }).uid);
        if (card) for (const t of trickTargets(s, ME, card.defId)) h.trick.add(`${t.side}:${t.row}:${t.col}`);
      }
      if (s.phase === 'swap') {
        for (const [a, b] of swapPairs(s, ME)) {
          h.swap.add(`${ME}:back:${a}`);
          h.swap.add(`${ME}:back:${b}`);
        }
      }
    }
    if (this.hint && this.myMove()) {
      const a = this.hint.d.action;
      if (a.type === 'choose') ['front', 'back'].forEach((r) => [ME, BOT].forEach((p) => h.hinted.add(`${p}:${r}:${a.col}`)));
      if (a.type === 'trick') {
        h.hinted.add(`trick:${a.uid}`);
        h.hinted.add(`${a.target.side}:${a.target.row}:${a.target.col}`);
      }
      if (a.type === 'swap') {
        h.hinted.add(`${ME}:back:${a.a}`);
        h.hinted.add(`${ME}:back:${a.b}`);
      }
      if (a.type === 'flip') h.hinted.add(a.flip ? 'act:flip-yes' : 'act:flip-no');
      if (a.type === 'pass') h.hinted.add('act:pass');
      if (a.type === 'done') h.hinted.add('act:done');
      if (a.type === 'place') h.hinted.add('act:confirm');
    }
    return h;
  }

  private renderSides() {
    const s = this.s;
    const h = this.highlights();
    const clashCol = s.clash && (s.phase === 'flip' || s.phase === 'swap' || this.busy) ? s.clash.col : -1;
    for (const pid of [ME, BOT] as PlayerId[]) {
      const p = s.players[pid];
      const mine = pid === ME;
      const rowLine: Record<Row, number> = mine ? { front: 1, back: 2 } : { back: 1, front: 2 };
      const cells: string[] = [];
      const at = (col: number, row: number, html: string, span = false) =>
        cells.push(`<div style="grid-column:${col};grid-row:${span ? '1 / span 2' : row};min-width:0">${html}</div>`);

      for (const row of ['front', 'back'] as Row[]) {
        for (let c = 0; c < RULES.columns; c++) {
          const key = `${pid}:${row}:${c}`;
          const colState = s.columns[c];
          const slotCls = ['slot', row];
          if (h.play.has(key)) slotCls.push('can-play');
          if (h.choose.has(c)) slotCls.push('can-choose');
          if (h.trick.has(key)) slotCls.push('target-trick');
          if (h.swap.has(key)) slotCls.push('can-swap');
          if (this.sel?.kind === 'swap' && mine && row === 'back' && this.sel.col === c) slotCls.push('selected');
          if (this.sel?.kind === 'draft' && mine && this.sel.row === row && this.sel.col === c) slotCls.push('selected');
          if (h.hinted.has(key)) slotCls.push('hinted');
          if (colState?.resolved) slotCls.push('locked');
          if (c === clashCol) slotCls.push('clash');

          let inner = `<span class="slot-label">${row === 'front' ? 'Front' : 'Back'}<br>${c + 1}</span>`;
          const draftUid = mine && this.draft ? this.draft[row][c] : null;
          if (draftUid !== null) {
            const card = s.players[ME].hand.find((x) => x.uid === draftUid);
            if (card) inner = cardHtml(card, { row, cls: ['concealed'], badge: ICON.eyeOff });
          } else {
            const x = p[row][c];
            if (x) {
              const cls: string[] = [];
              const fx = this.fx.get(x.card.uid);
              if (fx) cls.push(fx);
              if (x.revealed) inner = cardHtml(x.card, { row, cls });
              else if (mine) inner = cardHtml(x.card, { row, cls: [...cls, 'concealed'], badge: ICON.eyeOff });
              else inner = backHtml(cls.join(' '));
            }
          }
          let mark = '';
          if (row === 'front' && colState?.resolved) {
            mark = `<span class="col-mark ${colState.winner === pid ? 'won' : 'lost'}">${colState.winner === pid ? '+1' : ''}</span>`;
          }
          at(3 + c, rowLine[row], `<div class="${slotCls.join(' ')}" data-slot="${pid}:${row}:${c}" aria-label="${ROW_PT[row]} ${c + 1}">${inner}${mark}</div>`);
        }
      }

      const plate = this.plateHtml(pid);
      if (mine) {
        at(1, 1, plate, true);
        at(2, 1, this.pileHtml(pid, 'tricks'));
        at(8, 1, this.pileHtml(pid, 'deck'));
        at(8, 2, this.pileHtml(pid, 'exile'));
        at(9, 1, this.pileHtml(pid, 'grave'));
        at(9, 2, this.pileHtml(pid, 'graveTricks'));
      } else {
        at(1, 1, this.pileHtml(pid, 'graveTricks'));
        at(1, 2, this.pileHtml(pid, 'grave'));
        at(2, 1, this.pileHtml(pid, 'exile'));
        at(2, 2, this.pileHtml(pid, 'deck'));
        at(8, 2, this.pileHtml(pid, 'tricks'));
        at(9, 1, plate, true);
      }
      this.el[mine ? 'side-me' : 'side-opp'].innerHTML = cells.join('');
    }
  }

  private plateHtml(pid: PlayerId) {
    const p = this.s.players[pid];
    const pct = Math.min(100, (p.points / RULES.pointsToWin) * 100);
    const cls = ['plate'];
    if (this.pulse.has(`plate:${pid}`)) cls.push('scored');
    return `<div class="${cls.join(' ')}" data-plate="${pid}" style="height:100%">
      <div class="who">${pid === ME ? 'Você' : 'Bot'}</div>
      <div class="life">${p.points}</div>
      <div class="life-label">de ${RULES.pointsToWin} pts</div>
      <div class="life-bar"><i style="width:${pct}%"></i></div>
      <div class="meta">Truques ${p.trickHand.length}<br>Deck ${p.charDeck.length}</div>
    </div>`;
  }

  private pileHtml(pid: PlayerId, kind: PileKind) {
    const p = this.s.players[pid];
    const pulse = this.pulse.has(`${pid}:${kind}`) ? ' pulse' : '';
    const backs = (n: number) => Array.from({ length: Math.min(3, n) }, () => backHtml()).join('');
    switch (kind) {
      case 'deck':
        return `<button class="pile stack${pulse}" data-pile="${pid}:deck" aria-label="Deck de personagens: ${p.charDeck.length}">${backs(p.charDeck.length)}<span class="count">${p.charDeck.length}</span><span class="pile-name">Personagens</span></button>`;
      case 'tricks':
        return `<button class="pile stack" data-pile="${pid}:tricks" aria-label="Deck de truques e equipamentos: ${p.trickDeck.length}">${backs(p.trickDeck.length)}<span class="count">${p.trickDeck.length}</span><span class="pile-name">Truques</span></button>`;
      default: {
        const list = kind === 'grave' ? p.graveChars : kind === 'exile' ? p.exile : p.graveTricks;
        const top = list[list.length - 1];
        const label = kind === 'grave' ? 'Cemitério 1' : kind === 'exile' ? 'Exílio' : 'Cemitério 2';
        const inner = top ? cardHtml(top, { cls: ['spent'] }) + `<span class="pile-name">${label}</span>` : `<span class="slot-label">${label}</span>`;
        return `<button class="pile${kind === 'exile' ? ' exile' : ''}${pulse}" data-pile="${pid}:${kind}" aria-label="${label}: ${list.length}">${inner}${list.length ? `<span class="count">${list.length}</span>` : ''}</button>`;
      }
    }
  }

  private renderHands() {
    const s = this.s;
    const h = this.highlights();
    const me = s.players[ME];
    const inDraft = new Set(this.draft ? [...this.draft.front, ...this.draft.back].filter((x): x is number => x !== null) : []);
    const chars = me.hand.filter((c) => !inDraft.has(c.uid));
    const handMe = this.el['hand-me'];
    handMe.classList.toggle('locked', !this.myMove());
    const charHtml = chars
      .map((c) => {
        const cls: string[] = [];
        if (this.sel?.kind === 'hand' && this.sel.uid === c.uid) cls.push('selected');
        return cardHtml(c, { cls, attrs: `data-hand="${c.uid}" tabindex="0" role="button"` });
      })
      .join('');
    const trickHtml = me.trickHand
      .map((c) => {
        const cls: string[] = [];
        if (this.sel?.kind === 'trick' && this.sel.uid === c.uid) cls.push('selected');
        if (h.hinted.has(`trick:${c.uid}`)) cls.push('hinted');
        if (this.myMove() && s.phase === 'trick' && trickTargets(s, ME, c.defId).length) cls.push('usable');
        return cardHtml(c, { cls, attrs: `data-trick="${c.uid}" tabindex="0" role="button"` });
      })
      .join('');
    const charLabel = s.phase === 'place' && s.actor === ME ? 'Personagens para distribuir' : 'Personagens na mão';
    handMe.innerHTML = `
      <div class="hand-group"><div class="hand-label">${charLabel}</div><div class="hand-cards">${charHtml || '<span class="hand-empty">—</span>'}</div></div>
      <div class="hand-group tricks"><div class="hand-label">Truques e equipamentos</div><div class="hand-cards">${trickHtml || '<span class="hand-empty">—</span>'}</div></div>`;
    const opp = s.players[BOT];
    this.el['hand-opp'].innerHTML = `${opp.hand.map(() => backHtml()).join('')}${opp.trickHand.map(() => backHtml('trick-back')).join('')}<span class="opp-hand-note">Bot: ${opp.hand.length} personagem(ns), ${opp.trickHand.length} truque(s) na mão</span>`;
  }

  private renderStrip() {
    const s = this.s;
    this.el['turn-no'].textContent =
      s.phase === 'coin' ? 'Preparação' : `Rodada ${s.round} · Turno ${Math.max(1, s.turnInRound)}/5 · Confronto ${Math.max(1, s.turnTotal)} de até ${RULES.maxTurns}`;
    const who = this.el['turn-who'];
    who.classList.remove('thinking');
    if (s.phase === 'over') who.textContent = s.winner === ME ? 'Vitória' : s.winner === BOT ? 'Derrota' : 'Empate';
    else if (s.phase === 'coin') who.textContent = 'Cara ou coroa';
    else if (s.actor === BOT) {
      who.textContent = `${PHASE_PT[s.phase]} · bot pensando`;
      who.classList.add('thinking');
    } else who.textContent = `${PHASE_PT[s.phase]} · sua vez`;

    // linha do confronto atual
    let clash = '';
    if (s.clash) {
      const c = s.clash.col;
      const f0 = s.players[ME].front[c];
      const f1 = s.players[BOT].front[c];
      if (f0?.revealed && f1?.revealed) {
        const cmp = compareFronts(f0.card, f1.card);
        if (cmp.byPrinciple) clash = `Campo ${c + 1}: vantagem de princípio para ${cmp.leader === ME ? 'você' : 'o bot'}`;
        else clash = `Campo ${c + 1}: você ${sideTotal(s, ME, c)} × ${sideTotal(s, BOT, c)} bot`;
      }
    }
    this.el['clash-line'].textContent = clash;

    this.el['coin-mini'].innerHTML = coinSvg(s.coinWinner === null || s.coinWinner === ME ? 'cara' : 'coroa');
    this.el['coin-mini'].title = s.coinWinner === null ? 'A moeda decide a iniciativa' : `Iniciativa agora: ${s.initiative === ME ? 'você' : 'bot'}`;
    if (!this.el['die-me'].classList.contains('rolling')) {
      this.el['die-me'].innerHTML = dieSvg(this.dice[0]);
      this.el['die-bot'].innerHTML = dieSvg(this.dice[1]);
    }
    this.el['dice-readout'].textContent = this.diceText;
    this.el.actions.innerHTML = this.actionButtons();
  }

  private actionButtons(): string {
    const s = this.s;
    const h = this.highlights();
    const hc = (k: string) => (h.hinted.has(`act:${k}`) ? ' hinted' : '');
    if (!this.myMove()) return '';
    const hint = `<button class="btn ghost" data-act="hint" title="Atalho: H">Dica</button>`;
    switch (s.phase) {
      case 'place': {
        const ready = this.draft && !this.draft.front.includes(null) && validatePlace(s, { type: 'place', front: this.draft.front as number[], back: this.draft.back }) === null;
        return `${hint}<button class="btn ghost" data-act="auto">Distribuir automático</button><button class="btn ghost" data-act="clear">Limpar</button><button class="btn${hc('confirm')}" data-act="confirm" ${ready ? '' : 'disabled'}>Confirmar</button>`;
      }
      case 'trick':
        return `${hint}<button class="btn${hc('pass')}" data-act="pass">Passar</button>`;
      case 'choose':
        return `${hint}<span class="chip">Clique num campo livre</span>`;
      case 'flip': {
        const c = s.clash!;
        const back = s.players[ME].back[c.col]!.card;
        return `${hint}<button class="btn${hc('flip-yes')}" data-act="flip-yes">Virar (+DEF ${getDef(back.defId).def})</button><button class="btn ghost${hc('flip-no')}" data-act="flip-no">Não virar</button>`;
      }
      case 'swap':
        return `${hint}<button class="btn${hc('done')}" data-act="done">Pronto</button>`;
      default:
        return '';
    }
  }

  private findVisible(uid: number): { card: CardInst; row?: Row } | null {
    const s = this.s;
    if (this.draft) {
      const c = s.players[ME].hand.find((x) => x.uid === uid);
      if (c) {
        const row = this.draft.front.includes(uid) ? 'front' : this.draft.back.includes(uid) ? 'back' : undefined;
        return { card: c, row };
      }
    }
    for (const pid of [ME, BOT] as PlayerId[]) {
      const p = s.players[pid];
      for (const row of ['front', 'back'] as Row[]) {
        const x = p[row].find((y) => y?.card.uid === uid);
        if (x && (pid === ME || x.revealed)) return { card: x.card, row };
      }
      const pools = pid === ME ? [p.hand, p.trickHand, p.graveChars, p.graveTricks, p.exile] : [p.graveChars, p.graveTricks, p.exile];
      for (const list of pools) {
        const c = list.find((x) => x.uid === uid);
        if (c) return { card: c };
      }
    }
    return null;
  }

  private renderInspector() {
    const box = this.el.inspector;
    const found = this.inspectUid !== null ? this.findVisible(this.inspectUid) : null;
    if (!found) {
      box.innerHTML = `<div class="placeholder">Passe o mouse ou toque numa carta para ver os detalhes.</div>`;
      return;
    }
    if (isTrick(found.card.defId)) {
      const t = getTrick(found.card.defId);
      box.innerHTML = `${cardHtml(found.card, { big: true })}<div class="details"><b>${t.kind === 'truque' ? 'Truque' : 'Equipamento'}.</b> Use na fase de truques, antes do dado (1 por turno). Depois de usado, vai para o cemitério 2.</div>`;
      return;
    }
    const d = getDef(found.card.defId);
    const beatsList = PRINCIPLE_BEATS[d.principle].map((x) => PRINCIPLE_LABEL[x]).join(', ');
    const losesTo = (Object.keys(PRINCIPLE_BEATS) as Principle[]).filter((k) => PRINCIPLE_BEATS[k].includes(d.principle)).map((x) => PRINCIPLE_LABEL[x]);
    box.innerHTML = `${cardHtml(found.card, { big: true, row: found.row })}
      <div class="details">
        <b>${PRINCIPLE_LABEL[d.principle]}</b> vence ${beatsList}${losesTo.length ? `; perde para ${losesTo.join(', ')}` : ''}.
        ${d.principle === 'realeza' ? ' No fim da rodada vai para o <b>exílio</b>.' : ''}<br>
        Na frontline disputa com ATK ${d.atk}. Na backline, se virada, soma DEF ${d.def}.
      </div>`;
  }

  private renderCoach() {
    const s = this.s;
    const rec = this.stats[this.prefs.difficulty];
    let tip: string;
    if (s.phase === 'coin') tip = 'Escolha cara ou coroa para decidir a iniciativa.';
    else if (s.phase === 'over') tip = 'Partida encerrada. Clique em “Nova partida” para jogar de novo.';
    else if (s.actor === BOT) tip = 'O bot está decidindo. Acompanhe o registro abaixo.';
    else
      switch (s.phase) {
        case 'place':
          tip = this.sel?.kind === 'hand'
            ? 'Agora clique numa casa vazia do seu lado.'
            : 'Clique numa carta da mão e depois numa casa. Frente: o ATK disputa o campo. Trás: a DEF soma se você virar. Clicar numa carta já posta e depois noutra casa troca as duas.';
          break;
        case 'trick':
          tip = this.sel?.kind === 'trick' ? 'Clique no alvo destacado em azul.' : 'Clique num truque contornado para usar (1 por turno) ou passe.';
          break;
        case 'choose':
          tip = 'Você venceu no d6: clique num campo livre. As duas frontlines dele serão reveladas.';
          break;
        case 'flip': {
          const c = s.clash!;
          tip = c.stage === 'loser'
            ? 'Você está perdendo este campo. Virar a backline soma a DEF dela. Se não virar, ela continua oculta e pode trocar de lugar depois.'
            : 'O bot virou a backline. Você pode virar a sua para somar a DEF.';
          break;
        }
        case 'swap':
          tip = 'Fim do turno: clique em duas backlines ocultas suas para trocar de lugar (pode repetir). Depois clique em Pronto.';
          break;
        default:
          tip = '';
      }
    const hint = this.hint ? `<p class="hint-text"><b>Sugestão:</b> ${this.hint.text}.<br><small>${this.hint.d.reason}</small></p>` : '';
    this.el.coach.innerHTML = `<p>${tip}</p>${hint}
      <div class="row"><button class="btn ghost" data-act="hint" ${this.myMove() ? '' : 'disabled'}>Pedir dica ao bot</button></div>
      <div class="stats-line">Contra o bot ${DIFFICULTY_LABEL[this.prefs.difficulty]}: ${rec.wins} V · ${rec.losses} D</div>`;
  }

  private renderLog() {
    const el = this.el.log;
    el.innerHTML = this.log.map((l) => `<div class="${l.cls}">${l.text}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }
}

// ─── Peças auxiliares ─────────────────────────────────────────────────────

function coinSvg(side: CoinSide): string {
  const mark =
    side === 'cara'
      ? `<circle cx="50" cy="48" r="16" class="mark"/><path class="mark" d="M43 46q3 3 6 0M51 46q3 3 6 0M44 55q6 5 12 0"/>${Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return `<line class="mark" x1="${50 + Math.cos(a) * 21}" y1="${48 + Math.sin(a) * 21}" x2="${50 + Math.cos(a) * 26}" y2="${48 + Math.sin(a) * 26}"/>`;
        }).join('')}`
      : `<path class="mark" d="M30 58 L27 34 L39 46 L50 28 L61 46 L73 34 L70 58 Z M30 64 L70 64"/>`;
  return `<svg class="coin-svg" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" class="rim"/><circle cx="50" cy="50" r="39" class="inner"/>${mark}<text x="50" y="84" text-anchor="middle" class="word">${side.toUpperCase()}</text></svg>`;
}

function wheelSvg(): string {
  const node = (x: number, y: number, p: Principle, w = 92) =>
    `<g class="w-node"><rect x="${x - w / 2}" y="${y - 13}" width="${w}" height="26" fill="var(--${p === 'engenharia' ? 'eng' : p === 'infantaria' ? 'inf' : p === 'qg' ? 'qg' : 'real'})" stroke="var(--ink-2)"/><text x="${x}" y="${y + 4}" text-anchor="middle" ${p === 'qg' || p === 'infantaria' ? 'style="fill:#fcfbf8"' : ''}>${PRINCIPLE_LABEL[p]}</text></g>`;
  return `<svg viewBox="0 0 260 176" role="img" aria-label="Engenharia vence QG, QG vence Infantaria, Infantaria vence Engenharia; Realeza vence todos">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-2)"/></marker></defs>
    <path class="w-arrow" marker-end="url(#arr)" d="M182 24 Q214 28 214 124"/>
    <path class="w-arrow" marker-end="url(#arr)" d="M178 140 L94 140"/>
    <path class="w-arrow" marker-end="url(#arr)" d="M46 126 Q46 28 78 24"/>
    ${node(130, 24, 'engenharia', 100)}
    ${node(214, 140, 'qg', 70)}
    ${node(46, 140, 'infantaria', 92)}
    ${node(130, 84, 'realeza', 84)}
    <text x="130" y="110" text-anchor="middle" class="w-note">vence todos · cai no exílio</text>
    <text x="130" y="168" text-anchor="middle" class="w-note">seta = “vence”</text>
  </svg>`;
}

function rulesHtml(): string {
  const principle = PRINCIPLE_MODE === 'dominante' ? 'Vantagem de princípio vence o campo direto.' : `Vantagem de princípio soma +${PRINCIPLE_BONUS}.`;
  return `<ul class="rules-list">
    <li>Cada rodada: 10 personagens virados (5 na frente, 5 atrás) e 5 turnos, um por campo.</li>
    <li>Turno: truques (1 cada) → d6 → quem tirar mais escolhe o campo → as frontlines são reveladas.</li>
    <li>${principle} Sem vantagem: ATK × ATK. Quem perde pode virar a backline (soma DEF); aí o outro pode virar a dele.</li>
    <li>Empate: d6 até desempatar. Cada campo vencido vale 1 ponto.</li>
    <li>Fim do turno: backlines ainda ocultas podem trocar de lugar. Fim da rodada: tudo ao cemitério.</li>
    <li>Vence quem fizer ${RULES.pointsToWin} pontos (no máximo ${RULES.maxTurns} turnos).</li>
  </ul>`;
}
