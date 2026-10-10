import mapData from '../data/gyeongbuk-map.js?v=32';
import { store } from './store.js?v=32';
import { createMapView, shortName } from './map-view.js?v=32';
import { shrinkPhoto } from './photo.js?v=32';
import { esc, safeLink, josa, timeText } from './util.js?v=32';
import { MAX_LEN } from './config.js?v=32';
import { DEMO_ROSTER, DEFAULT_TEXTS, DEFAULT_TAG, DEFAULT_CHAT, GROUP_COLORS, ERA, EXAMPLE_CID, EXAMPLE_RES, EXAMPLE_HINT, ARROW_TIP, withDefaults } from './defaults.js?v=32';
import { createTagView } from './tag-view.js?v=32';
import { createChatView } from './chat-view.js?v=32';
import { createTeacher, hashCode } from './teacher.js?v=32';

const $ = (s, r = document) => r.querySelector(s);
const stage = $('#stage');

// ---------- 화면 크기: 1280×800 무대를 비율 그대로 늘이고 줄입니다 ----------
let scale = 1;
function fitStage() {
  if (typingNow()) return; // 자판이 올라와 있을 때는 크기를 바꾸지 않음
  const w = window.innerWidth, h = window.innerHeight;
  scale = Math.min(w / 1280, h / 800);
  stage.style.transform = `translate(${(w - 1280 * scale) / 2}px, ${(h - 800 * scale) / 2}px) scale(${scale})`;
}
window.addEventListener('resize', fitStage);

// ---------- 한글 입력 보호: 글자를 조합하거나 입력칸에 있는 동안에는 다시 그리지 않음 ----------
let composing = false;
let renderQueued = false;
document.addEventListener('compositionstart', () => { composing = true; }, true);
document.addEventListener('compositionend', () => {
  composing = false;
  if (renderQueued) setTimeout(requestRender, 0);
}, true);
document.addEventListener('focusout', () => setTimeout(() => { if (renderQueued) requestRender(); }, 60), true);
function typingNow() {
  if (composing) return true;
  const a = document.activeElement;
  return !!a && ((a.tagName === 'INPUT' && !['file', 'button', 'checkbox', 'radio'].includes(a.type)) || a.tagName === 'TEXTAREA');
}
// 입력칸이 있는 부분은 따로 한 번만 그리므로, 다른 부분은 글자를 조합하는 순간만 피해서 그립니다.
function requestRender() {
  if (composing) { renderQueued = true; return; }
  renderQueued = false;
  renderAll();
}

// ---------- 상태 ----------
const S = {
  me: null, // { g: 모둠 번호, n: 이름 } — 기기에 기억하지 않음(늘 처음 화면에서 시작)
  tab: 'map',
  selected: null,
  arrowMode: null, // { from: 자원 key | null }
  selArrow: null,
  enterGroup: null,
  enterName: null,
};
let modal = null;

const TEACHER = { g: 0, n: '선생님', teacher: true };

function roster() {
  const r = store.get('cfg', 'roster');
  return r && Array.isArray(r.groups) && r.groups.length ? r : DEMO_ROSTER;
}
const groupName = (g) => (g === 0 ? '선생님' : (roster().groups.find((x) => x.id === g) || { name: g + '모둠' }).name);
const ownerOf = (cid) => (roster().assign || {})[cid];
const isTeacher = () => !!(S.me && S.me.teacher);
const canAdd = (cid) => cid !== EXAMPLE_CID && (isTeacher() || ownerOf(cid) == null || ownerOf(cid) === S.me.g);
const myCounties = () => mapData.regions.filter((r) => S.me && ownerOf(r.id) === S.me.g).map((r) => r.id);
const texts = () => withDefaults(store.get('cfg', 'texts'), DEFAULT_TEXTS);
const tagCfg = () => withDefaults(store.get('cfg', 'tagcfg'), DEFAULT_TAG);
const chatCfg = () => withDefaults(store.get('cfg', 'chatcfg'), DEFAULT_CHAT);
const stages = () => store.get('cfg', 'stages') || {};
const regionName = (id) => (mapData.regions.find((r) => r.id === id) || {}).name || '';
// 교류 제안서 화면: 완성된 자원 지도 위에서 모둠이 제안 지역 하나를 정하고 화살표를 잇습니다. 화살표는 모둠별로 따로 봅니다.
const isPlan = () => S.tab === 'plan';
const onMapView = () => S.tab === 'map' || S.tab === 'plan';
const planOf = (g) => (store.get('plan', 'g' + g) || {}).cid ?? null;
const planView = () => {
  const ids = roster().groups.map((g) => g.id);
  if (ids.includes(S.planGroup)) return S.planGroup;
  return !isTeacher() && ids.includes(S.me.g) ? S.me.g : ids[0];
};
const groupColor = (g) => GROUP_COLORS[Math.max(0, roster().groups.findIndex((x) => x.id === g)) % GROUP_COLORS.length];
const planMine = () => !isTeacher() && planView() === S.me.g;
const planArrows = () => arrowsAll().filter((a) => a.by && a.by.g === planView());
const sameMe = (by) => !!by && !!S.me && by.g === S.me.g && by.n === S.me.n;
const byText = (by) => (by ? (by.g === 0 ? '선생님' : `${groupName(by.g)} · ${by.n}`) : '');
const ENV = { nat: '자연환경', hum: '인문환경' };
const AMT = { many: '많아요', few: '적어요' };

// 예시 지역(문경)의 예시 카드는 앱에 들어 있고, 아이들이 올린 카드는 서버에서 옵니다.
function resAll() {
  return EXAMPLE_RES.concat(store.list('res').filter((r) => r.cid !== EXAMPLE_CID).sort((a, b) => (a.at || 0) - (b.at || 0)));
}
const resGet = (key) => resAll().find((r) => r.key === key);
function resMap() {
  return new Map(resAll().map((r) => [r.key, r]));
}
function arrowsAll() {
  const rm = resMap();
  return store.list('arrow')
    .filter((a) => rm.has(a.from) && rm.has(a.to))
    .map((a) => ({ ...a, fromRes: rm.get(a.from), toRes: rm.get(a.to) }))
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}

// ---------- 그리기 ----------
let mapView = null;
let lastPanel = '';
let lastMapSig = '';

function renderAll() {
  if (S.teacherScreen) { teacher.render(); refreshModal(); return; }
  if (!S.me) { renderEnter(); return; }
  renderTop();
  renderTabs();
  if (onMapView() && (S.tab === 'map' || stages().plan || isTeacher())) {
    renderMap();
    renderPanel();
  }
  refreshModal();
}

function renderEnter() {
  $('#enter').hidden = false;
  $('#main').hidden = true;
  $('#teacher').hidden = true;
  const r = roster();
  const g = r.groups.find((x) => x.id === S.enterGroup);
  const names = g ? g.members : [];
  const ready = g && names.includes(S.enterName);
  $('#enter').innerHTML = `
    <div class="enter">
      <div class="enter-title" data-act="secret">${ICON.pin}<span>경상북도 자원 지도</span></div>
      <p class="enter-sub">어린이 지역 조사관, 어서 와요!</p>
      <div class="enter-step"><span class="num">1</span>우리 모둠을 골라요</div>
      <div class="groups">${r.groups.map((x) => `<button type="button" class="gbtn ${x.id === S.enterGroup ? 'on' : ''}" data-act="pick-group" data-g="${x.id}">${esc(x.name)}</button>`).join('')}</div>
      <div class="enter-step"><span class="num">2</span>내 이름을 골라요</div>
      <div class="names">${g
        ? names.map((n) => `<button type="button" class="nbtn ${n === S.enterName ? 'on' : ''}" data-act="pick-name" data-n="${esc(n)}">${esc(n)}</button>`).join('')
        : '<p class="hint">모둠을 먼저 골라 주세요.</p>'}</div>
      <div class="enter-go">
        <button type="button" class="btn primary big ${ready ? '' : 'off'}" data-act="enter">들어가기</button>
        <span class="why-not">${ready ? '' : g ? '이름을 골라 주세요' : '모둠을 먼저 골라 주세요'}</span>
      </div>
      ${r.demo ? '<p class="demo-note">시험용 이름이에요. 선생님이 명단을 넣으면 바뀌어요.</p>' : ''}
    </div>`;
}

function syncInfo() {
  const st = store.status();
  if (st.pending) {
    return { cls: 'wait', text: st.mode === 'ok' ? `보내는 중 (${st.pending})` : `이 태블릿에만 있어요 (${st.pending})` };
  }
  if (st.mode === 'ok') return { cls: 'on', text: '모두와 공유 중' };
  if (st.mode === 'setup') return { cls: '', text: '이 기기에만 저장' };
  if (st.mode === 'connecting') return { cls: '', text: '연결 중…' };
  return { cls: '', text: '인터넷 연결이 끊겼어요' };
}

function renderTop() {
  $('#enter').hidden = true;
  $('#teacher').hidden = true;
  $('#main').hidden = false;
  $('#who').innerHTML = isTeacher() ? `${ICON.key}선생님 화면으로` : esc(`${groupName(S.me.g)} · ${S.me.n}`);
  const t = texts(), st = stages();
  const tab = (id, label, open) => `<button type="button" class="tab ${S.tab === id ? 'on' : ''} ${open ? '' : 'locked'}" data-tab="${id}">${open ? '' : ICON.lock}${esc(label)}</button>`;
  const html = isTeacher()
    ? tab('map', t.tabMap, true) + tab('plan', t.tabPlan, true)
    : tab('map', t.tabMap, true) + tab('plan', t.tabPlan, !!st.plan) + tab('tag', t.tabTag, !!st.tag) + tab('chat', t.tabChat, !!st.chat);
  if ($('#tabs').innerHTML !== html) $('#tabs').innerHTML = html;
  const s = syncInfo();
  $('#sync').className = 'sync ' + s.cls;
  $('#syncText').textContent = s.text;
  $('#sync').title = s.text;
  fitTop();
}

// 위 막대가 넘치면(화면 이름이 길 때) 글씨를 한 단계씩 줄이고, 그래도 넘치면 오른쪽 상태 글을 점만 남깁니다.
function fitTop() {
  const top = $('#main .top');
  top.classList.remove('tight', 'tighter');
  if (top.scrollWidth > top.clientWidth + 1) top.classList.add('tight');
  if (top.scrollWidth > top.clientWidth + 1) top.classList.add('tighter');
}

function renderTabs() {
  const planOpen = !!stages().plan || isTeacher();
  $('#view-map').hidden = !(S.tab === 'map' || (S.tab === 'plan' && planOpen));
  const pv = $('#view-plan');
  pv.hidden = !(S.tab === 'plan' && !planOpen);
  if (!pv.hidden) {
    const html = `<div class="locked-view"><div class="lock-card">${ICON.lockBig}<h2>${esc(texts().tabPlan)}</h2>
      <p>자원 지도를 다 만들면 선생님이 열어 줘요.</p>
      <button type="button" class="btn" data-tab="map">${esc(texts().tabMap)}(으)로 가기</button></div></div>`;
    if (pv.innerHTML !== html) pv.innerHTML = html;
  }
  ['tag', 'chat'].forEach((id) => {
    const v = $('#view-' + id);
    const view = id === 'tag' ? tagView : chatView;
    v.hidden = S.tab !== id;
    if (S.tab !== id) return;
    if (stages()[id]) {
      if (v.dataset.locked) { delete v.dataset.locked; view.unmount(); }
      view.update();
      return;
    }
    const name = texts()[id === 'tag' ? 'tabTag' : 'tabChat'];
    const html = `<div class="locked-view"><div class="lock-card">${ICON.lockBig}<h2>${esc(name)}</h2>
      <p>선생님이 열어 주면 쓸 수 있어요.</p>
      <button type="button" class="btn" data-tab="map">${esc(texts().tabMap)}(으)로 가기</button></div></div>`;
    if (!v.dataset.locked || v.innerHTML !== html) { v.innerHTML = html; v.dataset.locked = '1'; view.unmount(); }
  });
}

function renderMap() {
  const counts = {};
  resAll().forEach((r) => { counts[r.cid] = (counts[r.cid] || 0) + 1; });
  // 지도 화면에는 자원만, 화살표는 교류 제안서 화면에서 보고 있는 모둠의 것만 그립니다.
  const arrows = isPlan() ? planArrows().map((a) => ({ key: a.key, from: a.fromRes.cid, to: a.toRes.cid })) : [];
  const focus = isPlan() ? planOf(planView()) : null;
  const pickRes = S.arrowMode && S.arrowMode.from ? resGet(S.arrowMode.from) : null;
  const m = {
    counts,
    selected: S.selected,
    mine: new Set(isPlan() ? [] : myCounties()),
    // 교류 제안서: 모둠마다 고른 제안 지역을 그 모둠의 색으로 칠합니다.
    tint: isPlan() ? Object.fromEntries(roster().groups.map((g) => [planOf(g.id), groupColor(g.id)]).filter(([c]) => c != null)) : {},
    arrows,
    pick: pickRes ? pickRes.cid : null,
    selArrow: S.selArrow,
  };
  const sig = JSON.stringify({ ...m, mine: [...m.mine] });
  if (sig !== lastMapSig) { lastMapSig = sig; mapView.update(m); }

  const btn = $('#arrowBtn');
  btn.hidden = !(isPlan() && planMine());
  btn.classList.toggle('on', !!S.arrowMode);
  btn.innerHTML = S.arrowMode ? `${ICON.x}화살표 그만두기` : `${ICON.arrow}화살표 잇기`;
  const ban = $('#arrowBanner');
  ban.hidden = !S.arrowMode;
  if (S.arrowMode) {
    const from = pickRes;
    ban.innerHTML = from
      ? `<span class="num">2</span><span>이어질 자원을 골라요. <b>${esc(shortName(regionName(from.cid)))} ${esc(from.name)}</b>에서 출발해요.<br><small>다른 시군을 누르고 오른쪽에서 골라요.</small></span>`
      : `<span class="num">1</span><span>출발할 자원을 골라요.<br><small>지도에서 시군을 누르고, 오른쪽에서 자원을 골라요. 한쪽은 우리 제안 지역(${esc(regionName(planOf(S.me.g)))})이어야 해요.</small></span>`;
  }
}

function resCard(r, pickMode) {
  const img = r.photo && r.photo.thumb
    ? `<img src="${esc(r.photo.thumb)}" alt="" loading="lazy">`
    : `<span class="noimg">${ICON.image}</span>`;
  let pick = '';
  if (pickMode) {
    const from = S.arrowMode.from;
    pick = r.key === from ? '<span class="pick-tag on">출발 자원</span>'
      : `<span class="pick-tag">${from ? '여기로 잇기' : '여기서 출발'}</span>`;
  }
  return `<button type="button" class="rcard ${pickMode && r.key === S.arrowMode.from ? 'picked' : ''}" data-res="${esc(r.key)}">
    <span class="thumb">${img}</span>
    <span class="rc-body">
      <span class="rc-top"><b>${esc(r.name)}</b><span class="badge ${r.amt}">${AMT[r.amt] || ''}</span></span>
      <small><span class="env ${r.env}">${ENV[r.env] || ''}</span>${esc(r.why)}</small>
      ${r.era ? `<small><span class="era ${r.era}">${ERA[r.era]}</span>${esc(r.eraWhy || '')}</small>` : ''}
      <small class="by">${r.example ? '예시 카드' : esc(byText(r.by))}${r._pending ? ' · <em>아직 못 보냄</em>' : ''}</small>
    </span>${pick}</button>`;
}

function planPanel(all) {
  const gid = planView();
  const mine = planMine();
  const focus = planOf(gid);
  const arrows = planArrows();
  const aitem = (a) => `<button type="button" class="aitem" data-arrowkey="${esc(a.key)}"><span>${esc(shortName(regionName(a.fromRes.cid)))} ${esc(a.fromRes.name)}</span>${ICON.arrowSmall}<span>${esc(shortName(regionName(a.toRes.cid)))} ${esc(a.toRes.name)}</span></button>`;
  let html = `<div class="plan-groups">${roster().groups.map((g) => `<button type="button" class="chip ${g.id === gid ? 'on' : ''}" data-plang="${g.id}"><i class="gdot" style="background:${groupColor(g.id)}"></i>${esc(g.name)}${!isTeacher() && g.id === S.me.g ? ' (우리)' : ''}</button>`).join('')}</div>`;
  if (S.selected == null) {
    html += `<div class="p-head"><h2>${esc(groupName(gid))} 교류 제안서</h2></div>`;
    html += focus != null
      ? `<button type="button" class="mycounty" data-county="${focus}" style="background:${groupColor(gid)}"><b>${esc(regionName(focus))}</b><span>제안 지역</span></button>`
      : `<p class="hint">${mine ? '먼저 지도에서 우리 모둠이 제안할 시군을 누르고, [제안 지역으로 정하기]를 눌러요.' : '아직 제안 지역을 정하지 않았어요.'}</p>`;
    html += `<h3 class="p-h3">${ICON.arrowSmall}화살표 ${arrows.length}개</h3>`;
    html += arrows.length ? `<div class="alist">${arrows.map(aitem).join('')}</div>`
      : `<p class="hint">${mine && focus != null ? '[화살표 잇기]를 눌러 제안 지역의 자원과 다른 시군의 자원을 이어요.' : '아직 이은 화살표가 없어요.'}</p>`;
  } else {
    const id = S.selected;
    const list = all.filter((r) => r.cid === id);
    html += `<div class="p-head"><h2>${esc(regionName(id))}</h2>
      <button type="button" class="btn small" data-act="focus">${ICON.zoom}크게 보기</button>
      <button type="button" class="xbtn" data-act="unselect" aria-label="닫기">${ICON.x}</button></div>`;
    const owners = roster().groups.filter((g) => planOf(g.id) === id);
    if (owners.length) html += `<div class="p-sub plan-focus">${owners.map((g) => `<i class="gdot" style="background:${groupColor(g.id)}"></i>`).join('')}${esc(owners.map((g) => g.name).join(', '))}의 제안 지역이에요</div>`;
    if (id !== focus && mine && !S.arrowMode) {
      const owner = ownerOf(id);
      const ok = id !== EXAMPLE_CID && (owner == null || owner === S.me.g);
      html += `<div class="add-row"><button type="button" class="btn small ${ok ? 'primary' : 'off'}" data-act="plan-set" data-why="${id === EXAMPLE_CID ? '문경시는 예시 지역이라 고를 수 없어요' : '우리 모둠이 맡은 시군 가운데에서 골라요'}">${ICON.flag}제안 지역으로 정하기</button>
        <small>${focus != null ? `지금은 ${esc(regionName(focus))}` : '아직 정하지 않았어요'}</small></div>`;
    }
    html += list.length
      ? '<div class="cards">' + list.map((r) => resCard(r, !!S.arrowMode)).join('') + '</div>'
      : '<p class="hint">올라온 자원이 없어요.</p>';
    const here = arrows.filter((a) => a.fromRes.cid === id || a.toRes.cid === id);
    if (here.length && !S.arrowMode) html += `<h3 class="p-h3">${ICON.arrowSmall}이어진 화살표 ${here.length}개</h3><div class="alist">${here.map(aitem).join('')}</div>`;
  }
  return html;
}

function renderPanel() {
  const panel = $('#panel');
  let html = '';
  const all = resAll();
  const arrows = [];
  if (isPlan()) {
    html = planPanel(all);
  } else if (S.selected == null) {
    const mine = myCounties();
    html += `<div class="p-head"><h2>${mine.length ? '우리 모둠이 맡은 시군' : '시군을 골라요'}</h2></div>`;
    if (mine.length) {
      html += '<div class="mylist">' + mine.map((id) => {
        const n = all.filter((r) => r.cid === id).length;
        return `<button type="button" class="mycounty" data-county="${id}"><b>${esc(regionName(id))}</b><span>자원 ${n}개</span></button>`;
      }).join('') + '</div>';
      html += '<p class="hint">지도나 위의 시군을 눌러 자원을 올려요.</p>';
    } else {
      html += `<p class="hint big">${S.arrowMode ? '지도에서 시군을 눌러요.' : '지도에서 시군을 누르면<br>그 시군의 자원 카드가 여기에 나와요.'}</p>`;
    }
    html += `<div class="summary">${ICON.pinSmall}지도 전체: 자원 ${all.length}개</div>`;
  } else {
    const id = S.selected;
    const list = all.filter((r) => r.cid === id);
    const owner = ownerOf(id);
    html += `<div class="p-head"><h2>${esc(regionName(id))}</h2>
      <button type="button" class="btn small" data-act="focus">${ICON.zoom}크게 보기</button>
      <button type="button" class="xbtn" data-act="unselect" aria-label="닫기">${ICON.x}</button></div>`;
    html += id === EXAMPLE_CID
      ? `<div class="p-sub ex-note">${ICON.bulb}예시 지역이에요. 카드를 눌러 어떻게 썼는지 살펴봐요.</div>`
      : `<div class="p-sub">${owner != null ? `맡은 모둠: ${esc(groupName(owner))}` : '아직 맡은 모둠이 없어요'}</div>`;
    html += list.length
      ? '<div class="cards">' + list.map((r) => resCard(r, !!S.arrowMode)).join('') + '</div>'
      : '<p class="hint">아직 올라온 자원이 없어요.</p>';
    if (!S.arrowMode && id !== EXAMPLE_CID) {
      const ok = canAdd(id);
      html += `<div class="add-row">
        <button type="button" class="btn primary ${ok ? '' : 'off'}" data-act="add">${ICON.plus}자원 올리기</button>
        <small>${ok ? `3개 정도 올려요 (지금 ${list.length}개)` : `${esc(groupName(owner))}${josa(groupName(owner), '이', '가').slice(-1)} 맡은 시군이에요`}</small></div>`;
      const mine = arrows.filter((a) => a.fromRes.cid === id || a.toRes.cid === id);
      if (mine.length) {
        html += `<h3 class="p-h3">${ICON.arrowSmall}이어진 화살표 ${mine.length}개</h3><div class="alist">` + mine.map((a) =>
          `<button type="button" class="aitem" data-arrowkey="${esc(a.key)}"><span>${esc(shortName(regionName(a.fromRes.cid)))} ${esc(a.fromRes.name)}</span>${ICON.arrowSmall}<span>${esc(shortName(regionName(a.toRes.cid)))} ${esc(a.toRes.name)}</span></button>`).join('') + '</div>';
      }
    }
  }
  const st = store.status();
  if (st.pending && st.mode !== 'ok') {
    html += `<div class="pending">${ICON.cloud}<span>아직 서버에 못 보냈어요, 이 태블릿에만 있어요 (${st.pending}개).<br><small>인터넷이 돌아오면 저절로 보내요.</small></span>
      <button type="button" class="btn small" data-act="retry">다시 보내기</button></div>`;
  }
  if (html !== lastPanel) {
    const y = panel.scrollTop;
    panel.innerHTML = html;
    panel.scrollTop = y;
    lastPanel = html;
  }
}

// ---------- 알림 ----------
let toastT = null;
function toast(text, ms = 2200) {
  const t = $('#toast');
  t.innerHTML = esc(text);
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, ms);
}
function savedToast() {
  const st = store.status();
  if (st.mode === 'ok') toast('남겼어요!');
  else toast('남겼어요! 아직 서버에 못 보냈어요, 이 태블릿에만 있어요. 인터넷이 돌아오면 보내요.', 4200);
}

// ---------- 팝업과 입력 창 ----------
function openModal(m, html, side) {
  modal = m;
  const el = $('#modal');
  el.className = 'modal ' + (side ? 'side' : 'dim');
  el.innerHTML = html;
  el.hidden = false;
}
function closeModal() {
  if (modal && modal.type === 'arrow') S.selArrow = null;
  modal = null;
  const el = $('#modal');
  el.hidden = true;
  el.innerHTML = '';
  requestRender();
}
function refreshModal() {
  if (!modal) return;
  if (modal.type === 'res') {
    if (!resGet(modal.key)) { closeModal(); toast('이 자원은 지워졌어요.'); return; }
    showRes(modal.key, true);
  } else if (modal.type === 'arrow') {
    if (!arrowsAll().some((a) => a.key === modal.key)) { closeModal(); toast('이 화살표는 지워졌어요.'); return; }
    showArrow(modal.key, true);
  }
}

function photoBox(p, big) {
  const src = p && (big ? p.full || p.thumb : p.thumb);
  return src ? `<img src="${esc(src)}" alt="">` : `<span class="noimg">${ICON.image}<small>사진이 없어요</small></span>`;
}

function editRow(item, kind) {
  if (item.example) return `<div class="pop-foot"><span class="by">${ICON.bulb}예시 카드예요. 이렇게 조사해서 올려요.</span></div>`;
  const canEdit = isTeacher() || (S.me && item.by && item.by.g === S.me.g);
  const canDel = isTeacher() || sameMe(item.by);
  const edited = item.edited ? ` · ${esc(item.edited.n)}${josa(item.edited.n, '이', '가').slice(-1)} 고쳤어요` : '';
  return `<div class="pop-foot">
    <span class="by">${esc(byText(item.by))}${josa(item.by ? item.by.n : '', '이', '가').slice(-1)} 남겼어요${edited}</span>
    <span class="acts">
      <button type="button" class="btn small ${canEdit ? '' : 'off'}" data-act="edit-${kind}" data-why="같은 모둠 친구만 고칠 수 있어요">${ICON.pen}고치기</button>
      <button type="button" class="btn small danger ${canDel ? '' : 'off'}" data-act="del-${kind}" data-why="올린 사람만 지울 수 있어요">${ICON.trash}지우기</button>
    </span></div>`;
}

function showRes(key, refresh) {
  const r = resGet(key);
  if (!r) return;
  const link = safeLink(r.link);
  const html = `<div class="sheet pop res-pop" role="dialog" aria-label="${esc(r.name)}">
    <div class="pop-head"><span class="pop-place">${esc(regionName(r.cid))}</span><b>${esc(r.name)}</b>
      <button type="button" class="xbtn light" data-act="close" aria-label="닫기">${ICON.x}</button></div>
    <div class="pop-photo big">${photoBox(r.photo, true)}</div>
    <div class="pop-info">
      <div class="info-row"><span class="num">1</span><span class="env ${r.env}">${ENV[r.env] || ''}</span><span>${esc(r.why)}</span></div>
      <div class="info-row"><span class="num">2</span><b>${esc(r.name)}</b><span class="badge ${r.amt}">이 시군에 ${AMT[r.amt] || ''}</span></div>
      <div class="info-row"><span class="num">3</span>${r.era ? `<span class="era ${r.era}">${ERA[r.era]}</span><span>${esc(r.eraWhy || '')}</span>` : '<span class="muted">옛날과 비교한 내용이 없어요</span>'}</div>
      <div class="info-row"><span class="num">4</span>${link ? `<a class="btn small" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${ICON.link}자료 보기</a>` : '<span class="muted">링크가 없어요</span>'}</div>
    </div>
    ${editRow(r, 'res')}
  </div>`;
  if (refresh) {
    const el = $('#modal');
    if (el.innerHTML !== html) el.innerHTML = html;
    modal = { type: 'res', key };
  } else {
    if (S.selArrow) { S.selArrow = null; requestRender(); }
    openModal({ type: 'res', key }, html, true);
  }
}

function showArrow(key, refresh) {
  const a = arrowsAll().find((x) => x.key === key);
  if (!a) return;
  const f = a.fromRes, t = a.toRes;
  const html = `<div class="sheet pop arrow-pop" role="dialog" aria-label="화살표">
    <div class="pop-head coral"><span>${esc(shortName(regionName(f.cid)))} ${esc(f.name)}</span>${ICON.arrowWhite}<span>${esc(shortName(regionName(t.cid)))} ${esc(t.name)}</span>
      <button type="button" class="xbtn light" data-act="close" aria-label="닫기">${ICON.x}</button></div>
    <div class="two-photos">
      <button type="button" class="ph" data-res="${esc(f.key)}">${photoBox(f.photo)}<span>${esc(shortName(regionName(f.cid)))} · ${esc(f.name)} <em class="badge ${f.amt}">${AMT[f.amt] || ''}</em></span></button>
      <span class="ph-arrow">${ICON.arrow}</span>
      <button type="button" class="ph" data-res="${esc(t.key)}">${photoBox(t.photo)}<span>${esc(shortName(regionName(t.cid)))} · ${esc(t.name)} <em class="badge ${t.amt}">${AMT[t.amt] || ''}</em></span></button>
    </div>
    <ol class="steps3">
      <li><span class="step-name"><span class="num">1</span>환경</span>
        <span class="step-text"><span class="env ${f.env}">${ENV[f.env] || ''}</span>${esc(f.why)}${f.era ? ` <span class="era ${f.era}">${ERA[f.era]}</span>` : ''}<br><span class="env ${t.env}">${ENV[t.env] || ''}</span>${esc(t.why)}${t.era ? ` <span class="era ${t.era}">${ERA[t.era]}</span>` : ''}</span></li>
      <li><span class="step-name"><span class="num">2</span>교류</span><span class="step-text">${esc(a.how)}</span></li>
      <li><span class="step-name"><span class="num">3</span>생활 변화</span><span class="step-text">${esc(a.change)}</span></li>
    </ol>
    ${editRow(a, 'arrow')}
  </div>`;
  if (refresh) {
    const el = $('#modal');
    if (el.innerHTML !== html) el.innerHTML = html;
    modal = { type: 'arrow', key };
  } else openModal({ type: 'arrow', key }, html, true);
}

function confirmBox(text, okLabel, onOk, danger) {
  openModal({ type: 'confirm', onOk }, `<div class="sheet confirm" role="dialog">
    <p>${text}</p>
    <div class="confirm-acts"><button type="button" class="btn" data-act="close">아니요</button>
    <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-act="confirm-ok">${esc(okLabel)}</button></div></div>`);
}

// 쓰던 글 보관(새로고침하거나 태블릿이 꺼져도 다시 열면 이어 쓰기)
const draftKey = (id) => `gb-draft|${S.me.g}|${S.me.n}|${id}`;
function loadDraft(id) { try { return JSON.parse(localStorage.getItem(draftKey(id)) || 'null'); } catch (e) { return null; } }
function saveDraft(id, v) { try { localStorage.setItem(draftKey(id), JSON.stringify(v)); } catch (e) { /* 무시 */ } }
function dropDraft(id) { try { localStorage.removeItem(draftKey(id)); } catch (e) { /* 무시 */ } }

const field = (name, value, ph, extra = '') =>
  `<span class="field"><input name="${name}" value="${esc(value)}" maxlength="${MAX_LEN}" placeholder="${esc(ph)}" autocomplete="off" ${extra}><span class="count" data-count="${name}">${String(value || '').length}/${MAX_LEN}</span></span>`;
const seg = (name, opts, v) => `<div class="seg" data-seg="${name}">${opts.map(([k, label]) => `<button type="button" data-v="${k}" class="${v === k ? 'on' : ''}">${label}</button>`).join('')}</div>`;

// 폼 공통: 입력할 때마다 글자 수·저장 단추 상태만 고치고, 입력칸 자체는 다시 그리지 않습니다.
function bindForm(f, draftId, validate, onSave) {
  const root = $('#modal .sheet');
  const update = () => {
    const why = validate();
    const btn = root.querySelector('[data-act="form-save"]');
    btn.classList.toggle('off', !!why);
    root.querySelector('.why-not').textContent = why || '';
    root.querySelectorAll('[data-count]').forEach((c) => {
      const inp = root.querySelector(`input[name="${c.dataset.count}"]`);
      c.textContent = `${inp.value.length}/${MAX_LEN}`;
    });
  };
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name && t.name in f) { f[t.name] = t.value; saveDraft(draftId, f); update(); }
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg] button');
    if (b) {
      const box = b.closest('[data-seg]');
      f[box.dataset.seg] = b.dataset.v;
      box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      saveDraft(draftId, f);
      update();
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const inputs = [...root.querySelectorAll('input:not([type=file])')];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus(); else e.target.blur();
  });
  modal.save = () => {
    const why = validate();
    if (why) { toast(why); return; }
    if (onSave() !== false) { dropDraft(draftId); closeModal(); }
  };
  modal.cancel = () => { dropDraft(draftId); closeModal(); };
  modal.update = update;
  update();
}

function openResForm(cid, key) {
  const old = key ? resGet(key) : null;
  const draftId = key ? 'res-' + key : 'res-new-' + cid;
  const draft = loadDraft(draftId);
  const f = { env: '', why: '', name: '', amt: '', era: '', eraWhy: '', link: '', ...(old ? { env: old.env, why: old.why, name: old.name, amt: old.amt, era: old.era || '', eraWhy: old.eraWhy || '', link: old.link || '' } : {}), ...(draft || {}) };
  const eraHint = () => (f.era ? EXAMPLE_HINT.era[f.era] : '위에서 하나를 고르면 예시가 나와요');
  let photo = old && old.photo ? old.photo : null;
  let newPhoto = null;
  let busy = false;
  const html = `<div class="sheet form" role="dialog">
    <div class="sheet-head"><b>${esc(regionName(cid))}</b>&nbsp;${key ? '자원 고치기' : '자원 올리기'}
      ${draft ? '<span class="draft-note">쓰던 글을 불러왔어요</span>' : ''}
      <button type="button" class="xbtn" data-act="form-cancel" aria-label="닫기">${ICON.x}</button></div>
    <div class="form-cols">
      <div class="col">
        <div class="q"><span class="num">1</span>이 자원은 어떤 환경 때문에 있나요?</div>
        ${seg('env', [['nat', '자연환경'], ['hum', '인문환경']], f.env)}
        ${field('why', f.why, '왜 그런지 한 줄로 써요')}
        <p class="ex">${esc(EXAMPLE_HINT.why)}</p>
        <div class="q"><span class="num">2</span>자원 이름을 쓰고, 많은지 적은지 골라요</div>
        ${field('name', f.name, '자원 이름')}
        <p class="ex">${esc(EXAMPLE_HINT.name)}</p>
        ${seg('amt', [['many', '이 시군에 많아요'], ['few', '이 시군에 적어요']], f.amt)}
      </div>
      <div class="col">
        <div class="q"><span class="num">3</span>옛날과 비교하면 어때요?</div>
        <div class="seg3">${seg('era', Object.entries(ERA), f.era)}</div>
        ${field('eraWhy', f.eraWhy, '왜 달라졌나요? 쓰는 모습이 어떻게 달라졌나요?')}
        <p class="ex" data-erahint>${esc(eraHint())}</p>
        <div class="q"><span class="num">4</span>링크와 사진 한 장을 넣어요</div>
        <span class="field"><input name="link" type="url" inputmode="url" value="${esc(f.link)}" maxlength="500" placeholder="자료 주소 (https://…)" autocomplete="off"></span>
        <div class="photo-box">
          <div class="photo-prev">${photoBox(photo)}</div>
          <div class="photo-acts">
            <label class="btn small">${ICON.camera}<span class="ptext">${photo ? '사진 바꾸기' : '사진 넣기'}</span><input type="file" accept="image/*" hidden></label>
            <button type="button" class="btn small ghost" data-act="photo-del" ${photo ? '' : 'hidden'}>사진 빼기</button>
          </div>
        </div>
        <p class="face-note">${ICON.face}얼굴이 나온 사진은 올리지 않아요.</p>
      </div>
    </div>
    <div class="sheet-foot"><span class="why-not"></span>
      <button type="button" class="btn ghost" data-act="form-cancel">그만두기</button>
      <button type="button" class="btn primary" data-act="form-save">${ICON.check}남기기</button></div>
  </div>`;
  openModal({ type: 'resForm' }, html);
  const root = $('#modal .sheet');
  const showPhoto = () => {
    root.querySelector('.photo-prev').innerHTML = busy ? '<span class="noimg"><small>사진을 줄이는 중…</small></span>' : photoBox(newPhoto || photo);
    root.querySelector('.ptext').textContent = newPhoto || photo ? '사진 바꾸기' : '사진 넣기';
    root.querySelector('[data-act="photo-del"]').hidden = !(newPhoto || photo);
  };
  root.querySelector('input[type=file]').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    busy = true; showPhoto(); modal.update();
    try {
      newPhoto = await shrinkPhoto(file);
    } catch (err) {
      toast('이 사진은 넣을 수 없어요. 다른 사진을 골라 주세요.');
    }
    busy = false; showPhoto(); modal.update();
  });
  modal.photoDel = () => { newPhoto = null; photo = null; showPhoto(); };
  bindForm(f, draftId, () => {
    // 고른 것에 맞는 예시를 보여 줍니다(입력칸은 건드리지 않음).
    const eh = root.querySelector('[data-erahint]');
    if (eh && eh.textContent !== eraHint()) eh.textContent = eraHint();
    if (busy) return '사진을 줄이는 중이에요. 잠깐만요!';
    if (!f.env) return '1번: 자연환경인지 인문환경인지 골라 주세요';
    if (!f.why.trim()) return '1번: 왜 그런지 써 주세요';
    if (!f.name.trim()) return '2번: 자원 이름을 써 주세요';
    if (!f.amt) return '2번: 많아요 / 적어요를 골라 주세요';
    if (!f.era) return '3번: 옛날과 비교해서 하나를 골라 주세요';
    if (f.era !== 'old' && !f.eraWhy.trim()) return '3번: 왜 달라졌는지 한 줄로 써 주세요';
    if (f.link.trim() && !safeLink(f.link)) return '4번: 링크 주소를 다시 확인해 주세요';
    return '';
  }, () => {
    const k = key || store.newKey('r');
    const v = {
      cid, env: f.env, why: f.why.trim(), name: f.name.trim(), amt: f.amt, era: f.era, eraWhy: f.eraWhy.trim(), link: safeLink(f.link),
      photo: newPhoto ? null : photo,
      by: old ? old.by : { ...S.me },
      at: old ? old.at : Date.now(),
    };
    if (old) v.edited = { ...S.me, at: Date.now() };
    const kept = store.put('res', k, v, newPhoto);
    if (!kept) toast('이 태블릿에 보관할 공간이 모자라요. 인터넷이 될 때 다시 남겨 주세요.', 4000);
    else savedToast();
  });
}

function openArrowForm(fromKey, toKey, key) {
  const old = key ? store.list('arrow').find((a) => a.key === key) : null;
  if (old) { fromKey = old.from; toKey = old.to; }
  const rm = resMap();
  const fr = rm.get(fromKey), tr = rm.get(toKey);
  if (!fr || !tr) return;
  const draftId = key ? 'arrow-' + key : `arrow-new-${fromKey}-${toKey}`;
  const draft = loadDraft(draftId);
  const f = { how: old ? old.how : '', change: old ? old.change : '', ...(draft || {}) };
  const side = (r) => `<div class="af-res">${photoBox(r.photo)}<span><small>${esc(regionName(r.cid))}</small><b>${esc(r.name)}</b></span></div>`;
  const html = `<div class="sheet form arrow-form" role="dialog">
    <div class="sheet-head">${key ? '화살표 고치기' : '화살표 잇기'}
      ${draft ? '<span class="draft-note">쓰던 글을 불러왔어요</span>' : ''}
      <button type="button" class="btn small tip-btn" data-act="tip">${ICON.bulb}선생님의 팁</button>
      <button type="button" class="xbtn" data-act="form-cancel" aria-label="닫기">${ICON.x}</button></div>
    <div class="af-body">
      <div class="af-main">
    <div class="af-top">${side(fr)}<span class="af-arrow">${ICON.arrow}</span>${side(tr)}</div>
    <div class="q"><span class="num">1</span>어떻게 교류하나요?</div>
    ${field('how', f.how, '한 줄로 써요')}
    <div class="q"><span class="num">2</span>그러면 생활 모습이 어떻게 달라지나요?</div>
    ${field('change', f.change, '한 줄로 써요')}
      </div>
    <div class="tip-box" data-tip hidden>
      <b>${ICON.bulb}선생님의 팁 <small>예시: ${esc(ARROW_TIP.pair)}</small></b>
      <p><span class="num">1</span>${esc(ARROW_TIP.how.tip)}<br><em>예: ${esc(ARROW_TIP.how.ex)}</em></p>
      <p><span class="num">2</span>${esc(ARROW_TIP.change.tip)}<br><em>예: ${esc(ARROW_TIP.change.ex)}</em></p>
      <small>예시를 그대로 쓰지 말고, 우리 모둠이 조사한 자원으로 써요.</small>
    </div>
    </div>
    <div class="sheet-foot"><span class="why-not"></span>
      <button type="button" class="btn ghost" data-act="form-cancel">그만두기</button>
      <button type="button" class="btn primary" data-act="form-save">${ICON.check}남기기</button></div>
  </div>`;
  openModal({ type: 'arrowForm' }, html);
  bindForm(f, draftId, () => {
    if (!f.how.trim()) return '1번: 어떻게 교류하는지 써 주세요';
    if (!f.change.trim()) return '2번: 생활 모습이 어떻게 달라지는지 써 주세요';
    return '';
  }, () => {
    const k = key || store.newKey('a');
    const v = { from: fromKey, to: toKey, how: f.how.trim(), change: f.change.trim(), by: old ? old.by : { ...S.me }, at: old ? old.at : Date.now() };
    if (old) v.edited = { ...S.me, at: Date.now() };
    store.put('arrow', k, v);
    S.arrowMode = null;
    savedToast();
  });
}

// ---------- 화살표 잇기 ----------
function pickForArrow(key) {
  const r = resGet(key);
  if (!r) return;
  const from = S.arrowMode.from;
  if (!from) { S.arrowMode.from = key; S.selected = null; requestRender(); toast('이제 이어질 자원이 있는 시군을 눌러요.'); return; }
  if (from === key) { S.arrowMode.from = null; requestRender(); return; }
  const fr = resGet(from);
  if (fr && fr.cid === r.cid) { toast('다른 시군의 자원을 골라 주세요.'); return; }
  const focus = planOf(S.me.g);
  if (fr && fr.cid !== focus && r.cid !== focus) { toast(`화살표 한쪽은 우리 제안 지역(${regionName(focus)})의 자원이어야 해요.`, 3200); return; }
  const dup = arrowsAll().find((a) => a.from === from && a.to === key && a.by && a.by.g === S.me.g);
  if (dup) { toast('이미 이어진 화살표예요.'); S.arrowMode = null; S.selArrow = dup.key; requestRender(); showArrow(dup.key); return; }
  openArrowForm(from, key);
}

// ---------- 누르기 ----------
document.addEventListener('click', (e) => {
  const t = e.target;
  const off = t.closest('.btn.off, .tab.locked');
  const act = t.closest('[data-act]');
  if (off && act && off === act && !['enter'].includes(act.dataset.act)) {
    if (act.dataset.why) toast(act.dataset.why);
    else if (act.dataset.act === 'add') toast('다른 모둠이 맡은 시군에는 올릴 수 없어요.');
    else if (act.dataset.act === 'form-save' && modal && modal.save) modal.save();
    return;
  }
  const tabB = t.closest('[data-tab]');
  if (tabB) {
    const id = tabB.dataset.tab;
    if (id !== 'map' && !stages()[id] && !isTeacher()) { toast('선생님이 열어 주면 쓸 수 있어요.'); }
    if (id !== S.tab) {
      S.arrowMode = null; S.selArrow = null; S.planGroup = null;
      if (modal && (modal.type === 'res' || modal.type === 'arrow')) closeModal();
      lastPanel = ''; lastMapSig = '';
    }
    S.tab = id;
    requestRender();
    if ((id === 'map' || id === 'plan') && mapView) setTimeout(() => mapView.resize(), 0);
    return;
  }
  if (t.closest('#arrowBtn')) {
    if (S.arrowMode) { S.arrowMode = null; toast('화살표 잇기를 그만두었어요.'); }
    else if (planOf(S.me.g) == null) { toast('먼저 우리 모둠의 제안 지역을 정해요. 지도에서 시군을 누르고 [제안 지역으로 정하기]를 눌러요.', 3600); return; }
    else { S.arrowMode = { from: null }; S.selArrow = null; if (modal) closeModal(); }
    requestRender();
    return;
  }
  const resB = t.closest('[data-res]');
  if (resB) {
    if (S.arrowMode && resB.closest('#panel')) pickForArrow(resB.dataset.res);
    else showRes(resB.dataset.res);
    return;
  }
  const ak = t.closest('[data-arrowkey]');
  if (ak) { S.selArrow = ak.dataset.arrowkey; showArrow(ak.dataset.arrowkey); requestRender(); return; }
  const pg = t.closest('[data-plang]');
  if (pg) {
    S.planGroup = +pg.dataset.plang; S.arrowMode = null; S.selArrow = null;
    if (modal && (modal.type === 'res' || modal.type === 'arrow')) closeModal();
    requestRender();
    return;
  }
  const cty = t.closest('[data-county]');
  if (cty) { S.selected = +cty.dataset.county; requestRender(); return; }
  if (!act) {
    if (modal && modal.type !== 'confirm' && !modal.type.endsWith('Form') && t.id === 'modal') closeModal();
    return;
  }
  const a = act.dataset.act;
  if (a === 'pick-group') { S.enterGroup = +act.dataset.g; S.enterName = null; renderEnter(); }
  else if (a === 'pick-name') { S.enterName = act.dataset.n; renderEnter(); }
  else if (a === 'enter') {
    const g = roster().groups.find((x) => x.id === S.enterGroup);
    if (!g) { toast('모둠을 먼저 골라 주세요.'); return; }
    if (!g.members.includes(S.enterName)) { toast('이름을 골라 주세요.'); return; }
    S.me = { g: g.id, n: S.enterName };
    S.tab = 'map'; S.selected = null; S.arrowMode = null; S.selArrow = null;
    lastPanel = ''; lastMapSig = '';
    renderAll();
    mapView.resize();
    mapView.home(true);
  }
  else if (a === 'who') {
    if (isTeacher()) { openTeacher(); return; }
    confirmBox(`${esc(S.me.n)}, 나가기 할까요?<br><small>다음 친구가 자기 이름으로 들어갈 수 있어요.</small>`, '나가기', () => {
      S.me = null; S.enterGroup = null; S.enterName = null; S.arrowMode = null; S.selected = null;
      tagView.reset(); chatView.reset();
      renderEnter();
    });
  }
  else if (a === 'secret') secretTap();
  else if (a === 'tlogin-ok') teacherLogin();
  else if (a === 'typed-ok') {
    const inp = $('#modal input[data-typed]');
    if (inp.value.trim() !== modal.word) { toast(`"${modal.word}"라고 써 주세요.`); return; }
    const fn = modal.onOk; closeModal(); fn();
  }
  else if (a === 'close') closeModal();
  else if (a === 'confirm-ok') { const fn = modal.onOk; closeModal(); fn(); }
  else if (a === 'form-save') modal.save();
  else if (a === 'form-cancel') modal.cancel();
  else if (a === 'photo-del') modal.photoDel();
  else if (a === 'tip') {
    const box = $('#modal [data-tip]');
    if (box) { box.hidden = !box.hidden; act.classList.toggle('on', !box.hidden); }
  }
  else if (a === 'unselect') { S.selected = null; requestRender(); }
  else if (a === 'focus') mapView.focus(S.selected);
  else if (a === 'add') openResForm(S.selected);
  else if (a === 'plan-set') {
    const cid = S.selected;
    const set = () => { store.put('plan', 'g' + S.me.g, { cid, by: { g: S.me.g, n: S.me.n }, at: Date.now() }); toast(`${josa(regionName(cid), '을', '를')} 우리 모둠 제안 지역으로 정했어요.`); };
    const had = planOf(S.me.g);
    if (had != null && had !== cid && arrowsAll().some((x) => x.by && x.by.g === S.me.g)) {
      confirmBox(`제안 지역을 ${esc(regionName(cid))}(으)로 바꿀까요?<br><small>이미 이은 화살표는 그대로 남아요. 필요 없는 것은 지워 주세요.</small>`, '바꾸기', set);
    } else set();
  }
  else if (a === 'retry') { store.retry(); toast('다시 보내 볼게요.'); }
  else if (a === 'edit-res') { const k = modal.key; const r = resGet(k); openResForm(r.cid, k); }
  else if (a === 'edit-arrow') { openArrowForm(null, null, modal.key); }
  else if (a === 'del-res') {
    const k = modal.key;
    const n = arrowsAll().filter((x) => x.from === k || x.to === k).length;
    confirmBox(`이 자원을 지울까요?${n ? `<br><small>이어진 화살표 ${n}개도 지도에서 사라져요.</small>` : ''}`, '지우기', () => {
      store.remove('res', k, { ...S.me, at: Date.now() });
      toast('지웠어요.');
    }, true);
  }
  else if (a === 'del-arrow') {
    const k = modal.key;
    confirmBox('이 화살표를 지울까요?', '지우기', () => {
      store.remove('arrow', k, { ...S.me, at: Date.now() });
      S.selArrow = null;
      toast('지웠어요.');
    }, true);
  }
});

// ---------- 선생님 화면 ----------
let teacher = null, tagView = null, chatView = null;
let secretTaps = [];
function secretTap() {
  const now = Date.now();
  secretTaps = secretTaps.filter((t) => now - t < 3000).concat(now);
  if (secretTaps.length < 5) return;
  secretTaps = [];
  if (!store.ready()) { toast('서버와 연결된 뒤에 다시 눌러 주세요.'); return; }
  const has = !!store.get('cfg', 'teacher');
  openModal({ type: 'tlogin', setup: !has }, `<div class="sheet confirm" role="dialog">
    <p>${has ? '선생님 암호' : '선생님 암호 정하기'}<br><small>${has ? '숫자 4자리' : '처음이에요. 숫자 4자리를 두 번 써 주세요.'}</small></p>
    <div class="code-row"><input type="password" inputmode="numeric" maxlength="4" data-code="1" autocomplete="off" aria-label="암호">
    ${has ? '' : '<input type="password" inputmode="numeric" maxlength="4" data-code="2" autocomplete="off" aria-label="암호 한 번 더">'}</div>
    <div class="confirm-acts"><button type="button" class="btn" data-act="close">닫기</button>
    <button type="button" class="btn primary" data-act="tlogin-ok">들어가기</button></div></div>`);
  setTimeout(() => { const i = $('#modal [data-code="1"]'); if (i) i.focus(); }, 50);
}
async function teacherLogin() {
  const a = ($('#modal [data-code="1"]') || {}).value || '';
  if (!/^\d{4}$/.test(a)) { toast('숫자 4자리로 써 주세요.'); return; }
  const saved = store.get('cfg', 'teacher');
  if (modal.setup) {
    if (a !== $('#modal [data-code="2"]').value) { toast('두 번 쓴 암호가 달라요.'); return; }
    const salt = Math.random().toString(36).slice(2, 10);
    store.put('cfg', 'teacher', { salt, hash: await hashCode(salt, a) });
  } else if (!saved || (await hashCode(saved.salt, a)) !== saved.hash) {
    toast('암호가 맞지 않아요.');
    return;
  }
  closeModal();
  try { sessionStorage.setItem('gb-teacher', '1'); } catch (e) { /* 무시 */ }
  openTeacher(true);
}
function openTeacher(fresh) {
  S.teacherScreen = true;
  S.me = null; S.arrowMode = null; S.selected = null; S.selArrow = null;
  if (modal) closeModal();
  $('#enter').hidden = true;
  $('#main').hidden = true;
  $('#teacher').hidden = false;
  if (fresh) teacher.open(); else teacher.render(true);
  store.refresh();
}
function teacherMap() {
  S.teacherScreen = false;
  S.me = { ...TEACHER };
  S.tab = 'map'; S.selected = null; S.arrowMode = null; S.selArrow = null;
  lastPanel = ''; lastMapSig = '';
  renderAll();
  mapView.resize();
  mapView.home(true);
}
function teacherExit() {
  S.teacherScreen = false;
  S.me = null; S.enterGroup = null; S.enterName = null;
  try { sessionStorage.removeItem('gb-teacher'); } catch (e) { /* 무시 */ }
  renderEnter();
}
function confirmTyped(word, onOk) {
  openModal({ type: 'confirm', word, onOk }, `<div class="sheet confirm" role="dialog">
    <p>정말 지울까요?<br><small>되살릴 수 없어요. 아래 칸에 "${esc(word)}"라고 써 주세요.</small></p>
    <div class="code-row"><input data-typed autocomplete="off" aria-label="확인 글자"></div>
    <div class="confirm-acts"><button type="button" class="btn" data-act="close">아니요</button>
    <button type="button" class="btn danger" data-act="typed-ok">지우기</button></div></div>`);
}

// ---------- 시작 ----------
function start() {
  fitStage();
  mapView = createMapView($('#mapbox'), mapData, {
    getScale: () => scale,
    onRegion(id) {
      if (modal && (modal.type === 'res' || modal.type === 'arrow')) closeModal();
      S.selected = id;
      S.selArrow = null;
      requestRender();
    },
    onArrow(key) {
      if (S.arrowMode || !isPlan()) return;
      S.selArrow = key;
      showArrow(key);
      requestRender();
    },
    onBlank() {
      if (modal && (modal.type === 'res' || modal.type === 'arrow')) { closeModal(); return; }
      if (!S.arrowMode && S.selected != null) { S.selected = null; requestRender(); }
    },
  });
  const ctx = {
    store, esc, ICON, regions: mapData.regions, exampleCid: EXAMPLE_CID,
    me: () => S.me,
    roster, groupName, groupColor, texts, stages, tagCfg, chatCfg, toast,
    classStep: () => Math.min(4, Math.max(1, (store.get('cfg', 'chatstep') || {}).step || 1)),
    saved: (msg) => (store.status().mode === 'ok' ? toast(msg) : toast(msg + ' 아직 서버에 못 보냈어요, 이 태블릿에만 있어요.', 4000)),
    confirm: (text, onOk) => confirmBox(text, '네', onOk),
    confirmTyped,
    openMap: teacherMap,
    exit: teacherExit,
  };
  tagView = createTagView($('#view-tag'), ctx);
  chatView = createChatView($('#view-chat'), ctx);
  teacher = createTeacher($('#teacher'), ctx);
  store.onChange(requestRender);
  store.start();
  let wasTeacher = false;
  try { wasTeacher = sessionStorage.getItem('gb-teacher') === '1'; } catch (e) { /* 무시 */ }
  if (wasTeacher) openTeacher(true); else renderEnter();
}

const sv = (d, w = 24, extra = '') => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ${extra} aria-hidden="true">${d}</svg>`;
const ICON = {
  pin: sv('<path d="M12 22 C12 22 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C19 14.5 12 22 12 22 Z"/><circle cx="12" cy="9.5" r="2.6"/>', 40),
  pinSmall: sv('<path d="M12 22 C12 22 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C19 14.5 12 22 12 22 Z"/><circle cx="12" cy="9.5" r="2.6"/>', 20),
  arrow: sv('<path d="M4 12 H19 M13 6 L19 12 L13 18"/>', 26),
  arrowSmall: sv('<path d="M4 12 H19 M13 6 L19 12 L13 18"/>', 18),
  arrowWhite: sv('<path d="M4 12 H19 M13 6 L19 12 L13 18"/>', 28),
  x: sv('<path d="M6 6 L18 18 M18 6 L6 18"/>', 22),
  plus: sv('<path d="M12 5 V19 M5 12 H19"/>', 22),
  lock: sv('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11 V8 a4 4 0 0 1 8 0 V11"/>', 18),
  lockBig: sv('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11 V8 a4 4 0 0 1 8 0 V11"/>', 64),
  image: sv('<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16 L15 11 L6 19"/>', 30),
  camera: sv('<path d="M4 8 H8 L10 5 H14 L16 8 H20 V19 H4 Z"/><circle cx="12" cy="13" r="3.5"/>', 22),
  face: sv('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6 L18.4 18.4"/>', 20),
  link: sv('<path d="M10 14 a4 4 0 0 0 5.7 0 l3-3 a4 4 0 0 0-5.7-5.7 l-1 1"/><path d="M14 10 a4 4 0 0 0-5.7 0 l-3 3 a4 4 0 0 0 5.7 5.7 l1-1"/>', 20),
  pen: sv('<path d="M4 20 L8 19 L19 8 L16 5 L5 16 Z"/>', 18),
  trash: sv('<path d="M5 7 H19 M9 7 V4 H15 V7 M7 7 L8 20 H16 L17 7"/>', 18),
  check: sv('<path d="M5 12 L10 17 L19 7"/>', 22),
  zoom: sv('<circle cx="11" cy="11" r="6.5"/><path d="M16 16 L20 20 M11 8 V14 M8 11 H14"/>', 18),
  key: sv('<circle cx="8" cy="15" r="4"/><path d="M11 12 L20 3 M17 6 L20 9 M15 8 L17 10"/>', 22),
  inbox: sv('<path d="M3 13 L6 5 H18 L21 13 V19 H3 Z"/><path d="M3 13 H8 L9 16 H15 L16 13 H21"/>', 22),
  bulb: sv('<path d="M9 18 H15 M10 21 H14 M12 3 a6 6 0 0 0-3.5 10.9 V16 H15.5 V13.9 A6 6 0 0 0 12 3 Z"/>', 26),
  send: sv('<path d="M4 12 L20 4 L14 20 L11 13 Z"/>', 22),
  star: sv('<path d="M12 3 L14.6 9 L21 9.5 L16 13.6 L17.6 20 L12 16.5 L6.4 20 L8 13.6 L3 9.5 L9.4 9 Z"/>', 24),
  bot: sv('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4 V8 M9 13 V14 M15 13 V14"/>', 16),
  flag: sv('<path d="M6 21 V4 M6 5 H18 L15 9 L18 13 H6"/>', 24),
  cloud: sv('<path d="M7 18 H17 a4 4 0 0 0 0-8 a6 6 0 0 0-11.5 1.5 A3.5 3.5 0 0 0 7 18 Z"/><path d="M4 4 L20 20"/>', 26),
};

start();
