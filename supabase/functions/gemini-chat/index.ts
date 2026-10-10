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
  '실제 사례 비교: 이 단계에서는 두 가지를 차례로 찾게 해요. (가) 먼저 아이들이 조사한 경상북도의 실제 지역과 자원을 예로 들어, 지역마다 많은 것과 부족한 것이 달라서 교류가 필요했다는 점. (나) 그다음 "옛날과 오늘날에는 생활 모습이나 교류하는 방법이 어떻게 달라졌을까요?"처럼 때에 따라서도 달라진다는 점. (가)가 나오면 꼭 (나)를 물어보고, (나)가 먼저 나오면 (가)를 물어봐요. 이때 "장소", "시간", "공간"이라는 낱말은 쓰지 말고 "지역마다", "곳곳", "옛날과 오늘날", "때"처럼 풀어서 말해요.',
  '모둠 문장 완성: 문장 틀의 빈칸에 들어갈 말을 아이들이 스스로 고르게 도와요. 빈칸 답을 통째로 알려 주지 말고, 앞의 대화에서 아이들이 한 말을 떠올리게 하거나 두세 개의 낱말 중에서 고르게 해요.',
];

// 아이들이 스스로 찾아야 하는 낱말입니다. 모둠 아이가 먼저 쓰기 전에 AI 답에 이 낱말이 나오면
// 다시 쓰게 하고, 그래도 나오면 아래의 안전한 되묻기로 바꿉니다.
const SECRET_WORDS = ['장소', '시간', '희소', '공간'];
const SAFE_REPLY = [
  '좋은 생각이에요. 왜 그렇게 생각했는지 조금 더 이야기해 줄래요?',
  '좋은 생각이에요. 왜 그렇게 생각했는지 조금 더 이야기해 줄래요?',
  '잘 찾았어요. 우리가 조사한 지역 가운데 어디에 무엇이 많고, 어디에 무엇이 적었는지 하나만 더 말해 줄래요?',
  '스스로 찾아내면 훨씬 더 멋질 거예요. 앞에서 우리 모둠이 나눈 이야기를 떠올려 봐요. 무엇이 달라서 지역마다 있는 것과 없는 것이 달랐나요?',
];

// 단계 통과 기준(AI가 판정). 4단계는 모둠 문장을 저장하면 통과라서 AI가 판정하지 않습니다.
const PASS_RULE = [
  '모든 것이 풍족한 지역 사람들의 생활이 어떨지를 모둠이 자기 말로, 이유나 구체적인 모습과 함께 말했다.',
  '모든 것이 다 있는 지역은 다른 지역과 교류할 필요가 있었을지에 대해, 모둠이 생각과 그 이유를 함께 말했다.',
  '모둠이 다음 두 가지를 모두 말했다. (가) 조사한 경상북도의 실제 지역이나 자원을 예로 들어, 지역마다 많은 것과 부족한 것이 달라서 교류가 필요했다는 점. (나) 옛날과 오늘날처럼 때에 따라 교류하는 방법이나 생활 모습이 달라졌다는 점과 그 까닭. 둘 중 하나만 말했으면 반드시 false로 하고, reply에서 아직 말하지 않은 쪽을 물어봐. praise에는 (가)와 (나)를 이어서 한 문장으로 되짚어 줘.',
  '',
];

// 단계마다 아직 꺼내면 안 되는 이야기(다음 단계 질문을 미리 하지 않게 함)
const STEP_BAN = [
  '아직 다른 지역과 주고받는 이야기(교류)나 실제 경상북도 지역 이야기는 꺼내지 마. 모든 것이 풍족한 가상의 지역 사람들이 어떻게 살지만 물어.',
  '아직 실제 지역 이야기는 꺼내지 마. "실제로는", "우리가 조사한", "경상북도", "모든 지역에 다 있었을까", "부족한 지역은" 같은 말로 넘어가면 안 돼. 모든 것이 다 있는 가상의 지역에서 교류가 필요했을지와 그 이유만 물어.',
  '아직 모둠 문장이나 빈칸 이야기는 꺼내지 마. 조사한 실제 지역의 많은 것과 부족한 것, 옛날과 오늘날의 차이만 물어.',
  '',
];
// 미션을 통과한 뒤에는 새 질문으로 나아가지 않고, 칭찬 한 문장 + 아래 말로 마무리합니다(선생님이 설정에서 고칠 수 있음).
const DEFAULT_PASS_TEXT = '미션 성공이에요! 선생님이 다음 단계를 열어 줄 때까지, 왜 그렇게 생각했는지 모둠끼리 한 번 더 이야기해 봐요.';
const DEFAULT_PRAISE = '모둠이 함께 생각해서 이유까지 잘 말해 주었어요.';

// ---------- 4단계: 빈칸 정답으로 이끌기 ----------
// 정답은 선생님 설정(chatcfg.answers)에서 옵니다. 쉼표로 빈칸을 나누고, 같은 뜻으로 인정할 말은 | 로 나눕니다.
const DEFAULT_ANSWERS = '공간|장소, 시간, 자원의 희소성|희소성';
const parseAnswers = (t: string) => t.split(',').map((x) => x.split('|').map((y) => y.trim()).filter(Boolean)).filter((x) => x.length);
// 모둠이 4단계에서 한 말(차례대로)을 보고, 빈칸마다 몇 번째 말에서 맞혔는지(-1이면 아직) 알아냅니다.
function blankState(answers: string[][], said: string[]) {
  const at = answers.map((syn) => said.findIndex((m) => syn.some((w) => m.replace(/\s/g, '').includes(w.replace(/\s/g, '')))));
  const last = said.length - 1;
  const cur = at.findIndex((x) => x < 0);
  const lastSolve = Math.max(-1, ...at);
  return { at, cur, just: at.map((x, i) => (x === last ? i : -1)).filter((i) => i >= 0), tries: last - lastSolve, done: cur < 0 };
}

// 힌트는 글자 수나 첫소리를 알려 주지 않습니다. 모둠이 앞에서 나눈 이야기에서 스스로 낱말을 끌어내도록,
// 틀릴 때마다 다른 방식의 "떠올리기 질문"을 차례로 씁니다.
const HINT_STYLE = [
  '되짚기: 3단계에서 이 모둠이 실제로 한 말을 짧게 되짚어 주고, "그때 무엇이 달라서 그랬다고 했나요?"처럼 그 안에서 낱말을 찾게 해.',
  '견주기: 구체적인 예 두 가지를 나란히 놓고(예: 모둠이 말한 두 지역, 또는 옛날과 오늘날) "이 둘은 무엇이 서로 다른가요? 그 다른 점을 한 낱말로 묶으면요?"라고 물어.',
  '거꾸로 생각하기: 1·2단계의 모든 것이 다 있는 가상의 지역을 다시 꺼내서, "그 지역에는 없었는데 실제 지역에는 있었던 차이는 무엇이었나요?"처럼 반대로 생각하게 해.',
  '문장에 넣어 보기: 아이가 방금 말한 낱말을 문장 틀의 그 빈칸에 넣어 소리 내어 읽어 보게 하고, "이 말로 우리가 조사한 이야기가 모두 설명되나요? 더 넓게 묶는 말은 없을까요?"라고 물어.',
  '좁혀 가기: 아이가 말한 낱말이 정답보다 좁은 뜻인지 넓은 뜻인지 알려 주고(예: "그건 그 가운데 한 가지예요", "그것들을 모두 묶는 말이 있어요"), 범위를 맞추게 해.',
  '사회 시간 떠올리기: 이 단원에서 배운 낱말 가운데 지금 이야기와 이어지는 것이 무엇이었는지 떠올리게 하고, 그 낱말이 어떤 뜻이었는지 아이가 먼저 말해 보게 해.',
];

function step4Guide(answers: string[][], st: ReturnType<typeof blankState>) {
  const n = st.cur + 1;
  const style = HINT_STYLE[Math.max(0, st.tries - 1) % HINT_STYLE.length];
  return [
    '',
    '[4단계 빈칸 이끌기 — 아래를 꼭 지켜]',
    `빈칸의 정답(너만 알고 있어. 아이가 먼저 말하기 전에는 정답 낱말을 절대 쓰지 마): ${answers.map((a, i) => `${i + 1}번=${a.join(' 또는 ')}`).join(', ')}`,
    `지금 상태: ${answers.map((_, i) => `${i + 1}번 ${st.at[i] >= 0 ? '찾음' : '아직'}`).join(', ')}. 지금 도울 빈칸은 ${n}번이야. 한 번에 이 빈칸 하나만 다뤄.`,
    st.just.length
      ? `방금 아이가 ${st.just.map((i) => i + 1).join(', ')}번 빈칸을 맞혔어. "맞아요"라고 분명하게 확인해 준 다음, ${n}번 빈칸으로 넘어가 떠올리기 질문을 해.`
      : `방금 아이가 한 말은 ${n}번 빈칸의 정답이 아니야. "좋아요", "똑똑해요", "맞아요", "멋져요"처럼 맞은 것처럼 들리는 칭찬을 하지 마. "아직 아니에요" 또는 (뜻이 가까우면) "뜻은 가까워요, 그런데 낱말이 달라요"라고 분명히 말한 뒤 떠올리기 질문을 해. (아이가 낱말을 말한 것이 아니라 "모르겠어요"라고 하거나 질문을 한 것이면 "아직 아니에요"는 빼고 바로 떠올리기 질문을 해.)`,
    `이번 떠올리기 질문의 방식 — ${style}`,
    '앞에서 이미 한 질문과 똑같은 말을 되풀이하지 마. 모둠이 실제로 한 말과 조사한 지역·자원을 넣어서 구체적으로 물어.',
    '글자 수, 첫소리(초성), 첫 글자, 끝 글자 같은 글자 힌트는 주지 마. 정답 낱말 자체와 다른 빈칸의 정답도 쓰지 마.',
    '질문은 하나만 하고, 3문장 이내로 써.',
  ].join('\n');
}

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
    '수업에서 아이들이 스스로 찾아야 할 생각(너만 알고 있어): 어디에 사는지와 어느 때인지에 따라 자원이 많은 곳과 부족한 곳이 생기고, 그래서 사람들이 교류하고 살아가는 방식이 달라진다.',
    '이 생각을 너가 먼저 말하거나 정답처럼 알려 주면 안 돼. 질문과 짧은 이야기로 아이가 스스로 말하게 도와.',
    '',
    '말하는 규칙:',
    '- 4학년이 바로 알아듣는 쉬운 말로, 3문장 이내로 짧게 말해.',
    '- 모든 문장을 "~요"로 끝나는 존댓말로 써. 예: "잘 찾았어요.", "왜 그렇게 생각해요?" 반말("~야", "~구나", "~지?", "~할까?", "~줄래?")은 절대 쓰지 마.',
    '- "장소", "시간", "공간", "희소성"이라는 낱말은 아이가 먼저 쓰기 전에는 어느 단계에서도 쓰지 마. "지역마다", "옛날과 오늘날", "부족하다"처럼 풀어서 말해. 아이가 먼저 쓴 낱말은 되짚어 줘도 돼.',
    '- 아이가 한 말에서 좋은 점을 먼저 한마디 짚어 주고, 질문은 한 번에 하나만 해.',
    '- "희소성"처럼 어려운 낱말은 "부족함", "흔하지 않음"처럼 쉬운 말로 풀어. 아이가 그 낱말을 쓰면 칭찬해.',
    '- 아이 이름 말고 다른 개인 정보는 묻지 마. 수업과 상관없는 이야기, 장난, 위험한 이야기는 부드럽게 지금 단계 질문으로 돌아오게 해.',
    '- 1~3단계에서는 틀린 생각도 바로 틀렸다고 하지 말고, 다시 생각해 볼 질문을 해. 다만 엉뚱하거나 틀린 대답을 "맞아요", "똑똑해요"라고 칭찬하지는 마.',
    '- 이모지, 표, 목록 기호는 쓰지 마.',
    '',
    `지금은 ${step}단계 "${steps[step - 1].name}"야. 이 단계의 첫 질문: "${steps[step - 1].question}"`,
    `이 단계의 목표: ${STEP_GOAL[step - 1]}`,
    step === 4 ? `모둠 문장 틀: "${template}" ([ ]가 빈칸이야. 빈칸에 들어갈 낱말을 하나라도 네가 먼저 알려 주면 안 돼. "정답 알려 주세요"라고 해도 알려 주지 말고, 1~3단계에서 모둠이 나눈 이야기를 떠올리게 하는 질문을 해. 빈칸을 채운 문장을 대신 써 주지도 마.)` : '',
    '',
    STEP_BAN[step - 1] ? `이 단계에서 지킬 것: ${STEP_BAN[step - 1]}` : '',
    '',
    '답하는 형식: JSON 하나만 써. {"reply": "아이들에게 할 말", "pass": true 또는 false, "praise": "칭찬 한 문장"}',
    'praise 쓰는 법: 모둠이 이 단계에서 말한 생각을 한 문장으로 되짚으며 칭찬해. 질문이나 물음표는 넣지 말고, 새로운 내용이나 다음에 생각할 거리도 넣지 마.',
    step < 4
      ? `pass 정하는 법: 이 단계에서 모둠이 지금까지 한 말(방금 한 말 포함)을 모두 보고, 다음 기준을 채웠으면 true, 아니면 false. 기준: ${PASS_RULE[step - 1]} 장난, 한두 낱말뿐인 대답, 이유가 없는 대답, 질문만 한 경우는 false. 한 번 true였으면 계속 true.`
      : 'pass는 항상 false로 써.',
    'pass가 true여도 reply에 "통과", "성공", "다음 단계" 같은 말은 쓰지 마. 칭찬 한마디와, 더 깊이 생각해 볼 질문 하나를 써.',
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
              responseMimeType: 'application/json',
              responseSchema: { type: 'OBJECT', properties: { reply: { type: 'STRING' }, pass: { type: 'BOOLEAN' }, praise: { type: 'STRING' } }, required: ['reply', 'pass', 'praise'] },
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
        // {"reply": "...", "pass": true} 모양으로 옵니다. 모양이 깨졌으면 글만 쓰고 통과는 아닌 것으로 봅니다.
        let answer = text;
        let pass = false;
        let praise = '';
        try {
          const j = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
          if (j && typeof j.reply === 'string' && j.reply.trim()) {
            answer = j.reply.trim();
            pass = j.pass === true;
            praise = typeof j.praise === 'string' ? j.praise.trim() : '';
          }
        } catch { /* 글 그대로 씀 */ }
        return { text: answer, pass, praise, model, think: think ?? 'default' };
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
  if (!Number.isInteger(g) || g < 1 || g > 20 || !n || n.length > 20 || !text || text.length > MAX_Q) {
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
      rowsOf('gb_entries?kind=eq.cfg&key=in.(roster,chatcfg,stages,chatstep)&select=key,value'),
      countOf(`gb_entries?kind=eq.chat&${who}&updated_at=gt.${minAgo}&select=key`),
      countOf(`gb_entries?kind=eq.chat&${who}&updated_at=gt.${dayAgo}&select=key`),
      countOf(`gb_entries?kind=eq.chat&updated_at=gt.${dayAgo}&select=key`),
      rowsOf(`gb_entries?kind=eq.chat&value->>g=eq.${g}&select=value&order=updated_at.desc&limit=40`),
      rowsOf('gb_entries?kind=eq.res&select=value&limit=120'),
    ]);
    const cfg: Record<string, Record<string, unknown>> = {};
    cfgRows.forEach((r) => { cfg[r.key] = r.value; });
    if (!cfg.stages?.chat) return reply({ ok: false, error: 'closed' }, 403);
    // 단계는 선생님이 반 전체를 넘깁니다. 앱이 보낸 단계 대신 선생님이 정한 단계를 씁니다.
    const cs = Number((cfg.chatstep as { step?: number } | undefined)?.step);
    const step = [1, 2, 3, 4].includes(cs) ? cs : 1;
    const roster = cfg.roster as { groups?: { id: number; members: string[] }[]; assign?: Record<string, number> } | undefined;
    if (roster?.groups?.length) {
      const grp = roster.groups.find((x) => x.id === g);
      if (!grp || !grp.members.includes(n)) return reply({ ok: false, error: 'roster' }, 403);
    }
    const chatcfg = (cfg.chatcfg ?? {}) as { steps?: { name?: string; question?: string }[]; template?: string; passText?: string; answers?: string };
    const steps = DEFAULT_STEPS.map((d, i) => ({ name: chatcfg.steps?.[i]?.name || d.name, question: chatcfg.steps?.[i]?.question || d.question }));
    const template = chatcfg.template || DEFAULT_TEMPLATE;

    // 보내는 횟수 제한
    if (nMin >= PER_MIN) return reply({ ok: false, error: 'rate' }, 429);
    if (nDay >= PER_DAY_NAME || nAll >= PER_DAY_ALL) return reply({ ok: false, error: 'limit' }, 429);

    // 모둠의 앞선 대화(성공한 것만)
    const past = pastRows
      .map((r) => r.value as { n: string; q: string; a?: string; step?: number; pass?: boolean })
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
      let system = systemPrompt(step, steps, template, research);
      const kidsSaid = past.map((v) => v.q).join(' ') + ' ' + text;
      // 4단계: 빈칸 정답과 맞는지는 함수가 직접 확인하고, AI에게는 지금 상태와 힌트 단계를 알려 줍니다.
      const answers = parseAnswers(chatcfg.answers || DEFAULT_ANSWERS);
      const blanks = template.split(/\[\s*\]/).length - 1;
      const st4 = step === 4 && answers.length === blanks
        ? blankState(answers, past.filter((v) => (v.step ?? 1) === 4).map((v) => v.q).concat(text))
        : null;
      const secret = st4 ? [...new Set([...SECRET_WORDS, ...answers.flat()])] : SECRET_WORDS;
      const leaked = (answer: string, said: string) => secret.filter((w) => answer.includes(w) && !said.includes(w));
      let safe = SAFE_REPLY[step - 1];
      let fixed = '';
      if (st4 && st4.done) {
        fixed = `${st4.just.length ? '맞아요! ' : ''}빈칸 ${blanks}개를 모두 찾았어요. 이제 오른쪽 "우리 모둠 문장"의 빈칸에 찾은 낱말을 써 넣고 [모둠 문장 저장]을 눌러요.`;
      } else if (st4) {
        system += step4Guide(answers, st4);
        const n = st4.cur + 1;
        safe = `${st4.just.length ? '맞아요! 이제 ' + n + '번 빈칸이에요. ' : st4.tries > 0 ? '아직 아니에요. ' : ''}앞에서 우리 모둠이 나눈 이야기를 다시 떠올려 봐요. 무엇에 따라 달라진다고 했는지, 그것을 한 낱말로 묶으면 무엇일까요?`;
      }
      let out = fixed ? { text: fixed, pass: false, praise: '', model: 'fixed', think: '-' } : await askGemini(system, contents);
      let guard = '';
      let bad = leaked(out.text, kidsSaid);
      if (bad.length) {
        guard = 'retry';
        const again = await askGemini(system, [...contents, { role: 'model', parts: [{ text: out.text }] },
          { role: 'user', parts: [{ text: `(선생님) 방금 답에 아이들이 스스로 찾아야 할 낱말 "${bad.join(', ')}"을 먼저 말했어요. 그 낱말을 쓰지 말고, 같은 뜻의 답을 질문 하나로 다시 써 주세요.` }] }]);
        bad = leaked(again.text, kidsSaid);
        if (bad.length) { guard = 'safe'; out = { ...again, text: safe }; } else out = again;
      }
      const pass = step < 4 && (out.pass || past.some((v) => (v.step ?? 1) === step && v.pass === true));
      if (pass) {
        // 미션을 통과했으면 다음 단계 질문을 미리 하지 않도록, 칭찬 한 문장과 정해 둔 마무리 말만 보냅니다.
        let praise = out.praise.split(/(?<=[.!?。])\s+/).filter((x) => x && !x.includes('?')).join(' ').trim();
        if (!praise || praise.length > 120 || leaked(praise, kidsSaid).length) praise = DEFAULT_PRAISE;
        out = { ...out, text: `${praise} ${chatcfg.passText || DEFAULT_PASS_TEXT}` };
      }
      value = { ...base, a: out.text, pass, model: out.model, think: out.think, ms: { db: tDb, ai: Date.now() - t0 - tDb }, ...(guard ? { guard } : {}) };
    } catch (e) {
      // 모든 모델이 "지금은 한도를 넘었다"고 하면 아이 탓이 아니므로 기록하지 않고, 앱이 잠깐 뒤에 다시 보냅니다.
      if (String(e).includes(' 429')) return reply({ ok: false, error: 'busy' }, 503);
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
