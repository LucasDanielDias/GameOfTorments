import {
  BOT_DELAY_MS,
  DIFFICULTY_LABEL,
  PRINCIPLE_BEATS,
  PRINCIPLE_BONUS,
  PRINCIPLE_LABEL,
  PRINCIPLE_MODE,
  RULES,
  type Difficulty,
  type Principle,
} from '../config';
import { createBot, describeAction, type Bot, type BotDecision } from '../ai/bot';
import { getDef } from '../engine/cards';
import {
  applyAction,
  attackTargets,
  canAttackWith,
  moveTargets,
  newGame,
  other,
  previewCombat,
  unitAt,
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

type Sel = { kind: 'hand'; uid: number } | { kind: 'unit'; row: Row; col: number } | null;
type PileKind = 'deck' | 'tricks' | 'grave' | 'graveTricks' | 'exile';

interface LogItem {
  cls: string;
  text: string;
}

interface HotApi {
  snapshot?: (fn: () => unknown) => void;
}

export class App {
  private s!: GameState;
  private prefs = loadPrefs();
  private stats = loadStats();
  private bot!: Bot;
  private sel: Sel = null;
  private busy = false;
  private hint: { d: BotDecision; text: string } | null = null;
  private inspectUid: number | null = null;
  private fx = new Map<number, string>();
  private pulse = new Set<string>();
  private matchId = 0;
  private log: LogItem[] = [];
  private lastDie = 6;
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
    const hot = (window as unknown as { claude?: { hot?: HotApi } }).claude?.hot;
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
                <div class="chips" id="chips"></div>
              </div>
              <div class="tokens">
                <div><div class="coin-mini" id="coin-mini"></div><div class="token-label">Moeda</div></div>
                <div><div class="die" id="die"></div><div class="token-label">d6</div></div>
              </div>
              <div class="actions">
                <button class="btn ghost" data-act="hint" title="Atalho: H">Dica</button>
                <button class="btn" data-act="end" id="end-btn" title="Atalho: E">Encerrar turno</button>
              </div>
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
          <div class="box wheel"><h2>Princípios</h2>${wheelSvg()}${rulesHtml()}</div>
          <div class="box"><h2>Registro</h2><div class="log" id="log" aria-live="polite"></div></div>
        </aside>
      </main>
      <div id="overlay-root"></div>
      <div class="toast" id="toast" hidden></div>
    </div>`;
    const q = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;
    for (const id of ['app-root', 'table', 'hand-opp', 'hand-me', 'side-opp', 'side-me', 'turn-no', 'turn-who', 'chips', 'coin-mini', 'die', 'dice-readout', 'end-btn', 'inspector', 'coach', 'log', 'overlay-root', 'toast', 'mute-btn']) {
      this.el[id] = q(id);
    }
    (q('explain') as HTMLInputElement).checked = this.prefs.explain;
    (q('reduce') as HTMLInputElement).checked = this.prefs.reduceMotion;
    this.el['app-root'].classList.toggle('reduce-motion', this.prefs.reduceMotion);
  }

  private bind() {
    const r = this.root;
    r.addEventListener('pointerdown', () => sound.unlock(), { once: false });
    r.addEventListener('click', (e) => this.onClick(e));
    r.addEventListener('mouseover', (e) => {
      if (!matchMedia('(hover: hover)').matches) return;
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-uid]');
      if (c && !c.closest('.pile-grid')) {
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
      } else if (e.key === 'e' || e.key === 'E') this.endTurn();
      else if (e.key === 'h' || e.key === 'H') this.askHint();
    });
  }

  private resize() {
    const table = this.el.table;
    const narrow = table.clientWidth < 640;
    const gap = narrow ? 3 : 8;
    const pad = narrow ? 6 : 14;
    const availW = table.clientWidth - 2 * pad - 2 - 8 * gap;
    let cw = Math.floor(availW / 9);
    if (window.innerWidth > 980) {
      // cabeçalho, faixa central, folgas e mãos: 4 linhas de campo + mão (1.4) + mão do bot (0.7)
      const availH = window.innerHeight - 340;
      cw = Math.min(cw, Math.floor(availH / 7.7));
    }
    cw = Math.max(28, Math.min(104, cw));
    this.root.style.setProperty('--cw', `${cw}px`);
    this.root.style.setProperty('--gap', `${gap}px`);
    this.root.style.setProperty('--mat-pad', `${pad}px`);
    this.el['app-root'].classList.toggle('tiny', cw < 62);
  }

  // ─── Partida ───────────────────────────────────────────────────────────

  start(restore?: { s?: GameState; log?: LogItem[] }) {
    if (restore?.s) {
      this.s = restore.s;
      this.log = restore.log ?? [];
      this.matchId++;
      this.bot = createBot({ difficulty: this.prefs.difficulty });
      this.recorded = this.s.phase === 'over';
      this.render();
      if (this.s.phase === 'coin') this.showCoin();
      else if (this.s.phase === 'main' && this.s.current === BOT) void this.runBot();
      return;
    }
    this.newMatch();
  }

  private newMatch() {
    this.matchId++;
    this.s = newGame({ seed: randomSeed(), names: ['Você', 'Bot de Treino'] });
    this.bot = createBot({ difficulty: this.prefs.difficulty });
    this.sel = null;
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

  private myTurn() {
    return this.s.phase === 'main' && this.s.current === ME && !this.busy;
  }

  private async perform(a: Action) {
    this.busy = true;
    this.sel = null;
    this.hint = null;
    const id = this.matchId;
    const events = applyAction(this.s, a);
    await this.animate(events);
    if (id !== this.matchId) return;
    this.logEvents(events);
    this.busy = false;
    this.render();
    if (this.s.phase === 'over') this.finish();
  }

  private async endTurn() {
    if (!this.myTurn()) return;
    await this.perform({ type: 'end' });
    if (this.s.phase === 'main' && this.s.current === BOT) void this.runBot();
  }

  private async runBot() {
    const id = this.matchId;
    this.busy = true;
    this.renderStrip();
    while (this.s.phase === 'main' && this.s.current === BOT && id === this.matchId) {
      await sleep(this.prefs.reduceMotion ? 150 : BOT_DELAY_MS);
      if (id !== this.matchId) return;
      const d = this.bot.decide(this.s);
      if (this.prefs.explain && d.action.type !== 'end') {
        const what = describeAction(this.s, d.action).replace(/^Baixar .*? na/, 'Baixar carta na');
        this.pushLog('why', `Bot pensou: ${what.charAt(0).toLowerCase()}${what.slice(1)}. ${d.reason}`);
      }
      await this.perform(d.action);
      this.busy = this.s.current === BOT && this.s.phase === 'main';
    }
    if (id === this.matchId) {
      this.busy = false;
      this.render();
    }
  }

  private askHint() {
    if (!this.myTurn()) return;
    const helper = createBot({ difficulty: 'dificil', budgetMs: 220 });
    const d = helper.decide(this.s);
    this.hint = { d, text: describeAction(this.s, d.action) };
    this.render();
  }

  // ─── Entrada ───────────────────────────────────────────────────────────

  private onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    sound.unlock();

    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) return this.onAct(act, t.closest<HTMLElement>('[data-act]')!);

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

    const handCard = t.closest<HTMLElement>('[data-hand]');
    if (handCard) {
      const uid = Number(handCard.dataset.hand);
      this.inspectUid = uid;
      if (this.myTurn() && this.s.players[ME].playsLeft > 0) {
        this.sel = this.sel?.kind === 'hand' && this.sel.uid === uid ? null : { kind: 'hand', uid };
      } else if (this.myTurn()) {
        this.toast('Você já baixou uma carta neste turno.');
      }
      this.render();
      return;
    }

    const plate = t.closest<HTMLElement>('[data-plate]');
    if (plate) {
      const pid = Number(plate.dataset.plate) as PlayerId;
      if (pid === BOT && this.sel?.kind === 'unit' && this.myTurn()) {
        const col = this.sel.col;
        if (attackTargets(this.s, col).some((x) => x.kind === 'player')) {
          void this.perform({ type: 'attack', col, target: { kind: 'player' } });
        }
      }
      return;
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
        if (this.s.phase === 'main' && this.s.turn > 2) return this.confirmNew();
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
      case 'end':
        return void this.endTurn();
      case 'coin':
        return void this.flipCoin(el.dataset.call as CoinSide);
      case 'tricks':
        return this.toast('Truques e equipamentos chegam na próxima etapa.');
    }
  }

  private onSlot(pid: PlayerId, row: Row, col: number) {
    const unit = unitAt(this.s.players[pid], row, col);
    if (unit) this.inspectUid = unit.card.uid;
    if (!this.myTurn()) return this.render();

    if (pid === ME) {
      if (this.sel?.kind === 'hand' && !unit && this.s.players[ME].playsLeft > 0) {
        return void this.perform({ type: 'play', uid: this.sel.uid, row, col });
      }
      if (this.sel?.kind === 'unit') {
        const from = this.sel;
        if (from.row === row && from.col === col) {
          this.sel = null;
          return this.render();
        }
        if (moveTargets(this.s, from.row, from.col).some((m) => m.row === row && m.col === col)) {
          return void this.perform({ type: 'move', fromRow: from.row, fromCol: from.col, toRow: row, toCol: col });
        }
      }
      this.sel = unit ? { kind: 'unit', row, col } : null;
      if (unit && row === 'front' && !canAttackWith(this.s, col) && this.s.players[ME].movesLeft === 0) {
        this.toast(this.whyCantAttack(col));
      }
      return this.render();
    }

    // lado do bot: ataque
    if (this.sel?.kind === 'unit' && this.sel.row === 'front' && unit) {
      const atkCol = this.sel.col;
      if (attackTargets(this.s, atkCol).some((x) => x.kind === 'unit' && x.row === row && x.col === col)) {
        return void this.perform({ type: 'attack', col: atkCol, target: { kind: 'unit', row, col } });
      }
      this.toast(this.whyCantAttack(atkCol, row, col));
    }
    this.render();
  }

  private whyCantAttack(col: number, row?: Row, tcol?: number): string {
    const u = this.s.players[ME].front[col];
    if (!u) return 'Só cartas na frontline atacam.';
    if (RULES.firstTurnNoAttack && this.s.turn === 1) return 'Ninguém ataca no primeiro turno da partida.';
    if (u.attacked) return 'Esta carta já atacou neste turno.';
    if (RULES.summoningSickness && u.enteredTurn === this.s.turn) return 'Carta recém-baixada só ataca no próximo turno.';
    if (row === 'back') return 'A backline só pode ser atacada quando a frente daquela coluna estiver vazia.';
    if (tcol !== undefined && Math.abs(tcol - col) > RULES.attackReach) return 'Fora de alcance: a frontline ataca a coluna da frente e as vizinhas.';
    return 'Sem alvo válido.';
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
        case 'play':
          this.fx.set(ev.uid, 'enter');
          sound.play('card');
          break;
        case 'move':
          this.fx.set(ev.uid, 'enter');
          if (ev.swappedUid) this.fx.set(ev.swappedUid, 'enter');
          sound.play('move');
          break;
        case 'attack': {
          const att = this.q(`.side [data-uid="${ev.combat.attackerUid}"]`);
          const tgt = ev.combat.defenderUid !== null
            ? this.q(`.side [data-uid="${ev.combat.defenderUid}"]`)
            : this.q(`[data-plate="${other(ev.player)}"]`);
          if (att && tgt && !fast) {
            const a = att.getBoundingClientRect();
            const b = tgt.getBoundingClientRect();
            const dx = (b.left + b.width / 2 - (a.left + a.width / 2)) * 0.6;
            const dy = (b.top + b.height / 2 - (a.top + a.height / 2)) * 0.6;
            att.style.zIndex = '20';
            att.style.position = 'relative';
            await att.animate(
              [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(1.06)`, offset: 0.55 }, { transform: 'none' }],
              { duration: 420, easing: 'cubic-bezier(.3,.7,.3,1)' },
            ).finished.catch(() => undefined);
          }
          sound.play(ev.combat.winner === 'direct' ? 'direct' : 'hit');
          tgt?.classList.add(ev.combat.winner === 'direct' ? 'hurt' : 'hit');
          if (ev.combat.dice.length) await this.rollDice(ev.combat.dice, ev.player);
          else this.diceText = '';
          await wait(160);
          break;
        }
        case 'destroy': {
          const el = this.q(`.side [data-uid="${ev.uid}"]`);
          el?.classList.add('dying');
          sound.play('break');
          this.pulse.add(`${ev.owner}:${ev.to === 'exilio' ? 'exile' : 'grave'}`);
          await wait(430);
          break;
        }
        case 'damage':
          this.q(`[data-plate="${ev.player}"]`)?.classList.add('hurt');
          await wait(250);
          break;
        case 'turn':
          if (ev.player === ME) sound.play('turn');
          break;
        case 'draw':
          if (ev.player === ME) this.fx.set(ev.uid, 'enter');
          break;
      }
    }
  }

  private async rollDice(dice: [number, number][], attacker: PlayerId) {
    sound.play('dice');
    const die = this.el.die;
    const fast = this.prefs.reduceMotion;
    for (const [a, d] of dice) {
      if (!fast) {
        die.classList.add('rolling');
        for (let i = 0; i < 6; i++) {
          die.innerHTML = dieSvg(1 + Math.floor(Math.random() * 6));
          await sleep(60);
        }
        die.classList.remove('rolling');
      }
      die.innerHTML = dieSvg(a);
      await sleep(fast ? 50 : 280);
      die.innerHTML = dieSvg(d);
      await sleep(fast ? 50 : 280);
    }
    const [a, d] = dice[dice.length - 1];
    this.lastDie = d;
    const who = (p: PlayerId) => (p === ME ? 'você' : 'bot');
    this.diceText = `Empate decidido no d6 · ${who(attacker)} ${a} × ${d} ${who(other(attacker))}`;
    this.el['dice-readout'].textContent = this.diceText;
  }

  // ─── Moeda ─────────────────────────────────────────────────────────────

  private showCoin() {
    this.openOverlay(`
      <div class="modal" role="dialog" aria-label="Cara ou coroa">
        <div class="eyebrow">Quem começa?</div>
        <h2>Cara ou coroa</h2>
        <div class="coin3d" id="coin3d"><div class="coin-inner">
          <div class="coin-face">${coinSvg('cara')}</div>
          <div class="coin-face tails">${coinSvg('coroa')}</div>
        </div></div>
        <p id="coin-text">Escolha um lado. Se acertar, você começa. Quem começa não compra nem ataca no primeiro turno.</p>
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
    const starts = ev.starter === ME ? 'Você começa.' : 'O bot começa.';
    this.q('#coin-text')!.textContent = `Você pediu ${call}, deu ${ev.result}. ${starts}`;
    this.q('#coin-buttons')!.innerHTML = `<button class="btn" data-act="close">Para a mesa</button>`;
    this.logEvents(events);
    this.busy = false;
    this.render();
    const go = () => {
      if (id !== this.matchId) return;
      this.closeOverlay();
      if (this.s.current === BOT) void this.runBot();
    };
    this.q('#coin-buttons button')!.addEventListener('click', go, { once: true });
  }

  // ─── Fim de jogo ───────────────────────────────────────────────────────

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
    const sub = w === ME ? 'O campo é seu.' : w === BOT ? 'O bot levou esta.' : 'Ninguém cedeu.';
    this.openOverlay(`
      <div class="modal" role="dialog" aria-label="${title}">
        <div class="eyebrow">Fim da partida · turno ${this.s.turn}</div>
        <h2>${title}</h2>
        <p>${sub} Vida final: você ${Math.max(0, me.life)} × ${Math.max(0, bot.life)} bot.
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
    if (kind === 'tricks') return this.toast('Deck de truques e equipamentos: as regras chegam na próxima etapa.');
    if (kind === 'deck') return this.toast(`${owner === 'Seu' ? 'Seu deck' : 'Deck do bot'} de personagens: ${p.charDeck.length} carta(s).`);
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
    root.innerHTML = `<div class="overlay" ${dismissable ? 'data-backdrop' : ''}>${html}</div>`;
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
    this.toastTimer = window.setTimeout(() => (t.hidden = true), 2600);
  }

  // ─── Registro ──────────────────────────────────────────────────────────

  private pushLog(cls: string, text: string) {
    this.log.push({ cls, text });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
  }

  private logEvents(events: GameEvent[]) {
    const nm = (uid: number) => {
      for (const p of this.s.players) {
        const all = [...p.hand, ...p.graveChars, ...p.exile, ...p.front.map((u) => u?.card), ...p.back.map((u) => u?.card)];
        const c = all.find((x) => x && x.uid === uid);
        if (c) return getDef(c.defId).name;
      }
      return 'carta';
    };
    const who = (p: PlayerId) => (p === ME ? 'Você' : 'O bot');
    const cls = (p: PlayerId) => (p === ME ? 'me' : 'bot');
    for (const ev of events) {
      switch (ev.kind) {
        case 'coin':
          this.pushLog('big', `Moeda: você pediu ${ev.call}, deu ${ev.result}. ${ev.starter === ME ? 'Você começa' : 'O bot começa'}.`);
          break;
        case 'turn':
          this.pushLog('turn-mark', `Turno ${ev.turn} · ${ev.player === ME ? 'sua vez' : 'vez do bot'}`);
          break;
        case 'draw':
          this.pushLog(cls(ev.player), ev.player === ME ? `Você comprou ${nm(ev.uid)}.` : 'O bot comprou uma carta.');
          break;
        case 'handFull':
          this.pushLog(cls(ev.player), `${who(ev.player)} está com a mão cheia e não comprou.`);
          break;
        case 'play':
          this.pushLog(cls(ev.player), `${who(ev.player)} baixou ${nm(ev.uid)} na ${ROW_PT[ev.row]}, coluna ${ev.col + 1}.`);
          break;
        case 'move':
          this.pushLog(cls(ev.player), `${who(ev.player)} moveu ${nm(ev.uid)} para a ${ROW_PT[ev.toRow]}, coluna ${ev.toCol + 1}${ev.swappedUid ? ` (troca com ${nm(ev.swappedUid)})` : ''}.`);
          break;
        case 'attack': {
          const c = ev.combat;
          if (c.winner === 'direct') {
            this.pushLog(cls(ev.player), `${nm(c.attackerUid)} atacou diretamente.`);
          } else {
            const a = `${c.attValue}${c.attBonus ? `+${c.attBonus}` : ''}`;
            const d = `${c.defValue}${c.defBonus ? `+${c.defBonus}` : ''}`;
            const res = c.reason === 'dados' ? `empate, d6 ${c.dice.map(([x, y]) => `${x}×${y}`).join(', ')}` : c.reason === 'dominante' ? 'vantagem dominante' : `${a} × ${d}`;
            this.pushLog(cls(ev.player), `${nm(c.attackerUid)} atacou ${nm(c.defenderUid!)} (${res}): ${c.winner === 'att' ? 'atacante vence' : 'defensor resiste'}.`);
          }
          break;
        }
        case 'destroy':
          this.pushLog(cls(ev.owner), `${nm(ev.uid)} foi para ${ev.to === 'exilio' ? 'o exílio' : 'o cemitério'}.`);
          break;
        case 'damage':
          this.pushLog(cls(ev.player), `${who(ev.player)} sofreu ${ev.amount} de dano (vida ${Math.max(0, ev.life)}).`);
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

  private highlights() {
    const h = {
      play: new Set<string>(),
      attack: new Set<string>(),
      move: new Set<string>(),
      attackPlayer: false,
      hinted: new Set<string>(),
      hintPlate: false,
    };
    if (this.myTurn() && this.sel) {
      if (this.sel.kind === 'hand') {
        this.s.players[ME].front.forEach((u, c) => !u && h.play.add(`front:${c}`));
        this.s.players[ME].back.forEach((u, c) => !u && h.play.add(`back:${c}`));
      } else {
        if (this.sel.row === 'front') {
          for (const t of attackTargets(this.s, this.sel.col)) {
            if (t.kind === 'player') h.attackPlayer = true;
            else h.attack.add(`${t.row}:${t.col}`);
          }
        }
        for (const m of moveTargets(this.s, this.sel.row, this.sel.col)) h.move.add(`${m.row}:${m.col}`);
      }
    }
    if (this.hint && this.myTurn()) {
      const a = this.hint.d.action;
      if (a.type === 'play') {
        h.hinted.add(`hand:${a.uid}`);
        h.hinted.add(`${ME}:${a.row}:${a.col}`);
      } else if (a.type === 'move') {
        h.hinted.add(`${ME}:${a.fromRow}:${a.fromCol}`);
        h.hinted.add(`${ME}:${a.toRow}:${a.toCol}`);
      } else if (a.type === 'attack') {
        h.hinted.add(`${ME}:front:${a.col}`);
        if (a.target.kind === 'player') h.hintPlate = true;
        else h.hinted.add(`${BOT}:${a.target.row}:${a.target.col}`);
      }
    }
    return h;
  }

  private renderSides() {
    const h = this.highlights();
    for (const pid of [ME, BOT] as PlayerId[]) {
      const p = this.s.players[pid];
      const mine = pid === ME;
      const rowLine: Record<Row, number> = mine ? { front: 1, back: 2 } : { back: 1, front: 2 };
      const cells: string[] = [];
      const at = (col: number, row: number, html: string, span = false) =>
        cells.push(`<div style="grid-column:${col};grid-row:${span ? '1 / span 2' : row};min-width:0">${html}</div>`);

      for (const row of ['front', 'back'] as Row[]) {
        for (let c = 0; c < RULES.boardColumns; c++) {
          const u = p[row][c];
          const key = `${row}:${c}`;
          const slotCls = ['slot', row];
          if (mine && h.play.has(key)) slotCls.push('can-play');
          if (mine && h.move.has(key) && !u) slotCls.push('target-move');
          if (h.hinted.has(`${pid}:${key}`) && !u) slotCls.push('hinted');
          let inner = `<span class="slot-label">${row === 'front' ? 'Front' : 'Back'}<br>${c + 1}</span>`;
          if (u) {
            const cls: string[] = [];
            const fx = this.fx.get(u.card.uid);
            if (fx) cls.push(fx);
            const sick = RULES.summoningSickness && u.enteredTurn === this.s.turn && this.s.current === pid;
            if (u.attacked) cls.push('spent');
            if (mine && row === 'front' && this.myTurn() && canAttackWith(this.s, c)) cls.push('ready');
            if (mine && this.sel?.kind === 'unit' && this.sel.row === row && this.sel.col === c) cls.push('selected');
            if (!mine && h.attack.has(key)) cls.push('target-attack');
            if (mine && h.move.has(key)) cls.push('target-move');
            if (h.hinted.has(`${pid}:${key}`)) cls.push('hinted');
            inner = cardHtml(u.card, { row, cls, badge: sick ? ICON.hourglass : undefined });
          }
          at(3 + c, rowLine[row], `<div class="${slotCls.join(' ')}" data-slot="${pid}:${row}:${c}" aria-label="${ROW_PT[row]} ${c + 1}">${inner}</div>`);
        }
      }

      const plate = this.plateHtml(pid, !mine && h.attackPlayer, !mine && h.hintPlate);
      const deck = this.pileHtml(pid, 'deck');
      const tricks = this.pileHtml(pid, 'tricks');
      const grave = this.pileHtml(pid, 'grave');
      const graveT = this.pileHtml(pid, 'graveTricks');
      const exile = this.pileHtml(pid, 'exile');
      if (mine) {
        at(1, 1, plate, true);
        at(2, 1, tricks);
        at(8, 1, deck);
        at(8, 2, exile);
        at(9, 1, grave);
        at(9, 2, graveT);
      } else {
        at(1, 1, graveT);
        at(1, 2, grave);
        at(2, 1, exile);
        at(2, 2, deck);
        at(8, 2, tricks);
        at(9, 1, plate, true);
      }
      this.el[mine ? 'side-me' : 'side-opp'].innerHTML = cells.join('');
    }
  }

  private plateHtml(pid: PlayerId, target: boolean, hinted: boolean) {
    const p = this.s.players[pid];
    const pct = Math.max(0, Math.min(100, (p.life / RULES.startingLife) * 100));
    const cls = ['plate'];
    if (target) cls.push('target-attack');
    if (hinted) cls.push('hinted');
    return `<div class="${cls.join(' ')}" data-plate="${pid}" style="height:100%">
      <div class="who">${pid === ME ? 'Você' : 'Bot'}</div>
      <div class="life">${Math.max(0, p.life)}</div>
      <div class="life-label">Vida</div>
      <div class="life-bar"><i style="width:${pct}%"></i></div>
      <div class="meta">Mão ${p.hand.length}<br>Deck ${p.charDeck.length}</div>
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
        return `<button class="pile stack" data-pile="${pid}:tricks" aria-label="Deck de truques e equipamentos">${backs(p.trickDeck)}<span class="soon">em breve</span><span class="count">${p.trickDeck}</span><span class="pile-name">Truques/Equip.</span></button>`;
      case 'grave':
      case 'graveTricks':
      case 'exile': {
        const list = kind === 'grave' ? p.graveChars : kind === 'exile' ? p.exile : p.graveTricks;
        const top = list[list.length - 1];
        const label = kind === 'grave' ? 'Cemitério 1' : kind === 'exile' ? 'Exílio' : 'Cemitério 2';
        const inner = top ? cardHtml(top, { cls: ['spent'] }) + `<span class="pile-name">${label}</span>` : `<span class="slot-label">${label}</span>`;
        return `<button class="pile${kind === 'exile' ? ' exile' : ''}${pulse}" data-pile="${pid}:${kind}" aria-label="${label}: ${list.length}">${inner}${list.length ? `<span class="count">${list.length}</span>` : ''}</button>`;
      }
    }
  }

  private renderHands() {
    const h = this.highlights();
    const me = this.s.players[ME];
    const handMe = this.el['hand-me'];
    handMe.classList.toggle('locked', !this.myTurn());
    handMe.innerHTML = me.hand.length
      ? me.hand
          .map((c) => {
            const cls: string[] = [];
            if (this.sel?.kind === 'hand' && this.sel.uid === c.uid) cls.push('selected');
            if (h.hinted.has(`hand:${c.uid}`)) cls.push('hinted');
            const fx = this.fx.get(c.uid);
            if (fx) cls.push(fx);
            return cardHtml(c, { cls, attrs: `data-hand="${c.uid}" tabindex="0" role="button"` });
          })
          .join('')
      : '<span class="hand-empty">Mão vazia</span>';
    const opp = this.s.players[BOT];
    this.el['hand-opp'].innerHTML = opp.hand.map(() => backHtml()).join('') || '<span class="hand-empty">Bot sem cartas na mão</span>';
  }

  private renderStrip() {
    const s = this.s;
    const me = s.players[ME];
    this.el['turn-no'].textContent = s.phase === 'coin' ? 'Preparação' : `Turno ${s.turn} de até ${RULES.maxTurns}`;
    const who = this.el['turn-who'];
    who.classList.remove('thinking');
    if (s.phase === 'coin') who.textContent = 'Cara ou coroa';
    else if (s.phase === 'over') who.textContent = s.winner === ME ? 'Vitória' : s.winner === BOT ? 'Derrota' : 'Empate';
    else if (s.current === ME) who.textContent = 'Sua vez';
    else {
      who.textContent = 'Bot pensando';
      who.classList.add('thinking');
    }
    const showChips = s.phase === 'main' && s.current === ME;
    const noAtk = RULES.firstTurnNoAttack && s.turn === 1;
    this.el.chips.innerHTML = showChips
      ? `<span class="chip${me.playsLeft ? '' : ' off'}">Baixar ${me.playsLeft}/${RULES.playsPerTurn}</span>
         <span class="chip${me.movesLeft ? '' : ' off'}">Mover ${me.movesLeft}/${RULES.movesPerTurn}</span>
         <span class="chip${noAtk ? ' off' : ''}">Atacar</span>`
      : '';
    this.el['coin-mini'].innerHTML = coinSvg(s.starter === null ? 'cara' : s.starter === ME ? 'cara' : 'coroa');
    this.el['coin-mini'].title = s.starter === null ? 'A moeda decide quem começa' : `Começou: ${s.starter === ME ? 'você' : 'bot'}`;
    if (!this.el.die.classList.contains('rolling')) this.el.die.innerHTML = dieSvg(this.lastDie);
    this.el['dice-readout'].textContent = this.diceText;
    (this.el['end-btn'] as HTMLButtonElement).disabled = !this.myTurn();
    this.root.querySelectorAll<HTMLButtonElement>('[data-act="hint"]').forEach((b) => (b.disabled = !this.myTurn()));
  }

  private findVisible(uid: number): { card: CardInst; row?: Row; owner: PlayerId } | null {
    for (const pid of [ME, BOT] as PlayerId[]) {
      const p = this.s.players[pid];
      for (const row of ['front', 'back'] as Row[]) {
        const u = p[row].find((x) => x?.card.uid === uid);
        if (u) return { card: u.card, row, owner: pid };
      }
      const pools = pid === ME ? [p.hand, p.graveChars, p.exile] : [p.graveChars, p.exile];
      for (const list of pools) {
        const c = list.find((x) => x.uid === uid);
        if (c) return { card: c, owner: pid };
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
    const d = getDef(found.card.defId);
    const beatsList = PRINCIPLE_BEATS[d.principle].map((x) => PRINCIPLE_LABEL[x]).join(', ');
    const losesTo = (Object.keys(PRINCIPLE_BEATS) as Principle[]).filter((k) => PRINCIPLE_BEATS[k].includes(d.principle)).map((x) => PRINCIPLE_LABEL[x]);
    const where = found.row ? `Em campo na <b>${ROW_PT[found.row]}</b>: usa ${found.row === 'front' ? `ATK ${d.atk}` : `DEF ${d.def}`}.` : `Na frontline usa ATK ${d.atk}; na backline, DEF ${d.def}.`;
    let preview = '';
    if (this.sel?.kind === 'unit' && this.sel.row === 'front' && found.owner === BOT && found.row && this.myTurn()) {
      const att = this.s.players[ME].front[this.sel.col];
      if (att) {
        const p = previewCombat(att.card, found.card, found.row);
        const odds = p.dominant ? (p.dominant === 'att' ? 'vence por dominância' : 'perde por dominância') : p.pAttWins === 1 ? 'vitória certa' : p.pAttWins === 0 ? 'derrota certa' : '50% no d6';
        const tCol = this.s.players[BOT][found.row].findIndex((u) => u?.card.uid === found.card.uid);
        const reach = attackTargets(this.s, this.sel.col).some((t) => t.kind === 'unit' && t.row === found.row && t.col === tCol);
        preview = `<div class="preview">Seu ${getDef(att.card.defId).name}: ${p.attValue}${p.attBonus ? `+${p.attBonus}` : ''} × ${p.defValue}${p.defBonus ? `+${p.defBonus}` : ''} → <b>${odds}</b>${reach ? '' : ' (fora de alcance)'}</div>`;
      }
    }
    box.innerHTML = `${cardHtml(found.card, { big: true, row: found.row })}
      <div class="details">
        <b>${PRINCIPLE_LABEL[d.principle]}</b>${beatsList ? ` vence ${beatsList}` : ''}${losesTo.length ? `; perde para ${losesTo.join(', ')}` : ''}.
        ${d.principle === 'realeza' ? ' Ao ser derrotada, vai para o <b>exílio</b>.' : ''}<br>${where}
        ${preview}
      </div>`;
  }

  private renderCoach() {
    const s = this.s;
    const rec = this.stats[this.prefs.difficulty];
    let tip = '';
    if (s.phase === 'coin') tip = 'Escolha cara ou coroa para decidir quem começa.';
    else if (s.phase === 'over') tip = 'Partida encerrada. Clique em “Nova partida” para jogar de novo.';
    else if (s.current === BOT) tip = 'O bot está jogando. Acompanhe o registro abaixo.';
    else if (this.sel?.kind === 'hand') tip = 'Agora clique numa casa vazia. Frontline usa o ATK; backline usa a DEF e protege a coluna.';
    else if (this.sel?.kind === 'unit') tip = this.sel.row === 'front' ? 'Alvos em vermelho podem ser atacados. Casas tracejadas em azul aceitam movimento.' : 'Cartas na backline não atacam, mas podem se mover (tracejado azul).';
    else if (s.players[ME].playsLeft > 0 && s.players[ME].hand.length) tip = 'Selecione uma carta da mão para baixar, ou uma carta em campo para atacar ou mover.';
    else tip = 'Ataque com as cartas contornadas ou encerre o turno (tecla E).';
    const hint = this.hint ? `<p class="hint-text"><b>Sugestão:</b> ${this.hint.text}.<br><small>${this.hint.d.reason}</small></p>` : '';
    this.el.coach.innerHTML = `<p>${tip}</p>${hint}
      <div class="row"><button class="btn ghost" data-act="hint" ${this.myTurn() ? '' : 'disabled'}>Pedir dica ao bot</button></div>
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
      ? // rosto: sol com olhos fechados
        `<circle cx="50" cy="48" r="16" class="mark"/><path class="mark" d="M43 46q3 3 6 0M51 46q3 3 6 0M44 55q6 5 12 0"/>${Array.from({ length: 8 }, (_, i) => {
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
  const bonus = PRINCIPLE_MODE === 'bonus' ? `Vantagem de princípio soma +${PRINCIPLE_BONUS}.` : 'Vantagem de princípio vence direto.';
  return `<ul class="rules-list">
    <li>Baixe ${RULES.playsPerTurn} personagem por turno; mova ${RULES.movesPerTurn} carta (front ↔ back ou casa vizinha).</li>
    <li>Frontline usa ATK e ataca a coluna da frente e as vizinhas. Backline usa DEF e protege a coluna.</li>
    <li>A backline só é atacada com a frente da coluna vazia. Coluna toda vazia: dano direto na vida.</li>
    <li>${bonus} Empate: d6 decide.</li>
    <li>Vida inicial ${RULES.startingLife}. Zere a do rival para vencer.</li>
  </ul>`;
}
