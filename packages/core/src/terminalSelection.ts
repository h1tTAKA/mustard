// 터미널 선택 글 복사 다듬기(#1212) — 에이전트 TUI는 본문을 왼쪽 여백 뒤에 그려서, 복사하면 모든 줄 앞에 같은 공백이 붙어 옴.
// 비어 있지 않은 모든 줄에 공통인 앞 공백만 지움 → 코드·목록의 상대 들여쓰기는 그대로. 한 줄이라도 0칸이면 손대지 않음.
// 줄 끝 \r(Windows 줄바꿈)은 그 줄에 붙여 둠 — 빈 CRLF 줄이 "0칸 들여쓰기"로 잡혀 여백 계산을 망치지 않게.
// 내용 있는 줄이 2줄 미만이면 그대로(한 줄 선택은 손대지 않음).
// firstPrefix = 첫 줄에서 선택 시작 앞에 있던 화면 글자(모르면 undefined). 글만으로는 "줄 중간부터 고른 선택"과
// "def f():\n    return 1" 같은 코드를 구분 못 해서(리뷰) 화면에서 받아 씀:
//   공백뿐 = 들여쓰기 안에서 시작 → 그만큼 들여쓰기에 더해 판단, 다른 글자 = 줄 중간부터 → 첫 줄은 판단·자르기에서 뺌.
export function trimSelectionGutter(text: string, firstPrefix?: string): string {
  const lines = text.split("\n").map((raw) => {
    const cr = raw.endsWith("\r");
    const body = cr ? raw.slice(0, -1) : raw;
    return { body, cr, indent: body.length - body.replace(/^ +/, "").length };
  });
  if (lines.filter((l) => l.indent < l.body.length).length < 2) return text;
  const lead = firstPrefix === undefined ? 0 : /^ *$/.test(firstPrefix) ? firstPrefix.length : -1; // -1 = 첫 줄 제외
  let gutter = Infinity;
  for (const [i, l] of lines.entries()) {
    if (l.indent === l.body.length) continue; // 빈 줄·공백만 있는 줄은 판단에서 뺌
    if (i === 0 && lead < 0) continue;
    gutter = Math.min(gutter, l.indent + (i === 0 ? lead : 0));
    if (gutter === 0) return text;
  }
  if (!Number.isFinite(gutter)) return text;
  return lines.map((l, i) => {
    const cut = i === 0 ? (lead < 0 ? 0 : Math.max(0, Math.min(l.indent + lead, gutter) - lead)) : Math.min(l.indent, gutter);
    return l.body.slice(cut) + (l.cr ? "\r" : "");
  }).join("\n");
}
