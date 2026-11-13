"use client";
// 코드그래프 raw 뷰어(#842 서브5, opt-in) — 노드-엣지 다이어그램을 캔버스에 포스 레이아웃으로.
// 서브4 플로우(사람 친화 밴드/알약)와 별개: 그래프 구조 자체를 보고 싶은 유저용. 모달 오버레이.
// 레이아웃 엔진 d3-force(ISC). 팬/줌은 손수(의존성 최소).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, type Simulation, type SimulationNodeDatum } from "d3-force";
import { IconX, IconLoader2, IconFocus2 } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import type { RepoAssetRole, RepoGraph, RepoNodeKind } from "@/lib/repo/types";

type SimNode = SimulationNodeDatum & { id: string; label: string; file: string; kind: RepoNodeKind; role?: RepoAssetRole };
type SimLink = { source: SimNode | string; target: SimNode | string; relation: string };

// 노드 종류별 색(다크 배경서 잘 보이는 톤). 엣지는 연한 회색.
const KIND_COLOR: Record<RepoNodeKind, string> = {
  file: "#60a5fa", function: "#34d399", component: "#c084fc", class: "#fbbf24", type: "#f472b6",
};
const KIND_LABEL: Record<RepoNodeKind, string> = {
  file: "file", function: "function", component: "component", class: "class", type: "type",
};
// 게임 에셋 역할 색(#1013) — 역할이 있으면 kind(file) 색 대신. 범례엔 그래프에 실제 있는 역할만.
const ROLE_COLOR: Record<RepoAssetRole, string> = { scene: "#fb923c", prefab: "#a3e635", asset: "#a5b4fc" };
const NODE_R = 4, DRAG_THRESHOLD = 4; // 노드 반경(그래프 좌표), 클릭/드래그 판별 이동 임계(px)
const BIG_GRAPH = 5000;               // 이 이상이면 무거움 배너(silent 캡 금지)

export default function RepoGraphViewer({ root, onOpenFile, onClose }: {
  root: string;
  onOpenFile?: (file: string, line?: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [graph, setGraph] = useState<RepoGraph | null>(null);
  // 범례에 넣을 역할 — 그래프 바뀔 때만 1회 계산(#1014 리뷰: 렌더마다 노드 전체 스캔 방지)
  const roles = useMemo(() => (Object.keys(ROLE_COLOR) as RepoAssetRole[]).filter((r) => graph?.nodes.some((n) => n.role === r)), [graph]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const viewRef = useRef({ x: 0, y: 0, k: 1 }); // 팬(x,y CSS px) + 줌(k)
  const dirtyRef = useRef(true);                 // 다시 그릴 필요 플래그(idle 시 rAF no-op)
  const rafRef = useRef(0);
  const hoverRef = useRef<SimNode | null>(null);

  // 1) 그래프 로드 — 서브2 캐시 라우트 재사용.
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로드 시작 초기화(비동기 fetch 준비)
    setLoading(true); setErr(null);
    void (async () => {
      try {
        const r = await fetch("/api/repo/codegraph", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
        const d = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !d?.graph) { setErr(d?.error ? String(d.error) : `HTTP ${r.status}`); return; }
        setGraph(d.graph as RepoGraph);
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : String(e)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [root]);

  // 화면→그래프 좌표 역변환(줌/팬 역산). 히트테스트·드래그에.
  const toGraph = useCallback((sx: number, sy: number) => {
    const v = viewRef.current;
    return { gx: (sx - v.x) / v.k, gy: (sy - v.y) / v.k };
  }, []);
  const nodeAt = useCallback((sx: number, sy: number): SimNode | null => {
    const { gx, gy } = toGraph(sx, sy);
    const rr = (NODE_R + 3) * (NODE_R + 3); // 약간 여유
    for (let i = nodesRef.current.length - 1; i >= 0; i--) { // 위(나중 그린 것) 우선
      const n = nodesRef.current[i];
      const dx = (n.x ?? 0) - gx, dy = (n.y ?? 0) - gy;
      if (dx * dx + dy * dy <= rr) return n;
    }
    return null;
  }, [toGraph]);

  // 캔버스 그리기(DPR 대응 + 팬/줌 변환).
  const draw = useCallback(() => {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const v = viewRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(v.x, v.y); ctx.scale(v.k, v.k);
    // 엣지
    ctx.lineWidth = 0.6 / v.k;
    ctx.strokeStyle = "rgba(120,120,135,0.28)";
    ctx.beginPath();
    for (const l of linksRef.current) {
      const s = l.source as SimNode, tg = l.target as SimNode;
      if (typeof s !== "object" || typeof tg !== "object") continue;
      ctx.moveTo(s.x ?? 0, s.y ?? 0); ctx.lineTo(tg.x ?? 0, tg.y ?? 0);
    }
    ctx.stroke();
    // 노드
    for (const n of nodesRef.current) {
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = (n.role && ROLE_COLOR[n.role]) || (KIND_COLOR[n.kind] ?? "#9ca3af");
      ctx.fill();
    }
    // 라벨 — 확대(k>1.6) 시 또는 호버 노드만(클러터 방지)
    const hov = hoverRef.current;
    if (v.k > 1.6 || hov) {
      ctx.fillStyle = "rgba(228,228,235,0.92)";
      ctx.font = `${11 / v.k}px ui-monospace, monospace`;
      for (const n of nodesRef.current) {
        if (v.k <= 1.6 && n !== hov) continue;
        ctx.fillText(n.label, (n.x ?? 0) + NODE_R + 1.5 / v.k, (n.y ?? 0) + 3 / v.k);
      }
    }
  }, []);

  // 2) 그래프 생겼을 때 시뮬 구성 + rAF 루프.
  useEffect(() => {
    if (!graph) return;
    const nodes: SimNode[] = graph.nodes.map((n) => ({ id: n.id, label: n.label, file: n.file, kind: n.kind, role: n.role }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = graph.edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, relation: e.relation }));
    nodesRef.current = nodes; linksRef.current = links;
    const wrap = wrapRef.current;
    const w = wrap?.clientWidth ?? 800, h = wrap?.clientHeight ?? 600;
    const sim = forceSimulation(nodes)
      .force("charge", forceManyBody().strength(-24))
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(26).strength(0.4))
      .force("center", forceCenter(w / 2, h / 2))
      .force("collide", forceCollide(NODE_R + 1))
      .on("tick", () => { dirtyRef.current = true; });
    simRef.current = sim;
    viewRef.current = { x: 0, y: 0, k: 1 };
    dirtyRef.current = true;
    const loop = () => { if (dirtyRef.current) { dirtyRef.current = false; draw(); } rafRef.current = requestAnimationFrame(loop); };
    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); sim.stop(); simRef.current = null; };
  }, [graph, draw]);

  // 컨테이너 리사이즈 → 다시 그림.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { dirtyRef.current = true; });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ── 팬/줌/드래그(손수) ──
  const dragRef = useRef<{ id: number; node: SimNode | null; sx: number; sy: number; moved: boolean; panx: number; pany: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (dragRef.current) return; // 이미 한 포인터 추적 중 — 두 번째 터치 무시(멀티터치 상태 덮어쓰기 방지)
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const node = nodeAt(sx, sy);
    dragRef.current = { id: e.pointerId, node, sx, sy, moved: false, panx: viewRef.current.x, pany: viewRef.current.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (node) { simRef.current?.alphaTarget(0.2).restart(); }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const d = dragRef.current;
    if (!d) { // 호버 라벨
      const h = nodeAt(sx, sy);
      if (h !== hoverRef.current) { hoverRef.current = h; dirtyRef.current = true; }
      return;
    }
    if (e.pointerId !== d.id) return; // 추적 중인 포인터만
    if (!d.moved && Math.abs(sx - d.sx) + Math.abs(sy - d.sy) > DRAG_THRESHOLD) d.moved = true;
    if (d.node) { // 노드 드래그 → fx/fy 고정(그래프 좌표)
      const { gx, gy } = toGraph(sx, sy);
      d.node.fx = gx; d.node.fy = gy; dirtyRef.current = true;
    } else if (d.moved) { // 빈 곳 드래그 → 팬
      viewRef.current.x = d.panx + (sx - d.sx); viewRef.current.y = d.pany + (sy - d.sy); dirtyRef.current = true;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d && e.pointerId !== d.id) return; // 추적 포인터 아니면 무시
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    simRef.current?.alphaTarget(0);
    if (!d) return;
    if (d.node) { d.node.fx = null; d.node.fy = null; if (!d.moved && onOpenFile) onOpenFile(d.node.file); } // 클릭(안 움직임)=코드 열기
  };
  const onWheel = (e: React.WheelEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const v = viewRef.current;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const k2 = Math.min(6, Math.max(0.15, v.k * factor));
    // 커서 아래 지점 고정(줌 중심).
    v.x = sx - ((sx - v.x) / v.k) * k2; v.y = sy - ((sy - v.y) / v.k) * k2; v.k = k2;
    dirtyRef.current = true;
  };
  // 전체 보기(리셋).
  const reset = () => { viewRef.current = { x: 0, y: 0, k: 1 }; simRef.current?.alpha(0.4).restart(); dirtyRef.current = true; };

  // ESC 닫기.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const nodeCount = graph?.nodes.length ?? 0;
  return (
    <div className="absolute inset-0 z-[60] flex flex-col bg-white/95 backdrop-blur-sm dark:bg-[var(--s-pane)]/95" role="dialog" aria-modal="true" aria-label={t("graph.title")}>
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="mr-auto truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{t("graph.title")}</span>
        {nodeCount > 0 && <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">{t("graph.stats", { nodes: nodeCount, edges: graph?.edges.length ?? 0 })}</span>}
        {nodeCount > BIG_GRAPH && <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">{t("graph.big")}</span>}
        <button type="button" onClick={reset} title={t("graph.reset")} aria-label={t("graph.reset")}
          className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"><IconFocus2 size={15} stroke={2} aria-hidden /></button>
        <button type="button" onClick={onClose} title={t("mem.close")} aria-label={t("mem.close")}
          className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"><IconX size={16} stroke={2} aria-hidden /></button>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /> {t("graph.loading")}</div>
        ) : err ? (
          <div className="flex h-full flex-col items-center justify-center gap-1"><p className="text-[12px] text-rose-500">{t("graph.error")}</p><p className="break-words px-6 text-center text-[10px] text-zinc-400 dark:text-zinc-500">{err}</p></div>
        ) : (
          <>
            <canvas ref={canvasRef} className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel} />
            {/* 범례 — 노드 종류 색 */}
            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white/80 px-2.5 py-2 text-[10px] dark:border-zinc-700 dark:bg-zinc-900/80">
              {(Object.keys(KIND_COLOR) as RepoNodeKind[]).map((k) => (
                <span key={k} className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[k] }} aria-hidden /> {KIND_LABEL[k]}
                </span>
              ))}
              {roles.map((r) => (
                <span key={r} className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ROLE_COLOR[r] }} aria-hidden /> {r}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
