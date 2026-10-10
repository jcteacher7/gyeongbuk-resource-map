// TAG 화면: 발표 모둠을 고르고 T·A·G를 한 줄씩 댓글처럼 남깁니다.
// - 질문(A) 초안은 쓴 사람만 봅니다(화면에서 가리는 정도이며 완전한 잠금은 아님).
// - 남긴 TAG는 발표 모둠과 선생님, 쓴 사람이 봅니다.
// - 입력칸이 있는 틀은 한 번만 그리고, 다른 친구 글이 오면 목록만 바꿉니다(한글 입력 보호).
import { TAG_KEYS } from './defaults.js?v=17';
import { josa } from './util.js?v=17';

export function createTagView(el, ctx) {
  const { store, esc, ICON } = ctx;
  let target = null; // 모둠 번호 | 'mine' | null
  let shellSig = '';

  const lines = () => store.list('tag').sort((a, b) => (a.at || 0) - (b.at || 0));
  const isMe = (by) => by && ctx.me() && by.g === ctx.me().g && by.n === ctx.me().n;
  const chip = (k, cfg) => `<span class="tchip t-${k}"><b>${k}</b>${esc(cfg[k].name)}</span>`;

  function shell() {
    const me = ctx.me();
    const cfg = ctx.tagCfg();
    const groups = ctx.roster().groups;
    const sig = JSON.stringify([target, cfg, groups.map((g) => [g.id, g.name]), me.g]);
    if (sig === shellSig) return false;
    // 친구가 입력 중일 때 설정이 바뀌어도 입력칸을 다시 만들지 않음(입력을 마친 뒤 바뀜)
    if (shellSig && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return false;
    shellSig = sig;
    let main = '';
    if (target === 'mine') {
      main = `<div class="tv-head"><h2>${esc(josa(ctx.groupName(me.g), '이', '가'))} 받은 TAG</h2></div>
        <div class="tv-cols">${TAG_KEYS.map((k) => `<div class="tv-col"><div class="tv-col-head">${chip(k, cfg)}</div><div class="tv-col-list" data-col="${k}"></div></div>`).join('')}</div>`;
    } else if (target != null) {
      main = `<div class="tv-head"><h2>${esc(ctx.groupName(target))} 발표</h2></div>
        <div class="tv-draft">
          <div class="tv-q">${ICON.pen}질문 초안 <small>나만 봐요</small></div>
          <div class="trow"><input data-in="D" maxlength="${cfg.max}" placeholder="${esc(cfg.draftHint)}" autocomplete="off"><button type="button" class="btn small" data-send="D">적어 두기</button></div>
          <div class="tv-drafts" data-list="D"></div>
        </div>
        <div class="tv-q">발표를 듣고 TAG를 남겨요</div>
        ${TAG_KEYS.map((k) => `<div class="trow">${chip(k, cfg)}<input data-in="${k}" maxlength="${cfg.max}" placeholder="${esc(cfg[k].hint)}" autocomplete="off"><button type="button" class="btn small primary" data-send="${k}">남기기</button></div>`).join('')}
        <div class="tv-q mine-h">내가 ${esc(ctx.groupName(target))}에 남긴 TAG</div>
        <div class="tv-mylist" data-list="mine"></div>`;
    } else {
      main = '<p class="hint big">왼쪽에서 발표하는 모둠을 골라요.</p>';
    }
    el.innerHTML = `<div class="tag-view">
      <aside class="tv-left">
        <h2>누구의 발표에<br>남기나요?</h2>
        <div class="tv-targets">${groups.map((g) => {
          const own = g.id === me.g;
          return `<button type="button" class="tv-target ${target === g.id ? 'on' : ''} ${own ? 'off' : ''}" data-target="${g.id}">${esc(g.name)}${own ? '<small>우리 모둠</small>' : ''}</button>`;
        }).join('')}</div>
        <button type="button" class="tv-target recv ${target === 'mine' ? 'on' : ''}" data-target="mine">${ICON.inbox}우리 모둠이 받은 TAG <b data-count="recv"></b></button>
      </aside>
      <section class="tv-main">${main}</section>
    </div>`;
    return true;
  }

  function item(x, actions) {
    return `<div class="tline t-${x.type}">
      ${x.type === 'D' ? '<span class="tchip t-D">초안</span>' : `<span class="tchip t-${x.type}"><b>${x.type}</b></span>`}
      <span class="ttext">${esc(x.text)}${x._pending ? ' <em>아직 못 보냄</em>' : ''}</span>
      ${actions}</div>`;
  }

  function lists() {
    const me = ctx.me();
    const all = lines();
    const recv = all.filter((x) => x.to === me.g && x.type !== 'D');
    const cnt = el.querySelector('[data-count="recv"]');
    if (cnt) cnt.textContent = recv.length ? recv.length : '';
    const set = (node, html) => { if (node && node.innerHTML !== html) node.innerHTML = html; };
    if (target === 'mine') {
      TAG_KEYS.forEach((k) => {
        const node = el.querySelector(`[data-col="${k}"]`);
        const list = recv.filter((x) => x.type === k).reverse();
        set(node, list.length
          ? list.map((x) => `<div class="tcard">${esc(x.text)}<small>${esc(x.by ? x.by.n : '')} · ${esc(ctx.groupName(x.by && x.by.g))}</small></div>`).join('')
          : '<p class="hint">아직 없어요</p>');
      });
    } else if (target != null) {
      const mine = all.filter((x) => x.to === target && isMe(x.by));
      const del = (x) => `<button type="button" class="xbtn sm" data-del="${esc(x.key)}" aria-label="지우기">${ICON.trash}</button>`;
      set(el.querySelector('[data-list="D"]'), mine.filter((x) => x.type === 'D').map((x) =>
        item(x, `<button type="button" class="btn small ghost" data-use="${esc(x.key)}">질문(A)로 옮기기</button>${del(x)}`)).join(''));
      const tags = mine.filter((x) => x.type !== 'D');
      set(el.querySelector('[data-list="mine"]'), tags.length ? tags.map((x) => item(x, del(x))).join('') : '<p class="hint">아직 남긴 TAG가 없어요.</p>');
    }
  }

  function send(type) {
    const inp = el.querySelector(`input[data-in="${type}"]`);
    const text = inp.value.trim();
    if (!text) { ctx.toast(type === 'D' ? '질문 초안을 먼저 써 주세요.' : `${josa(ctx.tagCfg()[type].name, '을', '를')} 먼저 써 주세요.`); inp.focus(); return; }
    const me = ctx.me();
    store.put('tag', store.newKey('t'), { to: target, type, text, by: { g: me.g, n: me.n }, at: Date.now() });
    inp.value = '';
    ctx.saved(type === 'D' ? '적어 두었어요. 나만 볼 수 있어요.' : '남겼어요!');
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-target]');
    if (t) {
      if (t.classList.contains('off')) { ctx.toast('우리 모둠 발표에는 TAG를 남기지 않아요.'); return; }
      target = t.dataset.target === 'mine' ? 'mine' : +t.dataset.target;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      shellSig = '';
      update();
      return;
    }
    const s = e.target.closest('[data-send]');
    if (s) { send(s.dataset.send); return; }
    const u = e.target.closest('[data-use]');
    if (u) {
      const d = store.list('tag').find((x) => x.key === u.dataset.use);
      const a = el.querySelector('input[data-in="A"]');
      if (d && a) { a.value = d.text; a.focus(); ctx.toast('발표를 듣고 알맞게 고쳐서 남겨요.'); }
      return;
    }
    const d = e.target.closest('[data-del]');
    if (d) {
      ctx.confirm('이 글을 지울까요?', () => {
        store.remove('tag', d.dataset.del, { ...ctx.me(), at: Date.now() });
        ctx.toast('지웠어요.');
      });
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    const inp = e.target.closest('input[data-in]');
    if (inp) { e.preventDefault(); send(inp.dataset.in); }
  });

  function update() {
    if (!ctx.me()) return;
    shell();
    lists();
  }

  return {
    update,
    reset() { target = null; shellSig = ''; },
    unmount() { shellSig = ''; },
  };
}
