// 보기 모드(전시용) 전용 화면: TAG와 AI 챗봇을 볼 수만 있게 보여 줍니다.
// - 입력칸·지우기·보내기 단추가 없고, 서버에 아무것도 쓰지 않습니다.
// - 아이 이름은 가운데 글자를 가립니다(ctx.mask).
// - 질문(A) 초안은 쓴 사람만 보는 글이라 보여 주지 않습니다.
import { TAG_KEYS } from './defaults.js?v=54';
import { timeText, markBlanks } from './util.js?v=54';

function groupsWithAll(ctx) { return ctx.roster().groups; }

export function createViewTag(el, ctx) {
  const { store, esc, ICON } = ctx;
  let target = null;
  let sig = '';

  function update() {
    const groups = groupsWithAll(ctx);
    if (target == null || !groups.some((g) => g.id === target)) target = groups.length ? groups[0].id : null;
    const cfg = ctx.tagCfg();
    const all = store.list('tag').filter((x) => x.type !== 'D' && !x.deleted);
    const cnt = (g) => all.filter((x) => x.to === g).length;
    const chip = (k) => `<span class="tchip t-${k}"><b>${k}</b>${esc(cfg[k].name)}</span>`;
    const recv = all.filter((x) => x.to === target);
    const html = `<div class="tag-view vp">
      <aside class="tv-left">
        <h2>어느 모둠의<br>발표를 볼까요?</h2>
        <div class="tv-targets">${groups.map((g) => `<button type="button" class="tv-target ${target === g.id ? 'on' : ''}" data-vtg="${g.id}">${esc(g.name)}<small>${cnt(g.id) ? `받은 TAG ${cnt(g.id)}` : ''}</small></button>`).join('')}</div>
      </aside>
      <section class="tv-main">${target == null ? '<p class="hint big">아직 모둠이 없어요.</p>' : `
        <div class="tv-head"><h2>${esc(ctx.groupName(target))} 발표에 친구들이 남긴 TAG</h2></div>
        <div class="tv-cols">${TAG_KEYS.map((k) => {
          const list = recv.filter((x) => x.type === k).sort((a, b) => (b.at || 0) - (a.at || 0));
          return `<div class="tv-col"><div class="tv-col-head">${chip(k)}</div><div class="tv-col-list">${list.length
            ? list.map((x) => `<div class="tcard">${esc(x.text)}<small>${esc(x.by ? ctx.mask(x.by.n) : '')} · ${esc(ctx.groupName(x.by && x.by.g))}</small></div>`).join('')
            : '<p class="hint">아직 없어요</p>'}</div></div>`;
        }).join('')}</div>
        ${recv.length ? '' : '<p class="hint vp-note">수업에서 발표를 들은 친구들이 TAG를 남기면 여기에 보여요.</p>'}`}
      </section>
    </div>`;
    if (html === sig) return;
    const keep = [...el.querySelectorAll('.tv-col-list, .tv-main')].map((n) => n.scrollTop);
    el.innerHTML = html; sig = html;
    [...el.querySelectorAll('.tv-col-list, .tv-main')].forEach((n, i) => { n.scrollTop = keep[i] || 0; });
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vtg]');
    if (!b) return;
    target = +b.dataset.vtg;
    update();
  });

  return { update, reset() { target = null; sig = ''; }, unmount() { sig = ''; } };
}

export function createViewChat(el, ctx) {
  const { store, esc, ICON } = ctx;
  let group = null;
  let sig = '';
  let lastGroup = null;

  function update() {
    const groups = groupsWithAll(ctx);
    if (group == null || !groups.some((g) => g.id === group)) group = groups.length ? groups[0].id : null;
    const cfg = ctx.chatCfg();
    const chats = store.list('chat').filter((c) => c.a && !c.deleted);
    const rows = chats.filter((c) => c.g === group).sort((a, b) => (a.at || 0) - (b.at || 0));
    const gen = group == null ? null : store.get('gen', 'g' + group);
    const passed = (s) => (s === 4 ? !!(gen && gen.text) : rows.some((c) => (c.step || 1) === s && c.pass));
    const maxStep = Math.max(0, ...rows.map((c) => c.step || 1));
    const bubble = (who, text, extra) => `<div class="bub ${who}">${extra}<div class="bub-text">${esc(text)}</div></div>`;
    let thread = '';
    for (let s = 1; s <= maxStep; s++) {
      const st = cfg.steps[s - 1] || { name: '', question: '' };
      thread += `<div class="cv-sec"><span class="num">${s}</span>${esc(st.name)}</div>`;
      thread += bubble('ai', st.question, `<span class="bwho">${ICON.bot}AI</span>`);
      rows.filter((c) => (c.step || 1) === s).forEach((c) => {
        thread += bubble('kid', c.q, `<span class="bwho">${esc(ctx.mask(c.n))} · ${timeText(c.at)}</span>`);
        thread += bubble('ai', c.a, `<span class="bwho">${ICON.bot}AI</span>`);
      });
    }
    if (!thread) thread = '<p class="hint big vp-empty">아직 이 모둠의 대화가 없어요.<br>수업에서 모둠이 AI와 이야기하면 여기에 보여요.</p>';
    const html = `<div class="chat-view vp">
      <aside class="cv-left">
        <div class="tv-targets">${groups.map((g) => `<button type="button" class="tv-target ${group === g.id ? 'on' : ''}" data-vcg="${g.id}">${esc(g.name)}${(store.get('gen', 'g' + g.id) || {}).text ? `<small>${ICON.star}</small>` : ''}</button>`).join('')}</div>
        <ol class="cv-steps">${cfg.steps.map((s, i) => `<li class="${passed(i + 1) ? 'done' : 'todo'}"><span class="num">${i + 1}</span><span class="sname">${esc(s.name)}</span>${passed(i + 1) ? `<span class="pass">${ICON.star}</span>` : ''}</li>`).join('')}</ol>
      </aside>
      <section class="cv-main"><div class="cv-thread">${thread}</div></section>
      <aside class="cv-right">
        <div class="cv-keyq"><small>핵심 질문</small>${esc(cfg.keyQuestion)}</div>
        <h3>${ICON.star}${esc(group == null ? '' : ctx.groupName(group))}의 답</h3>
        <div class="cv-saved">${gen && gen.text
          ? `<p class="gen-text">${markBlanks(gen.text, gen.parts)}</p><small>${esc(gen.by ? ctx.mask(gen.by.n) : '')} · ${timeText(gen.at)}</small>`
          : '<p class="hint">아직 모둠 문장을 완성하지 않았어요.</p>'}</div>
      </aside>
    </div>`;
    if (html === sig) return;
    const th0 = el.querySelector('.cv-thread');
    const atBottom = th0 ? th0.scrollHeight - th0.scrollTop - th0.clientHeight < 80 : true;
    const keep = th0 ? th0.scrollTop : 0;
    el.innerHTML = html; sig = html;
    const th = el.querySelector('.cv-thread');
    if (lastGroup !== group) th.scrollTop = 0;
    else th.scrollTop = atBottom ? th.scrollHeight : keep;
    lastGroup = group;
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vcg]');
    if (!b) return;
    group = +b.dataset.vcg;
    update();
  });

  return { update, reset() { group = null; sig = ''; lastGroup = null; }, unmount() { sig = ''; } };
}
