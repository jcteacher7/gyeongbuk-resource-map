// AI 챗봇 화면: 모둠이 함께 "만약에 ~라면?" 대화를 하고 모둠 일반화 문장을 완성합니다.
// - 단계(대조 상황 → 반대 추론 → 실제 사례 비교 → 모둠 문장 완성)는 코드에 고정, 이름과 질문은 선생님이 고침.
// - 대화는 모둠마다 하나로 쌓이고, 아이 말과 AI 답이 한 쌍으로 서버(중계 함수)에 저장됩니다.
// - AI가 실패해도 아이가 쓴 말은 지워지지 않고 [다시 보내기]가 나옵니다.
import { splitTemplate } from './defaults.js?v=8';
import { josa, timeText } from './util.js?v=8';

const BLANK_MAX = 20;

export function createChatView(el, ctx) {
  const { store, esc, ICON } = ctx;
  let shellSig = '';
  let editSig = '';
  const pend = []; // 아직 답을 못 받은 내 말 { id, text, step, status: 'wait'|'fail', msg }
  let busy = false;

  const me = () => ctx.me();
  const gkey = () => 'g' + me().g;
  const stepNow = () => Math.min(4, Math.max(1, (store.get('cstep', gkey()) || {}).step || 1));
  const rows = () => store.list('chat').filter((c) => c.g === me().g && c.a).sort((a, b) => (a.at || 0) - (b.at || 0));
  const draftKey = () => `gb-draft|${me().g}|${me().n}|gen`;

  function shell() {
    const cfg = ctx.chatCfg();
    const sig = JSON.stringify([cfg.guide, cfg.max, me().g, me().n]);
    if (sig === shellSig) return;
    if (shellSig && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    shellSig = sig;
    editSig = '';
    el.innerHTML = `<div class="chat-view">
      <aside class="cv-left">
        <div class="cv-guide">${ICON.bulb}<span>${esc(cfg.guide)}</span></div>
        <ol class="cv-steps" data-steps></ol>
        <div class="cv-stepbtns">
          <button type="button" class="btn small ghost" data-step="prev">이전 단계</button>
          <button type="button" class="btn small primary" data-step="next">다음 단계로</button>
        </div>
      </aside>
      <section class="cv-main">
        <div class="cv-thread" data-thread></div>
        <div class="cv-input">
          <input data-chat maxlength="${cfg.max}" placeholder="AI에게 물어보거나 내 생각을 말해요" autocomplete="off">
          <button type="button" class="btn primary" data-send>${ICON.send}보내기</button>
        </div>
      </section>
      <aside class="cv-right">
        <h3>${ICON.star}우리 모둠 문장</h3>
        <div class="cv-saved" data-saved></div>
        <div class="cv-edit" data-edit></div>
      </aside>
    </div>`;
  }

  function steps() {
    const cfg = ctx.chatCfg();
    const now = stepNow();
    const html = cfg.steps.map((s, i) => `<li class="${i + 1 === now ? 'on' : i + 1 < now ? 'done' : ''}"><span class="num">${i + 1}</span>${esc(s.name)}</li>`).join('');
    const node = el.querySelector('[data-steps]');
    if (node.innerHTML !== html) node.innerHTML = html;
    el.querySelector('[data-step="prev"]').classList.toggle('off', now <= 1);
    el.querySelector('[data-step="next"]').classList.toggle('off', now >= 4);
  }

  function bubble(who, text, extra = '') {
    return `<div class="bub ${who}">${extra}<div class="bub-text">${esc(text)}</div></div>`;
  }

  function thread() {
    const cfg = ctx.chatCfg();
    const list = rows();
    const now = stepNow();
    const maxStep = Math.max(now, ...list.map((c) => c.step || 1), ...pend.map((p) => p.step));
    let html = '';
    for (let s = 1; s <= maxStep; s++) {
      const st = cfg.steps[s - 1];
      html += `<div class="cv-sec"><span class="num">${s}</span>${esc(st.name)}</div>`;
      html += bubble('ai', st.question, `<span class="bwho">${ICON.bot}AI</span>`);
      list.filter((c) => (c.step || 1) === s).forEach((c) => {
        const mine = c.n === me().n;
        html += bubble(mine ? 'kid me' : 'kid', c.q, `<span class="bwho">${esc(c.n)} · ${timeText(c.at)}</span>`);
        html += bubble('ai', c.a, `<span class="bwho">${ICON.bot}AI</span>`);
      });
      pend.filter((p) => p.step === s).forEach((p) => {
        html += bubble('kid me', p.text, `<span class="bwho">${esc(me().n)}</span>`);
        html += p.status === 'wait'
          ? `<div class="bub ai wait"><span class="bwho">${ICON.bot}AI</span><div class="bub-text">AI가 생각 중이에요<span class="dots"><i></i><i></i><i></i></span></div></div>`
          : `<div class="bub ai fail"><span class="bwho">${ICON.bot}AI</span><div class="bub-text">${esc(p.msg)}</div>
              <div class="bub-acts"><button type="button" class="btn small primary" data-retry="${p.id}">다시 보내기</button>
              <button type="button" class="btn small ghost" data-rewrite="${p.id}">고쳐 쓰기</button></div></div>`;
      });
    }
    const node = el.querySelector('[data-thread]');
    if (node.innerHTML === html) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    node.innerHTML = html;
    if (atBottom || !node.dataset.seen) node.scrollTop = node.scrollHeight;
    node.dataset.seen = '1';
  }

  function sentence() {
    const g = store.get('gen', gkey());
    const saved = el.querySelector('[data-saved]');
    const html = g && g.text
      ? `<p class="gen-text">${esc(g.text)}</p><small>${esc(g.by ? josa(g.by.n, '이', '가') : '')} 저장했어요 · ${timeText(g.at)}${g._pending ? ' · <em>아직 못 보냄</em>' : ''}</small>`
      : `<p class="hint">${stepNow() < 4 ? '4단계에서 모둠 문장을 완성해요.' : '아래 빈칸을 채워 모둠 문장을 완성해요.'}</p>`;
    if (saved.innerHTML !== html) saved.innerHTML = html;

    const edit = el.querySelector('[data-edit]');
    const tpl = ctx.chatCfg().template;
    const sig = JSON.stringify([tpl, stepNow() === 4]);
    if (sig === editSig) return;
    if (editSig && edit.contains(document.activeElement)) return; // 입력 중에는 틀을 다시 만들지 않음
    editSig = sig;
    if (stepNow() !== 4) { edit.innerHTML = ''; return; }
    const parts = splitTemplate(tpl);
    let vals = [];
    try { vals = JSON.parse(localStorage.getItem(draftKey()) || 'null') || []; } catch (e) { /* 무시 */ }
    if (!vals.length && g && Array.isArray(g.parts) && g.parts.length === parts.length - 1) vals = g.parts;
    edit.innerHTML = `<div class="gen-tpl">${parts.map((p, i) => esc(p) + (i < parts.length - 1
      ? `<input data-blank="${i}" maxlength="${BLANK_MAX}" value="${esc(vals[i] || '')}" autocomplete="off" aria-label="${i + 1}번 빈칸">` : '')).join('')}</div>
      <button type="button" class="btn primary" data-gen>${ICON.check}모둠 문장 저장</button>`;
  }

  function saveSentence() {
    const parts = splitTemplate(ctx.chatCfg().template);
    const inputs = [...el.querySelectorAll('[data-blank]')];
    const vals = inputs.map((i) => i.value.trim());
    const empty = vals.findIndex((v) => !v);
    if (empty >= 0) { ctx.toast(`${empty + 1}번 빈칸을 채워 주세요.`); inputs[empty].focus(); return; }
    const text = parts.map((p, i) => p + (i < vals.length ? vals[i] : '')).join('');
    store.put('gen', gkey(), { g: me().g, text, parts: vals, by: { g: me().g, n: me().n }, at: Date.now() });
    try { localStorage.removeItem(draftKey()); } catch (e) { /* 무시 */ }
    ctx.saved('모둠 문장을 저장했어요!');
  }

  function errMsg(e) {
    if (e && e.code === 'closed') return '선생님이 챗봇을 닫았어요.';
    if (e && e.code === 'rate') return '조금 천천히 보내 주세요. 잠깐 뒤에 다시 보내요.';
    if (e && e.code === 'limit') return '오늘 보낼 수 있는 만큼 다 보냈어요. 선생님께 말해 주세요.';
    if (e && e.code === 'roster') return '명단에 있는 이름으로 들어와야 해요. 나가기 후 다시 들어와 주세요.';
    if (!navigator.onLine) return '인터넷이 끊겼어요. 연결되면 다시 물어봐 주세요.';
    return 'AI가 대답하지 못했어요. 다시 물어봐 주세요.';
  }

  async function ask(p) {
    busy = true;
    p.status = 'wait';
    thread();
    try {
      const d = await store.callFunction('gemini-chat', { g: me().g, n: me().n, text: p.text, step: p.step });
      store.absorb('chat', d.key, d.value);
      pend.splice(pend.indexOf(p), 1);
    } catch (e) {
      p.status = 'fail';
      p.msg = errMsg(e);
    } finally {
      busy = false;
      thread();
    }
  }

  function send() {
    const inp = el.querySelector('[data-chat]');
    const text = inp.value.trim();
    if (!text) { ctx.toast('보낼 말을 먼저 써 주세요.'); inp.focus(); return; }
    if (busy) { ctx.toast('AI가 답하는 중이에요. 잠깐만요!'); return; }
    const p = { id: 'p' + Date.now(), text, step: stepNow(), status: 'wait' };
    pend.push(p);
    inp.value = '';
    ask(p);
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-send]')) { send(); return; }
    const r = e.target.closest('[data-retry]');
    if (r) {
      const p = pend.find((x) => x.id === r.dataset.retry);
      if (p && !busy) ask(p); else if (busy) ctx.toast('AI가 답하는 중이에요. 잠깐만요!');
      return;
    }
    const w = e.target.closest('[data-rewrite]');
    if (w) {
      const i = pend.findIndex((x) => x.id === w.dataset.rewrite);
      if (i < 0) return;
      const inp = el.querySelector('[data-chat]');
      if (inp.value.trim()) { ctx.toast('입력칸의 글을 먼저 보내거나 지워 주세요.'); return; }
      inp.value = pend[i].text;
      pend.splice(i, 1);
      thread();
      inp.focus();
      return;
    }
    const s = e.target.closest('[data-step]');
    if (s) {
      if (s.classList.contains('off')) return;
      const next = stepNow() + (s.dataset.step === 'next' ? 1 : -1);
      store.put('cstep', gkey(), { step: next, by: { g: me().g, n: me().n }, at: Date.now() });
      ctx.toast(`${next}단계 "${ctx.chatCfg().steps[next - 1].name}"(으)로 왔어요.`);
      return;
    }
    if (e.target.closest('[data-gen]')) saveSentence();
  });
  el.addEventListener('input', (e) => {
    if (!e.target.matches('[data-blank]')) return;
    const vals = [...el.querySelectorAll('[data-blank]')].map((i) => i.value);
    try { localStorage.setItem(draftKey(), JSON.stringify(vals)); } catch (err) { /* 무시 */ }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (e.target.matches('[data-chat]')) { e.preventDefault(); send(); }
    else if (e.target.matches('[data-blank]')) {
      e.preventDefault();
      const all = [...el.querySelectorAll('[data-blank]')];
      const next = all[all.indexOf(e.target) + 1];
      if (next) next.focus(); else e.target.blur();
    }
  });

  return {
    update() {
      if (!me()) return;
      shell();
      steps();
      thread();
      sentence();
    },
    reset() { shellSig = ''; editSig = ''; pend.length = 0; },
    unmount() { shellSig = ''; editSig = ''; },
  };
}
