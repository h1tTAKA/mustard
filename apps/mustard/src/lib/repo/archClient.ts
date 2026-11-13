// 아키텍처 결과 저장소 클라 호출(#1320) — /api/repo/arch. 서버에 없고 예전 localStorage에 있으면 1회 옮겨 줌(사용자 데이터 보존, 지우진 않음).
import type { SnapDiff } from "./incremental";

type Kind = "cats" | "flow";
const post = (body: object) => fetch("/api/repo/arch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// 예전 저장 키(#743) — 옮기기용.
const legacyKey = (root: string, kind: Kind, feature?: string) =>
  kind === "cats" ? `nunopi:ws:${root}:analyze-cats` : `nunopi:ws:${root}:flow:${encodeURIComponent(feature ?? "")}`;

export async function archPut(root: string, kind: Kind, data: unknown, feature?: string, legacy = false): Promise<boolean> {
  try { return (await post({ op: "put", path: root, kind, feature, data, legacy })).ok; } catch { return false; }
}

// diff=true면 저장 뒤 바뀐 파일도 계산(그래프 맞추느라 느릴 수 있어 갱신·낡음 표시에만).
export async function archGet<T>(root: string, kind: Kind, feature?: string, diff = false): Promise<{ data: T | null; diff: SnapDiff | null }> {
  let r: Response, d: { data?: unknown; diff?: unknown } | null;
  try { r = await post({ op: "get", path: root, kind, feature, diff }); d = await r.json().catch(() => null); }
  catch { return { data: null, diff: null }; }
  if (!r.ok || !d) return { data: null, diff: null }; // 서버 오류 때 옛 사본으로 덮어쓰지 않게 — 옮기기는 "서버에 확실히 없음"일 때만(리뷰)
  if (d.data) return { data: d.data as T, diff: (d.diff as SnapDiff | null) ?? null };
  // 서버에 없음 → 예전 localStorage(구 흐름 캐시는 배열 그대로였음)를 정규화해 옮김. 분석 시점을 모르니 스냅샷 없이(legacy).
  let old: unknown = null;
  try { const raw = localStorage.getItem(legacyKey(root, kind, feature)); if (raw) old = JSON.parse(raw); } catch { /* 손상 */ }
  if (kind === "flow" && Array.isArray(old)) old = { sections: old, overview: null };
  const ok = kind === "cats" ? Array.isArray(old) && old.length > 0 : Array.isArray((old as { sections?: unknown } | null)?.sections);
  if (!ok) return { data: null, diff: null };
  await archPut(root, kind, old, feature, true);
  return { data: old as T, diff: null };
}

// 차분 갱신 프롬프트용 파일 심볼 뼈대. 실패면 빈 문자열(파일 이름만으로 진행).
export async function archSkeleton(root: string, files: string[]): Promise<string> {
  try { const d = await (await post({ op: "skeleton", path: root, data: files })).json(); return typeof d?.text === "string" ? d.text : ""; }
  catch { return ""; }
}
