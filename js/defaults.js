// 선생님 화면에서 고칠 수 있는 설정의 처음 값입니다.
// 저장된 설정(cfg)이 있으면 그 값을 먼저 쓰고, 빠진 칸만 여기 값으로 채웁니다.
// 바뀌면 안 되는 구조(화면 4개 순서, T·A·G 세 칸, 챗봇 4단계, 입력 순서)는 코드에 고정합니다.

export const DEMO_ROSTER = {
  demo: true,
  groups: [
    { id: 1, name: '1모둠', members: ['가나다', '라마바', '사아자', '차카타'] },
    { id: 2, name: '2모둠', members: ['파하가', '나다라', '마바사', '아자차'] },
    { id: 3, name: '3모둠', members: ['카타파', '하가나', '다라마', '바사아', '자차카'] },
    { id: 4, name: '4모둠', members: ['타파하', '가라사', '나마아', '다바자', '라사차'] },
  ],
  assign: {},
};

// 모둠 색(교류 제안서에서 모둠이 고른 제안 지역을 칠함). 땅(노랑)·고른 시군(산호색)과 겹치지 않는 색
export const GROUP_COLORS = ['#F7A8C4', '#9FD0F7', '#A9DE8B', '#CDB5F7', '#F9B97A', '#8FDCD0', '#E7A0E8', '#C7CF7A'];

// 옛날과 비교(시간): 자원 카드의 세 번째 질문
export const ERA = { old: '옛날부터 많았어요', more: '요즘 많아졌어요', less: '옛날보다 줄었어요' };

// 예시 지역: 문경시. 아이들이 조사하는 지역에서 빼고, 어떻게 쓰는지 보여 주는 예시 카드를 미리 넣어 둡니다.
// (서버에 저장하지 않고 앱에 들어 있는 카드라서 고치거나 지울 수 없습니다. 내용은 선생님이 확인해 주세요.)
export const EXAMPLE_CID = 37090;
export const EXAMPLE_RES = [
  { key: 'ex-omija', cid: EXAMPLE_CID, env: 'nat', why: '산이 많고 낮과 밤의 기온 차가 커서', name: '오미자', amt: 'many',
    era: 'more', eraWhy: '오미자 음료와 축제가 인기를 얻어 기르는 농가가 늘었어요',
    link: 'https://ko.wikipedia.org/wiki/오미자', img: 'omija' },
  { key: 'ex-coal', cid: EXAMPLE_CID, env: 'nat', why: '땅속에 석탄이 많이 묻혀 있어서', name: '석탄', amt: 'few',
    era: 'less', eraWhy: '탄광이 문을 닫아 지금은 캐지 않고 박물관이 되었어요',
    link: 'https://ko.wikipedia.org/wiki/문경석탄박물관', img: 'coal' },
  { key: 'ex-bowl', cid: EXAMPLE_CID, env: 'hum', why: '도자기를 굽는 장인들이 모여 살아서', name: '찻사발', amt: 'many',
    era: 'old', eraWhy: '옛날부터 도자기를 구웠고 지금도 축제로 이어져요',
    link: 'https://www.sabal21.com/', img: 'bowl' },
// 사진은 assets/examples 에 있습니다(위키미디어 공용, 모두 CC0 — 출처: assets/examples/README.md).
].map(({ img, ...r }, i) => ({ ...r, photo: { full: `assets/examples/${img}.jpg`, thumb: `assets/examples/${img}-s.jpg` }, by: { g: 0, n: '예시' }, at: i, example: true }));
// 입력칸 아래에 보여 주는 예시(문경 예시 카드에서 가져옴)
export const EXAMPLE_HINT = {
  why: '예: 산이 많고 낮과 밤의 기온 차가 커서 (문경 오미자)',
  name: '예: 오미자',
  era: {
    old: '예: 옛날부터 도자기를 구웠고 지금도 축제로 이어져요 (문경 찻사발)',
    more: '예: 오미자 음료와 축제가 인기를 얻어 기르는 농가가 늘었어요 (문경 오미자)',
    less: '예: 탄광이 문을 닫아 지금은 캐지 않고 박물관이 되었어요 (문경 석탄)',
  },
};

export const DEFAULT_TEXTS = { tabMap: '우리 지도', tabPlan: '교류 제안서', tabTag: 'TAG', tabChat: 'AI 챗봇' };

export const TAG_KEYS = ['T', 'A', 'G'];
export const DEFAULT_TAG = {
  T: { name: '좋은 점', hint: '발표에서 좋았던 점을 한 줄로 써요' },
  A: { name: '질문', hint: '궁금한 점을 한 줄로 써요' },
  G: { name: '개선점 제안', hint: '이렇게 하면 더 좋겠다는 점을 한 줄로 써요' },
  draftHint: '발표 전에 제안서를 보며 떠오른 질문을 적어 둬요 (나만 봐요)',
  max: 50,
};

export const DEFAULT_CHAT = {
  guide: 'AI는 정답을 알려 주지 않아요. 질문을 주고받으며 우리 모둠이 스스로 찾아내요.',
  steps: [
    { name: '대조 상황', question: '만약 산도 있고 바다도 있고 넓은 평야도 있어서, 필요한 모든 물건과 먹거리가 풍족하게 다 있는 가상의 지역이 있다면 어떨까요?' },
    { name: '반대 추론', question: '이 지역 사람들은 다른 지역과 생활 모습이 다르거나, 멀리까지 가서 다른 지역과 교류할 필요가 있었을까요?' },
    { name: '실제 사례 비교', question: '우리가 조사한 경상북도의 지역들은 왜 생활 모습이 다르고 서로 교류가 필요했을까요?' },
    { name: '모둠 문장 완성', question: '이제 우리 모둠의 문장을 완성해 봐요. 빈칸에 어떤 말이 들어가면 좋을까요?' },
  ],
  template: '[ ]와 [ ]에 따라 [ ]이 발생하기 때문에, 사람들의 살아가는 방식이 변화한다.',
  // 빈칸의 정답(4단계에서 AI가 이쪽으로 이끎). 쉼표로 빈칸을 나누고, 같은 뜻으로 인정할 말은 | 로 나눔
  answers: '공간|장소, 시간, 자원의 희소성|희소성',
  // 미션을 통과했을 때 AI가 칭찬 한 문장 뒤에 붙이는 말(다음 단계 질문을 미리 하지 않도록 함)
  passText: '미션 성공이에요! 선생님이 다음 단계를 열어 줄 때까지, 왜 그렇게 생각했는지 모둠끼리 한 번 더 이야기해 봐요.',
  max: 150,
};

// 저장된 설정과 처음 값을 합칩니다(빠진 칸만 채움).
export function withDefaults(saved, base) {
  if (!saved || typeof saved !== 'object') return JSON.parse(JSON.stringify(base));
  const out = JSON.parse(JSON.stringify(base));
  for (const k of Object.keys(saved)) {
    const v = saved[k];
    if (Array.isArray(base[k]) && Array.isArray(v)) {
      out[k] = base[k].map((b, i) => (v[i] && typeof b === 'object' ? { ...b, ...v[i] } : v[i] ?? b));
    } else if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = { ...base[k], ...v };
    } else if (v !== undefined && v !== null && v !== '') {
      out[k] = v;
    }
  }
  return out;
}

// 문장 틀을 조각으로 나눕니다: "[ ]와 [ ]에 따라 …" → ['', '와 ', '에 따라 …'] (빈칸 = 조각 수 − 1)
export function splitTemplate(t) {
  return String(t || '').split(/\[\s*\]/);
}
