export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 링크는 http(s) 주소만 엽니다. "naver.com"처럼 앞부분을 빼고 쓰면 https:// 를 붙입니다.
export function safeLink(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch (e) {
    return '';
  }
}

// 받침에 따라 이/가, 을/를 등을 고릅니다.
export function josa(word, withBatchim, without) {
  const c = String(word || '').charCodeAt(String(word || '').length - 1);
  if (c < 0xac00 || c > 0xd7a3) return word + without;
  return word + ((c - 0xac00) % 28 ? withBatchim : without);
}

export function timeText(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 모둠 문장에서 아이들이 빈칸에 써 넣은 말만 색을 다르게 보여 줍니다.
// 저장된 글(text) 안에서 빈칸 값(parts)을 앞에서부터 차례로 찾아 표시합니다(문장 틀이 나중에 바뀌어도 됨).
export function markBlanks(text, parts) {
  text = String(text || '');
  if (!Array.isArray(parts) || !parts.length) return esc(text);
  let out = '';
  let pos = 0;
  for (const part of parts) {
    const at = part ? text.indexOf(part, pos) : -1;
    if (at < 0) continue;
    out += esc(text.slice(pos, at)) + `<span class="fill">${esc(part)}</span>`;
    pos = at + part.length;
  }
  return out + esc(text.slice(pos));
}
