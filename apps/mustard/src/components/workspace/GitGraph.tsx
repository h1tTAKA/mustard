"use client";
// 워크스페이스 깃 그래프(#649) — /api/repo/git-log → 파싱 → 레인 배정 → SVG(점·선) + 커밋행.
// 커밋 클릭 → 바뀐 파일(M/A/D) 펼침, 파일 클릭 → onOpenDiff(diff 뷰).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconLoader2, IconRefresh, IconGitBranch, IconTag, IconChevronRight, IconChevronDown, IconGitCommit, IconCloudDownload, IconArrowDown, IconPlus, IconMinus } from "@tabler/icons-react";
import { useT, useToast, getSetting, GKEYS, GIT_DEFAULTS } from "@mustard/core";
import { parseGitLog, assignLanes, githubLogin, type GitGraphModel } from "@/lib/repo/gitGraph";

// ref 배지 종류별 스타일 — 로컬 브랜치 / 원격(origin/*) / 태그 / 현재 HEAD 브랜치 구분(색 같으면 못 알아봄).
function refBadge(ref: string, curBranch: string) {
  if (ref === curBranch) return { cls: "bg-brown-900 text-brown-300 ring-1 ring-inset ring-brown-300/50", tag: false }; // 그래프 배지 = 모노크롬 브라운(배경 딥브라운 + 테두리·글자 탄, 동일 계열) (#794)
  if (/^v?\d/.test(ref)) return { cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400", tag: true }; // 태그
  if (ref.includes("/")) return { cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400", tag: false };       // 원격(origin/…)
  return { cls: "bg-zinc-200/70 text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300", tag: false };                     // 로컬 브랜치 = 쿨 뉴트럴(현재=골드와 웜 경쟁 방지)
}

const ROW_H = 24, FILE_H = 20, LANE_W = 16;
const HOVER_DELAY_MS = 1000; // 커밋 호버 툴팁 dwell — 훑을 땐 안 뜨고 머물러야 뜸
// 색(#707, orca식) — 트렁크(lane 0)는 브랜드 인디고 고정, 브랜치는 커밋마다 다른 accent 순환.
// 레인이 아니라 "커밋별"로 색을 매김 → 같은 레인(1)을 재사용하는 단발 브랜치들도 서로 다른 색(무지개).
const TRUNK_COLOR = "#6366f1";
const BRANCH_COLORS = ["#f59e0b", "#ec4899", "#14b8a6", "#a855f7", "#0ea5e9", "#f43f5e", "#84cc16", "#f97316"];
const cx = (lane: number) => lane * LANE_W + LANE_W / 2;
// 점→부모점 연결선(#707). 대각 스윕(엉킴) 방지 위해 레인 따라 직진, "전환은 한 행만" 곡선.
// roundApex(한 행 전환): 트렁크(안쪽) 끝은 "수평 접선"으로 뻗어 둥근 꼭지점, 브랜치 레인(바깥) 끝은 "수직 접선"으로 레인과 블렌드(orca식).
// CURVE_F = 베지어 핸들 길이 비율. 0.5523이 사분원 근사(가장 둥글면서 좌우 균형). 그보다 크면 제어점이 한 모서리로 몰려 굴곡이 한쪽만 부푼다(#707).
const CURVE_F = 0.55;
const roundApex = (x1: number, ya: number, x2: number, yb: number) =>
  x2 > x1
    ? `C${x1 + (x2 - x1) * CURVE_F} ${ya} ${x2} ${yb - (yb - ya) * CURVE_F} ${x2} ${yb}`   // 트렁크(안,x1)→바깥(x2): 시작 수평, 끝 수직
    : `C${x1} ${ya + (yb - ya) * CURVE_F} ${x1 + (x2 - x1) * CURVE_F} ${yb} ${x2} ${yb}`; // 바깥(x1)→트렁크(안,x2): 시작 수직, 끝 수평
const linkPath = (x1: number, y1: number, x2: number, y2: number) => {
  if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`;
  if (y2 - y1 <= ROW_H * 1.5) return `M${x1} ${y1}${roundApex(x1, y1, x2, y2)}`;      // 인접 — 트렁크쪽 둥근 꼭지점
  if (x2 > x1) return `M${x1} ${y1}${roundApex(x1, y1, x2, y1 + ROW_H)}L${x2} ${y2}`; // 바깥 분기 — 첫 행 곡선(수직 끝) 후 직진
  return `M${x1} ${y1}L${x1} ${y2 - ROW_H}${roundApex(x1, y2 - ROW_H, x2, y2)}`;       // 안쪽 복귀 — 직진 후 끝 행 곡선
};
const STATUS = { M: ["M", "text-amber-600 dark:text-amber-500"], A: ["A", "text-emerald-600 dark:text-emerald-500"], D: ["D", "text-rose-600 dark:text-rose-500"], R: ["R", "text-sky-600 dark:text-sky-500"], C: ["C", "text-sky-600 dark:text-sky-500"] } as const;

// 워킹트리 변경 파일 한 건.
type Change = { path: string; index: string; work: string; added: number; deleted: number };
type WorktreeKind = "staged" | "unstaged" | "untracked";
// 변경의 diff 종류(클릭 시 어떤 diff를 열지) — unstaged 우선, 없으면 staged, ?? 는 untracked.
const changeKind = (c: Change): WorktreeKind => c.index === "?" ? "untracked" : (c.work !== " " && c.work !== "?") ? "unstaged" : "staged";
// 표시 배지: 문자 + 색.
function changeBadge(c: Change): { ch: string; cls: string } {
  if (c.index === "?" ) return { ch: "U", cls: "text-zinc-400" };
  if (c.index === "D" || c.work === "D") return { ch: "D", cls: "text-rose-600 dark:text-rose-500" };
  if (c.index === "A") return { ch: "A", cls: "text-emerald-600 dark:text-emerald-500" };
  if (c.index === "R") return { ch: "R", cls: "text-sky-600 dark:text-sky-500" };
  // staged(index)면 초록계, unstaged만이면 주황계.
  const staged = c.index !== " " && c.index !== "?";
  return { ch: "M", cls: staged ? "text-emerald-600 dark:text-emerald-500" : "text-amber-600 dark:text-amber-500" };
}

export default function GitGraph({ root, onOpenDiff, onFocusBranch, onOpenChange, onRefreshed, refreshNonce, focus, onFocusResult }: { root: string; onOpenDiff: (hash: string, file: string) => void; onFocusBranch: (branch: string) => void; onOpenChange?: (file: string, kind: WorktreeKind) => void; onRefreshed?: () => void; refreshNonce?: number; focus?: { hash: string; n: number; file?: string }; onFocusResult?: (found: boolean) => void }) {
  const t = useT();
  const toast = useToast();
  const [model, setModel] = useState<GitGraphModel | null>(null);
  const [isGit, setIsGit] = useState(true);
  const [branch, setBranch] = useState("");
  const [detached, setDetached] = useState<{ sha: string; label: string } | null>(null); // #1025 분리 HEAD 표시
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<null | "fetch" | "pull">(null); // #946 최신화 진행
  const [commitMsg, setCommitMsg] = useState(""); // #947 커밋 메시지
  const [committing, setCommitting] = useState(false); // #947 커밋 진행
  const [creatingBranch, setCreatingBranch] = useState(false); // #948 새 브랜치 입력 표시
  const [branchName, setBranchName] = useState(""); // #948
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filesByHash, setFilesByHash] = useState<Record<string, { status: string; path: string }[]>>({});
  const [changes, setChanges] = useState<Change[]>([]);
  const [changesOpen, setChangesOpen] = useState(true);
  const [untrackedOpen, setUntrackedOpen] = useState(false); // 미추적 하위그룹(기본 접힘, #699)
  // 커밋 호버 팝오버(#685) — 전체 메세지(제목+본문). fixed라 스크롤 컨테이너 잘림 회피.
  // dwell 지연: 그래프를 훑으며 지나갈 땐 안 뜨고, 머물러야(HOVER_DELAY_MS) 뜬다(orca식).
  // #1064 캐치업 세션 카드 "그래프에서 보기" — 그 커밋 행으로 스크롤 + 잠깐 강조.
  const [flash, setFlash] = useState<string | null>(null);
  const [flashFile, setFlashFile] = useState<{ hash: string; file: string; n: number } | null>(null); // #1074 펼친 커밋 안 그 파일 강조(n = 요청 번호)
  const scrolledFor = useRef<number | null>(null); // 이 요청으로 이미 파일 줄까지 스크롤했나(새로고침마다 다시 튀지 않게)
  const graphScrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ subject: string; body: string; left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // 행→툴팁 이동 여유(호버 브릿지, #834)
  // 행에서 벗어남 — 대기 중 dwell 취소 + 약간 지연 후 숨김(그 사이 툴팁으로 이동하면 툴팁 onMouseEnter가 취소).
  const leaveRow = useCallback(() => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } hideTimer.current = setTimeout(() => { setHover(null); hideTimer.current = null; }, 140); }, []);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); if (hideTimer.current) clearTimeout(hideTimer.current); }, []); // 언마운트 시 타이머 정리

  const load = useCallback(async () => {
    void refreshNonce; // 재fetch 트리거(#739) — 값 변하면 이 콜백 identity 바뀌어 아래 effect 재실행.
    if (!root) return;
    setLoading(true);
    try {
      const r = await fetch("/api/repo/git-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const d = await r.json();
      if (r.ok && d.isGit) { setIsGit(true); setBranch(d.branch ?? ""); setDetached(d.detached ?? null); setModel(assignLanes(parseGitLog(d.log ?? ""))); }
      else { setIsGit(false); setModel(null); }
    } catch { setIsGit(false); setModel(null); }
    finally { setLoading(false); }
    // 워킹트리 변경(커밋 전) 목록.
    try {
      const r = await fetch("/api/repo/git-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const d = await r.json();
      setChanges(r.ok && d.isGit && Array.isArray(d.files) ? d.files : []);
    } catch { setChanges([]); }
    onRefreshed?.(); // 상위(파일트리 도트·챗 승계)도 함께 갱신(#687/#689)
    // refreshNonce: 상위(WorkspaceView)가 파일 워처 변경 시 증가 → 그래프+변경사항 재fetch(#739).
  }, [root, onRefreshed, refreshNonce]);
  // 로컬 최신화(#946) — fetch/pull 후 성공 시 그래프 갱신 + 토스트.
  const sync = useCallback(async (action: "fetch" | "pull", silent = false) => {
    if (!root || syncing) return;
    setSyncing(action);
    try {
      const r = await fetch("/api/repo/git-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, action }) });
      const d = await r.json();
      // #954 silent(자동 fetch)은 토스트 생략, 갱신만.
      if (d.ok) { if (!silent) toast(t(action === "fetch" ? "workspace.gitFetchDone" : "workspace.gitPullDone"), "success"); void load(); }
      else if (!silent) toast(t("workspace.gitSyncFailed") + (d.error ? ` (${d.error})` : ""), "error");
    } catch { if (!silent) toast(t("workspace.gitSyncFailed"), "error"); }
    finally { setSyncing(null); }
  }, [root, syncing, toast, t, load]);
  // #954 main 자동 최신화 — 레포 열 때(root 변경) 설정 켜져 있으면 조용한 fetch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync가 setSyncing 호출(자동 fetch, 조용). root 변경 시 1회.
    if (root && getSetting<boolean>(GKEYS.autoFetch, GIT_DEFAULTS.autoFetch)) void sync("fetch", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- root 변경 시에만 자동 fetch
  }, [root]);
  // 스테이징(#947) — stage/unstage 후 변경목록 갱신.
  const stageFiles = useCallback(async (files: string[], action: "stage" | "unstage") => {
    if (!root || files.length === 0) return;
    try {
      const r = await fetch("/api/repo/git-stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, files, action }) });
      const d = await r.json();
      if (d.ok) void load();
      else toast(t("workspace.gitStageFailed") + (d.error ? ` (${d.error})` : ""), "error");
    } catch { toast(t("workspace.gitStageFailed"), "error"); }
  }, [root, toast, t, load]);
  // 커밋(#947) — staged 변경 커밋 후 메시지 비우고 갱신.
  const doCommit = useCallback(async () => {
    if (!root || !commitMsg.trim() || committing) return;
    setCommitting(true);
    try {
      const r = await fetch("/api/repo/git-commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, message: commitMsg.trim() }) });
      const d = await r.json();
      if (d.ok) { toast(t("workspace.gitCommitDone"), "success"); setCommitMsg(""); void load(); }
      else toast(t("workspace.gitCommitFailed") + (d.error ? ` (${d.error})` : ""), "error");
    } catch { toast(t("workspace.gitCommitFailed"), "error"); }
    finally { setCommitting(false); }
  }, [root, commitMsg, committing, toast, t, load]);
  // 브랜치 생성(#948) — switch -c 후 그래프·브랜치 갱신.
  const createBranch = useCallback(async () => {
    const raw = branchName.trim();
    if (!root || !raw) return;
    // #954 branch prefix — 설정된 prefix가 있고 아직 안 붙었으면 앞에 붙임.
    const prefix = getSetting<string>(GKEYS.branchPrefix, GIT_DEFAULTS.branchPrefix);
    const name = prefix && !raw.startsWith(prefix) ? prefix + raw : raw;
    try {
      const r = await fetch("/api/repo/git-branch-create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, name }) });
      const d = await r.json();
      if (d.ok) { toast(t("workspace.gitBranchCreated"), "success"); setCreatingBranch(false); setBranchName(""); void load(); }
      else toast(t("workspace.gitBranchCreateFailed") + (d.error ? ` (${d.error})` : ""), "error");
    } catch { toast(t("workspace.gitBranchCreateFailed"), "error"); }
  }, [root, branchName, toast, t, load]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load()가 setLoading 동기 호출(마운트/root 변경 시 로드)
  useEffect(() => { void load(); }, [load]);
  // 폴더 바뀌면 펼침·캐시 초기화.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- root 변경 시 펼침·캐시 리셋
  useEffect(() => { setExpanded(new Set()); setFilesByHash({}); }, [root]);

  const loadFiles = async (hash: string) => {
    if (!filesByHash[hash]) {
      try {
        const r = await fetch("/api/repo/git-show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, hash }) });
        const d = await r.json();
        setFilesByHash((prev) => ({ ...prev, [hash]: d.ok && Array.isArray(d.files) ? d.files : [] }));
      } catch { setFilesByHash((prev) => ({ ...prev, [hash]: [] })); }
    }
  };
  const toggle = async (hash: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(hash)) n.delete(hash); else n.add(hash); return n; });
    await loadFiles(hash);
  };

  const graphW = useMemo(() => (model ? Math.max(1, model.laneCount) * LANE_W : LANE_W), [model]);
  // 그래프 열 가시 폭(#718) — 브랜치 많으면 그래프가 커밋메세지를 밀어내므로 기본 ~3레인만 보이게 클립, divider로 넓혀 확인.
  // graphColW=유저가 지정한 폭(null=기본). colW=실제 적용 폭(graphW 넘지 않게 clamp). colW<graphW면 divider 노출.
  const [graphColW, setGraphColW] = useState<number | null>(null);
  const DEFAULT_COL = 3 * LANE_W + 12, MIN_COL = LANE_W + 8;
  const colW = graphColW != null ? Math.min(Math.max(graphColW, MIN_COL), graphW) : Math.min(graphW, DEFAULT_COL);
  const graphWRef = useRef(graphW); // 드래그 move서 최신 graphW
  useEffect(() => { graphWRef.current = graphW; }, [graphW]);
  // 그래프 열 폭 레포별 영속(#718) — root(레포) 바뀌면 그 레포 저장분 로드, graphColW 변경 시 저장. colRepoRef로 전환 오염 방지.
  const colRepoRef = useRef<string | null>(null);
  useEffect(() => {
    colRepoRef.current = root;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- root 변경 시 그 레포 폭 복원
    try { const s = Number(localStorage.getItem(`nunopi:ws:${root}:git-graph-col-w`)); setGraphColW(Number.isFinite(s) && s > 0 ? s : null); } catch { setGraphColW(null); }
  }, [root]);
  useEffect(() => { if (colRepoRef.current !== root) return; const k = `nunopi:ws:${root}:git-graph-col-w`; try { if (graphColW != null) localStorage.setItem(k, String(graphColW)); else localStorage.removeItem(k); } catch { /* ignore */ } }, [graphColW]); // eslint-disable-line react-hooks/exhaustive-deps -- root 제외: 전환 커밋에 옛 폭을 새 레포 키에 쓰는 오염 방지
  const startColDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const wrap = e.currentTarget.parentElement; if (!wrap) return;
    const left = wrap.getBoundingClientRect().left;
    const move = (ev: PointerEvent) => setGraphColW(Math.min(Math.max(ev.clientX - left, MIN_COL), graphWRef.current));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  };

  // 브랜치 색(#707) — "브랜치 정체성" 기준. 첫 tip(HEAD 계열)=트렁크 색, 첫 부모로 이어지는 커밋은 같은 색 승계 → 한 브랜치=한 색.
  // 새 tip(위에서 아무도 안 기다리던 커밋)이 나올 때마다 accent 순환. 레인 재사용해도 브랜치마다 다른 색.
  const colorByHash = useMemo(() => {
    const m: Record<string, string> = {};
    const inherit = new Map<string, string>(); // 이 해시가 등장하면 이어받을 색(첫 부모 승계)
    let bi = 0;
    model?.rows.forEach((r) => {
      const h = r.commit.hash;
      let color = inherit.get(h);
      if (color == null) { color = bi === 0 ? TRUNK_COLOR : BRANCH_COLORS[(bi - 1) % BRANCH_COLORS.length]; bi++; }
      m[h] = color;
      const p0 = r.commit.parents[0];
      if (p0 && !inherit.has(p0)) inherit.set(p0, color); // 첫 부모가 이 브랜치를 이어감 = 같은 색
    });
    return m;
  }, [model]);
  const colorOf = (hash: string) => colorByHash[hash] ?? TRUNK_COLOR; // 윈도우 밖 부모 등은 트렁크 색 폴백

  // 커밋 해시 → 행 인덱스, 그리고 각 행의 누적 top Y(펼친 파일 높이 반영) — 점-대-점 곡선의 세로 거리 계산용(#707).
  const { rowIndexByHash, rowTop } = useMemo(() => {
    const idxMap = new Map<string, number>();
    const tops: number[] = [];
    let y = 0;
    (model?.rows ?? []).forEach((r, i) => {
      idxMap.set(r.commit.hash, i);
      tops.push(y);
      const files = filesByHash[r.commit.hash];
      const filesH = expanded.has(r.commit.hash) ? (files ? files.length * FILE_H : FILE_H) : 0; // 로딩 중엔 1줄
      y += ROW_H + filesH;
    });
    return { rowIndexByHash: idxMap, rowTop: tops };
  }, [model, expanded, filesByHash]);
  const focusN = focus?.n;
  // #1066 그래프가 아직 새 커밋을 모르면(새로고침 전) 한 번 다시 불러와서 찾음 — 그래도 없으면 그때 "없음"
  const refetchedFor = useRef<number | null>(null);
  const [refetchTick, setRefetchTick] = useState(0);
  useEffect(() => {
    if (!focus || !model) return;
    const idx = model.rows.findIndex((r) => r.commit.hash.startsWith(focus.hash) || focus.hash.startsWith(r.commit.hash));
    if (idx < 0 && refetchedFor.current !== focus.n) {
      refetchedFor.current = focus.n;
      void load().finally(() => setRefetchTick((x) => x + 1)); // 실패해도 다시 찾아 결과(없음) 알림
      return;
    }
    onFocusResult?.(idx >= 0);
    if (idx < 0) return; // 그래프가 보여주는 최근 범위 밖
    const hash = model.rows[idx].commit.hash;
    // #1074 diff 카드에서 왔으면 커밋은 강조하지 않고 펼쳐서 그 파일만 반짝(유저 피드백 — 둘 다 강조하면 지저분). 스크롤은 파일 목록이 온 뒤 아래 effect에서
    if (focus.file) { setExpanded((prev) => (prev.has(hash) ? prev : new Set(prev).add(hash))); void loadFiles(hash); setFlashFile({ hash, file: focus.file, n: focus.n }); return; } // eslint-disable-line react-hooks/set-state-in-effect -- 외부 요청(focus) 시 펼침·강조
    setFlash(hash);
    graphScrollRef.current?.scrollTo({ top: Math.max(0, rowTop[idx] - ROW_H * 2), behavior: "smooth" });
    const t = setTimeout(() => setFlash((f) => (f === hash ? null : f)), 2500);
    return () => clearTimeout(t);
    // 요청 번호(n)가 바뀔 때만 — model·rowTop 갱신(폴링)마다 다시 튀지 않게
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusN, model ? 1 : 0, refetchTick]);

  // #1074 짚은 파일 — 펼친 커밋의 파일 목록이 오면 그 파일 줄로 스크롤
  useEffect(() => {
    if (!flashFile || !model || scrolledFor.current === flashFile.n) return;
    const { hash, file, n } = flashFile;
    const idx = model.rows.findIndex((r) => r.commit.hash === hash); const fi = filesByHash[hash]?.findIndex((f) => f.path === file) ?? -1;
    if (idx < 0 || !filesByHash[hash]) return; // 파일 목록 오기 전 — 오면 다시 돎
    scrolledFor.current = n; // 요청당 한 번(#1074 리뷰 — 새로고침으로 rowTop이 바뀔 때마다 다시 튀던 것)
    graphScrollRef.current?.scrollTo({ top: Math.max(0, rowTop[idx] + ROW_H + Math.max(0, fi) * FILE_H - ROW_H * 3), behavior: "smooth" });
    setTimeout(() => setFlashFile((f) => (f?.n === n ? null : f)), 2500); // 스크롤한 순간부터 2.5초(목록이 늦게 와도 보이게)
  }, [flashFile, filesByHash, model, rowTop]);

  // 추적 변경 vs 미추적(untracked) 분리 — 미추적은 접이식 하위그룹(#699).
  const tracked = useMemo(() => changes.filter((c) => changeKind(c) !== "untracked"), [changes]);
  const untracked = useMemo(() => changes.filter((c) => changeKind(c) === "untracked"), [changes]);
  // #962 Staged(index 변경) / Changes(work만, 담김 없음) 분리. 부분 staged는 Staged로.
  const staged = useMemo(() => tracked.filter((c) => c.index !== " " && c.index !== "?"), [tracked]);
  const unstagedTracked = useMemo(() => tracked.filter((c) => c.index === " "), [tracked]);

  // 변경 파일 한 행(tracked·untracked 공용, #699).
  const changeRow = (c: Change) => {
    const b = changeBadge(c);
    const name = c.path.replace(/\/$/, "").split("/").pop() || c.path;
    const canStage = c.work !== " ";                    // #947 unstaged/untracked → stage
    const canUnstage = c.index !== " " && c.index !== "?"; // #947 staged → unstage
    return (
      <div key={c.path} className="group flex w-full items-center gap-1 pl-6 pr-2 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800">
        <button type="button" onClick={() => onOpenChange?.(c.path, changeKind(c))} className="flex min-w-0 flex-1 items-baseline gap-1.5 py-0.5 text-left">
          <span className={`shrink-0 font-mono text-[9px] font-bold ${b.cls}`}>{b.ch}</span>
          <span className="truncate text-zinc-700 dark:text-zinc-200">{name}</span>
          <span className="truncate text-[9px] text-zinc-400 dark:text-zinc-500">{c.path}</span>
          <span className="ml-auto shrink-0 font-mono text-[9px]">
            {c.added > 0 && <span className="text-emerald-600 dark:text-emerald-500">+{c.added}</span>}
            {c.added > 0 && c.deleted > 0 && " "}
            {c.deleted > 0 && <span className="text-rose-600 dark:text-rose-500">−{c.deleted}</span>}
          </span>
        </button>
        {canUnstage && (
          <button type="button" onClick={() => void stageFiles([c.path], "unstage")} aria-label={t("workspace.gitUnstage")} title={t("workspace.gitUnstage")}
            className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-200">
            <IconMinus size={11} stroke={2.5} aria-hidden />
          </button>
        )}
        {canStage && (
          <button type="button" onClick={() => void stageFiles([c.path], "stage")} aria-label={t("workspace.gitStage")} title={t("workspace.gitStage")}
            className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-200">
            <IconPlus size={11} stroke={2.5} aria-hidden />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
        <IconGitBranch size={13} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
        {isGit && creatingBranch ? (
          <input autoFocus type="text" value={branchName} onChange={(e) => setBranchName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createBranch(); } else if (e.key === "Escape") { setCreatingBranch(false); setBranchName(""); } }}
            onBlur={() => { setCreatingBranch(false); setBranchName(""); }}
            placeholder={t("workspace.gitBranchNamePlaceholder")}
            className="min-w-0 flex-1 rounded border border-mustard-500/60 bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-900 outline-none dark:border-mustard-400/50 dark:bg-zinc-900 dark:text-zinc-50" />
        ) : isGit && branch ? (
          <>
            {/* #1025 칩 = 전환 드롭다운 버튼(모양 그대로 + ▾) */}
            <BranchMenu root={root} branch={branch} detached={detached} onSwitched={() => void load()} />
            <span className="group/nb relative flex items-center">
              <button type="button" onClick={() => setCreatingBranch(true)} aria-label={t("workspace.gitNewBranch")} className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                <IconPlus size={12} stroke={2} aria-hidden />
              </button>
              <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white opacity-0 shadow transition group-hover/nb:opacity-100 dark:bg-zinc-700">{t("workspace.gitNewBranch")}</span>
            </span>
          </>
        ) : (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">git</span>
        )}
        {isGit && !creatingBranch ? (
          <>
            <span className="group/ft relative ml-auto flex items-center">
              <button type="button" onClick={() => void sync("fetch")} disabled={!!syncing} aria-label={t("workspace.gitFetch")} className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800">
                <IconCloudDownload size={12} stroke={2} className={syncing === "fetch" ? "animate-pulse" : ""} aria-hidden />
              </button>
              <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white opacity-0 shadow transition group-hover/ft:opacity-100 dark:bg-zinc-700">{t("workspace.gitFetch")}</span>
            </span>
            <span className="group/pl relative flex items-center">
              <button type="button" onClick={() => void sync("pull")} disabled={!!syncing} aria-label={t("workspace.gitPull")} className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800">
                <IconArrowDown size={12} stroke={2} className={syncing === "pull" ? "animate-pulse" : ""} aria-hidden />
              </button>
              <span className="pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white opacity-0 shadow transition group-hover/pl:opacity-100 dark:bg-zinc-700">{t("workspace.gitPull")}</span>
            </span>
          </>
        ) : null}
        <button type="button" onClick={() => void load()} disabled={loading} className={`${isGit ? "" : "ml-auto "}rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800`} title={t("workspace.gitRefresh")}>
          <IconRefresh size={12} stroke={2} className={loading ? "animate-spin" : ""} aria-hidden />
        </button>
      </div>

      {loading && !model ? (
        <div className="flex flex-1 items-center justify-center text-zinc-400"><IconLoader2 size={15} stroke={2} className="animate-spin" aria-hidden /></div>
      ) : !isGit ? (
        <div className="flex flex-1 items-center justify-center px-3 text-center text-[11px] text-zinc-400 dark:text-zinc-500">{t("workspace.gitNone")}</div>
      ) : (
        // 변경 영역(상단·최대 45%·내부 스크롤) + 커밋 그래프(하단·나머지·자체 스크롤) 분리 → 드래그 없이 둘 다 보임(#699).
        <div className="flex min-h-0 flex-1 flex-col">
          {changes.length > 0 && (
            <div className="flex max-h-[45%] shrink-0 flex-col border-b border-zinc-200 dark:border-zinc-800">
              <button type="button" onClick={() => setChangesOpen((v) => !v)} className="flex w-full shrink-0 items-center gap-1 bg-white px-2.5 py-1 text-left text-[11px] font-semibold text-zinc-600 transition hover:bg-zinc-50 dark:bg-[var(--s-raise)] dark:text-zinc-300 dark:hover:bg-zinc-800/50">
                {changesOpen ? <IconChevronDown size={12} stroke={2} className="shrink-0 text-zinc-400" aria-hidden /> : <IconChevronRight size={12} stroke={2} className="shrink-0 text-zinc-400" aria-hidden />}
                <span>{t("workspace.gitChanges")}</span>
                <span className="rounded bg-zinc-200 px-1 text-[9px] font-bold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">{tracked.length}</span>
              </button>
              {changesOpen && (
                <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto">
                  {/* #962 Staged 그룹 — 담긴 파일 + 모두 빼기 */}
                  {staged.length > 0 && (
                    <>
                      <div className="flex items-center gap-1 py-0.5 pl-4 pr-2 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <span>{t("workspace.gitStaged")}</span>
                        <span className="rounded bg-emerald-500/15 px-1 text-[9px] font-bold">{staged.length}</span>
                        <button type="button" onClick={() => void stageFiles(staged.map((c) => c.path), "unstage")} className="ml-auto rounded px-1 py-0.5 text-[9px] font-medium text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">{t("workspace.gitUnstageAll")}</button>
                      </div>
                      {staged.map(changeRow)}
                    </>
                  )}
                  {/* #962 Changes 그룹 — 안 담긴 파일 + 모두 담기 */}
                  {unstagedTracked.length > 0 && (
                    <>
                      <div className="flex items-center gap-1 py-0.5 pl-4 pr-2 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        <span>{t("workspace.gitUnstagedChanges")}</span>
                        <span className="rounded bg-amber-500/15 px-1 text-[9px] font-bold">{unstagedTracked.length}</span>
                        <button type="button" onClick={() => void stageFiles(unstagedTracked.map((c) => c.path), "stage")} className="ml-auto rounded px-1 py-0.5 text-[9px] font-medium text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">{t("workspace.gitStageAll")}</button>
                      </div>
                      {unstagedTracked.map(changeRow)}
                    </>
                  )}
                  {untracked.length > 0 && (
                    <>
                      {/* 미추적(gitignore 아님·git이 처음 보는) 파일 — 도배 방지 위해 기본 접힘(orca식). 헤더=div(버튼 중첩 회피). */}
                      <div className="flex items-center gap-1 pl-4 pr-2 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                        <button type="button" onClick={() => setUntrackedOpen((v) => !v)} className="flex flex-1 items-center gap-1 py-0.5 text-left transition hover:text-zinc-600 dark:hover:text-zinc-300">
                          {untrackedOpen ? <IconChevronDown size={11} stroke={2} className="shrink-0" aria-hidden /> : <IconChevronRight size={11} stroke={2} className="shrink-0" aria-hidden />}
                          <span>{t("workspace.gitUntracked")}</span>
                          <span className="rounded bg-zinc-200 px-1 text-[9px] font-bold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">{untracked.length}</span>
                        </button>
                        <button type="button" onClick={() => void stageFiles(untracked.map((c) => c.path), "stage")} className="shrink-0 rounded px-1 py-0.5 text-[9px] font-medium transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">{t("workspace.gitStageAll")}</button>
                      </div>
                      {untrackedOpen && untracked.map(changeRow)}
                    </>
                  )}
                </div>
              )}
              {/* 커밋 박스(#947·#962) — staged 있으면 메시지 + 커밋(개수 표시). */}
              {changesOpen && staged.length > 0 && (
                <div className="shrink-0 space-y-1.5 border-t border-zinc-200 p-2 dark:border-zinc-800">
                  <textarea value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder={t("workspace.gitCommitPlaceholder")} rows={2}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void doCommit(); } }}
                    className="w-full resize-none rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
                  <button type="button" onClick={() => void doCommit()} disabled={!commitMsg.trim() || committing}
                    className="flex w-full items-center justify-center gap-1.5 rounded bg-mustard-500 py-1 text-[11px] font-medium text-white transition hover:bg-mustard-600 disabled:opacity-50">
                    {committing ? <IconLoader2 size={11} className="animate-spin" aria-hidden /> : <IconGitCommit size={11} stroke={2} aria-hidden />}
                    {t("workspace.gitCommit")} ({staged.length})
                  </button>
                </div>
              )}
            </div>
          )}
          {/* 커밋 그래프 — 나머지 공간. 그래프 열은 colW로 고정(클립), 우측 divider로 넓힘(#718). */}
          <div className="relative min-h-0 flex-1">
          {colW < graphW && (
            <div onPointerDown={startColDrag} style={{ left: colW }} title={t("workspace.gitGraphResize")}
              className="absolute inset-y-0 z-10 -ml-0.5 w-1 cursor-col-resize bg-transparent transition hover:bg-[#3B34E2]/40 dark:hover:bg-[#8b86f5]/40" />
          )}
          {/* container-type: 배지 max-width(cqw)가 스크롤되는 행 폭이 아니라 "보이는 패널 폭" 기준이 되게(#752). */}
          <div ref={graphScrollRef} className="nunopi-scroll h-full overflow-auto" style={{ containerType: "inline-size" }}>
          {model?.rows.map((row, idx) => {
            const dotY = ROW_H / 2;
            // 각 부모로 향하는 선을 "점→점" 곡선으로(#707) — 반행 stub 없이 점에서 점까지 한 번에 부드럽게(orca식).
            // 세로거리는 누적 top(rowTop)으로 재 펼친 파일 높이까지 반영. 같은 레인이면 직선, 아니면 부드러운 S곡선.
            const edges = row.commit.parents.map((p) => {
              const x1 = cx(row.lane);
              const ip = rowIndexByHash.get(p);
              if (ip == null) return { x1, y1: dotY, x2: x1, y2: ROW_H, color: colorOf(row.commit.hash) }; // 윈도우 밖 부모 = 아래로 이어짐만 표시
              const pLane = model!.rows[ip].lane;
              const y2 = dotY + (rowTop[ip] - rowTop[idx]);
              // 분기(부모가 더 바깥 레인)면 그 부모(새 브랜치) 색, 아니면 이 커밋(브랜치) 색.
              return { x1, y1: dotY, x2: cx(pLane), y2, color: pLane > row.lane ? colorOf(p) : colorOf(row.commit.hash) };
            });
            const isOpen = expanded.has(row.commit.hash);
            const files = filesByHash[row.commit.hash];
            return (
              <div key={row.commit.hash}>
                <button type="button" onClick={() => void toggle(row.commit.hash)}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget; // DOM 노드 동기 캡처 — 좌표는 "표시 시점"에 재계산(dwell 중 스크롤 반영, 🔴)
                    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } // 재진입 시 예약된 숨김 취소
                    if (hoverTimer.current) clearTimeout(hoverTimer.current);
                    hoverTimer.current = setTimeout(() => {
                      const r = el.getBoundingClientRect(); // dwell 후 실제 위치(스크롤됐어도 정확)
                      const POP_W = 380, MARGIN = 8, GAP = 4;
                      const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - POP_W - MARGIN));
                      // 위/아래 가용 공간 큰 쪽에 배치, 그 공간만큼 maxHeight → 뷰포트 밖으로 안 넘침(#834).
                      const spaceBelow = window.innerHeight - r.bottom - MARGIN, spaceAbove = r.top - MARGIN;
                      const below = spaceBelow >= spaceAbove;
                      const maxHeight = Math.max(80, (below ? spaceBelow : spaceAbove) - GAP);
                      // 아래=행 하단에 top 고정, 위=행 상단에 bottom 고정(위로 자라되 maxHeight로 상단 짤림 방지).
                      setHover(below
                        ? { subject: row.commit.subject, body: row.commit.body, left, top: r.bottom + GAP, maxHeight }
                        : { subject: row.commit.subject, body: row.commit.body, left, bottom: window.innerHeight - (r.top - GAP), maxHeight });
                    }, HOVER_DELAY_MS); // 머물러야 뜸
                  }}
                  onMouseLeave={leaveRow}
                  className={`flex w-max min-w-full items-center text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${flash === row.commit.hash ? "bg-mustard-500/20 ring-1 ring-inset ring-mustard-500/60 dark:bg-mustard-400/15" : ""}`} style={{ height: ROW_H }}>
                  {/* 그래프 셀 — 가로는 colW로 클립(overflow-x:clip), 세로는 visible(점→점 곡선이 부모 행까지 뻗음, #707). */}
                  <div className="shrink-0" style={{ width: colW, height: ROW_H, overflowX: "clip", overflowY: "visible" }}>
                    <svg width={graphW} height={ROW_H} style={{ minWidth: graphW, overflow: "visible" }} aria-hidden>
                      {edges.map((l, k) => <path key={k} d={linkPath(l.x1, l.y1, l.x2, l.y2)} stroke={l.color} strokeWidth={2} fill="none" strokeLinecap="round" />)}
                      {row.lane === 0
                        ? <circle cx={cx(row.lane)} cy={dotY} r={4} className="fill-white dark:fill-[var(--s-pane)]" stroke={colorOf(row.commit.hash)} strokeWidth={2} />
                        : <circle cx={cx(row.lane)} cy={dotY} r={3.5} fill={colorOf(row.commit.hash)} />}
                    </svg>
                  </div>
                  <IconChevronRight size={11} stroke={2} className={`shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                  {/* 커밋메세지 → 이름 → 해시. nowrap이라 좁으면 안 잘리고 가로 스크롤로 봄(전체는 호버 툴팁, #685·#737). */}
                  <span className="flex items-baseline gap-1.5 whitespace-nowrap pr-3 text-[11px]">
                    <span className="whitespace-nowrap text-zinc-700 dark:text-zinc-200">{row.commit.subject}</span>
                    {(() => { const login = githubLogin(row.commit.email); return <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">{login ? `@${login}` : row.commit.author}</span>; })()}
                    <span className="shrink-0 font-mono text-[10px] text-zinc-300 dark:text-zinc-600">{row.commit.hash.slice(0, 7)}</span>
                  </span>
                  {/* 브랜치/태그 배지(refs) — 우측 끝 고정(#741). sticky right-0라 가로 스크롤해도 뷰포트 오른쪽에 떠 있음.
                      왼쪽 gradient 배경으로 스크롤되는 메세지를 덮음. 긴 이름은 배지에서 max-w+truncate. */}
                  {row.commit.refs.length > 0 && (
                    <span className="sticky right-0 z-10 ml-auto flex shrink-0 items-center gap-1 self-center bg-gradient-to-l from-white via-white pl-4 dark:from-[var(--ink)] dark:via-[var(--ink)]">
                      {row.commit.refs.map((rf) => {
                        const isCur = rf === branch; // 현재 체크아웃 브랜치 = HEAD 위치
                        const b = refBadge(rf, branch);
                        // 브랜치 배지(태그 제외) 클릭 → 그 브랜치 챗 세션(#653). 커밋 토글 전파 차단.
                        const clickable = !b.tag;
                        return (
                          <span key={rf} role={clickable ? "button" : undefined} tabIndex={clickable ? -1 : undefined}
                            onClick={clickable ? (e) => { e.stopPropagation(); onFocusBranch(rf); } : undefined}
                            style={{ maxWidth: "min(45cqw, 14rem)" }} // 보이는 패널 폭의 45%(상한 14rem) — 넓히면 회복, 좁히면 더 truncate(#752)
                            className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[9px] font-medium ${b.cls} ${clickable ? "cursor-pointer hover:ring-1 hover:ring-current" : ""}`}
                            title={clickable ? t("workspace.gitAskBranch", { branch: rf }) : rf}>
                            {/* 현재 브랜치(isCur)는 배경색으로 구분되므로 "HEAD" 라벨 생략(#741 후속) — 너무 길어짐. */}
                            {isCur ? <IconGitCommit size={8} stroke={2.5} className="shrink-0" aria-hidden /> : b.tag ? <IconTag size={8} stroke={2} className="shrink-0" aria-hidden /> : <IconGitBranch size={8} stroke={2} className="shrink-0" aria-hidden />}
                            <span className="min-w-0 truncate">{rf}</span>
                          </span>
                        );
                      })}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div>
                    {files == null ? (
                      <div className="flex items-center text-zinc-400" style={{ height: FILE_H }}><span style={{ width: colW }} className="shrink-0" /><IconLoader2 size={11} stroke={2} className="ml-3 animate-spin" aria-hidden /></div>
                    ) : files.length === 0 ? (
                      <div className="flex items-center text-[10px] text-zinc-400" style={{ height: FILE_H }}><span style={{ width: colW }} className="shrink-0" /><span className="pl-3">(변경 없음)</span></div>
                    ) : files.map((f) => {
                      const [badge, cls] = STATUS[f.status as keyof typeof STATUS] ?? ["?", "text-zinc-400"];
                      return (
                        <button key={f.path} type="button" onClick={() => onOpenDiff(row.commit.hash, f.path)} className={`flex w-full items-center text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${flashFile?.hash === row.commit.hash && flashFile.file === f.path ? "bg-mustard-500/20 ring-1 ring-inset ring-mustard-500/60 dark:bg-mustard-400/15" : ""}`} style={{ height: FILE_H }}>
                          {/* 그래프 열 스페이서(colW) — 선은 위 커밋의 점→점 곡선이 이 구간을 가로질러 지나감(#707). */}
                          <span style={{ width: colW }} className="shrink-0" aria-hidden />
                          <span className="flex min-w-0 flex-1 items-baseline gap-1.5 pl-3 pr-2 text-[11px]">
                            <span className={`shrink-0 font-mono text-[9px] font-bold ${cls}`}>{badge}</span>
                            <span className="truncate text-zinc-600 dark:text-zinc-300">{f.path.split("/").pop()}</span>
                            <span className="truncate text-[9px] text-zinc-400 dark:text-zinc-500">{f.path}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          </div>
          </div>
        </div>
      )}
      {hover && (
        <div role="tooltip"
          onMouseEnter={() => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } }} // 툴팁 위에선 숨김 취소(스크롤 가능)
          onMouseLeave={() => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } setHover(null); }}
          style={{ position: "fixed", left: hover.left, top: hover.top, bottom: hover.bottom, maxWidth: 380, maxHeight: hover.maxHeight, zIndex: 50 }}
          className="overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-200 bg-white p-2.5 text-[11px] leading-relaxed shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
          <div className="font-semibold text-zinc-800 dark:text-zinc-100">{hover.subject}</div>
          {hover.body && <div className="mt-1.5 whitespace-pre-wrap text-zinc-500 dark:text-zinc-400">{hover.body}</div>}
        </div>
      )}
    </div>
  );
}

// 브랜치 전환 드롭다운(#1025) — 현재 브랜치 칩을 누르면 로컬(최근 순, 현재 ✓) + 원격 전용 목록. 검색으로 좁힘.
// 더티 워킹트리는 자동 stash 안 함 — git이 막으면 그 메시지를 토스트로(유저 변경 보호).
function BranchMenu({ root, branch, detached, onSwitched }: { root: string; branch: string; detached: { sha: string; label: string } | null; onSwitched: () => void }) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ local: string[]; remote: string[]; previous?: { label: string; detached: boolean } } | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const reqRef = useRef(0); // 목록 요청 번호 — 늦게 온 옛 응답(다른 레포·닫힌 뒤) 무시(#1026 리뷰)

  // 레포가 바뀌면 닫고 진행 중 요청 무효화.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- root 변경 시 드롭다운 리셋(이 파일의 다른 root 리셋 effect와 같은 패턴)
  useEffect(() => { reqRef.current++; setOpen(false); }, [root]);

  const toggle = useCallback(async () => {
    if (open) { reqRef.current++; setOpen(false); return; }
    const id = ++reqRef.current;
    setOpen(true); setQ(""); setList(null);
    let next: { local: string[]; remote: string[]; previous?: { label: string; detached: boolean } } = { local: [], remote: [] };
    try {
      const r = await fetch("/api/repo/git-branches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const d = await r.json();
      if (d.ok) next = { local: d.local ?? [], remote: d.remote ?? [], ...(d.previous ? { previous: d.previous } : {}) };
    } catch { /* 빈 목록 */ }
    if (id === reqRef.current) setList(next);
  }, [open, root]);

  // 바깥 클릭·Esc로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // prev: "이전 위치로"(git checkout -) — name은 토스트 표시용 라벨.
  const switchTo = useCallback(async (name: string, remote: boolean, prev = false) => {
    if (busy || (!prev && !remote && name === branch)) { setOpen(false); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/repo/git-switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prev ? { path: root, prev: true } : { path: root, branch: name, remote }) });
      const d = await r.json();
      if (d.ok) { toast(t("workspace.gitSwitched", { branch: remote ? name.slice(name.indexOf("/") + 1) : name }), "success"); setOpen(false); onSwitched(); }
      else toast(t("workspace.gitSwitchFailed") + (d.error ? ` (${d.error})` : ""), "error");
    } catch { toast(t("workspace.gitSwitchFailed"), "error"); }
    finally { setBusy(false); }
  }, [busy, branch, root, toast, t, onSwitched]);

  const ql = q.trim().toLowerCase();
  const local = (list?.local ?? []).filter((b) => b.toLowerCase().includes(ql));
  const remote = (list?.remote ?? []).filter((b) => b.toLowerCase().includes(ql));
  const row = "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800";
  return (
    <span ref={boxRef} className="relative min-w-0">
      {/* 분리 HEAD면 "HEAD" 대신 가리키는 ref(origin/develop 등)·해시 + "(분리)" + 점선 테두리 — 브랜치 위가 아님을 한눈에(커밋이 어느 브랜치에도 안 쌓임) */}
      <button type="button" onClick={() => void toggle()} aria-haspopup="listbox" aria-expanded={open}
        title={detached ? t("workspace.gitDetachedHint", { sha: detached.sha }) : t("workspace.gitSwitchBranch")}
        className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-mustard-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-mustard-400 dark:hover:bg-zinc-800 ${detached ? "outline outline-1 -outline-offset-1 outline-dashed outline-mustard-500/70 dark:outline-mustard-400/60" : "ring-1 ring-inset ring-mustard-500/60 dark:ring-mustard-400/50"}`}>
        <span className="truncate">{detached ? detached.label : branch}</span>
        {detached && <span className="shrink-0 font-normal text-zinc-400 dark:text-zinc-500">{t("workspace.gitDetached")}</span>}
        <IconChevronDown size={11} stroke={2.5} className="shrink-0 opacity-70" aria-hidden />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 top-full z-50 mt-1 flex max-h-80 w-64 flex-col rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <input autoFocus type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("workspace.gitBranchSearch")}
            className="mb-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-1 text-[11px] text-zinc-900 outline-none focus:border-mustard-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50" />
          <div className="nunopi-scroll min-h-0 flex-1 overflow-y-auto">
            {!list ? (
              <div className="flex justify-center py-3 text-zinc-400"><IconLoader2 size={14} className="animate-spin" aria-hidden /></div>
            ) : (
              <>
                {detached && <div className="mb-1 rounded bg-zinc-50 px-1.5 py-1 text-[10px] leading-snug text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">{t("workspace.gitDetachedHint", { sha: detached.sha })}</div>}
                {list.previous && !ql && (
                  <button type="button" disabled={busy} onClick={() => void switchTo(list.previous!.label, false, true)} className={`${row} mb-1 border-b border-zinc-200 pb-1.5 dark:border-zinc-700`}>
                    <span className="w-3 shrink-0 text-zinc-400">↩</span>
                    <span className="truncate">{t("workspace.gitPrevious")}: <span className="font-semibold">{list.previous.label}</span>{list.previous.detached ? ` ${t("workspace.gitDetached")}` : ""}</span>
                  </button>
                )}
                {local.map((b) => (
                  <button key={b} type="button" role="option" aria-selected={b === branch} disabled={busy} onClick={() => void switchTo(b, false)} className={row}>
                    <span className="w-3 shrink-0">{b === branch && <IconCheck size={11} stroke={2.5} className="text-mustard-600 dark:text-mustard-400" aria-hidden />}</span>
                    <span className="truncate">{b}</span>
                  </button>
                ))}
                {remote.length > 0 && <div className="mt-1 border-t border-zinc-200 px-1.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">{t("workspace.gitRemoteBranches")}</div>}
                {remote.map((b) => (
                  <button key={b} type="button" role="option" aria-selected={false} disabled={busy} onClick={() => void switchTo(b, true)} className={row}>
                    <span className="w-3 shrink-0" />
                    <span className="truncate text-zinc-500 dark:text-zinc-400">{b}</span>
                  </button>
                ))}
                {local.length + remote.length === 0 && <div className="px-1.5 py-2 text-[11px] text-zinc-400">{t("workspace.gitNoBranches")}</div>}
              </>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
