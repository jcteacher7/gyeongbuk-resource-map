// 화면 점검 도구(개발용): 브라우저에서 지금 보이는 화면을 재서 문제를 찾아 줍니다. 앱은 이 파일을 쓰지 않습니다.
// 쓰는 법: 개발자 도구 콘솔에서  (await import('/tools/audit.js')).audit('화면 이름')
// 재는 것: 누르는 곳 크기(44px 미만), 작은 글씨(14px 미만), 잘린 글, 색 대비(4.5:1 미만), 지도 글자 겹침
// 크기는 1280×800 무대 기준(px)입니다. 태블릿에서는 주소창 때문에 약 0.9배로 보입니다.

const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const parse = (c) => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0]; };
function bgOf(el) {
  // 가장 가까운 불투명 배경을 찾아 반투명 색을 차례로 섞습니다.
  const stack = [];
  for (let e = el; e; e = e.parentElement) {
    const c = parse(getComputedStyle(e).backgroundColor);
    const a = c.length > 3 ? c[3] : 1;
    if (a > 0) { stack.push([c[0], c[1], c[2], a]); if (a >= 1) break; }
  }
  let out = [230, 245, 242];
  for (const [r, g, b, a] of stack.reverse()) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
  return out;
}
const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
const say = (el) => (el.getAttribute('aria-label') || el.innerText || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 14);

export function audit(name) {
  const stage = document.getElementById('stage');
  const k = +(stage.style.transform.match(/scale\(([\d.]+)\)/) || [0, 1])[1];
  const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.left / k, y: b.top / k, w: b.width / k, h: b.height / k }; };
  const seen = (el) => {
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
    // 가려져 있지 않고 실제로 맨 위에 보이는 것만
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !!top && (el.contains(top) || top.contains(el));
  };
  const roots = [...stage.children].filter((c) => !c.hidden);
  const all = roots.flatMap((r) => [...r.querySelectorAll('*')]).filter(seen);

  const small = new Map();
  for (const el of all.filter((e) => e.matches('button, a, input:not([type=file]), select, textarea, label.btn'))) {
    const b = box(el);
    if (Math.min(b.w, b.h) < 44) { const key = label(el); small.set(key, [Math.round(b.w), Math.round(b.h), say(el), (small.get(key) || [0, 0, '', 0])[3] + 1]); }
  }
  const tiny = new Map(), low = new Map(), cut = new Map();
  for (const el of all) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const key = label(el);
    if (fs < 14) tiny.set(key, [fs, say(el), (tiny.get(key) || [0, '', 0])[2] + 1]);
    const fg = parse(cs.color), bg = bgOf(el);
    const a = fg.length > 3 ? fg[3] : 1;
    const mix = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    const l1 = lum(mix), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const need = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700) ? 3 : 4.5;
    if (ratio < need) low.set(key, [ratio.toFixed(2), need, Math.round(fs), say(el), (low.get(key) || [0, 0, 0, '', 0])[4] + 1]);
    if (el.scrollWidth > el.clientWidth + 1 && ['hidden', 'clip'].includes(cs.overflowX)) cut.set(key, [say(el), (cut.get(key) || ['', 0])[1] + 1]);
  }
  // 지도 글자·핀 겹침
  const labs = [...document.querySelectorAll('.labels > *')].filter(seen).map((el) => ({ t: say(el), ...box(el) }));
  const over = [];
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
    const a = labs[i], b = labs[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 3 && oy > 3) over.push(`${a.t}×${b.t}`);
  }
  // 무대 밖으로 나간 것
  const out = all.filter((el) => { const b = box(el); return b.w > 2 && (b.x + b.w > 1281 || b.y + b.h > 801 || b.x < -1 || b.y < -1); }).map(label);
  const arr = (m) => [...m].map(([k2, v]) => `${k2}: ${v.join(' | ')}`);
  return { name, scale: k, small: arr(small), tiny: arr(tiny), lowContrast: arr(low), cut: arr(cut), overlap: over, outside: [...new Set(out)].slice(0, 8) };
}
