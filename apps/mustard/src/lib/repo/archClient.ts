// 아키텍처 결과 저장소 클라 호출(#1320) — /api/repo/arch. 서버에 없고 예전 localStorage에 있으면 1회 옮겨 줌(사용자 데이터 보존, 지우진 않음).
import type { SnapDiff } from "./incremental";

type Kind = "cats" | "flow";
const post = (body: object) => fetch("/api/repo/arch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// 예전 저장 키(#743) — 옮기기용.
const legacyKey = (root: string, kind: Kind, feature?: string) =>
  kind === "cats" ? `nunopi:ws:${root}:analyze-cats` : `nunopi:ws:${root}:flow:${encodeURIComponent(feature ?? "")}`;

export async function archPut(root: string, kind: Kind, data: unknown, feature?: string): Promise<void> {
  try { await post({ op: "put", path: root, kind, feature, data }); } catch { /* 저장 실패 — 다음 저장 때 다시 */ }
}

export async function archGet<T>(root: string, kind: Kind, feature?: string): Promise<{ data: T | null; diff: SnapDiff | null }> {
  try {
    const r = await post({ op: "get", path: root, kind, feature });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.data) return { data: d.data as T, diff: (d.diff as SnapDiff | null) ?? null };
  } catch { /* 서버 실패 → 옛 저장분이라도 */ }
  // 서버에 없음 → 예전 localStorage(구 흐름 캐시는 배열 그대로였음)를 정규화해 옮김.
  let old: unknown = null;
  try { const raw = localStorage.getItem(legacyKey(root, kind, feature)); if (raw) old = JSON.parse(raw); } catch { /* 손상 */ }
  if (kind === "flow" && Array.isArray(old)) old = { sections: old, overview: null };
  const ok = kind === "cats" ? Array.isArray(old) && old.length > 0 : Array.isArray((old as { sections?: unknown } | null)?.sections);
  if (!ok) return { data: null, diff: null };
  await archPut(root, kind, old, feature);
  return { data: old as T, diff: null };
}
