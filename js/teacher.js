// 선생님 화면: 현황, TAG, 챗봇 기록, 모둠 문장 4개, 설정 고치기, 단계 열고 닫기, 지우기.
// 숨은 입구(들어가기 화면의 제목을 다섯 번 누름)와 네 자리 암호로 가립니다.
// 아이들이 우연히 들어오는 것을 막는 정도이며 완전한 잠금은 아닙니다.
import { TAG_KEYS, DEFAULT_TEXTS, DEFAULT_TAG, DEFAULT_CHAT, withDefaults, splitTemplate } from './defaults.js?v=12';
import { esc, timeText, josa } from './util.js?v=12';

const TABS = [['status', '현황'], ['tag', 'TAG'], ['board', '챗봇 한눈에'], ['chat', '챗봇 기록'], ['gen', '모둠 문장'], ['settings', '설정'], ['wipe', '지우기']];

export async function hashCode(salt, code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + code));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createTeacher(root, ctx) {
  const { store, regions, ICON } = ctx;
  let tab = 'status';
  let tagFilter = 'all';
  let showDrafts = false;
  let chatG = 'all';
  let chatN = 'all';
  let big = false;
  let lastBody = '';
  let boardStep = null; // null 이면 아이들이 있는 단계를 따라감
  let boardAi = false;

  root.innerHTML = `
    <header class="top t-top">
      <div class="logo t-logo">${ICON.key}<span>선생님 화면</span></div>
      <div class="t-stage" data-tstage></div>
      <button type="button" class="btn small" data-t="map">${ICON.pinSmall}지도 보기</button>
      <button type="button" class="btn small ghost" data-t="exit">나가기</button>
    </header>
    <nav class="tabs t-tabs" data-ttabs></nav>
    <div class="t-body" data-tbody></div>
    <button type="button" class="btn t-unbig" data-t="unbig" hidden>${ICON.x}작게</button>`;
  const body = root.querySelector('[data-tbody]');

  const all = (k) => store.list(k).sort((a, b) => (a.at || 0) - (b.at || 0));
  const gname = (g) => ctx.groupName(g);

  function header() {
    root.querySelector('[data-ttabs]').innerHTML = TABS.map(([id, label]) => `<button type="button" class="tab ${tab === id ? 'on' : ''}" data-ttab="${id}">${label}</button>`).join('');
    const st = ctx.stages();
    const t = ctx.texts();
    const tog = (k, label) => `<button type="button" class="tog ${st[k] ? 'on' : ''}" data-stage="${k}"><span class="sw"></span>${esc(label)} 화면 ${st[k] ? '열림' : '닫힘'}</button>`;
    root.querySelector('[data-tstage]').innerHTML = tog('tag', t.tabTag) + tog('chat', t.tabChat);
  }

  // ---------- 현황 ----------
  function statusHtml() {
    const r = ctx.roster();
    const res = all('res'), arr = all('arrow'), tags = all('tag').filter((x) => x.type !== 'D'), chats = all('chat'), gens = all('gen');
    const cnt = (list, g, n) => list.filter((x) => x.by && x.by.g === g && x.by.n === n).length;
    const chatCnt = (g, n) => chats.filter((x) => x.g === g && x.n === n).length;
    const cell = (v) => `<td class="${v ? '' : 'zero'}">${v}</td>`;
    let html = `<div class="t-stats">
      <div><b>${res.length}</b>자원 카드</div><div><b>${arr.length}</b>화살표</div><div><b>${tags.length}</b>TAG</div>
      <div><b>${chats.filter((c) => c.a).length}</b>챗봇 대화</div><div><b>${gens.length}/${r.groups.length}</b>모둠 문장</div></div>`;
    if (r.demo) html += '<p class="t-warn">아직 명단이 없어 시험용 이름으로 보여요. [설정]에서 명단을 넣어 주세요.</p>';
    html += '<div class="t-groups">' + r.groups.map((g) => {
      const rows = g.members.map((n) => {
        const a = cnt(res, g.id, n), b = cnt(arr, g.id, n), c = cnt(tags, g.id, n), d = chatCnt(g.id, n);
        return `<tr><th>${esc(n)}</th>${cell(a)}${cell(b)}${cell(c)}${cell(d)}</tr>`;
      }).join('');
      const idle = g.members.filter((n) => !cnt(res, g.id, n) && !cnt(arr, g.id, n));
      const counties = regions.filter((x) => (r.assign || {})[x.id] === g.id).map((x) => x.name.replace(/(시|군)$/, ''));
      return `<div class="t-card"><h3>${esc(g.name)}</h3>
        <p class="t-sub">맡은 시군: ${counties.length ? esc(counties.join(', ')) : '아직 없음'}</p>
        <table class="t-table"><tr><th></th><td>자원</td><td>화살표</td><td>TAG</td><td>챗봇</td></tr>${rows}</table>
        <p class="t-sub ${idle.length ? 'warn' : ''}">${idle.length ? `지도에 아직 안 올린 아이: ${esc(idle.join(', '))}` : '모두 지도에 올렸어요'}</p></div>`;
    }).join('') + '</div>';
    html += '<h3 class="t-h">시군별</h3><div class="t-counties">' + regions.map((x) => {
      const n = res.filter((v) => v.cid === x.id).length;
      const a = arr.filter((v) => { const f = res.find((q) => q.key === v.from), t = res.find((q) => q.key === v.to); return (f && f.cid === x.id) || (t && t.cid === x.id); }).length;
      const o = (r.assign || {})[x.id];
      return `<div class="t-county ${n ? '' : 'zero'}"><b>${esc(x.name)}</b><span>${o ? esc(gname(o)) : '배정 없음'}</span><span>자원 ${n} · 화살표 ${a}</span></div>`;
    }).join('') + '</div>';
    return html;
  }

  // ---------- TAG ----------
  function tagHtml() {
    const cfg = ctx.tagCfg();
    const r = ctx.roster();
    let list = all('tag');
    if (tagFilter !== 'all') list = list.filter((x) => x.to === tagFilter);
    const keys = showDrafts ? [...TAG_KEYS, 'D'] : TAG_KEYS;
    const name = (k) => (k === 'D' ? '질문 초안' : cfg[k].name);
    return `<div class="t-filter">
        <button type="button" class="chip ${tagFilter === 'all' ? 'on' : ''}" data-tagf="all">전체</button>
        ${r.groups.map((g) => `<button type="button" class="chip ${tagFilter === g.id ? 'on' : ''}" data-tagf="${g.id}">${esc(g.name)} 발표</button>`).join('')}
        <label class="chk"><input type="checkbox" data-drafts ${showDrafts ? 'checked' : ''}>질문 초안도 보기</label>
      </div>
      <div class="t-tagcols" style="grid-template-columns:repeat(${keys.length},1fr)">${keys.map((k) => {
        const items = list.filter((x) => x.type === k).reverse();
        return `<div class="tv-col"><div class="tv-col-head"><span class="tchip t-${k}"><b>${k === 'D' ? '초' : k}</b>${esc(name(k))}</span> ${items.length}</div>
          <div class="tv-col-list">${items.map((x) => `<div class="tcard">${esc(x.text)}
            <small>${esc(x.by ? `${x.by.n}(${gname(x.by.g)})` : '')} → ${esc(gname(x.to))} · ${timeText(x.at)}</small>
            <button type="button" class="xbtn sm" data-tdel="${esc(x.key)}" aria-label="지우기">${ICON.trash}</button></div>`).join('') || '<p class="hint">없어요</p>'}</div></div>`;
      }).join('')}</div>`;
  }

  // ---------- 챗봇 기록 ----------
  function chatHtml() {
    const r = ctx.roster();
    const steps = ctx.chatCfg().steps;
    let list = all('chat');
    if (chatG !== 'all') list = list.filter((c) => c.g === chatG);
    if (chatN !== 'all') list = list.filter((c) => c.n === chatN);
    const members = chatG === 'all' ? [] : ((r.groups.find((g) => g.id === chatG) || {}).members || []);
    return `<div class="t-filter">
        <button type="button" class="chip ${chatG === 'all' ? 'on' : ''}" data-chatg="all">전체</button>
        ${r.groups.map((g) => `<button type="button" class="chip ${chatG === g.id ? 'on' : ''}" data-chatg="${g.id}">${esc(g.name)}</button>`).join('')}
        ${members.length ? `<span class="t-sep"></span><button type="button" class="chip ${chatN === 'all' ? 'on' : ''}" data-chatn="all">모둠 전체</button>${members.map((n) => `<button type="button" class="chip ${chatN === n ? 'on' : ''}" data-chatn="${esc(n)}">${esc(n)}</button>`).join('')}` : ''}
      </div>
      <div class="t-chatlog">${list.length ? list.map((c) => `<div class="t-pair">
        <div class="t-meta">${timeText(c.at)} · ${esc(gname(c.g))} · ${esc(c.n)} · ${c.step || 1}단계 ${esc((steps[(c.step || 1) - 1] || {}).name || '')}</div>
        <div class="bub kid"><div class="bub-text">${esc(c.q)}</div></div>
        ${c.a ? `<div class="bub ai"><div class="bub-text">${esc(c.a)}</div></div>` : `<div class="bub ai fail"><div class="bub-text">AI가 답하지 못함${c.err ? ` <small>(${esc(c.err.slice(0, 120))})</small>` : ''}</div></div>`}
      </div>`).join('') : '<p class="hint big">아직 챗봇 대화가 없어요.</p>'}</div>`;
  }

  // ---------- 챗봇 한눈에: 모둠 4개의 대답을 단계별로 한 화면에(전자칠판용) ----------
  function boardHtml() {
    const r = ctx.roster();
    const cfg = ctx.chatCfg();
    const cls = ctx.classStep();
    const view = boardStep || cls;
    const chats = all('chat');
    const passOf = (g, s) => (s === 4 ? !!(store.get('gen', 'g' + g) || {}).text : chats.some((c) => c.g === g && (c.step || 1) === s && c.pass));
    return `<div class="t-board ${big ? 'big' : ''}">
      <div class="tb-bar">
        <div class="tb-steps">${cfg.steps.map((s, i) => `<button type="button" class="tb-step ${view === i + 1 ? 'on' : ''} ${cls === i + 1 ? 'cls' : ''}" data-bstep="${i + 1}"><span class="num">${i + 1}</span>${esc(s.name)}${cls === i + 1 ? '<small>아이들 지금 여기</small>' : ''}</button>`).join('')}</div>
        <div class="tb-ctl">
          <button type="button" class="btn small ghost ${cls <= 1 ? 'off' : ''}" data-cstep="-1">◀ 이전 단계로</button>
          <button type="button" class="btn small primary ${cls >= 4 ? 'off' : ''}" data-cstep="1">다음 단계 열기 ▶</button>
          <label class="chk"><input type="checkbox" data-bai ${boardAi ? 'checked' : ''}>AI 답도 보기</label>
          ${big ? '' : `<button type="button" class="btn small" data-t="big">${ICON.zoom}크게 띄우기</button>`}
        </div>
      </div>
      <p class="tb-q"><b>${view}단계 질문</b> ${esc(cfg.steps[view - 1].question)}</p>
      <div class="tb-grid" style="grid-template-columns:repeat(${r.groups.length},1fr)">${r.groups.map((g) => {
        const list = chats.filter((c) => c.g === g.id && (c.step || 1) === view);
        const gen = view === 4 ? store.get('gen', 'g' + g.id) : null;
        return `<div class="tb-col ${passOf(g.id, view) ? 'pass' : ''}">
          <h3>${esc(g.name)}${passOf(g.id, view) ? `<span class="tb-pass">${ICON.star}미션 성공</span>` : ''}</h3>
          ${view === 4 ? `<div class="tb-gen">${gen && gen.text ? esc(gen.text) : '<span class="hint">아직 문장을 저장하지 않았어요</span>'}</div>` : ''}
          <div class="tb-list">${list.length ? list.map((c) => `<div class="tb-item"><p>${esc(c.q)}</p>
            ${boardAi ? `<div class="tb-ai">${c.a ? esc(c.a) : 'AI가 답하지 못함'}</div>` : ''}
            <small>${esc(c.n)} · ${timeText(c.at)}${c.pass ? ' · ★' : ''}</small></div>`).join('') : '<p class="hint">아직 대답이 없어요</p>'}</div>
        </div>`;
      }).join('')}</div></div>`;
  }

  // ---------- 모둠 문장 ----------
  function genHtml() {
    const r = ctx.roster();
    return `<div class="t-gens ${big ? 'big' : ''}">
      ${big ? '' : `<div class="t-genbar"><span class="t-sub">문장 틀: ${esc(ctx.chatCfg().template)}</span><button type="button" class="btn small primary" data-t="big">${ICON.zoom}크게 띄우기</button></div>`}
      <div class="t-gengrid">${r.groups.map((g) => {
        const v = store.get('gen', 'g' + g.id);
        return `<div class="t-gen"><h3>${esc(g.name)}</h3>${v && v.text ? `<p>${esc(v.text)}</p><small>${esc(v.by ? josa(v.by.n, '이', '가') : '')} 저장 · ${timeText(v.at)}</small>` : '<p class="hint">아직 저장하지 않았어요</p>'}</div>`;
      }).join('')}</div></div>`;
  }

  // ---------- 설정 (입력칸이 있어 한 번만 그림) ----------
  let draftRoster = null;
  function settingsHtml() {
    const r = ctx.roster();
    draftRoster = draftRoster || JSON.parse(JSON.stringify({ groups: r.groups.map((g) => ({ id: g.id, name: g.name, members: r.demo ? [] : g.members })) }));
    const t = ctx.texts(), tg = ctx.tagCfg(), ch = ctx.chatCfg();
    const opt = (v, sel, label) => `<option value="${v}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
    return `<div class="t-settings">
      <section class="t-sec"><h3>1. 명단과 모둠</h3>
        <p class="t-sub">한 줄에 한 명씩 이름을 써요. 아이들이 지도에 입력을 시작하기 전에 정해 주세요. (이름을 바꾸면 이미 올린 글에는 옛 이름이 남아요)</p>
        <div class="t-roster">${draftRoster.groups.map((g, i) => `<div class="t-rg" data-rg="${i}">
          <input class="t-in" data-rname value="${esc(g.name)}" maxlength="10">
          <textarea class="t-in" data-rmem rows="6" placeholder="이름을 한 줄에 하나씩">${esc(g.members.join('\n'))}</textarea>
          <button type="button" class="btn small ghost" data-rdel="${i}">이 모둠 빼기</button></div>`).join('')}
          <button type="button" class="btn small" data-radd>${ICON.plus}모둠 더하기</button></div>
        <button type="button" class="btn primary" data-save="roster">명단 저장</button></section>

      <section class="t-sec"><h3>2. 시군 배정</h3>
        <p class="t-sub">모둠마다 맡을 시군을 골라요. 나중에 바꿔도 기록은 시군에 붙어 있어 사라지지 않아요. (명단을 먼저 저장해야 새 모둠이 보여요)</p>
        <div class="t-assign">${regions.map((x) => `<label><span>${esc(x.name)}</span><select class="t-in" data-assign="${x.id}">
          ${opt('', (r.assign || {})[x.id] ?? '', '없음')}${r.groups.map((g) => opt(g.id, (r.assign || {})[x.id] ?? '', g.name)).join('')}</select></label>`).join('')}</div>
        <button type="button" class="btn primary" data-save="assign">배정 저장</button></section>

      <section class="t-sec"><h3>3. 화면 이름</h3>
        <div class="t-grid3">
          <label>지도 화면<input class="t-in" data-txt="tabMap" value="${esc(t.tabMap)}" maxlength="10"></label>
          <label>TAG 화면<input class="t-in" data-txt="tabTag" value="${esc(t.tabTag)}" maxlength="10"></label>
          <label>챗봇 화면<input class="t-in" data-txt="tabChat" value="${esc(t.tabChat)}" maxlength="10"></label></div>
        <button type="button" class="btn primary" data-save="texts">화면 이름 저장</button></section>

      <section class="t-sec"><h3>4. TAG</h3>
        ${TAG_KEYS.map((k) => `<div class="t-grid2"><label>${k} 이름<input class="t-in" data-tag="${k}.name" value="${esc(tg[k].name)}" maxlength="12"></label>
          <label>${k} 입력칸 안내<input class="t-in" data-tag="${k}.hint" value="${esc(tg[k].hint)}" maxlength="60"></label></div>`).join('')}
        <div class="t-grid2"><label>질문 초안 안내<input class="t-in" data-tag="draftHint" value="${esc(tg.draftHint)}" maxlength="60"></label>
          <label>한 줄 글자 수<input class="t-in" type="number" min="10" max="200" data-tag="max" value="${tg.max}"></label></div>
        <button type="button" class="btn primary" data-save="tagcfg">TAG 저장</button></section>

      <section class="t-sec"><h3>5. 챗봇</h3>
        <label>안내 문구<input class="t-in" data-chat="guide" value="${esc(ch.guide)}" maxlength="80"></label>
        ${ch.steps.map((s, i) => `<div class="t-grid2 wide"><label>${i + 1}단계 이름<input class="t-in" data-chat="steps.${i}.name" value="${esc(s.name)}" maxlength="12"></label>
          <label>${i + 1}단계 첫 질문<textarea class="t-in" rows="2" data-chat="steps.${i}.question" maxlength="200">${esc(s.question)}</textarea></label></div>`).join('')}
        <label>미션 성공 뒤에 AI가 붙이는 말 <small>(칭찬 한 문장 뒤에 이 말이 붙고, 다음 단계 질문은 하지 않아요)</small><input class="t-in" data-chat="passText" value="${esc(ch.passText)}" maxlength="120"></label>
        <label>모둠 문장 틀 <small>([ ] 자리가 빈칸이 돼요. 빈칸 개수는 아이들이 쓰기 전에 정해 주세요)</small><input class="t-in" data-chat="template" value="${esc(ch.template)}" maxlength="120"></label>
        <button type="button" class="btn primary" data-save="chatcfg">챗봇 저장</button></section>

      <section class="t-sec"><h3>6. 선생님 암호 바꾸기</h3>
        <div class="t-grid2"><label>새 암호(숫자 4자리)<input class="t-in" type="password" inputmode="numeric" maxlength="4" data-pw="1"></label>
          <label>한 번 더<input class="t-in" type="password" inputmode="numeric" maxlength="4" data-pw="2"></label></div>
        <button type="button" class="btn primary" data-save="code">암호 바꾸기</button></section>
    </div>`;
  }

  function readRosterInputs() {
    body.querySelectorAll('[data-rg]').forEach((el) => {
      const g = draftRoster.groups[+el.dataset.rg];
      g.name = el.querySelector('[data-rname]').value.trim();
      g.members = el.querySelector('[data-rmem]').value.split('\n').map((s) => s.trim()).filter(Boolean);
    });
  }

  async function save(what) {
    if (what === 'roster') {
      readRosterInputs();
      const gs = draftRoster.groups;
      if (!gs.length) return ctx.toast('모둠이 하나 이상 있어야 해요.');
      for (const g of gs) {
        if (!g.name) return ctx.toast('모둠 이름이 빈 곳이 있어요.');
        if (!g.members.length) return ctx.toast(`${g.name}에 이름이 없어요.`);
        if (new Set(g.members).size !== g.members.length) return ctx.toast(`${g.name}에 같은 이름이 두 번 있어요.`);
        if (g.members.some((n) => n.length > 10)) return ctx.toast('이름은 10자까지 써요.');
      }
      if (new Set(gs.map((g) => g.name)).size !== gs.length) return ctx.toast('모둠 이름이 겹쳐요.');
      const old = ctx.roster();
      store.put('cfg', 'roster', { groups: gs, assign: old.demo ? {} : old.assign || {} });
      draftRoster = null;
      ctx.toast('명단을 저장했어요.');
      rebuild();
    } else if (what === 'assign') {
      const r = ctx.roster();
      if (r.demo) return ctx.toast('명단을 먼저 저장해 주세요.');
      const assign = {};
      body.querySelectorAll('[data-assign]').forEach((s) => { if (s.value) assign[s.dataset.assign] = +s.value; });
      store.put('cfg', 'roster', { groups: r.groups, assign });
      ctx.toast('시군 배정을 저장했어요.');
    } else if (what === 'texts') {
      const v = {};
      body.querySelectorAll('[data-txt]').forEach((i) => { v[i.dataset.txt] = i.value.trim() || DEFAULT_TEXTS[i.dataset.txt]; });
      store.put('cfg', 'texts', v);
      ctx.toast('화면 이름을 저장했어요.');
    } else if (what === 'tagcfg') {
      const v = withDefaults(store.get('cfg', 'tagcfg'), DEFAULT_TAG);
      body.querySelectorAll('[data-tag]').forEach((i) => {
        const [a, b] = i.dataset.tag.split('.');
        const val = a === 'max' ? Math.min(200, Math.max(10, +i.value || DEFAULT_TAG.max)) : i.value.trim();
        if (b) v[a][b] = val || DEFAULT_TAG[a][b]; else v[a] = val || DEFAULT_TAG[a];
      });
      store.put('cfg', 'tagcfg', v);
      ctx.toast('TAG 설정을 저장했어요.');
    } else if (what === 'chatcfg') {
      const v = withDefaults(store.get('cfg', 'chatcfg'), DEFAULT_CHAT);
      body.querySelectorAll('[data-chat]').forEach((i) => {
        const p = i.dataset.chat.split('.');
        const val = i.value.trim();
        if (p[0] === 'steps') v.steps[+p[1]][p[2]] = val || DEFAULT_CHAT.steps[+p[1]][p[2]];
        else v[p[0]] = val || DEFAULT_CHAT[p[0]];
      });
      const blanks = splitTemplate(v.template).length - 1;
      if (blanks < 1) return ctx.toast('문장 틀에 빈칸 [ ] 이 하나 이상 있어야 해요.');
      const oldBlanks = splitTemplate(ctx.chatCfg().template).length - 1;
      const doSave = () => { store.put('cfg', 'chatcfg', v); ctx.toast('챗봇 설정을 저장했어요.'); };
      if (blanks !== oldBlanks && store.list('gen').length) {
        ctx.confirm('빈칸 개수가 바뀌어요.<br><small>이미 저장된 모둠 문장은 그대로 남지만, 아이들이 다시 쓸 때는 새 틀로 써요.</small>', doSave);
      } else doSave();
    } else if (what === 'code') {
      const a = body.querySelector('[data-pw="1"]').value, b = body.querySelector('[data-pw="2"]').value;
      if (!/^\d{4}$/.test(a)) return ctx.toast('숫자 4자리로 써 주세요.');
      if (a !== b) return ctx.toast('두 번 쓴 암호가 달라요.');
      const salt = Math.random().toString(36).slice(2, 10);
      store.put('cfg', 'teacher', { salt, hash: await hashCode(salt, a) });
      body.querySelectorAll('[data-pw]').forEach((i) => { i.value = ''; });
      ctx.toast('암호를 바꿨어요.');
    }
  }

  // ---------- 지우기 ----------
  function wipeHtml() {
    const c = (k) => store.list(k).length;
    const row = (id, title, sub, n) => `<div class="t-wrow"><div><b>${title}</b><small>${sub}</small></div><span class="t-n">${n}</span>
      <button type="button" class="btn small danger" data-wipe="${id}">${ICON.trash}지우기</button></div>`;
    return `<div class="t-wipe">
      <p class="t-warn">지우면 되살릴 수 없어요. 누를 때마다 "지우기"라고 한 번 더 써서 확인해요.</p>
      ${row('map', '자원 카드·화살표·사진', '지도에 올린 것과 사진 파일 전부', `카드 ${c('res')} · 화살표 ${c('arrow')}`)}
      ${row('tag', 'TAG와 질문 초안', '모든 모둠', `${c('tag')}줄`)}
      ${row('chat', '챗봇 기록과 단계', '아이 말과 AI 답 전부, 모둠별 단계', `${c('chat')}쌍`)}
      ${row('gen', '모둠 문장', '모둠 4개', `${c('gen')}개`)}
      ${row('roster', '명단과 시군 배정', '수업이 끝나면 아이들 이름도 지워 주세요', ctx.roster().demo ? '없음' : '있음')}
      ${row('all', '수업 끝: 위 기록 전부', '설정(화면 이름·TAG·챗봇 문구·암호)만 남겨요', '')}
      <p class="t-sub">제미나이 키는 여기서 지워지지 않아요. Supabase 화면에서 직접 지워 주세요(README의 수업 뒤 정리).</p></div>`;
  }

  async function wipe(id) {
    const jobs = {
      map: async () => { const n = await store.wipePhotos(); await store.wipe(['res', 'arrow']); return `사진 ${n}장과 지도 기록을 지웠어요.`; },
      tag: async () => { await store.wipe(['tag']); return 'TAG를 지웠어요.'; },
      chat: async () => { await store.wipe(['chat', 'cstep']); await store.wipe(['cfg'], 'chatstep'); return '챗봇 기록을 지우고 1단계로 돌렸어요.'; },
      gen: async () => { await store.wipe(['gen']); return '모둠 문장을 지웠어요.'; },
      roster: async () => { await store.wipe(['cfg'], 'roster'); return '명단을 지웠어요.'; },
    };
    jobs.all = async () => { for (const k of ['map', 'tag', 'chat', 'gen', 'roster']) await jobs[k](); return '수업 기록을 모두 지웠어요.'; };
    ctx.confirmTyped('지우기', async () => {
      try { ctx.toast(await jobs[id](), 3000); } catch (e) { ctx.toast(String(e.message || e), 4000); }
      rebuild();
    });
  }

  // ---------- 그리기 ----------
  function rebuild() { lastBody = ''; render(true); }
  function render(force) {
    header();
    const canBig = tab === 'gen' || tab === 'board';
    root.classList.toggle('big', big && canBig);
    root.querySelector('[data-t="unbig"]').hidden = !(big && canBig);
    if (tab === 'settings') {
      if (force || !body.querySelector('.t-settings')) { body.innerHTML = settingsHtml(); lastBody = ''; }
      return; // 설정 화면은 입력 중일 수 있어 다시 그리지 않음
    }
    const html = { status: statusHtml, tag: tagHtml, board: boardHtml, chat: chatHtml, gen: genHtml, wipe: wipeHtml }[tab]();
    if (html !== lastBody) {
      const y = body.scrollTop;
      body.innerHTML = html;
      body.scrollTop = y;
      lastBody = html;
    }
  }

  root.addEventListener('click', (e) => {
    const t = e.target;
    const tb = t.closest('[data-ttab]');
    if (tb) { tab = tb.dataset.ttab; big = false; draftRoster = null; body.scrollTop = 0; rebuild(); return; }
    const sg = t.closest('[data-stage]');
    if (sg) {
      const k = sg.dataset.stage;
      const st = { ...ctx.stages() };
      st[k] = !st[k];
      store.put('cfg', 'stages', st);
      ctx.toast(`${k === 'tag' ? ctx.texts().tabTag : ctx.texts().tabChat} 화면을 ${st[k] ? '열었어요' : '닫았어요'}.`);
      return;
    }
    const a = t.closest('[data-t]');
    if (a) {
      const k = a.dataset.t;
      if (k === 'map') ctx.openMap();
      else if (k === 'exit') ctx.exit();
      else if (k === 'big') { big = true; rebuild(); }
      else if (k === 'unbig') { big = false; rebuild(); }
      return;
    }
    const bs = t.closest('[data-bstep]');
    if (bs) { boardStep = +bs.dataset.bstep === ctx.classStep() ? null : +bs.dataset.bstep; render(); return; }
    const cs = t.closest('[data-cstep]');
    if (cs) {
      if (cs.classList.contains('off')) return;
      const next = ctx.classStep() + +cs.dataset.cstep;
      store.put('cfg', 'chatstep', { step: next, at: Date.now() });
      boardStep = null;
      ctx.toast(`반 전체를 ${next}단계 "${ctx.chatCfg().steps[next - 1].name}"(으)로 보냈어요.`);
      return;
    }
    const f = t.closest('[data-tagf]');
    if (f) { tagFilter = f.dataset.tagf === 'all' ? 'all' : +f.dataset.tagf; render(); return; }
    const cg = t.closest('[data-chatg]');
    if (cg) { chatG = cg.dataset.chatg === 'all' ? 'all' : +cg.dataset.chatg; chatN = 'all'; render(); return; }
    const cn = t.closest('[data-chatn]');
    if (cn) { chatN = cn.dataset.chatn; render(); return; }
    const td = t.closest('[data-tdel]');
    if (td) { ctx.confirm('이 TAG를 지울까요?', () => { store.remove('tag', td.dataset.tdel, { g: 0, n: '선생님', at: Date.now() }); }); return; }
    const sv = t.closest('[data-save]');
    if (sv) { save(sv.dataset.save); return; }
    if (t.closest('[data-radd]')) {
      readRosterInputs();
      const id = Math.max(0, ...draftRoster.groups.map((g) => g.id)) + 1;
      draftRoster.groups.push({ id, name: id + '모둠', members: [] });
      body.innerHTML = settingsHtml();
      return;
    }
    const rd = t.closest('[data-rdel]');
    if (rd) { readRosterInputs(); draftRoster.groups.splice(+rd.dataset.rdel, 1); body.innerHTML = settingsHtml(); return; }
    const w = t.closest('[data-wipe]');
    if (w) wipe(w.dataset.wipe);
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-drafts]')) { showDrafts = e.target.checked; render(); }
    if (e.target.matches('[data-bai]')) { boardAi = e.target.checked; render(); }
  });

  return {
    render,
    open() { tab = 'status'; big = false; draftRoster = null; rebuild(); },
  };
}
