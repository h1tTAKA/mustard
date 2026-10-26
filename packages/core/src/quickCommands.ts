// 빠른 명령(#1194) — ⌘K 팔레트에서 실행하는 저장 명령. 셸 = 지금 터미널에 글(+Enter), 에이전트 = 이 레포 에이전트 터미널에 글.
// 설정 저장소 한 키(QKEYS.commands)에 배열로. 저장소 값은 사람이 손댈 수 있으니 읽을 때 정리(normalizeQuickCommands).
export type QuickCommand = {
  id: string;
  name: string;
  kind: "shell" | "agent";
  text: string;
  enter: boolean;     // 셸만 — 글 뒤에 Enter까지(끄면 입력만 해 두고 유저가 확인 후 Enter)
  repo?: string;      // 레포 메인 폴더 경로 — 없으면 모든 레포
};
export const QKEYS = { commands: "quick.commands" } as const;
export const QUICK_NAME_MAX = 80;
export const QUICK_TEXT_MAX = 4000;

// 잘못된 항목은 버리고, 길이는 자르고, 이름·글이 빈 것은 버림(미완성). id 중복은 첫 것만.
export function normalizeQuickCommands(raw: unknown): QuickCommand[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: QuickCommand[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.slice(0, 80) : "";
    const name = typeof o.name === "string" ? o.name.trim().slice(0, QUICK_NAME_MAX) : "";
    const text = typeof o.text === "string" ? o.text.slice(0, QUICK_TEXT_MAX) : "";
    if (!id || seen.has(id) || !name || !text.trim()) continue;
    seen.add(id);
    const kind = o.kind === "agent" ? "agent" : "shell";
    const repo = typeof o.repo === "string" && o.repo.trim() ? o.repo.trim() : undefined;
    out.push({ id, name, kind, text, enter: kind === "shell" ? o.enter !== false : false, ...(repo ? { repo } : {}) });
  }
  return out;
}

// 이 레포에서 보일 명령 — 이 레포 것 먼저, 그다음 모든 레포 것(각각 저장 순서)
export function quickCommandsFor(list: readonly QuickCommand[], repo: string | null): QuickCommand[] {
  const mine = repo ? list.filter((c) => c.repo === repo) : [];
  return [...mine, ...list.filter((c) => !c.repo)];
}

// 터미널에 보낼 글 — 여러 줄은 "한 번에 붙여넣기"(bracketed paste)로 감싸 입력칸에만 넣고(줄마다 바로 실행되지 않게, 리뷰),
// Enter는 설정이 켜졌을 때만 마지막에 한 번. 붙여넣기를 일찍 끝낼 수 있는 ESC·제어문자는 뺌.
export function quickShellInput(c: QuickCommand): string {
  const body = c.text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
  const typed = body.includes("\n") ? `\x1b[200~${body}\x1b[201~` : body;
  return c.enter ? `${typed}\r` : typed;
}

