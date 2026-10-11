"use client";
// 중앙 3패널 커스텀 도킹 레이아웃(#716) — 라이브러리 없이 "분할 트리"로 배치.
// 기존 패널(터미널·코드·문서) 컴포넌트를 그대로 렌더만 재배치. 디자인 변경 0.
// 커밋1: 트리 렌더 + split 리사이즈(기본 배치=현재와 동일). 드래그 도킹은 커밋2.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconGripVertical } from "@tabler/icons-react";

export type PanelId = "terminal" | "code" | "doc" | "flow" | "browser";
export type DockNode =
  | { t: "leaf"; panel: PanelId }
  | { t: "split"; dir: "row" | "col"; a: DockNode; b: DockNode; ratio: number }; // row=좌우, col=상하. ratio=a 자식 비율(0~1)

// 현재 존재하는 패널만으로 기본 트리 — 지금 화면과 동일하게(터미널 좌 | 코드 우, 문서는 코드 아래).
export function defaultTree(has: Record<PanelId, boolean>): DockNode {
  const term: DockNode = { t: "leaf", panel: "terminal" };
  let right: DockNode | null = null;
  if (has.code && has.doc) right = { t: "split", dir: "col", a: { t: "leaf", panel: "code" }, b: { t: "leaf", panel: "doc" }, ratio: 0.62 };
  else if (has.code) right = { t: "leaf", panel: "code" };
  else if (has.doc) right = { t: "leaf", panel: "doc" };
  let base: DockNode = right ? { t: "split", dir: "row", a: term, b: right, ratio: 0.58 } : term;
  // 플로우 패널(#743)은 열려 있을 때 오른쪽 컬럼으로. 기본 3패널엔 미포함.
  if (has.flow) base = { t: "split", dir: "row", a: base, b: { t: "leaf", panel: "flow" }, ratio: 0.66 };
  if (has.browser) base = { t: "split", dir: "row", a: base, b: { t: "leaf", panel: "browser" }, ratio: 0.5 }; // 인앱 브라우저(#1034) 오른쪽 절반
  return base;
}

// 저장된 JSON이 유효한 DockNode인지 검증(영속 복원 방어, #716).
export function isDockNode(x: unknown): x is DockNode {
  if (!x || typeof x !== "object") return false;
  const n = x as Record<string, unknown>;
  if (n.t === "leaf") return n.panel === "terminal" || n.panel === "code" || n.panel === "doc" || n.panel === "flow" || n.panel === "browser";
  if (n.t === "split") return (n.dir === "row" || n.dir === "col") && typeof n.ratio === "number" && isDockNode(n.a) && isDockNode(n.b);
  return false;
}

// 트리에 있는 리프 패널 집합.
export function leavesOf(node: DockNode): Set<PanelId> {
  const out = new Set<PanelId>();
  const walk = (n: DockNode) => { if (n.t === "leaf") out.add(n.panel); else { walk(n.a); walk(n.b); } };
  walk(node);
  return out;
}

// 없어진 패널 리프 제거 후 형제를 부모 자리로 승격(prune). 전부 사라지면 null.
export function pruneTree(node: DockNode, has: Record<PanelId, boolean>): DockNode | null {
  if (node.t === "leaf") return has[node.panel] ? node : null;
  const a = pruneTree(node.a, has);
  const b = pruneTree(node.b, has);
  if (a && b) return { ...node, a, b };
  return a ?? b; // 한쪽만 남으면 그걸로 승격
}

// 패널을 트리에 추가/제거(프로그래밍적, #743 플로우 패널 열고 닫기). 드래그 도킹(insertBeside)과 별개.
export function appendPanel(tree: DockNode, panel: PanelId): DockNode {
  if (leavesOf(tree).has(panel)) return tree; // 이미 있으면 그대로
  return { t: "split", dir: "row", a: tree, b: { t: "leaf", panel }, ratio: 0.66 };
}
export function removePanel(tree: DockNode, panel: PanelId): DockNode | null {
  return removeLeaf(tree, panel);
}

// path("a"/"b" 배열)의 split ratio 갱신(불변).
function setRatioAt(node: DockNode, path: ("a" | "b")[], ratio: number): DockNode {
  if (path.length === 0) return node.t === "split" ? { ...node, ratio } : node;
  if (node.t !== "split") return node;
  const [head, ...rest] = path;
  return head === "a" ? { ...node, a: setRatioAt(node.a, rest, ratio) } : { ...node, b: setRatioAt(node.b, rest, ratio) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MIN_RATIO = 0.12;

// ── 드래그 도킹 트리 조작(#716) ──
type Edge = "left" | "right" | "top" | "bottom";
// 트리에서 한 패널 리프 제거 후 형제 승격(없으면 null).
function removeLeaf(node: DockNode, panel: PanelId): DockNode | null {
  if (node.t === "leaf") return node.panel === panel ? null : node;
  const a = removeLeaf(node.a, panel), b = removeLeaf(node.b, panel);
  return a && b ? { ...node, a, b } : (a ?? b);
}
// target 리프를 edge 방향으로 split해 dragged를 새 형제로 삽입.
function insertBeside(node: DockNode, target: PanelId, dragged: PanelId, edge: Edge): DockNode {
  if (node.t === "leaf") {
    if (node.panel !== target) return node;
    const dir: "row" | "col" = edge === "left" || edge === "right" ? "row" : "col";
    const dl: DockNode = { t: "leaf", panel: dragged };
    const before = edge === "left" || edge === "top";
    return { t: "split", dir, a: before ? dl : node, b: before ? node : dl, ratio: 0.5 };
  }
  return { ...node, a: insertBeside(node.a, target, dragged, edge), b: insertBeside(node.b, target, dragged, edge) };
}
// dragged 패널을 target 패널의 edge 쪽으로 도킹.
function dockTo(tree: DockNode, dragged: PanelId, target: PanelId, edge: Edge): DockNode {
  if (dragged === target) return tree;
  const removed = removeLeaf(tree, dragged);
  return removed ? insertBeside(removed, target, dragged, edge) : tree;
}
// 포인터 위치 → 가장 가까운 가장자리(사분면).
function edgeOf(rect: DOMRect, x: number, y: number): Edge {
  const px = (x - rect.left) / rect.width, py = (y - rect.top) / rect.height;
  const dl = px, dr = 1 - px, dt = py, db = 1 - py, m = Math.min(dl, dr, dt, db);
  return m === dl ? "left" : m === dr ? "right" : m === dt ? "top" : "bottom";
}

export default function WorkspaceDockLayout({ tree, panels, onTreeChange }: {
  tree: DockNode;
  panels: Record<PanelId, ReactNode>;
  onTreeChange: (t: DockNode) => void;
}) {
  const treeRef = useRef(tree); // 드래그 move에서 최신 트리 읽기(closure stale 방지)
  useEffect(() => { treeRef.current = tree; }, [tree]);
  const [drag, setDrag] = useState<PanelId | null>(null);      // 드래그 중인 패널
  const [over, setOver] = useState<{ panel: PanelId; edge: Edge } | null>(null); // 현재 드롭 대상·가장자리

  const renderNode = (node: DockNode, path: ("a" | "b")[]): ReactNode => {
    if (node.t === "leaf") {
      const panel = node.panel;
      const showOver = over && over.panel === panel && drag && drag !== panel;
      const ov = over?.edge;
      return (
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {panels[panel]}
          {/* 이동 핸들 — 탭바 우측에 예약된 빈 자리(각 패널 탭바 pr)에 앉는 그립. 박스·배경 없이 점만, 탭과 안 겹침. */}
          <div draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", panel); setDrag(panel); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            title="패널 이동" aria-label="패널 이동"
            className="absolute right-0 top-0 z-40 flex h-7 w-[17px] cursor-grab items-center justify-center text-zinc-400 opacity-50 transition hover:text-zinc-600 hover:opacity-100 active:cursor-grabbing dark:hover:text-zinc-200">
            <IconGripVertical size={13} stroke={2} aria-hidden />
          </div>
          {/* 드래그 중: 다른 패널 위 드롭 오버레이(이벤트 안정 캡처 + 가장자리 하이라이트). 자기 자신엔 안 뜸. */}
          {drag && drag !== panel && (
            <div className="absolute inset-0 z-30"
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver({ panel, edge: edgeOf(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY) }); }}
              onDrop={(e) => { e.preventDefault(); const edge = edgeOf(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY); onTreeChange(dockTo(treeRef.current, drag, panel, edge)); setDrag(null); setOver(null); }}>
              {showOver && <div className={`pointer-events-none absolute bg-mustard-500/30 dark:bg-mustard-400/30 ${ov === "left" ? "inset-y-0 left-0 w-1/2" : ov === "right" ? "inset-y-0 right-0 w-1/2" : ov === "top" ? "inset-x-0 top-0 h-1/2" : "inset-x-0 bottom-0 h-1/2"}`} />}
            </div>
          )}
        </div>
      );
    }
    const isRow = node.dir === "row";
    const aBasis = `${node.ratio * 100}%`;
    const bBasis = `${(1 - node.ratio) * 100}%`;

    // 리사이즈 — 컨테이너 rect 기준 포인터 비율. 세로/가로에 따라 축 다름.
    const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const container = e.currentTarget.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return; // 0크기 컨테이너 → 나눗셈 발산 방지
      const move = (ev: PointerEvent) => {
        const r = isRow ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
        onTreeChange(setRatioAt(treeRef.current, path, clamp(r, MIN_RATIO, 1 - MIN_RATIO)));
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
      document.body.style.cursor = isRow ? "col-resize" : "row-resize"; document.body.style.userSelect = "none";
    };

    return (
      <div className={`flex min-h-0 min-w-0 flex-1 ${isRow ? "flex-row" : "flex-col"}`}>
        <div className="flex min-h-0 min-w-0" style={{ flexBasis: aBasis }}>{renderNode(node.a, [...path, "a"])}</div>
        <div onPointerDown={onDown}
          className={`shrink-0 bg-zinc-200 transition hover:bg-mustard-500/40 dark:bg-zinc-800 dark:hover:bg-mustard-400/40 ${isRow ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}`} />
        <div className="flex min-h-0 min-w-0" style={{ flexBasis: bBasis }}>{renderNode(node.b, [...path, "b"])}</div>
      </div>
    );
  };

  return <div className="flex h-full min-h-0 w-full">{renderNode(tree, [])}</div>;
}
