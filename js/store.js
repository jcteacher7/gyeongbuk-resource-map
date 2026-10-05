// 저장 담당: Supabase 표(gb_entries)에 읽고 쓰고, 연결이 끊기면 이 기기에 먼저 보관합니다.
//
// - 쓰기는 모두 "보낼 상자(outbox)"에 먼저 넣고 localStorage에 적은 뒤 서버로 보냅니다.
//   그래서 인터넷이 끊겨도, 새로고침해도 글이 사라지지 않고 연결이 돌아오면 다시 보냅니다.
// - 읽기는 몇 초마다 "마지막으로 본 뒤 바뀐 줄"만 가져오고, 가끔 전체를 다시 읽습니다.
// - 지우기는 줄을 없애지 않고 deleted 표시를 붙입니다(다른 기기에도 지운 것이 전해지도록).
import { SUPABASE_URL, SUPABASE_KEY, TABLE, PHOTO_BUCKET, POLL_MS } from './config.js?v=3';

const CACHE_KEY = 'gb-cache-v1';
const OUTBOX_KEY = 'gb-outbox-v1';
const FULL_EVERY_MS = 90000;
const KINDS = ['cfg', 'res', 'arrow'];

const rows = new Map(); // 'kind/key' → { kind, key, value, updated_at, pending }
let outbox = []; // { kind, key, value, photo: {full, thumb} (dataURL) | null }
let since = '';
let lastFull = 0;
let mode = 'connecting'; // ok | offline | setup | connecting
let flushing = false;
let timer = null;
const listeners = new Set();

const rk = (kind, key) => kind + '/' + key;

function emit() {
  listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
}

function saveOutbox() {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); return true; } catch (e) { return false; }
}
let cacheT = null;
function saveCache() {
  clearTimeout(cacheT);
  cacheT = setTimeout(() => {
    const list = [...rows.values()].filter((r) => !r.pending);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ since, rows: list })); } catch (e) { /* 공간이 없으면 건너뜀 */ }
  }, 300);
}

function localValue(item) {
  if (!item.photo) return item.value;
  return { ...item.value, photo: { full: item.photo.full, thumb: item.photo.thumb, local: true } };
}
function applyLocal(item) {
  rows.set(rk(item.kind, item.key), { kind: item.kind, key: item.key, value: localValue(item), updated_at: '', pending: true });
}

function loadLocal() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && Array.isArray(c.rows)) {
      c.rows.forEach((r) => rows.set(rk(r.kind, r.key), { ...r, pending: false }));
      since = c.since || '';
    }
  } catch (e) { /* 무시 */ }
  try { outbox = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]') || []; } catch (e) { outbox = []; }
  outbox.forEach(applyLocal);
}

function api(path, opts = {}, ms = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  const headers = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, ...(opts.headers || {}) };
  return fetch(SUPABASE_URL + path, { ...opts, headers, signal: ctl.signal }).finally(() => clearTimeout(t));
}

async function failOf(res) {
  let body = '';
  try { body = await res.text(); } catch (e) { /* 무시 */ }
  // 표가 아직 없음(선생님이 schema.sql 을 실행하기 전)
  if (res.status === 404 || body.includes('PGRST205') || body.includes('42P01')) return 'setup';
  return 'offline';
}

function setMode(m) {
  if (mode !== m) { mode = m; emit(); }
}

function isPending(kind, key) {
  return outbox.some((o) => o.kind === kind && o.key === key);
}

async function pull(full) {
  let q = `/rest/v1/${TABLE}?select=kind,key,value,updated_at&kind=in.(${KINDS.join(',')})&order=updated_at.asc`;
  if (!full && since) {
    // 거의 같은 순간에 저장된 줄을 놓치지 않으려고 3초 겹쳐 읽습니다.
    const t = Date.parse(since);
    if (!Number.isNaN(t)) q += '&updated_at=gt.' + encodeURIComponent(new Date(t - 3000).toISOString());
  }
  const res = await api(q);
  if (!res.ok) { const m = await failOf(res); throw Object.assign(new Error('pull'), { mode: m }); }
  const list = await res.json();
  let changed = false;
  const seen = new Set();
  for (const r of list) {
    const id = rk(r.kind, r.key);
    seen.add(id);
    if (!since || r.updated_at > since) since = r.updated_at;
    if (isPending(r.kind, r.key)) continue; // 내가 아직 못 보낸 글이 우선
    const old = rows.get(id);
    if (!old || old.pending || old.updated_at !== r.updated_at || JSON.stringify(old.value) !== JSON.stringify(r.value)) {
      rows.set(id, { ...r, pending: false });
      changed = true;
    }
  }
  if (full) {
    // 선생님 화면에서 완전히 지운 줄은 여기서 사라집니다.
    for (const [id, r] of rows) {
      if (!seen.has(id) && !isPending(r.kind, r.key)) { rows.delete(id); changed = true; }
    }
    lastFull = Date.now();
  }
  if (changed) { saveCache(); emit(); }
}

function dataUrlToBlob(u) {
  const [head, b64] = u.split(',');
  const type = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

async function uploadPhoto(path, dataUrl) {
  const res = await api(`/storage/v1/object/${PHOTO_BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'cache-control': '31536000' },
    body: dataUrlToBlob(dataUrl),
  }, 30000);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error('upload'), { mode: /bucket not found/i.test(body) ? 'setup' : 'offline' });
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

async function flush() {
  if (flushing || !outbox.length) return;
  flushing = true;
  try {
    while (outbox.length) {
      const item = outbox[0];
      if (item.photo) {
        const base = `${item.kind}/${item.key}-${Date.now().toString(36)}`;
        const full = await uploadPhoto(base + '.jpg', item.photo.full);
        const thumb = await uploadPhoto(base + '-s.jpg', item.photo.thumb);
        item.value = { ...item.value, photo: { full, thumb } };
        item.photo = null;
        saveOutbox();
      }
      const res = await api(`/rest/v1/${TABLE}?on_conflict=kind,key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ kind: item.kind, key: item.key, value: item.value }]),
      });
      if (!res.ok) { const m = await failOf(res); throw Object.assign(new Error('push'), { mode: m }); }
      outbox.shift();
      saveOutbox();
      if (!isPending(item.kind, item.key)) {
        rows.set(rk(item.kind, item.key), { kind: item.kind, key: item.key, value: item.value, updated_at: '', pending: false });
      }
      emit();
    }
    setMode('ok');
  } finally {
    flushing = false;
  }
}

async function tick() {
  clearTimeout(timer);
  if (!document.hidden) {
    try {
      await flush();
      await pull(!lastFull || Date.now() - lastFull > FULL_EVERY_MS);
      setMode('ok');
    } catch (e) {
      setMode(e.mode || 'offline');
    }
  }
  timer = setTimeout(tick, mode === 'ok' ? POLL_MS : POLL_MS * 2);
}

export const store = {
  start() {
    loadLocal();
    window.addEventListener('online', () => tick());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    tick();
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  status() { return { mode, pending: outbox.length }; },
  get(kind, key) {
    const r = rows.get(rk(kind, key));
    return r && !(r.value && r.value.deleted) ? r.value : undefined;
  },
  list(kind) {
    const out = [];
    for (const r of rows.values()) {
      if (r.kind === kind && r.value && !r.value.deleted) out.push({ ...r.value, key: r.key, _pending: r.pending });
    }
    return out;
  },
  // photo: 새 사진이 있을 때 { full, thumb } (dataURL). 서버로 보낼 때 올리고 주소로 바꿉니다.
  put(kind, key, value, photo = null) {
    const prev = outbox.findIndex((o) => o.kind === kind && o.key === key);
    if (!photo && prev >= 0 && outbox[prev].photo && value.photo && value.photo.local) photo = outbox[prev].photo;
    const v = { ...value };
    if (v.photo && v.photo.local) delete v.photo;
    const item = { kind, key, value: v, photo };
    if (prev >= 0) outbox.splice(prev, 1);
    outbox.push(item);
    const kept = saveOutbox();
    applyLocal(item);
    emit();
    flush().then(() => setMode('ok'), (e) => setMode(e.mode || 'offline'));
    return kept;
  },
  remove(kind, key, by) {
    const r = rows.get(rk(kind, key));
    if (!r) return true;
    const v = { ...r.value, deleted: true, deletedBy: by, deletedAt: Date.now() };
    if (v.photo && v.photo.local) delete v.photo;
    return store.put(kind, key, v);
  },
  newKey(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  },
  retry() { tick(); },
};
