"use client";
// 워크스페이스 diff 뷰(#649) — 커밋+파일의 git diff. shiki 신택스 하이라이팅 + 빨강(−)/초록(+) 배경.
import { Fragment, useEffect, useRef, useState } from "react";
import { codeToTokens, type ThemedToken, type BundledLanguage } from "shiki";
import { IconLoader2, IconAlertTriangle, IconGitCompare, IconSparkles, IconRefresh, IconBrandGithub, IconRobot, IconCheck, IconX, IconPlus, IconPlusMinus, IconClock } from "@tabler/icons-react";
import { loadPrReview, prReviewKey, PR_REVIEW_EVENT, type Finding } from "@/lib/prReview";
import { setFindingStatus, postFinding } from "@/lib/prReviewRun";
import { useLocale, useT, useToast } from "@mustard/core";
import { Markdown } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { Thread, type LineComment } from "@/components/workspace/github/PrReviewComments";
import MarkdownToolbar from "@/components/workspace/github/MarkdownToolbar";
import { addDraft, loadDrafts, removeDraft, saveDrafts, suggestionBlock, prDraftKey, PR_DRAFT_EVENT, type DraftComment } from "@/lib/prDraft";
import { type DLine, parseDiff, groupHunks, type Hunk, noteStoreKey, loadNotes, saveNote, explainDiffText, HUNK_NOTES_EVENT } from "@/lib/hunkNotes";

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript", json: "json",
  py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", rb: "ruby", php: "php", c: "c", h: "c",
  cpp: "cpp", cs: "csharp", swift: "swift", css: "css", scss: "scss", html: "html", md: "markdown", yml: "yaml", yaml: "yaml", sh: "bash", sql: "sql", toml: "toml",
};
const langOf = (file: string) => EXT_LANG[file.split(".").pop()?.toLowerCase() ?? ""] ?? "text";

// pr = PR 리뷰 diff(#1123) — GitHub PR의 그 파일 diff. AI 구간 설명은 숨김(캐치업과 분리).
export default function DiffPane({ root, hash, file, worktree, pr, providerId, providerSettings }: { root: string; hash?: string; file: string; worktree?: "staged" | "unstaged" | "untracked"; pr?: number; providerId: AgentProviderKind; providerSettings: ProviderSettings }) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  // 변경 구간별 에이전트 노트. key = diffText 해시(구간 내용 기반 안정 키 → 같은 diff 재오픈 시 매칭).
  const [notes, setNotes] = useState<Record<string, { status: "loading" | "done" | "error"; text?: string }>>({});
  const [lines, setLines] = useState<DLine[] | null>(null);
  const [full, setFull] = useState(false); // #1133 PR diff를 파일 전체로 받았나(아니면 바뀐 구간만)
  // #1127 PR diff — 에이전트 리뷰 지적(버린 것 제외)을 줄 옆 🤖로. 펼친 줄은 지적 내용 표시.
  const [findings, setFindings] = useState<Finding[]>(() => (pr ? loadPrReview(root, pr)?.findings ?? [] : []));
  const [openLines, setOpenLines] = useState<Set<number>>(new Set());
  const [threads, setThreads] = useState<LineComment[]>([]);
  const [threadTick, setThreadTick] = useState(0);
  // #1145 줄 댓글 쓰기 — 줄번호 칸 + (Shift = 범위), 고른 끝 줄 밑에 입력칸. 보류(리뷰에 추가)는 PR별 저장소.
  const [pick, setPick] = useState<{ file: string; side: "LEFT" | "RIGHT"; line: number; start?: number; anchor: number } | null>(null);
  const [head, setHead] = useState<string | undefined>(); // 이 diff의 커밋(파일 전체로 받았을 때만 앎)
  const [drafts, setDrafts] = useState<DraftComment[]>(() => (pr ? loadDrafts(root, pr) : []));
  useEffect(() => {
    if (!pr) return;
    const key = prDraftKey(root, pr);
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === key) { setDrafts(loadDrafts(root, pr)); setThreadTick((n) => n + 1); } }; // 리뷰로 보냈으면 줄 밑 스레드로
    window.addEventListener(PR_DRAFT_EVENT, on);
    return () => window.removeEventListener(PR_DRAFT_EVENT, on);
  }, [root, pr]);
  const [posting, setPosting] = useState<Set<string>>(new Set()); // GitHub에 올리는 중인 지적
  const adoptHere = async (f: Finding) => {
    if (!pr || posting.has(f.id)) return;
    setPosting((s) => new Set(s).add(f.id));
    try { await postFinding(root, pr, f, locale); } // 저장 이벤트로 findings 갱신
    catch (e) { const m = String((e as Error)?.message || e); toast(m === "posted-unsaved" ? t("prReview.postedUnsaved") : m === "gone" ? t("prReview.gone") : t("prReview.postFailed", { msg: m }), "error"); }
    finally { setPosting((s) => { const n = new Set(s); n.delete(f.id); return n; }); }
  };
  useEffect(() => {
    if (!pr) return;
    const key = prReviewKey(root, pr);
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === key) { setFindings(loadPrReview(root, pr)?.findings ?? []); setThreadTick((n) => n + 1); } }; // 지적 채택 = 새 줄 댓글
    window.addEventListener(PR_REVIEW_EVENT, on);
    return () => window.removeEventListener(PR_REVIEW_EVENT, on);
  }, [root, pr]);
  // #1145 GitHub에 달린 줄 댓글 스레드 — 그 줄(LEFT=옛 번호, RIGHT=새 번호) 밑에. 줄이 사라진(outdated) 건 대화 탭에만.
  useEffect(() => {
    if (!pr) return;
    let alive = true;
    void window.nunopiDesktop?.github?.prLineComments?.(root, pr).then((r) => { if (alive && r.ok && r.data) setThreads(r.data); }).catch(() => {});
    return () => { alive = false; };
  }, [root, pr, threadTick]);
  const [tokens, setTokens] = useState<ThemedToken[][]>([]); // 코드줄(add/del/ctx) 순서별 하이라이트 토큰
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "empty">("loading");
  const [isDark, setIsDark] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [paneW, setPaneW] = useState(0); // 보이는 패널 폭(px) — 노트가 패널 좁혀도 안 짤리게 동적 맞춤
  const rulerRef = useRef<HTMLDivElement>(null);
  const draggingRuler = useRef(false);
  const [vp, setVp] = useState({ top: 0, height: 100 }); // 오버뷰 썸(현재 보이는 구간, %)
  const [showRuler, setShowRuler] = useState(false);     // 오버뷰 미니맵 표시(스크롤·호버 시만)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reveal = () => { setShowRuler(true); if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setShowRuler(false), 1200); };
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const syncVp = () => {
    const el = scrollRef.current; if (!el) return;
    const h = el.scrollHeight || 1;
    setVp({ top: (el.scrollTop / h) * 100, height: Math.min(100, (el.clientHeight / h) * 100) });
  };
  useEffect(() => { if (status === "ok") syncVp(); }, [status, lines]);

  // 노트 영속 — diff 신원별 localStorage(#1054 hunkNotes로 분리, 커밋 자동 설명과 같은 저장소).
  const noteStore = noteStoreKey(root, file, hash, worktree, locale);
  const hunkKey = (h: Hunk) => h.diffText; // 구간 내용 자체를 키로(해시 충돌 원천 제거, 재오픈 매칭)
  // diff 바뀌면 저장 노트 로드 + 자동 설명이 이 diff에 쓰면 바로 반영(진행 중 로딩 표시는 유지).
  useEffect(() => {
    const load = () => setNotes((p) => {
      const n: Record<string, { status: "loading" | "done" | "error"; text?: string }> = {};
      for (const k in p) if (p[k].status === "loading") n[k] = p[k];
      const m = loadNotes(noteStore); for (const k in m) n[k] = { status: "done", text: m[k] };
      return n;
    });
    setNotes({}); // eslint-disable-line react-hooks/set-state-in-effect -- diff 키 변경 시 이전 diff 노트 비움
    load();
    const on = (e: Event) => { if ((e as CustomEvent).detail === noteStore) load(); };
    window.addEventListener(HUNK_NOTES_EVENT, on);
    return () => window.removeEventListener(HUNK_NOTES_EVENT, on);
  }, [noteStore]);

  // 변경 구간 온디맨드 설명 — 로딩 → 최종 → 영속.
  async function explainHunk(h: Hunk) {
    const key = hunkKey(h);
    if (notes[key]?.status === "loading") return; // 중복 가드
    setNotes((p) => ({ ...p, [key]: { status: "loading" } }));
    try {
      const text = await explainDiffText(h.diffText, providerId, providerSettings, locale);
      saveNote(noteStore, key, text); // 저장 이벤트로 load()가 done 반영
      setNotes((p) => ({ ...p, [key]: { status: "done", text } }));
    } catch { setNotes((p) => ({ ...p, [key]: { status: "error" } })); }
  }

  const jumpToY = (clientY: number) => {
    const el = scrollRef.current, ruler = rulerRef.current; if (!el || !ruler) return;
    const rect = ruler.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    el.scrollTop = frac * (el.scrollHeight - el.clientHeight);
  };
  // 룰러 드래그로 스크롤(썸 잡고 끌기).
  useEffect(() => {
    const mm = (e: MouseEvent) => { if (draggingRuler.current) jumpToY(e.clientY); };
    const mu = () => { draggingRuler.current = false; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", mm); window.addEventListener("mouseup", mu);
    return () => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); };
  }, []);
  const rulerDown = (e: React.MouseEvent) => { draggingRuler.current = true; document.body.style.userSelect = "none"; jumpToY(e.clientY); };
  // 스크롤 컨테이너의 보이는 폭 측정(패널 리사이즈 대응) — 노트 폭을 여기 맞춰 짤림 방지.
  useEffect(() => {
    const el = scrollRef.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPaneW(el.clientWidth));
    ro.observe(el); setPaneW(el.clientWidth);
    return () => ro.disconnect();
  }, [status]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 테마 초기 감지(1회)
    setIsDark(document.documentElement.classList.contains("dark"));
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- diff 바뀌면 로딩 리셋(키 변경 시)
    setStatus("loading"); setLines(null); setTokens([]); setHead(undefined); // head도 — 새 파일 받는 동안 옛 파일 커밋으로 댓글 안 담기게(리뷰)
    (async () => {
      try {
        // 워킹트리(커밋 전) diff면 git-diff, 커밋 diff면 git-show.
        let raw: string;
        if (pr) { // PR diff — gh(Electron)로. 먼저 파일 전체(#1133), 못 받으면(바이너리·큰 파일·실패) 바뀐 구간만
          const f = await window.nunopiDesktop?.github?.prFileFullDiff?.(root, pr, file);
          if (cancelled) return;
          if (f?.ok && f.data?.diff) { raw = f.data.diff; setFull(true); setHead(f.data.head); }
          else {
            const r = await window.nunopiDesktop?.github?.prFileDiff?.(root, pr, file);
            if (cancelled) return;
            if (!r?.ok || r.data?.missing) { setStatus("error"); return; } // missing = gh diff에 없음(큰 PR) → '변경 없음' 대신 오류
            raw = r.data?.diff ?? ""; setFull(false); setHead(r.data?.head); // 구간 diff도 그 diff의 커밋(받는 사이 push면 없음, 리뷰)
          }
        } else {
          const r = worktree
            ? await fetch("/api/repo/git-diff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, file, kind: worktree }) })
            : await fetch("/api/repo/git-show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, hash, file }) });
          const d = await r.json();
          if (cancelled) return;
          if (!r.ok || !d.ok) { setStatus("error"); return; }
          raw = String(d.diff ?? "");
        }
        // 변경 없음(이미 커밋됐거나 목록이 오래됨) → 빈 창 대신 안내.
        if (!raw.trim()) { setStatus("empty"); return; }
        const parsed = parseDiff(raw);
        // 코드줄만 모아 한 번에 하이라이트 → 줄별 토큰.
        const codeText = parsed.filter((l) => l.kind === "add" || l.kind === "del" || l.kind === "ctx").map((l) => l.text).join("\n");
        let toks: ThemedToken[][] = [];
        try { toks = (await codeToTokens(codeText, { lang: langOf(file) as BundledLanguage, theme: isDark ? "github-dark" : "github-light" })).tokens; } catch { toks = []; }
        if (cancelled) return;
        setLines(parsed); setTokens(toks); setStatus("ok");
      } catch { if (!cancelled) setStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, [root, hash, file, worktree, pr, isDark]);

  if (status === "loading") return <div className="flex h-full items-center justify-center text-zinc-400"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /></div>;
  if (status === "empty") return <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-[12px] text-zinc-400 dark:text-zinc-500"><IconGitCompare size={16} stroke={1.75} aria-hidden /><span>{t("workspace.diffEmpty")}</span></div>;
  if (status === "error" || !lines) return <div className="flex h-full items-center justify-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-500"><IconAlertTriangle size={14} stroke={2} aria-hidden /> {t("diff.loadFailed")}</div>;

  let codeIdx = 0; // add/del/ctx 진행 인덱스 → tokens 매칭
  const byLine = new Map<number, Finding[]>();
  for (const f of findings) if (f.file === file && f.status !== "discarded") byLine.set(f.line, [...(byLine.get(f.line) ?? []), f]);
  const threadAt = new Map<string, LineComment[]>(); // "LEFT:12" → 그 줄(범위면 끝 줄)에 달린 스레드(첫 댓글), GitHub처럼
  for (const c of threads) if (c.path === file && c.inReplyTo == null && !c.outdated && c.line) { const k = `${c.side ?? "RIGHT"}:${c.line}`; threadAt.set(k, [...(threadAt.get(k) ?? []), c]); }
  const reloadThreads = () => setThreadTick((n) => n + 1);
  const draftAt = new Map<string, DraftComment[]>();
  for (const d of drafts) if (d.path === file) draftAt.set(`${d.side}:${d.line}`, [...(draftAt.get(`${d.side}:${d.line}`) ?? []), d]);
  const sel = pick?.file === file ? pick : null;
  // GitHub는 PR diff 구간(바뀐 줄 앞뒤 3줄) 안에만 줄 댓글을 받음 — 파일 전체(#1133)로 받았으면 먼 줄엔 + 없음(리뷰: 422로 보류 리뷰 전체가 막힘)
  const near: boolean[] = new Array(lines.length).fill(!full);
  if (full) {
    const code = lines.map((l, i) => (l.kind === "add" || l.kind === "del" || l.kind === "ctx" ? i : -1)).filter((i) => i >= 0);
    code.forEach((i, k) => { if (lines[i].kind !== "ctx") for (let d = Math.max(0, k - 3); d <= Math.min(code.length - 1, k + 3); d++) near[code[d]] = true; });
  }
  // 범위 안 줄(LEFT = 옛 번호 있는 줄, RIGHT = 새 번호 있는 줄) — 빠진 줄 없이 이어지고 모두 댓글 가능해야 범위(리뷰: 구간 사이 숨은 줄을 suggestion이 지움)
  const rangeRows = (side: "LEFT" | "RIGHT", a: number, b: number) => {
    const idx = lines.map((l, i) => ((side === "LEFT" ? l.kind !== "add" && l.oldN != null && l.oldN >= a && l.oldN <= b : l.kind !== "del" && l.newN != null && l.newN >= a && l.newN <= b) && l.kind !== "meta" && l.kind !== "hunk" ? i : -1)).filter((i) => i >= 0);
    return idx.length === b - a + 1 && idx.every((i) => near[i]) ? idx : null;
  };
  // + 누름 — Shift면 같은 쪽 앞서 고른 줄부터 범위, 아니면 한 줄
  const choose = (side: "LEFT" | "RIGHT", ln: number, shift: boolean) => setPick((p) => {
    if (shift && p && p.file === file && p.side === side && p.anchor !== ln && rangeRows(side, Math.min(p.anchor, ln), Math.max(p.anchor, ln))) return { file, side, line: Math.max(p.anchor, ln), start: Math.min(p.anchor, ln), anchor: p.anchor };
    return { file, side, line: ln, anchor: ln };
  });
  // 오버뷰 룰러용: 연속 "같은 종류(추가/삭제)" 줄을 한 블록으로. 수정(삭제+추가)은 빨강 블록·초록 블록 따로 →
  // 삭제도 빨강으로 보임. (줄마다 틱 찍으면 새파일서 바코드 벽이라 병합.)
  const total = Math.max(1, lines.length);
  const blocks: { top: number; height: number; add: boolean }[] = [];
  { let s = -1; let kind: "add" | "del" | null = null;
    const flush = (end: number) => { if (s >= 0 && kind) blocks.push({ top: (s / total) * 100, height: Math.max(0.5, ((end - s) / total) * 100), add: kind === "add" }); };
    lines.forEach((l, i) => {
      const k = l.kind === "add" ? "add" : l.kind === "del" ? "del" : null;
      if (k) { if (s < 0) { s = i; kind = k; } else if (k !== kind) { flush(i); s = i; kind = k; } }
      else if (s >= 0) { flush(i); s = -1; kind = null; }
    });
    if (s >= 0) flush(lines.length);
  }
  // 변경 구간 → 시작 줄에 버튼(위), 끝 줄에 노트(아래) 앵커.
  const allHunks = groupHunks(lines);
  const hunkStart = new Map(allHunks.map((h) => [h.startLine, h]));
  const hunkEnd = new Map(allHunks.map((h) => [h.endLine, h]));
  const body = (
    <div className={`relative bg-white dark:bg-[var(--s-pane)] ${pr ? "min-h-0 flex-1" : "h-full"}`}
      onMouseEnter={() => { if (hideTimer.current) clearTimeout(hideTimer.current); setShowRuler(true); }}
      onMouseLeave={() => { if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setShowRuler(false), 400); }}>
      <div ref={scrollRef} onScroll={() => { syncVp(); reveal(); }} className="h-full overflow-auto pr-3 font-mono text-[11px] leading-[1.55] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {lines.map((l, i) => {
        // meta(diff/index/+++/---) + hunk(@@) 헤더 숨김 — -U100000으로 전체 컨텍스트라 생략 구분선 불필요.
        if (l.kind === "meta" || l.kind === "hunk") return null;
        const tok = tokens[codeIdx++]; // 이 코드줄의 토큰
        const bg = l.kind === "add" ? "bg-emerald-500/20" : l.kind === "del" ? "bg-rose-500/20" : "";
        const mark = l.kind === "add" ? "+" : l.kind === "del" ? "−" : " ";
        const markCls = l.kind === "add" ? "text-emerald-600 dark:text-emerald-500" : l.kind === "del" ? "text-rose-600 dark:text-rose-500" : "text-transparent";
        const startH = pr ? undefined : hunkStart.get(i); // PR diff는 AI 설명 없음 // 구간 시작 → 위에 설명 버튼
        const endH = pr ? undefined : hunkEnd.get(i); // 구간 끝 → 아래에 노트(PR diff는 없음)
        const lineF = pr && l.newN != null ? byLine.get(l.newN) : undefined; // #1127 이 줄의 에이전트 지적
        const lineN = l.newN as number;
        const side: "LEFT" | "RIGHT" = l.kind === "del" ? "LEFT" : "RIGHT"; // 바뀌지 않은 줄은 새 코드 쪽에
        const ln = (side === "LEFT" ? l.oldN : l.newN) ?? 0;
        const selLn = sel?.side === "LEFT" ? l.oldN : l.newN; // 범위 테두리 — LEFT 범위엔 안 바뀐 줄도(옛 번호로)
        const inSel = !!sel && selLn != null && l.kind !== (sel.side === "LEFT" ? "add" : "del") && selLn >= (sel.start ?? sel.line) && selLn <= sel.line;
        const lineD = pr ? draftAt.get(`${side}:${ln}`) ?? [] : [];
        const composeHere = !!sel && sel.side === side && sel.line === ln;
        const lineT = pr ? [...(l.oldN != null && l.kind !== "add" ? threadAt.get(`LEFT:${l.oldN}`) ?? [] : []), ...(l.newN != null ? threadAt.get(`RIGHT:${l.newN}`) ?? [] : [])] : [];
        const row = (
          <div key={i} className={`group relative flex w-max min-w-full ${bg} ${lineF || inSel ? "ring-1 ring-inset ring-mustard-500/70" : ""}`}>
            {/* #1127 지적 있는 줄 — 옛 줄번호 칸 왼쪽에 눈에 띄는 배지(오른쪽 정렬 번호는 3자리까지 안 가림, 코드 정렬 그대로), 누르면 지적 펼침 */}
            {lineF && (
              <button type="button" title={lineF.map((f) => f.title).join("\n")} aria-label={`${t("github.tabAgentReview")}: ${lineF.map((f) => f.title).join(", ")}`} aria-expanded={openLines.has(lineN)} aria-controls={`prf-${lineN}`}
                onClick={() => setOpenLines((s) => { const x = new Set(s); if (x.has(lineN)) x.delete(lineN); else x.add(lineN); return x; })}
                className="absolute inset-y-px left-0 z-[1] flex w-[14px] items-center justify-center rounded-r bg-mustard-500 text-brown-900 shadow-sm hover:bg-mustard-400">
                <IconRobot size={12} stroke={2.2} aria-hidden />
              </button>
            )}
            <span className="w-9 shrink-0 select-none border-r border-zinc-100 px-1 text-right text-[10px] text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">{l.oldN ?? ""}</span>
            {/* #1145 줄 댓글 + — 새 줄번호 칸 왼쪽, 줄에 올리면 보임. Shift+누름 = 범위. 이 diff의 커밋을 모르면(받는 사이 push·조회 실패) 없음 — 지금 head로 달면 엉뚱한 줄(리뷰) */}
            {pr && head && ln > 0 && near[i] && (
              <button type="button" onClick={(e) => choose(side, ln, e.shiftKey)} title={t("github.lineCommentAdd")} aria-label={`${t("github.lineCommentAdd")} ${ln}`}
                className="absolute inset-y-px left-9 z-[1] flex w-[14px] items-center justify-center rounded bg-mustard-500 text-brown-900 opacity-0 shadow-sm hover:bg-mustard-400 focus:opacity-100 group-hover:opacity-100">
                <IconPlus size={11} stroke={2.6} aria-hidden />
              </button>
            )}
            <span className="w-9 shrink-0 select-none border-r border-zinc-100 px-1 text-right text-[10px] text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">{l.newN ?? ""}</span>
            <span className={`w-4 shrink-0 select-none text-center ${markCls}`}>{mark}</span>
            <span className="whitespace-pre px-1">
              {tok ? tok.map((tk, j) => <span key={j} style={{ color: tk.color }}>{tk.content}</span>) : <span className="text-zinc-700 dark:text-zinc-200">{l.text}</span>}
            </span>
          </div>
        );
        if (lineF || lineT.length || lineD.length || composeHere) {
          const opened = !!lineF && openLines.has(l.newN as number);
          return (
            <Fragment key={`f-${i}`}>
              {row}
              {opened && <div id={`prf-${lineN}`}>{lineF.map((f) => (
                <div key={f.id} style={{ width: paneW ? paneW - 20 : undefined }} className="sticky left-0 z-[5] my-1 ml-2.5 rounded-lg border border-mustard-500/30 bg-mustard-50/80 px-3 py-2 font-sans dark:bg-mustard-500/[0.07]">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-mustard-700 dark:text-mustard-400">
                    <IconRobot size={11} stroke={2} aria-hidden />{t(`prReview.sev.${f.severity}`)}
                    {f.status === "adopted" && (f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-emerald-600 hover:underline dark:text-emerald-400"><IconCheck size={10} aria-hidden />{t("prReview.adopted")}</a> : <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><IconCheck size={10} aria-hidden />{t("prReview.adopted")}</span>)}
                  </div>
                  <div className="mt-0.5 text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">{f.title}</div>
                  {f.body && <div className="prose prose-sm max-w-none text-[11.5px] leading-relaxed text-zinc-700 dark:prose-invert dark:text-zinc-200 prose-p:my-1"><Markdown>{f.body}</Markdown></div>}
                  {f.status === "open" && (
                    <div className="mt-1 flex gap-1">
                      <button type="button" disabled={posting.has(f.id)} onClick={() => void adoptHere(f)} className="inline-flex items-center gap-1 rounded bg-mustard-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-mustard-700 hover:bg-mustard-500/25 dark:text-mustard-400"><IconCheck size={11} aria-hidden />{t("prReview.adopt")}</button>
                      <button type="button" onClick={() => { if (!setFindingStatus(root, pr!, f.id, "discarded")) toast(t("prReview.saveFailed"), "error"); }} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"><IconX size={11} aria-hidden />{t("prReview.discard")}</button>
                    </div>
                  )}
                </div>
              ))}</div>}
              {lineT.map((c) => (
                <div key={`t-${c.id}`} style={{ width: paneW ? paneW - 20 : undefined }} className="sticky left-0 z-[5] my-1 ml-2.5 bg-white font-sans dark:bg-[var(--s-pane)]">
                  <Thread root={root} number={pr!} prTitle="" top={c} replies={threads.filter((x) => x.inReplyTo === c.id)} onChanged={reloadThreads} />
                </div>
              ))}
              {lineD.map((d) => (
                <div key={`d-${d.id}`} style={{ width: paneW ? paneW - 20 : undefined }} className="sticky left-0 z-[5] my-1 ml-2.5 rounded-lg border border-dashed border-mustard-500/50 bg-white px-3 py-2 font-sans dark:bg-[var(--s-pane)]">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-mustard-700 dark:text-mustard-400">
                    <IconClock size={11} stroke={2} aria-hidden />{t("github.draftPending")}{d.startLine ? ` · ${d.startLine}-${d.line}` : ""}
                    <button type="button" onClick={() => { if (!saveDrafts(root, pr!, removeDraft(loadDrafts(root, pr!), d.id))) toast(t("prReview.saveFailed"), "error"); }}
                      className="ml-auto inline-flex items-center gap-0.5 rounded px-1 font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"><IconX size={11} aria-hidden />{t("github.delete")}</button>
                  </div>
                  <div className="prose prose-sm max-w-none text-[11.5px] leading-relaxed text-zinc-700 dark:prose-invert dark:text-zinc-200 prose-p:my-1"><Markdown>{d.body}</Markdown></div>
                </div>
              ))}
              {composeHere && sel && (
                <div style={{ width: paneW ? paneW - 20 : undefined }} className="sticky left-0 z-[5] my-1 ml-2.5 font-sans">
                  <LineComposer root={root} pr={pr!} file={file} sel={sel} head={head}
                    code={sel.side === "RIGHT" ? rangeRows("RIGHT", sel.start ?? sel.line, sel.line)?.map((k) => lines[k].text) ?? null : null}
                    onClose={() => setPick(null)} onPosted={reloadThreads} />
                </div>
              )}
            </Fragment>
          );
        }
        if (!startH && !endH) return row;
        const startNote = startH ? notes[hunkKey(startH)] : undefined;
        const endNote = endH ? notes[hunkKey(endH)] : undefined;
        return (
          <Fragment key={`h-${i}`}>
            {/* 구간 시작: 위에 설명 버튼 */}
            {startH && (
              <div className="flex items-center py-1 pl-[4.75rem]">
                <button type="button" onClick={() => void explainHunk(startH)} disabled={startNote?.status === "loading"}
                  className="inline-flex items-center gap-1 rounded-md bg-mustard-500/12 px-2 py-0.5 text-[10px] font-semibold text-mustard-700 ring-1 ring-inset ring-mustard-500/35 transition hover:bg-mustard-500/20 disabled:opacity-60 dark:bg-mustard-400/12 dark:text-mustard-400 dark:ring-mustard-400/30 dark:hover:bg-mustard-400/20">
                  {startNote?.status === "loading"
                    ? <><IconLoader2 size={11} stroke={2.5} className="animate-spin" aria-hidden />{t("workspace.hunkExplaining")}</>
                    : startNote?.status === "done"
                    ? <><IconRefresh size={11} stroke={2.5} aria-hidden />{t("workspace.hunkReexplain")}</>
                    : <><IconSparkles size={11} stroke={2.5} aria-hidden />{t("workspace.hunkExplain")}</>}
                </button>
              </div>
            )}
            {row}
            {/* 구간 끝: 아래에 노트(변경 코드 밑) */}
            {endNote?.status === "done" && (
              <div style={{ width: paneW ? paneW - 20 : undefined }} className="sticky left-0 z-[5] my-1 ml-2.5 rounded-lg border border-mustard-500/30 bg-mustard-500/10 px-3 py-2 font-sans backdrop-blur-sm dark:border-mustard-400/30 dark:bg-mustard-400/12">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-mustard-700 dark:text-mustard-400"><IconSparkles size={11} stroke={2.5} aria-hidden />{t("workspace.hunkNote")}</div>
                <div className="prose prose-sm max-w-none text-[12px] leading-relaxed text-zinc-700 dark:prose-invert dark:text-zinc-200 prose-headings:my-1 prose-headings:text-[12px] prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-li:my-0"><Markdown>{endNote.text ?? ""}</Markdown></div>
              </div>
            )}
            {endNote?.status === "error" && (
              <div className="my-1 ml-[4.75rem] flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-500"><IconAlertTriangle size={12} stroke={2} aria-hidden />{t("workspace.hunkNoteError")}</div>
            )}
          </Fragment>
        );
      })}
      </div>
      {/* 오른쪽 오버뷰 미니맵 스크롤바 — 트랙 + 변경 마크(초록/빨강) + 잡을 수 있는 뷰포트 썸. 드래그/클릭 이동. */}
      <div ref={rulerRef} onMouseDown={rulerDown} className="absolute inset-y-0 right-0 w-3.5 cursor-pointer border-l border-zinc-200 bg-zinc-100/70 dark:border-zinc-800 dark:bg-zinc-800/40">
        {blocks.map((b, k) => (
          <div key={k} className={`pointer-events-none absolute inset-x-0 ${b.add ? "bg-emerald-500" : "bg-rose-500"}`} style={{ top: `${b.top}%`, height: `${Math.max(0.6, b.height)}%`, minHeight: 3 }} />
        ))}
        {/* 뷰포트 썸(지금 보고 있는 구간) — 스크롤·호버 시만(미니맵 마크는 항상). */}
        <div className={`pointer-events-none absolute inset-x-0 rounded border border-zinc-400/60 bg-zinc-400/40 transition-opacity duration-300 dark:border-zinc-500/60 dark:bg-zinc-500/40 ${showRuler ? "opacity-100" : "opacity-0"}`} style={{ top: `${vp.top}%`, height: `${Math.max(6, vp.height)}%`, minHeight: 18 }} />
      </div>
    </div>
  );
  if (!pr) return body;
  // #1123 PR 리뷰 diff는 내 작업 diff와 구분되게 머리 띠(GitHub 아이콘 + PR 번호 + 파일).
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
        <IconBrandGithub size={13} stroke={2} className="shrink-0" aria-hidden />
        <span className="shrink-0 font-medium">{t("github.prReviewBanner", { n: pr })}</span>
        <span className="truncate font-mono text-[10.5px] text-zinc-400 dark:text-zinc-500">{file}</span>
        {status === "ok" && <span className="ml-auto shrink-0 text-[10.5px] text-zinc-400 dark:text-zinc-500">{t(full ? "github.diffFullFile" : "github.diffHunksOnly")}</span>}
      </div>
      {body}
    </div>
  );
}

// #1145 줄 댓글 입력칸 — [취소] [바로 달기](GitHub에 곧장) [리뷰에 추가](보류, PR 상세에서 판정과 함께). ± = 고른 줄 suggestion.
function LineComposer({ root, pr, file, sel, head, code, onClose, onPosted }: { root: string; pr: number; file: string; sel: { side: "LEFT" | "RIGHT"; line: number; start?: number }; head?: string; code: string[] | null; onClose: () => void; onPosted: () => void }) {
  const t = useT();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const suggest = () => {
    if (!code) return;
    const ta = taRef.current, at = ta ? ta.selectionStart : text.length;
    const block = suggestionBlock(code);
    setText((v) => `${v.slice(0, at)}${at && v[at - 1] !== "\n" ? "\n" : ""}${block}\n${v.slice(at)}`);
    requestAnimationFrame(() => taRef.current?.focus());
  };
  const post = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    const r = await window.nunopiDesktop?.github?.prLineComment?.(root, pr, file, sel.line, body, head, { side: sel.side, ...(sel.start ? { startLine: sel.start, startSide: sel.side } : {}) }).catch(() => null);
    if (!mounted.current) return;
    setBusy(false);
    if (r?.ok) { onPosted(); onClose(); } else setErr(r?.detail || t("github.error"));
  };
  const addToReview = () => {
    const body = text.trim();
    if (!body) return;
    const cur = loadDrafts(root, pr);
    const next = addDraft(cur, { path: file, side: sel.side, line: sel.line, startLine: sel.start, body, head }, crypto.randomUUID());
    if (next.length === cur.length) { setErr(t("github.draftNotAdded")); return; } // 같은 자리·같은 글이 이미 있거나 100개 꽉 참(리뷰)
    if (!saveDrafts(root, pr, next)) { toast(t("prReview.saveFailed"), "error"); return; }
    toast(t("github.draftAdded"));
    onClose();
  };
  const btn = "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-50";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-[var(--s-pane)]">
      <div className="mb-1 flex items-center gap-1">
        <span className="font-mono text-[10.5px] text-zinc-400 dark:text-zinc-500">{file}:{sel.start ? `${sel.start}-` : ""}{sel.line}</span>
        <MarkdownToolbar taRef={taRef} setValue={setText} className="ml-auto" />
        {code && <button type="button" onClick={suggest} title={t("github.suggestChange")} aria-label={t("github.suggestChange")} className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"><IconPlusMinus size={13} stroke={2} aria-hidden /></button>}
      </div>
      <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} rows={3} autoFocus placeholder={t("github.lineCommentPlaceholder")}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void post(); } else if (e.key === "Escape") onClose(); }}
        className="w-full resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-700 outline-none focus:border-mustard-500/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
      <div className="mt-1 flex justify-end gap-1">
        <button type="button" onClick={onClose} className={`${btn} text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200`}>{t("github.cancel")}</button>
        <button type="button" onClick={() => void post()} disabled={busy || !text.trim()} className={`${btn} border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}>
          {busy && <IconLoader2 size={11} className="animate-spin" aria-hidden />}{t("github.lineCommentPost")}
        </button>
        <button type="button" onClick={addToReview} disabled={busy || !text.trim()} className={`${btn} bg-zinc-800 text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white`}>{t("github.addToReview")}</button>
      </div>
      {err && <p className="mt-1 break-words text-[10.5px] text-rose-500">{err}</p>}
    </div>
  );
}
