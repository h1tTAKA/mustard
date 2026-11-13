"use client";
// 코드그래프 뷰어(#842 서브5 → #1322 탐색 화면) — 노드-엣지 다이어그램을 캔버스에 포스 레이아웃으로. 모달 오버레이.
// 서브4 플로우(사람 친화 밴드/알약)와 별개: 그래프 구조 자체를 보고 싶은 유저용.
// #1322: 위 툴바(보기 깊이·덩어리 칩·검색) + 오른쪽 패널(요약 / 누른 노드 상세). 순수 계산은 lib/repo/graphView.ts.
// 레이아웃 엔진 d3-force(ISC). 팬/줌은 손수(의존성 최소).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, type Simulation, type SimulationNodeDatum } from "d3-force";
import { IconX, IconLoader2, IconFocus2, IconSearch, IconCode, IconLayoutSidebarRight, IconRoute } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import type { RepoAssetRole, RepoGraph, RepoNode, RepoNodeKind } from "@/lib/repo/types";
import { DEPTHS, visibleKinds, searchNodes, neighbors, langStats, shortestPath, impactOf, type Link } from "@/lib/repo/graphView";
import { useViewDepth } from "@/lib/repo/viewDepth";

type SimNode = SimulationNodeDatum & { id: string; label: string; file: string; kind: RepoNodeKind; role?: RepoAssetRole; community?: number };
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
const MAX_CHIPS = 14, MAX_LIST = 50;  // 덩어리 칩·상세 목록 상한(화면 넘침 방지)
const HL = "#e8b93a";                  // 강조색(머스타드)
const CHANGED = "#f97316", AFFECTED = "#facc15"; // 영향 강조: 바뀐 노드(주황)·한 칸 이웃(노랑)
type ImpactBase = "off" | "analysis" | "worktree" | "branch";

export default function RepoGraphViewer({ root, onOpenFile, onClose }: {
  root: string;
  onOpenFile?: (file: string, line?: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [graph, setGraph] = useState<RepoGraph | null>(null);
  const [builtAt, setBuiltAt] = useState<number | null>(null);
  // 범례에 넣을 역할 — 그래프 바뀔 때만 1회 계산(#1014 리뷰: 렌더마다 노드 전체 스캔 방지)
  const roles = useMemo(() => (Object.keys(ROLE_COLOR) as RepoAssetRole[]).filter((r) => graph?.nodes.some((n) => n.role === r)), [graph]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [savedDepth, setDepth] = useViewDepth();                    // 보기 깊이(흐름 패널과 공유)
  const depth = savedDepth ?? "expert";                              // 안 골랐으면 전부 = 예전 그래프 그대로(리뷰)
  const [picked, setPicked] = useState<Set<number>>(new Set());     // 고른 덩어리(비면 전부)
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);    // 누른 노드 id → 오른쪽 상세
  const [panelOpen, setPanelOpen] = useState(true);
  // 경로 찾기 — pathPick: 지금 고르는 끝("from"=시작, "to"=끝, null=안 고르는 중). 둘 다 정해지면 최단 경로.
  const [pathPick, setPathPick] = useState<null | "from" | "to">(null);
  const [pathFrom, setPathFrom] = useState<string | null>(null);
  const [pathTo, setPathTo] = useState<string | null>(null);
  // 영향 강조 — 기준을 고르면 서버에서 바뀐 파일 목록을 받아 바뀐 노드 + 한 칸 이웃을 칠함.
  const [impactBase, setImpactBase] = useState<ImpactBase>("off");
  const [impact, setImpact] = useState<{ files: string[]; noBase?: boolean; error?: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const viewRef = useRef({ x: 0, y: 0, k: 1 }); // 팬(x,y CSS px) + 줌(k)
  const dirtyRef = useRef(true);                 // 다시 그릴 필요 플래그(idle 시 rAF no-op)
  const rafRef = useRef(0);
  const hoverRef = useRef<SimNode | null>(null);
  // 그리기용 강조 상태 미러 — draw는 rAF에서 돌아 state를 직접 못 봄.
  const hlRef = useRef<{ sel: string | null; match: Set<string>; picked: Set<number>; path: Set<string>; pathEdges: Set<string>; changed: Set<string>; affected: Set<string> }>({ sel: null, match: new Set(), picked: new Set(), path: new Set(), pathEdges: new Set(), changed: new Set(), affected: new Set() });

  // 1) 그래프 로드 — 서브2 캐시 라우트 재사용.
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로드 시작 초기화(비동기 fetch 준비)
    setLoading(true); setErr(null); setSelected(null); setPicked(new Set()); setQuery(""); setPathPick(null); setPathFrom(null); setPathTo(null); setImpactBase("off");
    void (async () => {
      try {
        const r = await fetch("/api/repo/codegraph", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
        const d = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !d?.graph) { setErr(d?.error ? String(d.error) : `HTTP ${r.status}`); return; }
        setGraph(d.graph as RepoGraph); setBuiltAt(typeof d.builtAt === "number" ? d.builtAt : null);
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : String(e)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [root]);

  // 보기 깊이에 맞는 노드만(종류로 거름). 깊이를 바꾸면 배치도 새로 — 모드 전환이라 흔들려도 됨.
  const shown = useMemo(() => {
    if (!graph) return [];
    const kinds = visibleKinds(depth);
    return graph.nodes.filter((n) => kinds.has(n.kind));
  }, [graph, depth]);
  const byId = useMemo(() => new Map(graph?.nodes.map((n) => [n.id, n]) ?? []), [graph]);
  const matches = useMemo(() => searchNodes(shown, query), [shown, query]);
  const communities = useMemo(() => [...(graph?.communities ?? [])].sort((a, b) => b.count - a.count).slice(0, MAX_CHIPS), [graph]);
  const langs = useMemo(() => langStats(graph?.nodes ?? []).slice(0, 6), [graph]);
  // 지금 깊이에 보이는 노드만 지나는 최단 경로(그려지는 것과 맞게). 끝점이 안 보이면 null.
  const path = useMemo(() => (graph && pathFrom && pathTo ? shortestPath(graph.edges, pathFrom, pathTo, new Set(shown.map((n) => n.id))) : null), [graph, shown, pathFrom, pathTo]);
  // 영향 기준이 바뀌면 바뀐 파일 목록 다시 받기(늦게 온 옛 응답은 버림).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 기준 전환 시 이전 결과 비움(비동기 조회 준비)
    setImpact(null);
    if (impactBase === "off") return;
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/repo/impact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, base: impactBase }) });
        const d = await r.json().catch(() => null);
        if (!alive) return;
        setImpact(r.ok && Array.isArray(d?.files) ? { files: d.files as string[], noBase: !!d.noBase } : { files: [], error: d?.error ? String(d.error) : `HTTP ${r.status}` });
      } catch (e) { if (alive) setImpact({ files: [], error: e instanceof Error ? e.message : String(e) }); }
    })();
    return () => { alive = false; };
  }, [root, impactBase]);
  const hit = useMemo(() => (graph && impact ? impactOf(graph, impact.files) : null), [graph, impact]);
  const detail = useMemo(() => (graph && selected ? neighbors(graph, selected) : null), [graph, selected]);

  useEffect(() => {
    const pathEdges = new Set<string>();
    if (path) for (let i = 1; i < path.length; i++) { pathEdges.add(`${path[i - 1]}|${path[i]}`); pathEdges.add(`${path[i]}|${path[i - 1]}`); }
    hlRef.current = { sel: selected, match: new Set(query.trim() ? matches.map((n) => n.id) : []), picked, path: new Set(path ?? [pathFrom, pathTo].filter((x): x is string => !!x)), pathEdges,
      changed: hit?.changed ?? new Set(), affected: hit?.affected ?? new Set() };
    dirtyRef.current = true;
  }, [selected, matches, picked, query, path, pathFrom, pathTo, hit]);

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
    const { sel, match, picked: pk, path: onPath, pathEdges, changed, affected } = hlRef.current;
    const impactOn = changed.size > 0;
    // 흐리게(배치 유지): 경로가 있으면 경로 밖 전부 → 영향 강조 중이면 바뀐·영향 밖 → 아니면 덩어리 거름 밖.
    const dim = (n: SimNode) => (pathEdges.size > 0 ? !onPath.has(n.id)
      : impactOn ? !changed.has(n.id) && !affected.has(n.id)
      : pk.size > 0 && (n.community == null || !pk.has(n.community)));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(v.x, v.y); ctx.scale(v.k, v.k);
    // 엣지 — 보통 / 흐림 / 선택 노드에 붙은 것(강조) 세 묶음.
    const normal: [SimNode, SimNode][] = [], faint: [SimNode, SimNode][] = [], hot: [SimNode, SimNode][] = [];
    for (const l of linksRef.current) {
      const s = l.source as SimNode, tg = l.target as SimNode;
      if (typeof s !== "object" || typeof tg !== "object") continue;
      if (pathEdges.size ? pathEdges.has(`${s.id}|${tg.id}`) : sel ? s.id === sel || tg.id === sel : impactOn && (changed.has(s.id) || changed.has(tg.id)) && !dim(s) && !dim(tg)) hot.push([s, tg]);
      else if (dim(s) || dim(tg)) faint.push([s, tg]);
      else normal.push([s, tg]);
    }
    const stroke = (list: [SimNode, SimNode][], color: string, width: number) => {
      if (!list.length) return;
      ctx.lineWidth = width / v.k; ctx.strokeStyle = color; ctx.beginPath();
      for (const [s, tg] of list) { ctx.moveTo(s.x ?? 0, s.y ?? 0); ctx.lineTo(tg.x ?? 0, tg.y ?? 0); }
      ctx.stroke();
    };
    stroke(faint, "rgba(120,120,135,0.07)", 0.6);
    stroke(normal, "rgba(120,120,135,0.28)", 0.6);
    stroke(hot, !pathEdges.size && !sel && impactOn ? CHANGED : HL, pathEdges.size ? 2.2 : 1.4);
    // 노드
    for (const n of nodesRef.current) {
      ctx.globalAlpha = dim(n) && n.id !== sel && !match.has(n.id) ? 0.15 : 1;
      const ring = n.id === sel || match.has(n.id) || onPath.has(n.id);
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, n.id === sel ? NODE_R * 1.6 : NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = (n.role && ROLE_COLOR[n.role]) || (KIND_COLOR[n.kind] ?? "#9ca3af");
      ctx.fill();
      if (ring) { ctx.lineWidth = 1.5 / v.k; ctx.strokeStyle = HL; ctx.stroke(); }
      else if (!pathEdges.size && (changed.has(n.id) || affected.has(n.id))) { ctx.lineWidth = 2 / v.k; ctx.strokeStyle = changed.has(n.id) ? CHANGED : AFFECTED; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    // 라벨 — 확대(k>1.6) 시, 또는 호버·선택·검색 결과만(클러터 방지)
    const hov = hoverRef.current;
    ctx.fillStyle = "rgba(228,228,235,0.92)";
    ctx.font = `${11 / v.k}px ui-monospace, monospace`;
    for (const n of nodesRef.current) {
      if (!(v.k > 1.6 && !dim(n)) && n !== hov && n.id !== sel && !match.has(n.id) && !onPath.has(n.id) && !changed.has(n.id)) continue;
      ctx.fillText(n.label, (n.x ?? 0) + NODE_R + 1.5 / v.k, (n.y ?? 0) + 3 / v.k);
    }
  }, []);

  // 2) 그래프(보이는 노드) 생겼을 때 시뮬 구성 + rAF 루프.
  useEffect(() => {
    if (!graph) return;
    const nodes: SimNode[] = shown.map((n) => ({ id: n.id, label: n.label, file: n.file, kind: n.kind, role: n.role, community: n.community }));
    const ids = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
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
  }, [graph, shown, draw]);

  // 컨테이너 리사이즈(오른쪽 패널 접기 포함) → 다시 그림.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { dirtyRef.current = true; });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // 경로 끝 고르기 — 시작 → 끝 순. 끝까지 고르면 고르기 모드 끝.
  const choosePathEnd = useCallback((id: string) => {
    if (pathPick === "from") { setPathFrom(id); setPathTo(null); setPathPick("to"); }
    else if (pathPick === "to") { setPathTo(id); setPathPick(null); }
  }, [pathPick]);
  const clearPath = () => { setPathPick(null); setPathFrom(null); setPathTo(null); };

  // 노드 고르기 + 화면 가운데로(검색 결과·상세 목록에서 누를 때). 경로 고르는 중이면 경로 끝으로.
  // 지금 깊이에 안 보이는 노드면 고르기만.
  const pick = useCallback((id: string) => {
    if (pathPick) { choosePathEnd(id); setQuery(""); return; }
    setSelected(id);
    const n = nodesRef.current.find((x) => x.id === id), wrap = wrapRef.current;
    if (!n || !wrap) return;
    const v = viewRef.current;
    v.k = Math.max(v.k, 1.8);
    v.x = wrap.clientWidth / 2 - (n.x ?? 0) * v.k; v.y = wrap.clientHeight / 2 - (n.y ?? 0) * v.k;
    dirtyRef.current = true;
  }, [pathPick, choosePathEnd]);

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
    if (d.node) { d.node.fx = null; d.node.fy = null; }
    // #1322: 클릭(안 움직임) = 노드 고르기(오른쪽 상세), 빈 곳 클릭 = 고르기 해제. 코드 열기는 두 번 클릭·상세의 버튼.
    if (d.moved) return;
    if (pathPick) { if (d.node) choosePathEnd(d.node.id); return; } // 경로 고르는 중 — 빈 곳 클릭은 무시
    setSelected(d.node ? d.node.id : null);
  };
  // 한계: 코드 탭이 줄 이동을 아직 몰라 line은 넘겨도 파일 맨 위로 열림(흐름 패널과 같음).
  const onDoubleClick = (e: React.MouseEvent) => {
    if (pathPick) return; // 경로 고르는 중 두 번 클릭은 끝 고르기만(코드 안 열림, 리뷰). 경로를 다 고른 뒤엔 다시 열림
    const rect = e.currentTarget.getBoundingClientRect();
    const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (n && onOpenFile) onOpenFile(n.file, byId.get(n.id)?.line);
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

  // ESC — 검색어 → 경로 → 선택 → 닫기 순으로 하나씩 비움.
  const pathActive = !!(pathPick || pathFrom);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (query) setQuery(""); else if (pathActive) { setPathPick(null); setPathFrom(null); setPathTo(null); } else if (selected) setSelected(null); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, query, selected, pathActive]);

  const togglePick = (id: number) => setPicked((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const nodeCount = graph?.nodes.length ?? 0;
  const symbolCount = graph ? nodeCount - graph.stats.files : 0;
  const sel = selected ? byId.get(selected) : undefined;
  const commName = (c?: number) => graph?.communities?.find((x) => x.id === c)?.label;
  const btn = "shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";
  const chip = (on: boolean) => `shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium transition ${on ? "bg-mustard-500/15 text-mustard-700 ring-1 ring-inset ring-mustard-500/35 dark:bg-mustard-400/15 dark:text-mustard-400 dark:ring-mustard-400/30" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}`;

  const nodeRow = (n: RepoNode, extra?: string) => (
    <button key={`${n.id}:${extra ?? ""}`} type="button" onClick={() => pick(n.id)}
      className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: (n.role && ROLE_COLOR[n.role]) || KIND_COLOR[n.kind] }} aria-hidden />
      <span className="truncate">{n.label}</span>
      {extra && <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-400 dark:text-zinc-500">{extra}</span>}
    </button>
  );
  const linkList = (title: string, list: Link[] | RepoNode[]) => list.length > 0 && (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{title} ({list.length})</p>
      {list.slice(0, MAX_LIST).map((x) => ("relation" in x ? nodeRow(x.node, x.relation) : nodeRow(x)))}
    </div>
  );

  return (
    <div className="absolute inset-0 z-[60] flex flex-col bg-white/95 backdrop-blur-sm dark:bg-[var(--s-pane)]/95" role="dialog" aria-modal="true" aria-label={t("graph.title")}>
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="mr-auto truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{t("graph.title")}</span>
        {nodeCount > 0 && <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">{t("graph.stats", { nodes: nodeCount, edges: graph?.edges.length ?? 0 })}</span>}
        {nodeCount > BIG_GRAPH && <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">{t("graph.big")}</span>}
        <button type="button" onClick={reset} title={t("graph.reset")} aria-label={t("graph.reset")} className={btn}><IconFocus2 size={15} stroke={2} aria-hidden /></button>
        <button type="button" onClick={() => setPanelOpen((v) => !v)} title={t("graph.panel")} aria-label={t("graph.panel")} aria-pressed={panelOpen} className={btn}><IconLayoutSidebarRight size={15} stroke={2} aria-hidden /></button>
        <button type="button" onClick={onClose} title={t("mem.close")} aria-label={t("mem.close")} className={btn}><IconX size={16} stroke={2} aria-hidden /></button>
      </div>
      {graph && (
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            {/* 보기 깊이 — 초보=파일만, 개발자=+클래스·컴포넌트, 숙련자=+함수·타입(흐름 설명 깊이와 공유) */}
            <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/70" role="group" title={t("graph.depthTitle")}>
              {DEPTHS.map((d) => (
                <button key={d} type="button" onClick={() => setDepth(d)} aria-pressed={depth === d} className={chip(depth === d)}>{t(`graph.depth.${d}`)}</button>
              ))}
            </div>
            {/* 덩어리 칩 — 누르면 그 덩어리만 진하게(여러 개 가능), 다시 누르면 해제 */}
            {communities.length > 0 && (
              <div className="nunopi-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" title={t("graph.clusterTitle")}>
                {communities.map((c) => (
                  <button key={c.id} type="button" onClick={() => togglePick(c.id)} aria-pressed={picked.has(c.id)} className={chip(picked.has(c.id))}>
                    {c.label} <span className="text-zinc-400 dark:text-zinc-500">{c.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* 검색 — 이름·파일·시그니처. 결과 누르면 그 노드로 이동·선택(경로 고르는 중이면 경로 끝으로) */}
          <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <IconSearch size={13} stroke={2} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("graph.search")} aria-label={t("graph.search")}
              className="w-full rounded-md border border-zinc-200 bg-white py-1 pl-7 pr-2 text-[12px] text-zinc-700 outline-none focus:border-mustard-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-mustard-400" />
            {query.trim() && (
              <div className="nunopi-scroll absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-[var(--s-bar)]">
                {matches.length ? matches.map((n) => nodeRow(n, n.file)) : <p className="px-1.5 py-1 text-[11px] text-zinc-400">{t("graph.noMatch")}</p>}
              </div>
            )}
          </div>
            {/* 경로 찾기 — 누르면 시작·끝 노드 고르기(캔버스 클릭 또는 검색), 켜진 상태에서 다시 누르면 지움 */}
            <button type="button" onClick={() => (pathActive ? clearPath() : (setPathPick("from"), setPanelOpen(true)))} aria-pressed={pathActive} title={t("graph.pathTitle")}
              className={`flex items-center gap-1 ${chip(pathActive)}`}>
              <IconRoute size={13} stroke={2} aria-hidden />{t("graph.path")}
            </button>
            {/* 영향 강조 기준 — 끔 / 분석 뒤 / 커밋 안 한 변경 / main 대비 */}
            <select value={impactBase} onChange={(e) => { setImpactBase(e.target.value as ImpactBase); setPanelOpen(true); }} title={t("graph.impactTitle")} aria-label={t("graph.impactTitle")}
              className={`shrink-0 rounded-md border border-zinc-200 bg-white py-0.5 pl-1.5 pr-1 text-[11px] outline-none dark:border-zinc-700 dark:bg-zinc-900 ${impactBase !== "off" ? "text-mustard-700 dark:text-mustard-400" : "text-zinc-500 dark:text-zinc-400"}`}>
              {(["off", "analysis", "worktree", "branch"] as const).map((b) => <option key={b} value={b}>{t(`graph.impact.${b}`)}</option>)}
            </select>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div ref={wrapRef} className="relative min-w-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /> {t("graph.loading")}</div>
          ) : err ? (
            <div className="flex h-full flex-col items-center justify-center gap-1"><p className="text-[12px] text-rose-500">{t("graph.error")}</p><p className="break-words px-6 text-center text-[10px] text-zinc-400 dark:text-zinc-500">{err}</p></div>
          ) : (
            <>
              <canvas ref={canvasRef} className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={onDoubleClick} onWheel={onWheel} />
              {/* 범례 — 노드 종류 색(지금 깊이에서 보이는 종류만) */}
              <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white/80 px-2.5 py-2 text-[10px] dark:border-zinc-700 dark:bg-zinc-900/80">
                {(Object.keys(KIND_COLOR) as RepoNodeKind[]).filter((k) => visibleKinds(depth).has(k)).map((k) => (
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
        {/* 오른쪽 패널 — 고른 노드 없으면 요약, 있으면 상세 */}
        {panelOpen && graph && (
          <aside className="nunopi-scroll flex w-72 shrink-0 flex-col gap-3 overflow-auto border-l border-zinc-200 p-3 dark:border-zinc-800">
            {pathActive ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t("graph.path")}</p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {byId.get(pathFrom ?? "")?.label ?? "…"} → {byId.get(pathTo ?? "")?.label ?? "…"}
                </p>
                {pathPick ? (
                  <p className="text-[11px] text-mustard-700 dark:text-mustard-400">{t(pathPick === "from" ? "graph.pathPickFrom" : "graph.pathPickTo")}</p>
                ) : path ? (
                  <div className="flex flex-col gap-0.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("graph.pathSteps", { n: path.length - 1 })}</p>
                    {path.map((id, i) => { const n = byId.get(id); return n ? nodeRow(n, String(i + 1)) : null; })}
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("graph.pathNone")}</p>
                )}
                <button type="button" onClick={clearPath} className="self-start text-[11px] font-medium text-mustard-700 hover:underline dark:text-mustard-400">{t("graph.pathClear")}</button>
              </div>
            ) : !sel && impactBase !== "off" ? (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t(`graph.impact.${impactBase}`)}</p>
                {!impact ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-zinc-400"><IconLoader2 size={12} stroke={2} className="animate-spin" aria-hidden />{t("graph.loading")}</p>
                ) : impact.error ? (
                  <p className="break-words text-[11px] text-rose-500">{impact.error}</p>
                ) : impact.noBase ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t(impactBase === "analysis" ? "graph.impactNoAnalysis" : "graph.impactNoBranch")}</p>
                ) : !impact.files.length ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("graph.impactNone")}</p>
                ) : (
                  <>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("graph.impactCounts", { files: impact.files.length, changed: hit?.changed.size ?? 0, affected: hit?.affected.size ?? 0 })}</p>
                    {linkList(t("graph.impactChanged"), graph.nodes.filter((n) => n.kind === "file" && hit?.changed.has(n.id)))}
                    {linkList(t("graph.impactAffected"), graph.nodes.filter((n) => hit?.affected.has(n.id) && visibleKinds(depth).has(n.kind)))}
                  </>
                )}
              </div>
            ) : !sel ? (
              <>
                <p className="truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{root.split("/").filter(Boolean).pop()}</p>
                <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t("graph.counts", { files: graph.stats.files, symbols: symbolCount, edges: graph.edges.length, clusters: graph.communities?.length ?? 0 })}</p>
                {graph.stats.capped && <p className="text-[11px] text-amber-600 dark:text-amber-400">{t("graph.capped", { n: graph.stats.files, all: graph.stats.scanned })}</p>}
                {langs.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{t("graph.langs")}</p>
                    <div className="flex flex-wrap gap-1">
                      {langs.map((l) => <span key={l.ext} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{l.ext} {l.count}</span>)}
                    </div>
                  </div>
                )}
                {builtAt && <p className="text-[10px] text-zinc-400 dark:text-zinc-500">{t("graph.builtAt", { at: new Date(builtAt).toLocaleString() })}</p>}
                <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("graph.pickHint")}</p>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[10px] uppercase text-zinc-400 dark:text-zinc-500">{sel.role ?? KIND_LABEL[sel.kind]}</span>
                  <p className="break-all text-[13px] font-semibold text-zinc-700 dark:text-zinc-100">{sel.label}</p>
                  <button type="button" onClick={() => onOpenFile?.(sel.file, sel.line)} title={t("flow.openCode")}
                    className="flex items-center gap-1 self-start break-all text-left font-mono text-[10px] text-mustard-600 hover:underline dark:text-mustard-400">
                    <IconCode size={12} stroke={2} className="shrink-0" aria-hidden />{sel.file}{sel.line ? `:${sel.line}` : ""}
                  </button>
                  {sel.signature && <p className="break-all font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{sel.owner ? `${sel.owner}.` : ""}{sel.label}{sel.signature}</p>}
                  {commName(sel.community) && <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("graph.cluster", { name: commName(sel.community)! })}</p>}
                </div>
                {detail && (
                  <>
                    {linkList(t("graph.outgoing"), detail.out)}
                    {linkList(t("graph.incoming"), detail.in)}
                    {linkList(t("graph.contains"), detail.contains)}
                  </>
                )}
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
