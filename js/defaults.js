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

export const DEFAULT_TEXTS = { tabMap: '우리 지도', tabTag: 'TAG', tabChat: 'AI 챗봇' };

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
