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
import { TRICKS, getDef, getTrick, isTrick } from '../engine/cards';
import {
  applyAction,
  duelStanding,
  findCard,
  maxBack,
  newGame,
  openColumns,
  swapPairs,
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
  choose: 'Escolha do campo',
  flip: 'Virar a backline?',
  exchange: 'Trocar com a frontline?',
  resolve: 'Resultado do duelo',
  swap: 'Mover a backline?',
  roundOver: 'Fim da rodada',
  over: 'Fim de jogo',
};

/** Etapas mostradas no marcador da partida. */
const STEPS: { label: string; phases: GameState['phase'][] }[] = [
  { label: 'Distribuição', phases: ['place'] },
  { label: 'Dado e campo', phases: ['choose'] },
  { label: 'Backline', phases: ['flip', 'exchange'] },
  { label: 'Resultado', phases: ['resolve', 'roundOver'] },
  { label: 'Mover', phases: ['swap'] },
];

type DragSrc = { kind: 'hand'; uid: number } | { kind: 'draft'; row: Row; col: number } | { kind: 'back'; col: number };

type Sel = { kind: 'hand'; uid: number } | { kind: 'draft'; row: Row; col: number } | { kind: 'swap'; col: number } | null;
type PileKind = 'deck' | 'tricks' | 'grave' | 'graveTricks' | 'exile';
type Draft = { front: (number | null)[]; back: (number | null)[] };

interface LogItem {
  cls: string;
  text: string;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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
  private vt: { skipTransition?: () => void } | null = null;
  private drag: { src: DragSrc; el: HTMLElement; x0: number; y0: number; ghost: HTMLElement | null; target: HTMLElement | null; w: number; h: number } | null = null;
  private suppressClick = false;

  constructor(private root: HTMLElement) {
    sound.muted = this.prefs.muted;
    this.build();
    this.bind();
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
            ${(['facil', 'medio', 'dificil'] as Difficulty[]).map((d) => `<button class="seg-btn" data-diff="${d}">${DIFFICULTY_LABEL[d]}</button>`).join('')}
          </div>
          <button class="btn btn-secondary" data-act="panel" id="panel-btn">Painel</button>
          <button class="btn btn-secondary" data-act="new">Nova partida</button>
          <button class="btn btn-icon" data-act="mute" id="mute-btn"></button>
        </div>
      </header>
      <main class="layout">
        <section class="table" id="table" aria-label="Mesa">
          <div class="hand opp" id="hand-opp" aria-label="Mão do bot"></div>
          <div class="mat">
            <div class="side opp" id="side-opp" aria-label="Lado do bot"></div>
            <div class="strip">
              <ol class="stepper" id="stepper" aria-label="Etapa atual"></ol>
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
        <aside class="panel" id="panel" aria-label="Painel">
          <div class="box"><h2>Carta</h2><div class="inspector" id="inspector"></div></div>
          <div class="box coach"><h2>Treino</h2><div id="coach"></div>
            <label class="check"><input type="checkbox" id="explain"> Explicar as jogadas do bot no registro</label>
            <label class="check"><input type="checkbox" id="reduce"> Reduzir animações</label>
          </div>
          <div class="box wheel"><h2>Regras</h2>${wheelSvg()}${rulesHtml()}</div>
          <div class="box"><h2>Registro</h2><div class="log" id="log" aria-live="polite"></div></div>
        </aside>
      </main>
      <div class="peek" id="peek" hidden></div>
      <div id="overlay-root"></div>
      <div id="stage-root"></div>
      <div class="toast" id="toast" hidden></div>
    </div>`;
    const q = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;
    for (const id of ['app-root', 'table', 'hand-opp', 'hand-me', 'side-opp', 'side-me', 'stepper', 'turn-no', 'turn-who', 'clash-line', 'coin-mini', 'die-me', 'die-bot', 'dice-readout', 'actions', 'inspector', 'coach', 'log', 'overlay-root', 'stage-root', 'toast', 'mute-btn', 'panel-btn', 'peek']) {
      this.el[id] = q(id);
    }
    (q('explain') as HTMLInputElement).checked = this.prefs.explain;
    (q('reduce') as HTMLInputElement).checked = this.prefs.reduceMotion;
    this.el['app-root'].classList.toggle('reduce-motion', this.prefs.reduceMotion);
  }

  private bind() {
    const r = this.root;
    r.addEventListener('pointerdown', () => sound.unlock());
    // arrastar e soltar (mouse e toque); o clique continua funcionando
    r.addEventListener('pointerdown', (e) => this.onDragStart(e));
    window.addEventListener('pointermove', (e) => this.onDragMove(e));
    window.addEventListener('pointerup', (e) => this.onDragEnd(e));
    window.addEventListener('pointercancel', () => this.endDrag());
    r.addEventListener(
      'click',
      (e) => {
        if (!this.suppressClick) return;
        this.suppressClick = false;
        e.stopPropagation();
        e.preventDefault();
      },
      true,
    );
    r.addEventListener('click', (e) => this.onClick(e));
    // janela flutuante com a carta sob o mouse
    r.addEventListener('mouseover', (e) => {
      if (!matchMedia('(hover: hover)').matches) return;
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-uid]');
      if (this.drag?.ghost || this.el['stage-root'].firstElementChild || this.el['overlay-root'].firstElementChild) return this.hidePeek();
      if (!c || c.closest('.peek, .overlay, .stage')) return this.hidePeek();
      const uid = Number(c.dataset.uid);
      this.showPeek(uid, e.clientX, e.clientY);
    });
    r.addEventListener('mousemove', (e) => {
      if (!this.el.peek.hidden) this.placePeek(e.clientX, e.clientY);
    });
    r.addEventListener('mouseleave', () => this.hidePeek());
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
        this.hidePeek();
        this.sel = null;
        this.render();
      } else if (e.key === 'h' || e.key === 'H') this.askHint();
    });
  }

  /** Cartas do tamanho que couber: a mesa usa a largura e quase toda a altura. */
  private resize() {
    const table = this.el.table;
    if (!table) return;
    const narrow = table.clientWidth < 640;
    const gap = narrow ? 3 : 8;
    const pad = narrow ? 6 : 14;
    const availW = table.clientWidth - 2 * pad - 2 - 8 * gap;
    let cw = Math.floor(availW / 9);
    if (!narrow) {
      const placing = this.s?.phase === 'place' && this.s.actor === ME;
      const chrome = 330 + (placing ? 40 : 0);
      const rows = 5.6 + (placing ? 1.4 * 0.82 : 0);
      cw = Math.min(cw, Math.floor((window.innerHeight - chrome) / rows));
    }
    cw = Math.max(28, Math.min(150, cw));
    this.root.style.setProperty('--cw', `${cw}px`);
    this.root.style.setProperty('--cw-base', `${cw}px`);
    this.root.style.setProperty('--gap', `${gap}px`);
    this.root.style.setProperty('--mat-pad', `${pad}px`);
    this.el['app-root'].classList.toggle('tiny', cw < 62);
  }

  // ─── Partida ───────────────────────────────────────────────────────────

  start(restore?: { s?: GameState; log?: LogItem[] }) {
    if (restore?.s && 'duelInRound' in restore.s && restore.s.clash?.mods !== undefined) {
      this.s = restore.s;
      this.log = restore.log ?? [];
      this.matchId++;
      this.bot = createBot({ difficulty: this.prefs.difficulty });
      this.recorded = this.s.phase === 'over';
      this.prepareDraft();
      this.render();
      if (this.s.phase === 'coin') this.showCoin();
      else void this.drive();
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
    this.el['stage-root'].innerHTML = '';
    this.pushLog('turn-mark', `Nova partida · bot ${DIFFICULTY_LABEL[this.prefs.difficulty]}`);
    this.render();
    this.showCoin();
  }

  private myMove() {
    const p = this.s.phase;
    return p !== 'over' && p !== 'coin' && p !== 'resolve' && p !== 'roundOver' && this.s.actor === ME && !this.busy;
  }

  private prepareDraft() {
    if (this.s.phase === 'place' && this.s.actor === ME) {
      if (!this.draft) this.draft = { front: Array(RULES.columns).fill(null), back: Array(RULES.columns).fill(null) };
    } else this.draft = null;
  }

  /** Aplica uma ação e só termina depois que todas as animações e avisos acabam. */
  private async perform(a: Action) {
    this.busy = true;
    this.sel = null;
    this.hint = null;
    this.hidePeek();
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
    this.renderStrip(); // a faixa já mostra a próxima etapa enquanto as animações rodam
    await this.animate(events);
    if (id !== this.matchId) return;
    this.logEvents(events);
    this.busy = false;
    this.prepareDraft();
    this.renderSmooth();
    if (this.s.phase === 'over') this.finish();
  }

  private async act(a: Action) {
    if (!this.myMove()) return;
    await this.perform(a);
    void this.drive();
  }

  /**
   * Condutor da partida: apura duelos, mostra o fim de rodada e faz o bot jogar,
   * um passo de cada vez. Para quando é a vez do jogador.
   */
  private driving = false;
  private async drive() {
    if (this.driving) return;
    this.driving = true;
    const id = this.matchId;
    const fast = this.prefs.reduceMotion;
    try {
      while (id === this.matchId && this.s.phase !== 'over' && this.s.phase !== 'coin') {
        if (this.s.phase === 'resolve') {
          this.busy = true;
          this.renderStrip();
          await sleep(fast ? 150 : 900);
          if (id !== this.matchId) return;
          await this.perform({ type: 'resolve' });
          continue;
        }
        if (this.s.phase === 'roundOver') {
          this.busy = true;
          this.renderStrip();
          await this.showRoundOver();
          if (id !== this.matchId) return;
          await this.perform({ type: 'next' });
          continue;
        }
        if (this.s.actor !== BOT) break;
        this.busy = true;
        this.renderStrip();
        await sleep(fast ? 150 : BOT_DELAY_MS);
        if (id !== this.matchId) return;
        const d = this.bot.decide(this.s);
        if (this.prefs.explain && d.reason && d.action.type !== 'done') {
          const what = d.action.type === 'place' ? 'distribuir as cartas viradas' : describeAction(this.s, d.action);
          this.pushLog('why', `Bot pensou: ${what.charAt(0).toLowerCase()}${what.slice(1)}. ${d.reason}`);
        }
        await this.perform(d.action);
      }
    } finally {
      this.driving = false;
      if (id === this.matchId) {
        this.busy = false;
        this.prepareDraft();
        this.renderSmooth();
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
    this.toast(`Sugestão: ${this.hint.text}.`);
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

    // toque (sem mouse): mostra a carta na janela flutuante
    if (!matchMedia('(hover: hover)').matches) {
      const c = t.closest<HTMLElement>('[data-uid]');
      if (c && !c.closest('.peek')) this.showPeek(Number(c.dataset.uid), e.clientX, e.clientY);
      else if (!t.closest('.peek')) this.hidePeek();
    }

    const pile = t.closest<HTMLElement>('[data-pile]');
    if (pile) {
      const [pid, kind] = pile.dataset.pile!.split(':');
      return this.showPile(Number(pid) as PlayerId, kind as PileKind);
    }

    const handCard = t.closest<HTMLElement>('[data-hand]');
    if (handCard) {
      const uid = Number(handCard.dataset.hand);
      this.inspectUid = uid;
      if (this.myMove() && this.s.phase === 'place') {
        this.sel = this.sel?.kind === 'hand' && this.sel.uid === uid ? null : { kind: 'hand', uid };
      } else if (this.myMove()) {
        this.toast('Cartas da mão só entram na mesa na distribuição, no início da rodada.');
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
        if (this.s.phase !== 'over' && this.s.round > 1) return this.confirmNew();
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
      case 'panel':
        this.prefs.showPanel = !this.prefs.showPanel;
        savePrefs(this.prefs);
        this.render();
        if (this.prefs.showPanel) this.root.querySelector('#panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      case 'tips':
        this.prefs.showTips = !this.prefs.showTips;
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
          this.renderSmooth();
        }
        return;
      case 'clear':
        if (this.draft) this.draft = { front: Array(RULES.columns).fill(null), back: Array(RULES.columns).fill(null) };
        this.sel = null;
        return this.renderSmooth();
      case 'confirm': {
        if (!this.draft) return;
        const a = { type: 'place' as const, front: this.draft.front as number[], back: this.draft.back };
        const err = this.draft.front.includes(null) ? 'Preencha as 5 casas da frontline.' : validatePlace(this.s, a);
        if (err) return this.toast(err);
        this.draft = null;
        return void this.act(a);
      }
      case 'flip-yes':
        return void this.act({ type: 'flip', flip: true });
      case 'flip-no':
        return void this.act({ type: 'flip', flip: false });
      case 'exchange-yes':
        return void this.act({ type: 'exchange', exchange: true });
      case 'exchange-no':
        return void this.act({ type: 'exchange', exchange: false });
      case 'done':
        return void this.act({ type: 'done' });
    }
  }

  private isTrickUid(uid: number) {
    return this.s.players[ME].trickHand.some((c) => c.uid === uid);
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
          if (row === 'front' && this.isTrickUid(this.sel.uid)) {
            this.toast('Truques e equipamentos só podem ir para a backline.');
            break;
          }
          this.draft[row][col] = this.sel.uid;
          this.sel = null;
          sound.play('card');
          return this.renderSmooth();
        } else if (this.sel?.kind === 'draft') {
          const from = this.sel;
          const moving = this.draft[from.row][from.col];
          const trickToFront = (row === 'front' && moving !== null && this.isTrickUid(moving)) || (from.row === 'front' && here !== null && this.isTrickUid(here));
          if (trickToFront) {
            this.toast('Truques e equipamentos só podem ir para a backline.');
            this.sel = null;
            break;
          }
          this.draft[from.row][from.col] = here;
          this.draft[row][col] = moving;
          this.sel = null;
          sound.play('move');
          return this.renderSmooth();
        } else if (here !== null) {
          this.sel = { kind: 'draft', row, col };
        }
        break;
      }
      case 'choose':
        if (openColumns(s).includes(col)) return void this.act({ type: 'choose', col });
        this.toast('Este campo já foi disputado nesta rodada.');
        break;
      case 'swap': {
        if (pid !== ME || row !== 'back') break;
        if (s.columns[col].resolved) {
          this.toast('Este campo já lutou: a backline dele fica travada até o fim da rodada.');
          break;
        }
        const sw = swapPairs(s, ME);
        if (this.sel?.kind === 'swap') {
          const a = this.sel.col;
          if (a === col) this.sel = null;
          else if (sw.some(([x, y]) => (x === a && y === col) || (x === col && y === a))) {
            return void this.act({ type: 'swap', a: Math.min(a, col), b: Math.max(a, col) });
          } else this.toast('Só backlines ocultas de campos que ainda não lutaram trocam de lugar.');
        } else if (sw.some(([x, y]) => x === col || y === col)) this.sel = { kind: 'swap', col };
        else this.toast('Esta casa não pode trocar: a carta já foi revelada.');
        break;
      }
    }
    this.render();
  }

  // ─── Arrastar e soltar ─────────────────────────────────────────────────

  private onDragStart(e: PointerEvent) {
    if (!this.myMove() || e.button !== 0) return;
    const t = e.target as HTMLElement;
    let src: DragSrc | null = null;
    let el: HTMLElement | null = null;
    if (this.s.phase === 'place' && this.draft) {
      const h = t.closest<HTMLElement>('[data-hand]');
      const slot = t.closest<HTMLElement>('[data-slot]');
      if (h) {
        src = { kind: 'hand', uid: Number(h.dataset.hand) };
        el = h;
      } else if (slot) {
        const [pid, row, col] = slot.dataset.slot!.split(':');
        if (Number(pid) === ME && this.draft[row as Row][Number(col)] !== null) {
          src = { kind: 'draft', row: row as Row, col: Number(col) };
          el = slot.querySelector<HTMLElement>('.card');
        }
      }
    } else if (this.s.phase === 'swap') {
      const slot = t.closest<HTMLElement>('[data-slot]');
      if (slot) {
        const [pid, row, col] = slot.dataset.slot!.split(':');
        const c = Number(col);
        if (Number(pid) === ME && row === 'back' && this.s.players[ME].back[c] && swapPairs(this.s, ME).some(([a, b]) => a === c || b === c)) {
          src = { kind: 'back', col: c };
          el = slot.querySelector<HTMLElement>('.card');
        }
      }
    }
    if (!src || !el) return;
    const r = el.getBoundingClientRect();
    this.drag = { src, el, x0: e.clientX, y0: e.clientY, ghost: null, target: null, w: r.width, h: r.height };
  }

  private onDragMove(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
      const g = d.el.cloneNode(true) as HTMLElement;
      g.removeAttribute('data-uid');
      g.removeAttribute('data-hand');
      g.style.removeProperty('view-transition-name');
      g.classList.remove('selected', 'hinted');
      g.classList.add('drag-ghost');
      g.style.width = `${d.w}px`;
      g.style.height = `${d.h}px`;
      this.el['app-root'].appendChild(g);
      d.ghost = g;
      d.el.classList.add('drag-src');
      this.hidePeek();
      this.sel = null;
      this.el['app-root'].classList.add('drag-active');
      // marca as casas onde dá para soltar
      this.root.querySelectorAll<HTMLElement>('#side-me [data-slot]').forEach((slot) => {
        if (this.dropValid(d.src, slot)) slot.classList.add('can-drop');
      });
    }
    d.ghost!.style.transform = `translate(${e.clientX - d.w / 2}px, ${e.clientY - d.h * 0.6}px) rotate(3deg) scale(1.04)`;
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-slot]') ?? null;
    const target = under && this.dropValid(d.src, under) ? under : null;
    if (target !== d.target) {
      d.target?.classList.remove('drop-ok');
      target?.classList.add('drop-ok');
      d.target = target;
    }
    e.preventDefault();
  }

  private onDragEnd(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    if (d.ghost) {
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 0);
      const target = d.target;
      this.endDrag();
      if (target) this.dropOn(d.src, target);
      else this.render();
      e.preventDefault();
    } else this.drag = null;
  }

  private endDrag() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    d.ghost?.remove();
    d.el.classList.remove('drag-src');
    this.el['app-root'].classList.remove('drag-active');
    this.root.querySelectorAll('.can-drop, .drop-ok').forEach((x) => x.classList.remove('can-drop', 'drop-ok'));
  }

  private dropValid(src: DragSrc, slot: HTMLElement): boolean {
    const [pidS, rowS, colS] = slot.dataset.slot!.split(':');
    const pid = Number(pidS);
    const row = rowS as Row;
    const col = Number(colS);
    if (pid !== ME || !this.myMove()) return false;
    if (src.kind === 'back') {
      return row === 'back' && col !== src.col && swapPairs(this.s, ME).some(([a, b]) => (a === src.col && b === col) || (b === src.col && a === col));
    }
    if (!this.draft) return false;
    const here = this.draft[row][col];
    if (src.kind === 'hand') return !(row === 'front' && this.isTrickUid(src.uid));
    if (src.row === row && src.col === col) return false;
    const moving = this.draft[src.row][src.col];
    if (row === 'front' && moving !== null && this.isTrickUid(moving)) return false;
    if (src.row === 'front' && here !== null && this.isTrickUid(here)) return false;
    return true;
  }

  private dropOn(src: DragSrc, slot: HTMLElement) {
    const [, rowS, colS] = slot.dataset.slot!.split(':');
    const row = rowS as Row;
    const col = Number(colS);
    if (src.kind === 'back') {
      void this.act({ type: 'swap', a: Math.min(src.col, col), b: Math.max(src.col, col) });
      return;
    }
    if (!this.draft) return;
    if (src.kind === 'hand') {
      this.draft[row][col] = src.uid; // se havia carta ali, ela volta para a mão
    } else {
      const moving = this.draft[src.row][src.col];
      this.draft[src.row][src.col] = this.draft[row][col];
      this.draft[row][col] = moving;
    }
    this.inspectUid = this.draft[row][col];
    sound.play('card');
    this.renderSmooth();
  }

  // ─── Janela flutuante da carta ─────────────────────────────────────────

  private peekUid: number | null = null;

  private showPeek(uid: number, x: number, y: number) {
    const found = this.findVisible(uid);
    if (!found) return this.hidePeek();
    this.inspectUid = uid;
    if (this.peekUid !== uid) {
      this.peekUid = uid;
      this.el.peek.innerHTML = this.cardDetailsHtml(found.card, found.row);
      this.renderInspector();
    }
    this.el.peek.hidden = false;
    this.placePeek(x, y);
  }

  private placePeek(x: number, y: number) {
    const p = this.el.peek;
    const w = p.offsetWidth || 280;
    const h = p.offsetHeight || 420;
    const m = 18;
    let left = x + m;
    if (left + w > window.innerWidth - 8) left = x - w - m;
    left = Math.max(8, left);
    const top = Math.max(8, Math.min(y - h / 2, window.innerHeight - h - 8));
    p.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  private hidePeek() {
    this.peekUid = null;
    if (this.el.peek) this.el.peek.hidden = true;
  }

  // ─── Animações ─────────────────────────────────────────────────────────

  private q(sel: string) {
    return this.root.querySelector<HTMLElement>(sel);
  }

  private async animate(events: GameEvent[]) {
    const fast = this.prefs.reduceMotion;
    const wait = (ms: number) => sleep(fast ? Math.min(ms, 60) : ms);
    for (const ev of events) {
      switch (ev.kind) {
        case 'roll': {
          await this.rollDice(ev.rolls);
          const [a, b] = ev.rolls[ev.rolls.length - 1];
          this.diceText = `d6: você ${a} × ${b} bot${ev.rolls.length > 1 ? ' (após empate)' : ''} · ${ev.chooser === ME ? 'você escolhe o campo' : 'o bot escolhe o campo'}`;
          this.renderStrip();
          await wait(300);
          break;
        }
        case 'reveal':
          ev.uids.forEach((u) => this.fx.set(u, 'flip-in'));
          sound.play('card');
          this.render();
          await wait(900);
          break;
        case 'flip':
          if (ev.flipped && ev.uid) {
            this.fx.set(ev.uid, 'flip-in');
            sound.play('card');
            this.render();
            await wait(800);
          } else {
            this.toast(`${ev.player === ME ? 'Você não virou' : 'O bot não virou'} a backline.`);
            await wait(500);
          }
          break;
        case 'exchange':
          if (ev.exchanged) {
            if (ev.newFrontUid) this.fx.set(ev.newFrontUid, 'enter');
            if (ev.newBackUid) this.fx.set(ev.newBackUid, 'enter');
            sound.play('move');
            this.renderSmooth();
            this.toast(`${ev.player === ME ? 'Você trocou' : 'O bot trocou'} a backline com a frontline.`);
            await wait(800);
          }
          break;
        case 'trigger':
          sound.play('move');
          if (ev.newUid) this.fx.set(ev.newUid, 'flip-in');
          this.render();
          await this.showTrigger(ev);
          break;
        case 'result':
          if (ev.dice.length) {
            await this.rollDice(ev.dice);
            this.diceText = `Empate em ${ev.totals[0]}: d6 ${ev.dice.map(([a, b]) => `${a}×${b}`).join(', ')}`;
          }
          sound.play(ev.winner === ME ? 'coin' : 'hit');
          this.pulse.add(`plate:${ev.winner}`);
          this.render();
          await this.showDuelPlaque(ev);
          break;
        case 'swap':
          sound.play('move');
          this.renderSmooth();
          await wait(450);
          break;
        case 'roundEnd':
          sound.play('break');
          this.pulse.add(`${ME}:grave`).add(`${BOT}:grave`);
          break;
        case 'placed':
          if (ev.player === BOT) {
            sound.play('card');
            this.renderSmooth();
            await wait(400);
          }
          break;
        case 'duel':
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
        for (let i = 0; i < 7; i++) {
          a.innerHTML = dieSvg(1 + Math.floor(Math.random() * 6));
          b.innerHTML = dieSvg(1 + Math.floor(Math.random() * 6));
          await sleep(65);
        }
        a.classList.remove('rolling');
        b.classList.remove('rolling');
      }
      a.innerHTML = dieSvg(x);
      b.innerHTML = dieSvg(y);
      this.dice = [x, y];
      await sleep(this.prefs.reduceMotion ? 40 : 450);
    }
  }

  /**
   * Mostra algo no centro da mesa e espera: some sozinho depois de `ms`
   * (ou só no clique, se `ms` for 0). Nada avança enquanto está na tela.
   */
  private stage(html: string, ms: number, cls = ''): Promise<void> {
    this.hidePeek();
    const root = this.el['stage-root'];
    const fast = this.prefs.reduceMotion;
    root.innerHTML = `<div class="stage ${cls}" role="dialog"><div class="stage-inner">${html}</div></div>`;
    const el = root.firstElementChild as HTMLElement;
    return new Promise((resolve) => {
      let done = false;
      const close = () => {
        if (done) return;
        done = true;
        el.classList.add('leaving');
        setTimeout(() => {
          if (root.firstElementChild === el) root.innerHTML = '';
          resolve();
        }, fast ? 10 : 260);
      };
      el.addEventListener('click', (e) => {
        if (ms === 0 && !(e.target as HTMLElement).closest('[data-stage-go]')) return;
        close();
      });
      el.querySelector<HTMLElement>('[data-stage-go]')?.focus();
      if (ms > 0) setTimeout(close, fast ? Math.min(ms, 500) : ms);
    });
  }

  private async showTrigger(ev: Extract<GameEvent, { kind: 'trigger' }>) {
    const t = getTrick(ev.defId);
    const who = ev.player === ME ? 'Você' : 'O bot';
    const card = (uid?: number) => {
      const c = uid ? findCard(this.s, uid) : null;
      return c ? cardHtml(c) : '';
    };
    let text = '';
    let shown = '';
    switch (ev.result) {
      case 'roubou':
        text = `${who} pescou da backline rival:`;
        shown = card(ev.stolenUid);
        break;
      case 'trocou':
        text = `${who} trocou a frontline pela carta do topo do deck:`;
        shown = card(ev.newUid);
        break;
      case 'sabotou':
        text = `${who} mandou ao cemitério a backline rival:`;
        shown = card(ev.destroyedUid);
        break;
      case 'bonus':
        text = `${who}: ${ev.text}.`;
        break;
      case 'falhou':
        text = ev.revealedUid ? `${t.name} não encontrou um personagem. Era:` : `${t.name} não teve alvo.`;
        shown = card(ev.revealedUid);
        break;
    }
    await this.stage(
      `<div class="trigger-pop">
        <div class="trigger-card">${cardHtml({ uid: -1, defId: ev.defId })}</div>
        <div class="trigger-body">
          <div class="eyebrow">${t.kind === 'truque' ? 'Truque' : 'Equipamento'} ativado · campo ${ev.col + 1}</div>
          <h3>${esc(t.name)}</h3>
          <p>${esc(text)}</p>
          ${shown ? `<div class="trigger-result">${shown}</div>` : ''}
        </div>
      </div>`,
      2600,
      'parchment',
    );
  }

  private async showDuelPlaque(ev: Extract<GameEvent, { kind: 'result' }>) {
    const [a, b] = ev.duelWins;
    const why =
      ev.reason === 'principio' ? 'vantagem de princípio' : ev.reason === 'dados' ? `empate em ${ev.totals[0]}, decidido no d6` : `${ev.totals[0]} × ${ev.totals[1]}`;
    const pips = (n: number) =>
      Array.from({ length: RULES.duelsToWinRound }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    await this.stage(
      `<div class="plaque">
        <div class="plaque-eyebrow">Duelo ${this.s.duelInRound} · campo ${ev.col + 1}</div>
        <div class="plaque-title">${ev.winner === ME ? 'Duelo seu' : 'Duelo do bot'}</div>
        <div class="plaque-why">${why}</div>
        <div class="plaque-score">
          <div><span>Você</span><b>${a}</b><div class="plaque-pips">${pips(a)}</div></div>
          <em>×</em>
          <div><span>Bot</span><b>${b}</b><div class="plaque-pips">${pips(b)}</div></div>
        </div>
        <div class="plaque-foot">Rodada ${this.s.round} · ${RULES.duelsToWinRound} duelos levam a rodada</div>
      </div>`,
      2400,
      'wood',
    );
  }

  private async showRoundOver() {
    const s = this.s;
    const w = s.lastRoundWinner!;
    const [me, bot] = s.players;
    const final = s.players[w].points >= RULES.pointsToWin;
    sound.play(w === ME ? 'win' : 'lose');
    await this.stage(
      `<div class="plaque big">
        <div class="plaque-eyebrow">Fim da rodada ${s.round}</div>
        <div class="plaque-title">${w === ME ? 'Rodada sua!' : 'Rodada do bot'}</div>
        <div class="plaque-why">Duelos: você ${me.duelWins} × ${bot.duelWins} bot</div>
        <div class="plaque-score">
          <div><span>Você</span><b>${me.points}</b></div>
          <em>×</em>
          <div><span>Bot</span><b>${bot.points}</b></div>
        </div>
        <div class="plaque-foot">${final ? 'Placar final da partida.' : `Pontos de ${RULES.pointsToWin}. Na próxima rodada você compra ${me.lastRoundLosses} truque(s) e o bot, ${bot.lastRoundLosses}.`}</div>
        <button class="btn btn-primary" data-stage-go>${final ? 'Ver resultado' : 'Próxima rodada'}</button>
      </div>`,
      0,
      'wood',
    );
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
        <p id="coin-text">Quem acertar ganha a iniciativa. Quem errar compra ${RULES.coinLoserExtraTricks} truque a mais no início.</p>
        <div class="row" id="coin-buttons">
          <button class="btn btn-primary" data-act="coin" data-call="cara">Cara</button>
          <button class="btn btn-primary" data-act="coin" data-call="coroa">Coroa</button>
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
    this.q('#coin-text')!.textContent =
      `Você pediu ${call}, deu ${ev.result}. ` +
      (ev.winner === ME ? 'A iniciativa é sua; o bot compra 1 truque a mais.' : 'A iniciativa é do bot; você compra 1 truque a mais.');
    this.q('#coin-buttons')!.innerHTML = `<button class="btn btn-primary" id="coin-go">Para a mesa</button>`;
    this.logEvents(events);
    this.busy = false;
    this.prepareDraft();
    this.render();
    this.q('#coin-go')!.addEventListener('click', () => {
      if (id !== this.matchId) return;
      this.closeOverlay();
      void this.drive();
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
        <div class="eyebrow">Fim da partida · ${this.s.round} rodadas</div>
        <h2>${title}</h2>
        <p>Placar final em rodadas: você ${me.points} × ${bot.points} bot.
        No nível ${DIFFICULTY_LABEL[this.prefs.difficulty]}: ${rec.wins} vitória(s), ${rec.losses} derrota(s).</p>
        <div class="row">
          <button class="btn btn-primary" data-act="new-confirm">Jogar de novo</button>
          <button class="btn btn-secondary" data-act="close" data-dismiss>Ver a mesa</button>
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
          <button class="btn btn-primary" data-act="new-confirm">Começar nova</button>
          <button class="btn btn-secondary" data-act="close" data-dismiss>Continuar jogando</button>
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
        <div class="row" style="margin-top:18px"><button class="btn btn-secondary" data-act="close" data-dismiss>Fechar</button></div>
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
    this.toastTimer = window.setTimeout(() => (t.hidden = true), 3000);
  }

  // ─── Registro ──────────────────────────────────────────────────────────

  private pushLog(cls: string, text: string) {
    this.log.push({ cls, text });
    if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
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
        case 'trickDraw': {
          const why = ev.round === 1 ? (ev.extra ? ` (${ev.extra} a mais por perder na moeda)` : '') : ' (1 por duelo perdido na rodada anterior)';
          this.pushLog(cls(ev.player), `${who(ev.player)} comprou ${ev.uids.length} truque(s)/equipamento(s)${why}.`);
          break;
        }
        case 'placed':
          this.pushLog(cls(ev.player), `${who(ev.player)} distribuiu as cartas viradas.`);
          break;
        case 'duel':
          this.pushLog('turn-mark', `Duelo ${ev.duel} da rodada ${ev.round}`);
          break;
        case 'roll': {
          const [a, b] = ev.rolls[ev.rolls.length - 1];
          this.pushLog('', `d6: você ${a} × ${b} bot${ev.rolls.length > 1 ? ' (após empate)' : ''}.`);
          break;
        }
        case 'choose':
          this.pushLog(cls(ev.player), `${who(ev.player)} escolheu o campo ${ev.col + 1}.`);
          break;
        case 'reveal': {
          const [a, b] = ev.uids.map((u) => findCard(this.s, u)!);
          const da = getDef(a.defId);
          const db = getDef(b.defId);
          this.pushLog('', `Revelação: ${da.name} (${PRINCIPLE_LABEL[da.principle]}, ATK ${da.atk}) × ${db.name} (${PRINCIPLE_LABEL[db.principle]}, ATK ${db.atk})${ev.byPrinciple ? ` → vantagem de princípio para ${ev.leader === ME ? 'você' : 'o bot'}` : ''}.`);
          break;
        }
        case 'flip': {
          if (!ev.flipped) {
            this.pushLog(cls(ev.player), `${who(ev.player)} não virou a backline.`);
            break;
          }
          const c = ev.uid ? findCard(this.s, ev.uid) : null;
          const what = c && !isTrick(c.defId) ? `${getDef(c.defId).name} (+DEF ${getDef(c.defId).def})` : nm(ev.uid);
          this.pushLog(cls(ev.player), `${who(ev.player)} virou a backline: ${what}.`);
          break;
        }
        case 'exchange':
          if (ev.exchanged) this.pushLog(cls(ev.player), `${who(ev.player)} trocou: ${nm(ev.newFrontUid)} foi para a frente e ${nm(ev.newBackUid)} para trás.`);
          else this.pushLog(cls(ev.player), `${who(ev.player)} manteve a frontline.`);
          break;
        case 'trigger': {
          const name = getTrick(ev.defId).name;
          const res =
            ev.result === 'roubou' ? `pescou ${nm(ev.stolenUid)} da backline rival`
            : ev.result === 'trocou' ? `trocou ${nm(ev.oldUid)} por ${nm(ev.newUid)} na frontline`
            : ev.result === 'sabotou' ? `mandou ${nm(ev.destroyedUid)} ao cemitério`
            : ev.result === 'bonus' ? (ev.text ?? '')
            : 'não pegou nenhum personagem';
          this.pushLog(cls(ev.player), `${name}: ${res}.`);
          break;
        }
        case 'result': {
          const why = ev.reason === 'principio' ? 'princípio' : ev.reason === 'dados' ? `empate em ${ev.totals[0]}, decidido no d6` : `${ev.totals[0]} × ${ev.totals[1]}`;
          this.pushLog('big', `Campo ${ev.col + 1}: duelo ${ev.winner === ME ? 'seu' : 'do bot'} (${why}). Duelos na rodada: ${ev.duelWins[0]} × ${ev.duelWins[1]}.`);
          break;
        }
        case 'swap':
          this.pushLog(cls(ev.player), `${who(ev.player)} trocou de lugar as backlines dos campos ${ev.a + 1} e ${ev.b + 1}.`);
          break;
        case 'swapDone':
          if (!ev.swaps) this.pushLog(cls(ev.player), `${who(ev.player)} não moveu a backline.`);
          break;
        case 'roundWon':
          this.pushLog('big', `Rodada ${ev.round} ${ev.winner === ME ? 'sua' : 'do bot'} (${ev.duelWins[0]} × ${ev.duelWins[1]} em duelos). Placar: ${ev.points[0]} × ${ev.points[1]}.`);
          break;
        case 'roundEnd': {
          const ex = ev.moved.filter((m) => m.to === 'exilio').length;
          this.pushLog('', `Cartas da mesa ao cemitério${ex ? `; ${ex} Realeza(s) revelada(s) ao exílio` : ''}.`);
          break;
        }
        case 'win':
          this.pushLog('big', ev.winner === 'empate' ? `Empate (${ev.reason}).` : `${ev.winner === ME ? 'Você venceu' : 'O bot venceu'} a partida (${ev.reason}).`);
          break;
      }
    }
  }

  // ─── Renderização ──────────────────────────────────────────────────────

  /** Renderiza com transição suave (as cartas deslizam para o novo lugar). */
  private renderSmooth() {
    const d = document as unknown as { startViewTransition?: (cb: () => void) => { skipTransition?: () => void } };
    if (!d.startViewTransition || this.prefs.reduceMotion) return this.render();
    try {
      this.vt?.skipTransition?.();
      this.vt = d.startViewTransition(() => this.render());
    } catch {
      this.render();
    }
  }

  render() {
    if (!this.s) return;
    const app = this.el['app-root'];
    app.classList.toggle('placing', this.s.phase === 'place' && this.s.actor === ME);
    app.classList.toggle('swapping', this.s.phase === 'swap' && this.s.actor === ME);
    app.classList.toggle('show-panel', this.prefs.showPanel);
    this.el['panel-btn'].textContent = this.prefs.showPanel ? 'Ocultar painel' : 'Painel';
    this.el['panel-btn'].setAttribute('aria-pressed', String(this.prefs.showPanel));
    this.resize();
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

  private highlights() {
    const s = this.s;
    const h = { play: new Set<string>(), choose: new Set<number>(), swap: new Set<string>(), hinted: new Set<string>() };
    if (this.myMove()) {
      if (s.phase === 'place' && this.sel?.kind === 'hand' && this.draft) {
        const trick = this.isTrickUid(this.sel.uid);
        for (const row of ['front', 'back'] as Row[]) {
          if (trick && row === 'front') continue;
          this.draft[row].forEach((u, c) => u === null && h.play.add(`${ME}:${row}:${c}`));
        }
      }
      if (s.phase === 'choose') openColumns(s).forEach((c) => h.choose.add(c));
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
      if (a.type === 'swap') {
        h.hinted.add(`${ME}:back:${a.a}`);
        h.hinted.add(`${ME}:back:${a.b}`);
      }
      if (a.type === 'flip') h.hinted.add(a.flip ? 'act:flip-yes' : 'act:flip-no');
      if (a.type === 'exchange') h.hinted.add(a.exchange ? 'act:exchange-yes' : 'act:exchange-no');
      if (a.type === 'done') h.hinted.add('act:done');
      if (a.type === 'place') h.hinted.add('act:confirm');
    }
    return h;
  }

  private draftCard(uid: number): CardInst | undefined {
    const p = this.s.players[ME];
    return p.hand.find((x) => x.uid === uid) ?? p.trickHand.find((x) => x.uid === uid);
  }

  private renderSides() {
    const s = this.s;
    const h = this.highlights();
    const clashCol = s.clash && (s.phase === 'flip' || s.phase === 'exchange' || s.phase === 'resolve' || s.phase === 'swap' || this.busy) ? s.clash.col : -1;
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
          if (h.swap.has(key)) slotCls.push('can-swap');
          if (this.sel?.kind === 'swap' && mine && row === 'back' && this.sel.col === c) slotCls.push('selected');
          if (this.sel?.kind === 'draft' && mine && this.sel.row === row && this.sel.col === c) slotCls.push('selected');
          if (h.hinted.has(key)) slotCls.push('hinted');
          if (colState?.resolved) slotCls.push('locked');
          if (c === clashCol) slotCls.push('clash');

          let inner = `<span class="slot-label">${row === 'front' ? 'Front' : 'Back'}<br>${c + 1}</span>`;
          const draftUid = mine && this.draft ? this.draft[row][c] : null;
          if (draftUid !== null) {
            const card = this.draftCard(draftUid);
            if (card) inner = cardHtml(card, { row, cls: ['concealed'], badge: ICON.eyeOff, vt: true });
          } else {
            const x = p[row][c];
            if (x) {
              const cls: string[] = [];
              const fx = this.fx.get(x.card.uid);
              if (fx) cls.push(fx);
              if (x.revealed) inner = cardHtml(x.card, { row, cls, vt: true });
              else if (mine) inner = cardHtml(x.card, { row, cls: [...cls, 'concealed'], badge: ICON.eyeOff, vt: true });
              else inner = backHtml(cls.join(' '));
            }
          }
          let mark = '';
          if (row === 'front' && colState?.resolved && colState.winner === pid) mark = `<span class="col-mark won">duelo</span>`;
          if (row === 'back' && colState?.resolved && mine) mark += `<span class="lock-mark" title="Campo travado">${ICON.lock}</span>`;
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
    if (this.s.phase !== 'over' && this.s.phase !== 'coin' && this.s.actor === pid && !['resolve', 'roundOver'].includes(this.s.phase)) cls.push('acting');
    const pips = Array.from({ length: RULES.duelsToWinRound }, (_, i) => `<i class="${i < p.duelWins ? 'on' : ''}"></i>`).join('');
    return `<div class="${cls.join(' ')}" data-plate="${pid}" style="height:100%">
      <div class="who">${pid === ME ? 'Você' : 'Bot'}</div>
      <div class="life">${p.points}</div>
      <div class="life-label">rodadas de ${RULES.pointsToWin}</div>
      <div class="life-bar"><i style="width:${pct}%"></i></div>
      <div class="duel-pips" title="Duelos vencidos nesta rodada">${pips}</div>
      <div class="life-label">duelos</div>
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
    const me = s.players[ME];
    const placing = s.phase === 'place' && s.actor === ME;
    const inDraft = new Set(this.draft ? [...this.draft.front, ...this.draft.back].filter((x): x is number => x !== null) : []);
    const cardsOf = (list: CardInst[], vt = true) =>
      list
        .filter((c) => !inDraft.has(c.uid))
        .map((c) => {
          const cls = this.sel?.kind === 'hand' && this.sel.uid === c.uid ? ['selected'] : [];
          return cardHtml(c, { cls, attrs: `data-hand="${c.uid}" tabindex="0" role="button"`, vt });
        })
        .join('');
    const handMe = this.el['hand-me'];
    handMe.classList.toggle('locked', !this.myMove());
    handMe.classList.toggle('compact', !placing);
    if (placing) {
      const max = maxBack(me);
      handMe.innerHTML = `
        <div class="hand-group"><div class="hand-label">Personagens · frontline ou backline</div><div class="hand-cards">${cardsOf(me.hand) || '<span class="hand-empty">—</span>'}</div></div>
        <div class="hand-group tricks"><div class="hand-label">Truques e equipamentos · só backline</div><div class="hand-cards">${cardsOf(me.trickHand) || '<span class="hand-empty">—</span>'}</div></div>
        <div class="hand-need">Frontline: 5 personagens (obrigatório). Backline: opcional, de 0 a ${max} carta(s), personagem ou truque. O que não for para a mesa fica na mão.</div>`;
    } else {
      handMe.innerHTML = `<div class="hand-summary">Na sua mão: ${me.hand.length} personagem(ns) e ${me.trickHand.length} truque(s)/equipamento(s). Eles entram na próxima distribuição.</div>
        ${me.hand.length + me.trickHand.length ? `<div class="hand-cards mini">${cardsOf([...me.hand, ...me.trickHand], false)}</div>` : ''}`;
    }
    const opp = s.players[BOT];
    this.el['hand-opp'].innerHTML = `<span class="opp-hand-note">Mão do bot: ${opp.hand.length} personagem(ns) · ${opp.trickHand.length} truque(s)/equipamento(s)</span>`;
  }

  private renderStepper() {
    const s = this.s;
    const cur = STEPS.findIndex((st) => st.phases.includes(s.phase));
    this.el.stepper.innerHTML = STEPS.map((st, i) => {
      const state = s.phase === 'coin' || s.phase === 'over' ? '' : i < cur ? 'done' : i === cur ? 'current' : '';
      return `<li class="step ${state}"><span class="step-dot">${i + 1}</span><span class="step-label">${st.label}</span></li>`;
    }).join('');
  }

  private renderStrip() {
    const s = this.s;
    const [me, bot] = s.players;
    this.renderStepper();
    this.el['turn-no'].innerHTML =
      s.phase === 'coin'
        ? 'Preparação'
        : `<b>Rodada ${s.round}</b> de até ${RULES.maxRounds} · <b>Duelo ${Math.max(1, s.duelInRound)}</b> · Placar <b>${me.points} × ${bot.points}</b>`;
    const who = this.el['turn-who'];
    who.classList.remove('thinking');
    if (s.phase === 'over') who.textContent = s.winner === ME ? 'Vitória' : s.winner === BOT ? 'Derrota' : 'Empate';
    else if (s.phase === 'coin') who.textContent = 'Cara ou coroa';
    else if (s.phase === 'resolve' || s.phase === 'roundOver') who.textContent = PHASE_PT[s.phase];
    else if (s.actor === BOT) {
      who.textContent = `${PHASE_PT[s.phase]} · vez do bot`;
      who.classList.add('thinking');
    } else who.textContent = `${PHASE_PT[s.phase]} · sua vez`;

    let clash = '';
    if (s.clash && s.players[0].front[s.clash.col]?.revealed && s.players[1].front[s.clash.col]?.revealed) {
      const c = s.clash.col;
      const st = duelStanding(s, c);
      clash = st.byPrinciple
        ? `Campo ${c + 1}: vantagem de princípio para ${st.leader === ME ? 'você' : 'o bot'}`
        : `Campo ${c + 1}: você ${st.totals[0]} × ${st.totals[1]} bot`;
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

  /** Botões da faixa central: mesma altura e estilo; instruções em texto simples. */
  private actionButtons(): string {
    const s = this.s;
    const h = this.highlights();
    const hc = (k: string) => (h.hinted.has(`act:${k}`) ? ' hinted' : '');
    if (!this.myMove()) return '';
    const hint = `<button class="btn btn-secondary" data-act="hint" title="Atalho: H">Dica</button>`;
    const note = (t: string) => `<span class="strip-note">${t}</span>`;
    switch (s.phase) {
      case 'place': {
        const ready = this.draft && !this.draft.front.includes(null) && validatePlace(s, { type: 'place', front: this.draft.front as number[], back: this.draft.back }) === null;
        return `${hint}<button class="btn btn-secondary" data-act="auto">Automático</button><button class="btn btn-secondary" data-act="clear">Limpar</button><button class="btn btn-primary${hc('confirm')}" data-act="confirm" ${ready ? '' : 'disabled'}>Confirmar</button>`;
      }
      case 'choose':
        return `${note('Clique num campo livre')}${hint}`;
      case 'flip': {
        const c = s.clash!;
        const back = s.players[ME].back[c.col]!.card;
        const label = isTrick(back.defId) ? `Virar ${getTrick(back.defId).name}` : `Virar (+DEF ${getDef(back.defId).def})`;
        return `${hint}<button class="btn btn-secondary${hc('flip-no')}" data-act="flip-no">Não virar</button><button class="btn btn-primary${hc('flip-yes')}" data-act="flip-yes">${label}</button>`;
      }
      case 'exchange': {
        const c = s.clash!;
        const back = getDef(s.players[ME].back[c.col]!.card.defId);
        const front = getDef(s.players[ME].front[c.col]!.card.defId);
        return `${note(`${esc(back.name)} (ATK ${back.atk}) na frente; ${esc(front.name)} soma DEF ${front.def}`)}${hint}<button class="btn btn-secondary${hc('exchange-no')}" data-act="exchange-no">Manter</button><button class="btn btn-primary${hc('exchange-yes')}" data-act="exchange-yes">Trocar com a frontline</button>`;
      }
      case 'swap':
        return s.players[ME].swapsThisTurn
          ? `${note('Clique em duas casas para trocar de novo')}${hint}<button class="btn btn-primary${hc('done')}" data-act="done">Pronto</button>`
          : `${note('Para mover, arraste uma backline ou clique em duas casas')}${hint}<button class="btn btn-primary${hc('done')}" data-act="done">Não mover</button>`;
      default:
        return '';
    }
  }

  private findVisible(uid: number): { card: CardInst; row?: Row } | null {
    const s = this.s;
    if (this.draft) {
      const c = this.draftCard(uid);
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

  /** Carta grande + o que ela faz (usado na janela flutuante e no painel). */
  private cardDetailsHtml(card: CardInst, row?: Row): string {
    if (isTrick(card.defId)) {
      const t = getTrick(card.defId);
      return `${cardHtml(card, { big: true })}<div class="details"><b>${t.kind === 'truque' ? 'Truque' : 'Equipamento'}.</b> ${esc(t.text)}<br><small>Vai virado na backline durante a distribuição e dispara quando você o vira no duelo daquele campo. No fim da rodada, vai ao cemitério 2.</small></div>`;
    }
    const d = getDef(card.defId);
    const beatsList = PRINCIPLE_BEATS[d.principle].map((x) => PRINCIPLE_LABEL[x]).join(', ');
    const losesTo = (Object.keys(PRINCIPLE_BEATS) as Principle[]).filter((k) => PRINCIPLE_BEATS[k].includes(d.principle)).map((x) => PRINCIPLE_LABEL[x]);
    const where = row === 'front' ? 'Está na frontline: disputa com o ATK.' : row === 'back' ? 'Está na backline: se virada no duelo, soma a DEF.' : '';
    return `${cardHtml(card, { big: true, row })}
      <div class="details">
        <b>${PRINCIPLE_LABEL[d.principle]}</b> vence ${beatsList}${losesTo.length ? `; perde para ${losesTo.join(', ')}` : ''}.
        ${d.principle === 'realeza' ? ' Se for revelada, vai ao <b>exílio</b> no fim da rodada; oculta, vai ao cemitério.' : ''}<br>
        ATK ${d.atk} na frontline · DEF ${d.def} na backline. ${where}
      </div>`;
  }

  private renderInspector() {
    const box = this.el.inspector;
    const found = this.inspectUid !== null ? this.findVisible(this.inspectUid) : null;
    box.innerHTML = found ? this.cardDetailsHtml(found.card, found.row) : `<div class="placeholder">Passe o mouse ou toque numa carta para ver os detalhes.</div>`;
  }

  private tipText(): string {
    const s = this.s;
    if (s.phase === 'coin') return 'Escolha cara ou coroa para decidir a iniciativa.';
    if (s.phase === 'over') return 'Partida encerrada. Clique em “Nova partida” para jogar de novo.';
    if (s.phase === 'resolve') return 'Apurando o duelo…';
    if (s.phase === 'roundOver') return 'Rodada decidida. Veja o placar e avance.';
    if (s.actor === BOT) return 'O bot está decidindo. Acompanhe o registro abaixo.';
    switch (s.phase) {
      case 'place':
        return this.sel?.kind === 'hand'
          ? 'Agora clique numa casa vazia do seu lado. Truques só vão para a backline.'
          : 'Arraste as cartas da mão para as casas (ou clique na carta e depois na casa). Frente: o ATK disputa o campo. Trás: personagem soma a DEF se virado; truque dispara o efeito quando virado.';
      case 'choose':
        return 'Você venceu no d6: clique num campo livre. As duas frontlines dele serão reveladas.';
      case 'flip':
        return s.clash!.stage === 'loser'
          ? 'Você está perdendo este duelo. Virar a backline soma a DEF (personagem) ou dispara o efeito (truque). Se não virar, ela continua oculta e pode trocar de lugar depois.'
          : 'O bot virou a backline. Você pode virar a sua para responder.';
      case 'exchange':
        return 'Você virou um personagem. Pode colocá-lo na frente deste duelo no lugar da frontline (a antiga vai para trás e soma a DEF dela). Só é permitido quando o princípio dele não vence o da frontline rival.';
      case 'swap':
        return 'Fim do duelo: se quiser, troque de lugar backlines ocultas dos campos que ainda não lutaram. Campos já disputados ficam travados.';
      default:
        return '';
    }
  }

  private renderCoach() {
    const rec = this.stats[this.prefs.difficulty];
    const toggle = `<button class="btn btn-secondary" data-act="tips">${this.prefs.showTips ? 'Ocultar dicas' : 'Mostrar dicas'}</button>`;
    let body = '';
    if (this.prefs.showTips) {
      const hint = this.hint ? `<p class="hint-text"><b>Sugestão:</b> ${this.hint.text}.<br><small>${this.hint.d.reason}</small></p>` : '';
      body = `<p>${this.tipText()}</p>${hint}`;
    }
    this.el.coach.innerHTML = `<div class="row">${toggle}</div>${body}
      <div class="stats-line">Contra o bot ${DIFFICULTY_LABEL[this.prefs.difficulty]}: ${rec.wins} V · ${rec.losses} D</div>`;
  }

  private renderLog() {
    if (!this.prefs.showPanel) return;
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
    <text x="130" y="110" text-anchor="middle" class="w-note">vence todos · revelada, vai ao exílio</text>
    <text x="130" y="168" text-anchor="middle" class="w-note">seta = “vence”</text>
  </svg>`;
}

function rulesHtml(): string {
  const principle = PRINCIPLE_MODE === 'dominante' ? 'Vantagem de princípio vence o duelo.' : `Vantagem de princípio soma +${PRINCIPLE_BONUS}.`;
  return `<ul class="rules-list">
    <li>Início da rodada: compre 1 truque por duelo perdido na rodada anterior.</li>
    <li>Distribuição: 5 personagens virados na frontline; a backline é opcional (personagens ou truques, virados). O resto fica na mão.</li>
    <li>Duelo: d6 → quem tirar mais escolhe o campo → as frontlines são reveladas. ${principle} Sem vantagem: ATK × ATK.</li>
    <li>Quem perde pode virar a backline: personagem soma DEF, truque dispara o efeito. Se virar, o outro pode responder.</li>
    <li>Personagem virado pode trocar de lugar com a frontline, se o princípio dele não vencer o da frontline rival. A antiga frontline soma a DEF.</li>
    <li>Empate: d6 até desempatar. Fim do duelo: você decide se troca de lugar as backlines ocultas dos campos que ainda não lutaram.</li>
    <li>Rodada: quem vencer ${RULES.duelsToWinRound} duelos leva 1 ponto. Tudo vai ao cemitério; Realeza revelada, ao exílio.</li>
    <li>Vence quem fizer ${RULES.pointsToWin} pontos (no máximo ${RULES.maxRounds} rodadas).</li>
  </ul>
  <h3 class="rules-sub">Truques e equipamentos</h3>
  <ul class="rules-list">${TRICKS.map((t) => `<li><b>${esc(t.name)}</b> (${t.kind}): ${esc(t.text.replace('Ao ser virado: ', ''))}</li>`).join('')}</ul>`;
}
