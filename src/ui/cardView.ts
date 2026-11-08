import { PRINCIPLE_LABEL } from '../config';
import { getDef, getTrick, isTrick } from '../engine/cards';
import type { CardInst, Row } from '../engine/game';
import versoEmblema from '../assets/verso-emblema.jpg';
import { ART, ICON, emblemSvg, trickSvg } from './art';

export interface CardViewOpts {
  row?: Row;
  big?: boolean;
  cls?: string[];
  badge?: string;
  attrs?: string;
  /** nome de transição: a carta desliza suavemente quando muda de lugar */
  vt?: boolean;
}

function vtStyle(card: CardInst, o: CardViewOpts): string {
  return o.vt ? `style="view-transition-name: c${card.uid}"` : '';
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Frente da carta de personagem. ATK no canto superior esquerdo, DEF no direito. */
export function cardHtml(card: CardInst, o: CardViewOpts = {}): string {
  if (isTrick(card.defId)) return trickHtml(card, o);
  const d = getDef(card.defId);
  const cls = ['card', `p-${d.principle}`];
  if (o.row === 'front') cls.push('in-front');
  if (o.row === 'back') cls.push('in-back');
  if (o.big) cls.push('lg');
  if (o.cls) cls.push(...o.cls);
  const art = d.art && ART[d.art];
  const artHtml = art
    ? `<div class="art has-img"><img src="${art}" alt="" loading="lazy" draggable="false"></div>`
    : `<div class="art">${emblemSvg(d.principle)}</div>`;
  const crown = d.principle === 'realeza' ? ICON.crown : '';
  return `<div class="${cls.join(' ')}" data-uid="${card.uid}" ${o.attrs ?? ''} ${vtStyle(card, o)} aria-label="${esc(d.name)}, ${PRINCIPLE_LABEL[d.principle]}, ataque ${d.atk}, defesa ${d.def}">
    <div class="face">
      <div class="stat atk" title="Ataque (frontline)">${ICON.sword}${d.atk}</div>
      <div class="stat def" title="Defesa (backline)">${d.def}${ICON.shield}</div>
      ${artHtml}
      <div class="name">${esc(d.name)}</div>
      <div class="text">${esc(d.text)}</div>
      <div class="ptag">${crown}${PRINCIPLE_LABEL[d.principle]}</div>
      ${o.badge ? `<div class="badge">${o.badge}</div>` : ''}
    </div>
  </div>`;
}

/** Verso: igual para todas as cartas (personagens e truques). */
export function backHtml(extra = ''): string {
  return `<div class="card back ${extra}" aria-label="Carta virada">
    <div class="face">
      <div class="seal"><img src="${versoEmblema}" alt="" draggable="false"></div>
      <div class="back-title">Game of<br>Torments</div>
    </div>
  </div>`;
}

/** Carta de truque/equipamento: sem ATK, DEF ou princípio; só nome, tipo e efeito. */
export function trickHtml(card: CardInst, o: CardViewOpts = {}): string {
  const d = getTrick(card.defId);
  const cls = ['card', 'trick', `k-${d.kind}`];
  if (o.big) cls.push('lg');
  if (o.cls) cls.push(...o.cls);
  return `<div class="${cls.join(' ')}" data-uid="${card.uid}" ${o.attrs ?? ''} ${vtStyle(card, o)} aria-label="${esc(d.name)}, ${d.kind}">
    <div class="face">
      <div class="art">${trickSvg(d.id)}</div>
      <div class="name">${esc(d.name)}</div>
      <div class="text">${esc(d.text)}</div>
      <div class="ptag">${d.kind === 'truque' ? 'Truque' : 'Equipamento'}</div>
    </div>
  </div>`;
}
