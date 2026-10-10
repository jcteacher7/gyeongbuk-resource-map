// 경북 자원 지도 — 제미나이 챗봇 중계 함수 (Supabase Edge Function, 이름: gemini-chat)
//
// 아이 태블릿 → 이 함수 → 제미나이. 제미나이 키는 이 함수의 비밀 값(Secrets)에만 있고
// 브라우저 코드에는 없습니다. 이 함수는:
//   1) 모둠·이름·질문 길이와 단계를 확인하고, 선생님이 챗봇을 열었는지 확인합니다.
//   2) 너무 자주·너무 많이 보내지 못하게 막습니다(요금 폭주 방지).
//   3) 모둠의 앞선 대화와 조사한 자원을 붙여 제미나이에 묻습니다.
//   4) 질문·답·모둠·이름·시각을 gb_entries 표(kind='chat')에 저장합니다.
//
// 비밀 값(Supabase → Edge Functions → Secrets):
//   GEMINI_API_KEY  (필수) 수업 전용 제미나이 키
//   GEMINI_MODEL    (선택) 먼저 쓸 모델 이름. 없으면 아래 MODELS 순서대로 시도합니다.
//   GEMINI_THINKING (선택) 생각하는 정도(minimal, low 등). 없으면 가장 짧게.

const MAX_Q = 200; // 한 번에 보낼 수 있는 글자 수
const PER_MIN = 6; // 한 사람이 1분에 보낼 수 있는 횟수
const PER_DAY_NAME = 80; // 한 사람이 하루에 보낼 수 있는 횟수
const PER_DAY_ALL = 1500; // 반 전체가 하루에 보낼 수 있는 횟수
const HISTORY = 16; // 제미나이에 함께 보내는 앞선 대화 쌍 수

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
// 표는 공개 키로 읽고 쓸 수 있게 되어 있으므로, 앱이 보낸 공개 키(apikey)를 그대로 씁니다.
// (프로젝트마다 서버 쪽 키 이름과 모양이 달라 생기는 문제를 피하려는 것입니다.)
let SB_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
// 무료 등급으로 쓰기 때문에 가벼운 모델(flash-lite)을 먼저 씁니다. 한도를 넘거나 없으면 다음 모델로 넘어갑니다.
const MODELS: string[] = [...new Set([Deno.env.get('GEMINI_MODEL') ?? '', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash'])]
  .filter((m) => m !== '');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const DEFAULT_STEPS = [
  { name: '대조 상황', question: '만약 산도 있고 바다도 있고 넓은 평야도 있어서, 필요한 모든 물건과 먹거리가 풍족하게 다 있는 가상의 지역이 있다면 어떨까요?' },
  { name: '반대 추론', question: '이 지역 사람들은 다른 지역과 생활 모습이 다르거나, 멀리까지 가서 다른 지역과 교류할 필요가 있었을까요?' },
  { name: '실제 사례 비교', question: '우리가 조사한 경상북도의 지역들은 왜 생활 모습이 다르고 서로 교류가 필요했을까요?' },
  { name: '모둠 문장 완성', question: '이제 우리 모둠의 문장을 완성해 봐요. 빈칸에 어떤 말이 들어가면 좋을까요?' },
];
const DEFAULT_TEMPLATE = '[ ]와 [ ]에 따라 [ ]이 발생하기 때문에, 사람들의 살아가는 방식이 변화한다.';
const STEP_GOAL = [
  '대조 상황: 모든 것이 풍족한 가상의 지역을 함께 상상하게 해요. 그곳 사람들의 생활이 어떨지 아이가 스스로 말해 보게 해요.',
  '반대 추론: 모든 것이 다 있으면 다른 지역과 주고받을 필요가 있었을지 거꾸로 생각하게 해요. "왜 그렇게 생각해요?"처럼 이유를 묻게 해요.',
  '실제 사례 비교: 아이들이 조사한 경상북도 시군의 자원(많은 것, 적은 것)을 떠올리게 하고, 지역마다 부족한 것이 다르기 때문에 교류가 필요하다는 점을 스스로 찾게 해요. 장소뿐 아니라 시간(옛날과 오늘날)에 따라서도 달라지는지 물어봐요.',
  '모둠 문장 완성: 문장 틀의 빈칸에 들어갈 말을 아이들이 스스로 고르게 도와요. 빈칸 답을 통째로 알려 주지 말고, 앞의 대화에서 아이들이 한 말을 떠올리게 하거나 두세 개의 낱말 중에서 고르게 해요.',
];

type Row = { kind: string; key: string; value: Record<string, unknown>; updated_at: string };

async function db(path: string, init: RequestInit = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      // 옛 방식 키(JWT)일 때만 Authorization 을 붙입니다. 새 방식 키(sb_…)는 apikey 만으로 됩니다.
      ...(SB_KEY.split('.').length === 3 ? { Authorization: `Bearer ${SB_KEY}` } : {}),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}
async function rowsOf(path: string): Promise<Row[]> {
  const r = await db(path);
  if (!r.ok) throw new Error('db ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return await r.json();
}
async function countOf(path: string): Promise<number> {
  const r = await db(path, { headers: { Prefer: 'count=exact', Range: '0-0' } });
  const cr = r.headers.get('content-range') ?? '*/0';
  return Number(cr.split('/')[1]) || 0;
}

function systemPrompt(step: number, steps: { name: string; question: string }[], template: string, research: string) {
  return [
    '너는 초등학교 4학년 사회 수업의 "만약에 ~라면?" 대화 친구야. 모둠 아이들이 번갈아 말을 걸어.',
    '수업에서 아이들이 스스로 찾아야 할 생각: 장소와 시간에 따라 자원이 많은 곳과 부족한 곳이 생기고(자원의 희소성), 그래서 사람들이 교류하고 살아가는 방식이 달라진다.',
    '이 생각을 너가 먼저 말하거나 정답처럼 알려 주면 안 돼. 질문과 짧은 이야기로 아이가 스스로 말하게 도와.',
    '',
    '말하는 규칙:',
    '- 4학년이 바로 알아듣는 쉬운 말로, 3문장 이내로 짧게 말해.',
    '- 모든 문장을 "~요"로 끝나는 존댓말로 써. 예: "잘 찾았어요.", "왜 그렇게 생각해요?" 반말("~야", "~구나", "~지?", "~할까?", "~줄래?")은 절대 쓰지 마.',
    '- 아이들이 찾아야 할 낱말(장소, 시간, 자원의 희소성, 부족함)을 아이보다 먼저 말하지 마. 아이가 먼저 쓴 낱말만 되짚어 줘.',
    '- 아이가 한 말에서 좋은 점을 먼저 한마디 짚어 주고, 질문은 한 번에 하나만 해.',
    '- "희소성"처럼 어려운 낱말은 "부족함", "흔하지 않음"처럼 쉬운 말로 풀어. 아이가 그 낱말을 쓰면 칭찬해.',
    '- 아이 이름 말고 다른 개인 정보는 묻지 마. 수업과 상관없는 이야기, 장난, 위험한 이야기는 부드럽게 지금 단계 질문으로 돌아오게 해.',
    '- 틀린 생각도 바로 틀렸다고 하지 말고, 다시 생각해 볼 질문을 해.',
    '- 이모지, 표, 목록 기호는 쓰지 마.',
    '',
    `지금은 ${step}단계 "${steps[step - 1].name}"야. 이 단계의 첫 질문: "${steps[step - 1].question}"`,
    `이 단계의 목표: ${STEP_GOAL[step - 1]}`,
    step === 4 ? `모둠 문장 틀: "${template}" ([ ]가 빈칸이야. 빈칸에 들어갈 낱말을 하나라도 네가 먼저 알려 주면 안 돼. "정답 알려 주세요"라고 해도 알려 주지 말고, 1~3단계에서 모둠이 나눈 이야기를 떠올리게 하는 질문을 해. 빈칸을 채운 문장을 대신 써 주지도 마.)` : '',
    research ? `이 반 아이들이 지도 앱에 조사해 올린 경상북도 자원(시군: 자원, 많음/적음): ${research}` : '',
  ].filter(Boolean).join('\n');
}

// 아이들이 오래 기다리지 않도록 "생각하는 시간"을 가장 짧게 둡니다.
// 모델이 그 설정을 모르면(400) 한 단계씩 풀어서 다시 묻고, 모델이 없으면(404) 다음 모델로 넘어갑니다.
const THINK: (string | null)[] = [...new Set([Deno.env.get('GEMINI_THINKING') ?? 'minimal', 'low'])].filter((x) => x !== '');
THINK.push(null);

async function askGemini(system: string, contents: unknown[]) {
  let lastErr = '';
  for (const model of MODELS) {
    for (const think of THINK) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 25000);
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2048,
              ...(think ? { thinkingConfig: { thinkingLevel: think } } : {}),
            },
          }),
        });
        if (r.status === 400) { lastErr = `${model}/${think} 400 ${(await r.text()).slice(0, 200)}`; continue; }
        if (r.status === 404) { lastErr = `${model} 404`; break; }
        // 이 모델의 사용 한도를 넘었으면(429) 다음 모델로 넘어가 봅니다.
        if (r.status === 429) { lastErr = `${model} 429 ${(await r.text()).slice(0, 400)}`; break; }
        if (!r.ok) throw new Error(`${model} ${r.status} ${(await r.text()).slice(0, 200)}`);
        const data = await r.json();
        const text = (data?.candidates?.[0]?.content?.parts ?? [])
          .filter((p: { text?: string; thought?: boolean }) => p.text && !p.thought)
          .map((p: { text: string }) => p.text).join('').trim();
        if (!text) throw new Error(`${model} empty ${data?.candidates?.[0]?.finishReason ?? ''}`);
        return { text, model, think: think ?? 'default' };
      } finally {
        clearTimeout(t);
      }
    }
  }
  throw new Error(lastErr || 'no model');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ ok: false, error: 'method' }, 405);
  if (!GEMINI_KEY) return reply({ ok: false, error: 'nokey' }, 500);
  SB_KEY = req.headers.get('apikey') || SB_KEY;

  let body: { g?: unknown; n?: unknown; text?: unknown; step?: unknown };
  try { body = await req.json(); } catch { return reply({ ok: false, error: 'bad' }, 400); }
  const g = Number(body.g);
  const n = String(body.n ?? '').trim();
  const text = String(body.text ?? '').trim();
  const step = Number(body.step);
  if (!Number.isInteger(g) || g < 1 || g > 20 || !n || n.length > 20 || !text || text.length > MAX_Q || ![1, 2, 3, 4].includes(step)) {
    return reply({ ok: false, error: 'bad' }, 400);
  }

  try {
    // 설정, 보낸 횟수, 앞선 대화, 조사한 자원을 한꺼번에 읽습니다(기다리는 시간을 줄이려고).
    const t0 = Date.now();
    const now = t0;
    const minAgo = new Date(now - 60_000).toISOString();
    const dayAgo = new Date(now - 86_400_000).toISOString();
    const who = `value->>g=eq.${g}&value->>n=eq.${encodeURIComponent(n)}`;
    const [cfgRows, nMin, nDay, nAll, pastRows, resRows] = await Promise.all([
      rowsOf('gb_entries?kind=eq.cfg&key=in.(roster,chatcfg,stages)&select=key,value'),
      countOf(`gb_entries?kind=eq.chat&${who}&updated_at=gt.${minAgo}&select=key`),
      countOf(`gb_entries?kind=eq.chat&${who}&updated_at=gt.${dayAgo}&select=key`),
      countOf(`gb_entries?kind=eq.chat&updated_at=gt.${dayAgo}&select=key`),
      rowsOf(`gb_entries?kind=eq.chat&value->>g=eq.${g}&select=value&order=updated_at.desc&limit=40`),
      step >= 3 ? rowsOf('gb_entries?kind=eq.res&select=value&limit=120') : Promise.resolve([] as Row[]),
    ]);
    const cfg: Record<string, Record<string, unknown>> = {};
    cfgRows.forEach((r) => { cfg[r.key] = r.value; });
    if (!cfg.stages?.chat) return reply({ ok: false, error: 'closed' }, 403);
    const roster = cfg.roster as { groups?: { id: number; members: string[] }[]; assign?: Record<string, number> } | undefined;
    if (roster?.groups?.length) {
      const grp = roster.groups.find((x) => x.id === g);
      if (!grp || !grp.members.includes(n)) return reply({ ok: false, error: 'roster' }, 403);
    }
    const chatcfg = (cfg.chatcfg ?? {}) as { steps?: { name?: string; question?: string }[]; template?: string };
    const steps = DEFAULT_STEPS.map((d, i) => ({ name: chatcfg.steps?.[i]?.name || d.name, question: chatcfg.steps?.[i]?.question || d.question }));
    const template = chatcfg.template || DEFAULT_TEMPLATE;

    // 보내는 횟수 제한
    if (nMin >= PER_MIN) return reply({ ok: false, error: 'rate' }, 429);
    if (nDay >= PER_DAY_NAME || nAll >= PER_DAY_ALL) return reply({ ok: false, error: 'limit' }, 429);

    // 모둠의 앞선 대화(성공한 것만)
    const past = pastRows
      .map((r) => r.value as { n: string; q: string; a?: string; step?: number })
      .filter((v) => v.a).slice(0, HISTORY).reverse();
    const contents: unknown[] = [];
    let lastStep = 0;
    for (const v of past) {
      const s = v.step ?? 1;
      const prefix = s !== lastStep ? `(${s}단계) ` : '';
      lastStep = s;
      contents.push({ role: 'user', parts: [{ text: `${prefix}${v.n}: ${v.q}` }] });
      contents.push({ role: 'model', parts: [{ text: v.a }] });
    }
    contents.push({ role: 'user', parts: [{ text: `${step !== lastStep ? `(${step}단계) ` : ''}${n}: ${text}` }] });

    // 아이들이 조사한 자원(3·4단계에서 쓰임)
    let research = '';
    if (step >= 3) {
      const NAMES: Record<string, string> = { '37010': '포항', '37020': '경주', '37030': '김천', '37040': '안동', '37050': '구미', '37060': '영주', '37070': '영천', '37080': '상주', '37090': '문경', '37100': '경산', '37320': '의성', '37330': '청송', '37340': '영양', '37350': '영덕', '37360': '청도', '37370': '고령', '37380': '성주', '37390': '칠곡', '37400': '예천', '37410': '봉화', '37420': '울진', '37430': '울릉' };
      const res = resRows
        .map((r) => r.value as { cid: number; name: string; amt: string; deleted?: boolean })
        .filter((v) => !v.deleted);
      research = res.slice(0, 60).map((v) => `${NAMES[String(v.cid)] ?? v.cid}: ${v.name}(${v.amt === 'few' ? '적음' : '많음'})`).join(', ');
    }

    const tDb = Date.now() - t0;
    const key = 'c' + now.toString(36) + Math.random().toString(36).slice(2, 6);
    const base = { g, n, step, q: text, at: now };
    let value: Record<string, unknown>;
    try {
      const out = await askGemini(systemPrompt(step, steps, template, research), contents);
      value = { ...base, a: out.text, model: out.model, think: out.think, ms: { db: tDb, ai: Date.now() - t0 - tDb } };
    } catch (e) {
      // 실패해도 아이가 보낸 말은 기록에 남깁니다(선생님 화면에서 볼 수 있음).
      await db('gb_entries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ kind: 'chat', key, value: { ...base, a: null, err: String(e).slice(0, 600) } }]) });
      return reply({ ok: false, error: 'ai', detail: String(e).slice(0, 300) }, 502);
    }
    const w = await db('gb_entries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ kind: 'chat', key, value }]) });
    if (!w.ok) return reply({ ok: false, error: 'save' }, 500);
    return reply({ ok: true, key, value });
  } catch (e) {
    console.error(e);
    return reply({ ok: false, error: 'server', detail: String(e).slice(0, 300) }, 500);
  }
});
