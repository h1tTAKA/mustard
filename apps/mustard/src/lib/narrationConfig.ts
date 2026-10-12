// 실시간 해설 켜짐 여부(#1062) — 설정(렌더러 localStorage)을 서버가 직접 못 읽어서 캐치업이 POST로 알려줌.
// 메모리 값(앱 재시작 시 기본 켜짐 → 캐치업이 뜨면서 다시 알림). globalThis = dev 라우트 리로드에도 유지.
const g = globalThis as unknown as { __mustardNarrationOn?: boolean };
export const isNarrationOn = () => g.__mustardNarrationOn !== false;
export const setNarrationOn = (on: boolean) => { g.__mustardNarrationOn = on; };
