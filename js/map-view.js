// 지도 그리기: 시군 모양(확대되는 층) 위에 이름·핀·화살표(글자 크기가 그대로인 층)를 얹습니다.
// 확대는 [+] [−] [처음 크기] 단추와 "이 시군 크게 보기"로만 합니다. 한 손가락으로 밀면 지도가 움직입니다.
import { esc } from './util.js?v=34';

const NS = 'http://www.w3.org/2000/svg';
const PAD = 22;
const MAX_ZOOM = 7;
const TAP_SLOP = 10;

export const shortName = (n) => n.replace(/(시|군)$/, '');

export function createMapView(el, data, h) {
  const regById = new Map(data.regions.map((r) => [r.id, r]));
  const ull = data.regions.find((r) => r.inset);
  const ib = ull.inset.box;

  el.innerHTML = `
    <svg class="map-svg" aria-label="경상북도 시군 지도">
      <rect class="sea" x="-9999" y="-9999" width="19998" height="19998"></rect>
      <g class="world">
        <g class="nbs">${data.neighbors.map((n) => `<path d="${n.d}"></path>`).join('')}</g>
        <rect class="inset" data-id="${ull.id}" x="${ib[0]}" y="${ib[1]}" width="${ib[2]}" height="${ib[3]}" rx="6"></rect>
        <g class="regs">${data.regions.map((r) => `<path data-id="${r.id}" d="${r.d}"></path>`).join('')}</g>
        <path class="sel-outline" d=""></path>
      </g>
    </svg>
    <svg class="arrows-svg">
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#2A6F7D"></path></marker>
        <marker id="ahs" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#FF6B57"></path></marker>
      </defs>
      <g class="arrows"></g>
    </svg>
    <div class="labels"></div>
    <div class="zoom">
      <button type="button" class="zbtn" data-zoom="in" aria-label="크게">+</button>
      <button type="button" class="zbtn" data-zoom="out" aria-label="작게">−</button>
      <button type="button" class="zbtn home" data-zoom="home">처음 크기</button>
    </div>
    <div class="credit">${esc(data.source)}</div>`;

  const svg = el.querySelector('.map-svg');
  const world = el.querySelector('.world');
  const regPaths = new Map([...el.querySelectorAll('.regs path')].map((p) => [+p.dataset.id, p]));
  const insetRect = el.querySelector('.inset');
  const selOutline = el.querySelector('.sel-outline');
  const arrowsG = el.querySelector('.arrows');
  const labels = el.querySelector('.labels');

  let view = { s: 1, tx: 0, ty: 0 };
  let homeS = 1;
  let model = { counts: {}, selected: null, mine: new Set(), arrows: [], pick: null, selArrow: null, tint: {} };
  let labelEls = [];
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const W = () => el.clientWidth;
  const H = () => el.clientHeight;
  const toScreen = ([x, y]) => [x * view.s + view.tx, y * view.s + view.ty];

  function fit(b, maxS) {
    const [x0, y0, x1, y1] = b;
    const s = Math.min((W() - PAD * 2) / (x1 - x0), (H() - PAD * 2) / (y1 - y0), maxS || Infinity);
    return { s, tx: W() / 2 - ((x0 + x1) / 2) * s, ty: H() / 2 - ((y0 + y1) / 2) * s };
  }
  function clamp(v) {
    const s = Math.min(Math.max(v.s, homeS), homeS * MAX_ZOOM);
    const [x0, y0, x1, y1] = data.home;
    const tx = Math.min(Math.max(v.tx, W() * 0.4 - x1 * s), W() * 0.6 - x0 * s);
    const ty = Math.min(Math.max(v.ty, H() * 0.4 - y1 * s), H() * 0.6 - y0 * s);
    return { s, tx, ty };
  }

  let anim = 0;
  function go(target, instant) {
    target = clamp(target);
    cancelAnimationFrame(anim);
    if (instant || reduce) { view = target; paint(); return; }
    const from = { ...view };
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 240);
      const e = 1 - Math.pow(1 - k, 3);
      view = { s: from.s + (target.s - from.s) * e, tx: from.tx + (target.tx - from.tx) * e, ty: from.ty + (target.ty - from.ty) * e };
      paint();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  let sizedW = 0; // 처음 크기를 마지막으로 맞춘 때의 지도 칸 너비(화면이 숨겨져 있을 때는 0)
  function home(instant) {
    const v = fit(data.home);
    homeS = v.s;
    sizedW = W();
    go(v, instant);
  }
  function zoomBy(f) {
    const cx = W() / 2, cy = H() / 2;
    const s = Math.min(Math.max(view.s * f, homeS), homeS * MAX_ZOOM);
    const k = s / view.s;
    go({ s, tx: cx - (cx - view.tx) * k, ty: cy - (cy - view.ty) * k });
  }
  function focus(id) {
    const r = regById.get(id);
    if (!r) return;
    const [x0, y0, x1, y1] = r.bbox;
    const m = Math.max(x1 - x0, y1 - y0) * 0.25;
    go(fit([x0 - m, y0 - m, x1 + m, y1 + m], homeS * MAX_ZOOM));
  }

  // ---------- 그리기 ----------
  function paint() {
    world.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.s})`);
    const pos = labelEls.map(({ pt }) => toScreen(pt));
    spread(pos);
    labelEls.forEach(({ node }, i) => {
      node.style.transform = `translate(${pos[i][0].toFixed(1)}px, ${pos[i][1].toFixed(1)}px)`;
    });
    paintArrows();
  }

  // 시군 핀과 이름이 서로 겹치면 겹친 만큼만 조금씩 밀어냅니다(제자리에서 최대 32px까지).
  // 핀이 있는 시군을 먼저 지키고, 이름만 있는 쪽을 더 많이 밉니다.
  function spread(pos) {
    const items = labelEls.map((l, i) => ({ i, w: l.w, h: l.h, pin: l.pin, x0: pos[i][0], y0: pos[i][1] })).filter((l) => l.w);
    for (let round = 0; round < 10; round++) {
      let moved = false;
      for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
        const A = items[a], B = items[b];
        const pa = pos[A.i], pb = pos[B.i];
        const ox = (A.w + B.w) / 2 + 2 - Math.abs(pa[0] - pb[0]);
        const oy = (A.h + B.h) / 2 + 2 - Math.abs(pa[1] - pb[1]);
        if (ox <= 0 || oy <= 0) continue;
        const wa = A.pin && !B.pin ? 0.25 : !A.pin && B.pin ? 0.75 : 0.5;
        if (ox < oy) { const s = pa[0] < pb[0] ? -1 : 1; pa[0] += s * ox * wa; pb[0] -= s * ox * (1 - wa); }
        else { const s = pa[1] < pb[1] ? -1 : 1; pa[1] += s * oy * wa; pb[1] -= s * oy * (1 - wa); }
        moved = true;
      }
      for (const it of items) {
        const p = pos[it.i];
        p[0] = Math.min(it.x0 + 32, Math.max(it.x0 - 32, p[0]));
        p[1] = Math.min(it.y0 + 32, Math.max(it.y0 - 32, p[1]));
      }
      if (!moved) break;
    }
  }

  function pinPoint(id) {
    return regById.get(id).label;
  }

  function paintArrows() {
    const groups = new Map();
    model.arrows.forEach((a) => {
      const pair = a.from < a.to ? a.from + '-' + a.to : a.to + '-' + a.from;
      if (!groups.has(pair)) groups.set(pair, []);
      groups.get(pair).push(a);
    });
    let html = '';
    let selHtml = '';
    groups.forEach((list) => {
      list.forEach((a, i) => {
        const lo = Math.min(a.from, a.to), hi = Math.max(a.from, a.to);
        const [ax, ay] = toScreen(pinPoint(lo));
        const [bx, by] = toScreen(pinPoint(hi));
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const bend = (i % 2 ? -1 : 1) * (0.2 + Math.floor(i / 2) * 0.18) * len;
        const cx = (ax + bx) / 2 - (dy / len) * bend;
        const cy = (ay + by) / 2 + (dx / len) * bend;
        let [sx, sy, ex, ey] = a.from === lo ? [ax, ay, bx, by] : [bx, by, ax, ay];
        const trim = (px, py, d) => {
          const l = Math.hypot(cx - px, cy - py) || 1;
          return [px + ((cx - px) / l) * d, py + ((cy - py) / l) * d];
        };
        [sx, sy] = trim(sx, sy, 20);
        [ex, ey] = trim(ex, ey, 26);
        const d = `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
        const sel = a.key === model.selArrow;
        const part = sel
          ? `<path class="arw-under" d="${d}"></path><path class="arw sel" d="${d}" marker-end="url(#ahs)"></path>`
          : `<path class="arw flow" d="${d}" marker-end="url(#ah)"></path>`;
        const hit = `<path class="arw-hit" data-arrow="${esc(a.key)}" d="${d}"></path>`;
        if (sel) {
          // 곡선의 한가운데(Q 곡선에서 t=0.5)에 이유 딱지를 얹습니다.
          const mx = (sx + 2 * cx + ex) / 4, my = (sy + 2 * cy + ey) / 4;
          selHtml += part + hit + `<g transform="translate(${mx.toFixed(1)} ${my.toFixed(1)})"><g class="why-badge"><circle r="19"></circle><path d="M-9 -7 H9 A2.5 2.5 0 0 1 11.5 -4.5 V3 A2.5 2.5 0 0 1 9 5.5 H0 L-5 10 V5.5 H-9 A2.5 2.5 0 0 1 -11.5 3 V-4.5 A2.5 2.5 0 0 1 -9 -7 Z"></path></g></g>`;
        } else html += part + hit;
      });
    });
    arrowsG.innerHTML = html + selHtml;
  }

  function buildLabels() {
    const out = [];
    let html = '';
    data.neighbors.forEach((n) => {
      if (!n.name) return;
      out.push({ pt: n.label });
      html += `<span class="nbname">${esc(n.name)}</span>`;
    });
    // 울릉 상자 안내
    // 상자 아래에 둡니다(위쪽은 교류 제안서의 [화살표 잇기] 단추가 가리기 때문).
    out.push({ pt: [ib[0] + ib[2] / 2, ib[1] + ib[3]] });
    html += '<span class="inset-note">울릉군<small>보기 편하게 위치와 크기를 바꿨어요</small></span>';
    out.push({ pt: ull.inset.dokdo });
    html += `<span class="dokdo-note" data-id="${ull.id}">독도</span>`;
    data.regions.forEach((r) => {
      const n = model.counts[r.id] || 0;
      const cls = [r.id === model.selected ? 'sel' : '', model.mine.has(r.id) ? 'mine' : '', r.id === model.pick ? 'pick' : ''].join(' ');
      out.push({ pt: r.label });
      html += n
        ? `<button type="button" class="pin ${cls}" data-id="${r.id}"><span>${esc(shortName(r.name))}</span><b>${n}</b></button>`
        : `<button type="button" class="rname ${cls}" data-id="${r.id}">${esc(shortName(r.name))}</button>`;
    });
    labels.innerHTML = html;
    const nodes = labels.children;
    // 시군 핀·이름만 겹침을 풉니다(이웃 지역 이름, 울릉 안내는 제자리).
    labelEls = out.map((o, i) => {
      const node = nodes[i];
      const region = node.matches('.pin, .rname');
      return { node, pt: o.pt, pin: node.matches('.pin'), w: region ? node.offsetWidth : 0, h: region ? (node.matches('.pin') ? node.offsetHeight : 30) : 0 };
    });
  }

  function update(m) {
    model = { ...model, ...m };
    regPaths.forEach((p, id) => {
      p.classList.toggle('sel', id === model.selected);
      p.classList.toggle('mine', model.mine.has(id));
      p.classList.toggle('has', !!model.counts[id]);
      p.style.fill = model.tint[id] || '';
    });
    insetRect.classList.toggle('sel', model.selected === ull.id);
    const selR = model.selected != null && model.selected !== ull.id ? regById.get(model.selected) : null;
    selOutline.setAttribute('d', selR ? selR.d : '');
    buildLabels();
    paint();
  }

  // ---------- 누르기와 밀기 ----------
  let drag = null;
  let moved = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.zoom')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, v: { ...view } };
    moved = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = h.getScale();
    const dx = (e.clientX - drag.x) / k, dy = (e.clientY - drag.y) / k;
    if (!moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    moved = true;
    cancelAnimationFrame(anim);
    view = clamp({ s: drag.v.s, tx: drag.v.tx + dx, ty: drag.v.ty + dy });
    paint();
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  el.addEventListener('click', (e) => {
    if (moved) { moved = false; e.stopPropagation(); return; }
    const z = e.target.closest('[data-zoom]');
    if (z) {
      const k = z.dataset.zoom;
      if (k === 'in') zoomBy(1.5); else if (k === 'out') zoomBy(1 / 1.5); else home();
      return;
    }
    const a = e.target.closest('[data-arrow]');
    if (a) { h.onArrow(a.dataset.arrow); return; }
    const r = e.target.closest('[data-id]');
    if (r) { h.onRegion(+r.dataset.id); return; }
    h.onBlank();
  });
  svg.addEventListener('dragstart', (e) => e.preventDefault());

  return {
    update,
    home,
    focus,
    // 지도 칸이 숨겨져 있다가 보이게 되었으면(너비가 달라졌으면) 처음 크기로 다시 맞춥니다.
    resize() { if (!W()) return; if (sizedW !== W()) { home(true); return; } const v = fit(data.home); homeS = v.s; go(view, true); },
    regionName: (id) => (regById.get(id) || {}).name || '',
    regions: data.regions,
  };
}
