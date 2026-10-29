// #1213 맥 지금 입력 소스 ID — Option을 Alt로 "자동" 판단용. 앱 창 focus·⌥ 누를 때 다시 읽음(1초에 한 번까지).
let id: string | null = null;
let pending = false;
let last = 0;
let again: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();

export const inputSourceId = () => id;

export function refreshInputSource() {
  const now = Date.now();
  if (typeof window === "undefined" || !window.nunopiDesktop?.keyboardInputSource) return;
  if (pending || now - last < 1000) { again ??= setTimeout(() => { again = null; refreshInputSource(); }, 1000); return; } // 막힌 요청은 한 번 뒤에 다시(리뷰)
  pending = true; last = now;
  window.nunopiDesktop.keyboardInputSource()
    .then((v) => { const next = v ?? null; if (next !== id) { id = next; subs.forEach((f) => f()); } })
    .catch(() => {})
    .finally(() => { pending = false; });
}

export function subscribeInputSource(f: () => void) {
  subs.add(f);
  return () => { subs.delete(f); };
}

if (typeof window !== "undefined") {
  refreshInputSource();
  window.addEventListener("focus", refreshInputSource);
}
