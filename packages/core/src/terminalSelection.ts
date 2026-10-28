// 터미널 선택 글 복사 다듬기(#1212) — 에이전트 TUI는 본문을 왼쪽 여백 뒤에 그려서, 복사하면 모든 줄 앞에 같은 공백이 붙어 옴.
// 비어 있지 않은 모든 줄에 공통인 앞 공백만 지움 → 코드·목록의 상대 들여쓰기는 그대로. 한 줄이라도 0칸이면 손대지 않음.
// 줄 끝 \r(Windows 줄바꿈)은 그 줄에 붙여 둠 — 빈 CRLF 줄이 "0칸 들여쓰기"로 잡혀 여백 계산을 망치지 않게.
// 0칸 줄이 하나라도 있으면(첫 줄 포함) 그대로 — 줄 중간부터 고른 선택과 "def f():\n    return 1" 같은 정상 코드를 구분할 수 없어서 안전한 쪽(재리뷰).
// 내용 있는 줄이 2줄 미만이면 그대로(한 줄 선택은 손대지 않음).
export function trimSelectionGutter(text: string): string {
  const lines = text.split("\n").map((raw) => {
    const cr = raw.endsWith("\r");
    const body = cr ? raw.slice(0, -1) : raw;
    return { body, cr, indent: body.length - body.replace(/^ +/, "").length };
  });
  if (lines.filter((l) => l.indent < l.body.length).length < 2) return text;
  let gutter = Infinity;
  for (const l of lines) {
    if (l.indent === l.body.length) continue; // 빈 줄·공백만 있는 줄은 판단에서 뺌
    gutter = Math.min(gutter, l.indent);
    if (gutter === 0) return text;
  }
  if (!Number.isFinite(gutter)) return text;
  return lines.map((l) => l.body.slice(Math.min(l.indent, gutter)) + (l.cr ? "\r" : "")).join("\n");
}
