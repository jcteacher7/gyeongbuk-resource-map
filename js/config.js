// Supabase 연결 정보입니다. 주소와 sb_publishable 키는 브라우저에 공개되는 키라 여기에 있어도 됩니다.
// (기존 앱 mungyeong-AI-project-tool 과 같은 Supabase 프로젝트를 씁니다.)
// 제미나이 키 같은 비밀 키는 절대 여기에 넣지 않습니다.
export const SUPABASE_URL = 'https://wigxlmwysuqxiuonucqq.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_kaxYJaj4pRlXP7fsCzsS5Q_Azzaf5Fb';

export const TABLE = 'gb_entries';
export const PHOTO_BUCKET = 'gb-photos';

// 다른 친구의 글을 새로 읽어 오는 간격(밀리초)
export const POLL_MS = 4000;
// 한 줄 입력칸의 글자 수
export const MAX_LEN = 40;
