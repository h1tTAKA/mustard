// 아키텍처 결과 저장소 클라 호출(#1320) — /api/repo/arch. 서버에 없고 예전 localStorage에 있으면 1회 옮겨 줌(사용자 데이터 보존, 지우진 않음).
import type { SnapDiff } from "./incremental";

type Kind = "cats" | "flow";
const post = (body: object) => fetch("/api/repo/arch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// 예전 저장 키(#743) — 옮기기용.
const legacyKey = (root: string, kind: Kind, feature?: string) =>
  kind === "cats" ? `nunopi:ws:${root}:analyze-cats` : `nunopi:ws:${root}:flow:${encodeURIComponent(feature ?? "")}`;

// token = 분석 시작 시점 스냅샷 표(archBegin 또는 diff 조회가 준 것). 없으면 저장 시점 스냅샷.
// keepExtras = 저장돼 있던 깊이별 설명·둘러보기를 서버에서 이어 붙임(#1322, 구조 변화 없는 갱신).
// 성공하면 저장한 흐름 판(at, 0 아님), 실패면 null — patch가 "같은 흐름에 붙이는지" 확인할 때 씀(#1322).
export async function archPut(root: string, kind: Kind, data: unknown, feature?: string, opts: { legacy?: boolean; token?: string; keepExtras?: boolean } = {}): Promise<number | null> {
  try {
    const r = await post({ op: "put", path: root, kind, feature, data, legacy: opts.legacy, token: opts.token, keepExtras: opts.keepExtras });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    return typeof d?.at === "number" ? d.at : null;
  } catch { return null; }
}

// 흐름 덧붙임(깊이별 설명·둘러보기)만 저장 — 스냅샷·노드는 그대로(#1322).
// at = 설명·단계를 만들 때 본 흐름 판. 그사이 흐름이 바뀌었으면 "stale"(조용히 버림).
export async function archPatch(root: string, feature: string, data: object, at: number | null): Promise<"ok" | "stale" | "fail"> {
  try {
    const r = await post({ op: "patch", path: root, kind: "flow", feature, data, ...(at ? { at } : {}) });
    return r.ok ? "ok" : r.status === 409 ? "stale" : "fail";
  } catch { return "fail"; }
}

// 분석 시작 — 지금 스냅샷을 서버가 잡아 두고 표를 줌(실패하면 undefined → 저장 시점 스냅샷).
export async function archBegin(root: string): Promise<string | undefined> {
  try { const d = await (await post({ op: "begin", path: root })).json(); return typeof d?.token === "string" ? d.token : undefined; } catch { return undefined; }
}

// diff=true면 저장 뒤 바뀐 파일도 계산(그래프 맞추느라 느릴 수 있어 갱신·낡음 표시에만). "token"이면 분석 시작 표도(갱신 전용).
type Got<T> = { data: T | null; diff: SnapDiff | null; token?: string; error?: boolean };
export async function archGet<T>(root: string, kind: Kind, feature?: string, diff: boolean | "token" = false): Promise<Got<T>> {
  let r: Response, d: { data?: unknown; diff?: unknown; token?: unknown } | null;
  try { r = await post({ op: "get", path: root, kind, feature, diff: !!diff, wantToken: diff === "token" }); d = await r.json().catch(() => null); }
  catch { return { data: null, diff: null, error: true }; }
  // 서버 오류 = error(호출부가 새로 분석해 덮어쓰지 않게) — 옮기기는 "서버에 확실히 없음"일 때만(리뷰)
  if (!r.ok || !d) return { data: null, diff: null, error: true };
  if (d.data) return { data: d.data as T, diff: (d.diff as SnapDiff | null) ?? null, token: typeof d.token === "string" ? d.token : undefined };
  // 서버에 없음 → 예전 localStorage(구 흐름 캐시는 배열 그대로였음)를 정규화해 옮김. 분석 시점을 모르니 스냅샷 없이(legacy).
  let old: unknown = null;
  try { const raw = localStorage.getItem(legacyKey(root, kind, feature)); if (raw) old = JSON.parse(raw); } catch { /* 손상 */ }
  if (kind === "flow" && Array.isArray(old)) old = { sections: old, overview: null };
  const ok = kind === "cats" ? Array.isArray(old) && old.length > 0 : Array.isArray((old as { sections?: unknown } | null)?.sections);
  if (!ok) return { data: null, diff: null };
  await archPut(root, kind, old, feature, { legacy: true });
  return { data: old as T, diff: null };
}

// 차분 갱신 프롬프트용 파일 심볼 뼈대. 실패면 빈 문자열(파일 이름만으로 진행).
export async function archSkeleton(root: string, files: string[]): Promise<string> {
  try { const d = await (await post({ op: "skeleton", path: root, data: files })).json(); return typeof d?.text === "string" ? d.text : ""; }
  catch { return ""; }
}
