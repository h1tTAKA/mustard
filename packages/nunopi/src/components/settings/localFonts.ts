// #1224 터미널 글꼴 자동완성 — 설치된 글꼴을 Chromium queryLocalFonts()로 받아 고정폭만 추림(따로 IPC·의존성 없음).
// 고정폭 판정 = 캔버스에서 좁은 글자(i)와 넓은 글자(W) 폭이 같은지. 못 읽으면(권한·브라우저) 빈 목록 → 그냥 입력칸.
let cache: Promise<string[]> | null = null;

type FontData = { family: string };
export function listMonospaceFonts(): Promise<string[]> {
  return (cache ??= (async () => {
    const q = (window as unknown as { queryLocalFonts?: () => Promise<FontData[]> }).queryLocalFonts;
    if (!q) return [];
    const families = [...new Set((await q()).map((f) => f.family))];
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return families.sort();
    const mono = families.filter((f) => {
      ctx.font = `16px "${f.replace(/"/g, "")}"`;
      return Math.abs(ctx.measureText("i").width - ctx.measureText("W").width) < 0.01;
    });
    return mono.sort((a, b) => a.localeCompare(b));
  })().catch(() => { cache = null; return []; })); // 실패는 기억 안 함 — 다음 포커스에 다시
}
