// 흐름 차분 갱신 병합(#1320) — 순수 함수(점검 쉬움). RepoFlowPane이 씀.
// 원칙: 지운 파일 노드는 빼고, LLM이 새로 준 노드가 있는 파일은 그 파일 노드를 통째 교체, LLM이 아무것도 안 준 파일은 그대로 둠
// (관련 없는 변경 때문에 노드가 사라지지 않게). 다른 파일의 새 노드는 이름이 새로울 때만 추가.
import type { ArchSection as FlowSection } from "./archStore";

const nk = (s: string) => s.trim().toLowerCase();

// 갱신(옛 방식, 차분 정보 없을 때): 기존 흐름 유지 + 새 이름 노드만 해당 레이어(없으면 새 레이어)에 추가.
export function mergeFlow(existing: FlowSection[], incoming: FlowSection[]): FlowSection[] {
  const out = existing.map((s) => ({ layer: s.layer, nodes: s.nodes.map((n) => ({ ...n })) }));
  const layerIdx = new Map(out.map((s, i) => [nk(s.layer), i]));
  const seen = new Set(out.flatMap((s) => s.nodes.map((n) => nk(n.name))));
  for (const s of incoming) for (const n of s.nodes) {
    if (seen.has(nk(n.name))) continue;
    seen.add(nk(n.name));
    const li = layerIdx.get(nk(s.layer));
    if (li != null) out[li].nodes.push({ ...n });
    else { layerIdx.set(nk(s.layer), out.length); out.push({ layer: s.layer, nodes: [{ ...n }] }); }
  }
  return out;
}

// 차분 갱신: removed(지운 파일) 노드 삭제 → incoming이 다룬 파일 중 changed(구조 바뀐 파일)에 속한 것은 기존 노드 교체 → 나머지 병합.
// 마지막에 없는 노드를 가리키는 next와 빈 레이어 정리.
export function applyFlowDiff(existing: FlowSection[], incoming: FlowSection[], removed: string[], changed: string[]): FlowSection[] {
  const gone = new Set(removed);
  const changedSet = new Set(changed);
  const replaced = new Set<string>();
  for (const s of incoming) for (const n of s.nodes) if (n.file && changedSet.has(n.file)) replaced.add(n.file);
  const kept = existing.map((s) => ({ layer: s.layer, nodes: s.nodes.filter((n) => !n.file || (!gone.has(n.file) && !replaced.has(n.file))) }));
  const merged = mergeFlow(kept, incoming.map((s) => ({ layer: s.layer, nodes: s.nodes.filter((n) => !n.file || !gone.has(n.file)) })));
  const names = new Set(merged.flatMap((s) => s.nodes.map((n) => nk(n.name))));
  return merged
    .map((s) => ({ layer: s.layer, nodes: s.nodes.map((n) => (n.next ? { ...n, next: n.next.filter((x) => names.has(nk(x))) } : n)) }))
    .filter((s) => s.nodes.length);
}
