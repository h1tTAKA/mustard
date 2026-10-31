"use client";
// 워크스페이스 diff 뷰(#649) — 커밋+파일의 git diff. shiki 신택스 하이라이팅 + 빨강(−)/초록(+) 배경.
import { langOf } from "@/lib/codeLang";
import { useCodeFont } from "@/lib/codeFont";
import { showWs } from "@/lib/codeWs";
import { foldRuns } from "@/lib/diffFold";
import { Fragment, useEffect, useRef, useState } from "react";
import { codeToTokens, type ThemedToken, type BundledLanguage } from "shiki";
import { IconLoader2, IconAlertTriangle, IconGitCompare, IconSparkles, IconRefresh, IconBrandGithub, IconRobot, IconCheck, IconX, IconPlus, IconPlusMinus, IconClock, IconArrowsVertical } from "@tabler/icons-react";
import { loadPrReview, prReviewKey, PR_REVIEW_EVENT, type Finding } from "@/lib/prReview";
import { setFindingStatus, postFinding } from "@/lib/prReviewRun";
import { useLocale, useT, useToast, useSetting, EKEYS, EDITOR_DEFAULTS, type DiffView } from "@mustard/core";
import { Markdown } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { Thread, type LineComment } from "@/components/workspace/github/PrReviewComments";
import MarkdownToolbar from "@/components/workspace/github/MarkdownToolbar";
import { addNote, diffNotesKey, formatNotes, isFull, loadNotes as loadDiffNotes, markSent, removeNote, saveNotes as saveDiffNotes, unsent, DIFF_NOTES_EVENT, type DiffNote } from "@/lib/diffNotes";
import { sendToAgent } from "@/lib/browser/sendToAgent";
import { requestTerminalFocus } from "@/components/workspace/TerminalPane";
import { addDraft, loadDrafts, removeDraft, saveDrafts, suggestionBlock, prDraftKey, PR_DRAFT_EVENT, type DraftComment } from "@/lib/prDraft";
import { type DLine, parseDiff, groupHunks, type Hunk, noteStoreKey, loadNotes, saveNote, explainDiffText, HUNK_NOTES_EVENT } from "@/lib/hunkNotes";


// pr = PR 리뷰 diff(#1123) — GitHub PR의 그 파일 diff. AI 구간 설명은 숨김(캐치업과 분리).
export default function DiffPane({ root, hash, file, worktree, pr, providerId, providerSettings }: { root: string; hash?: string; file: string; worktree?: "staged" | "unstaged" | "untracked"; pr?: number; providerId: AgentProviderKind; providerSettings: ProviderSettings }) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const font = useCodeFont(-1); // #1218 기본 11px
  const wrap = useSetting<boolean>(EKEYS.wordWrap, EDITOR_DEFAULTS.wordWrap);
  const ws = useSetting<boolean>(EKEYS.showWhitespace, EDITOR_DEFAULTS.showWhitespace);
  const txt = (s: string) => (ws ? showWs(s) : s);
  const view = useSetting<DiffView>(EKEYS.diffView, EDITOR_DEFAULTS.diffView);
  const fold = useSetting<boolean>(EKEYS.diffFold, EDITOR_DEFAULTS.diffFold);
  const foldCtx = useSetting<number>(EKEYS.diffFoldContext, EDITOR_DEFAULTS.diffFoldContext);
  const [openRuns, setOpenRuns] = useState<Set<number>>(new Set()); // 펼친 접힌 묶음(시작 줄 위치)
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
  // #1169 PR 아닌 diff(작업 폴더·커밋)의 줄 메모 → 에이전트. 어느 diff에서 단 메모인지(scope)로 나눠 보여 줌.
  const scope = pr ? "" : worktree ?? (hash ? `commit:${hash}` : "unstaged");
  const [dnotes, setDnotes] = useState<DiffNote[]>(() => (pr ? [] : loadDiffNotes(root)));
  useEffect(() => {
    if (pr) return;
    setDnotes(loadDiffNotes(root)); // eslint-disable-line react-hooks/set-state-in-effect -- 레포 바뀌면 다시
    const key = diffNotesKey(root);
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === key) setDnotes(loadDiffNotes(root)); };
    window.addEventListener(DIFF_NOTES_EVENT, on);
    return () => window.removeEventListener(DIFF_NOTES_EVENT, on);
  }, [root, pr]);
  // #1169 안 보낸 메모(레포 전체 — 여러 파일·diff에 단 것을 한 묶음으로) → 이 레포 에이전트 터미널로
  const pendingNotes = pr ? [] : unsent(dnotes);
  const sentNotes = pr ? 0 : dnotes.length - pendingNotes.length;
  const [sendingNotes, setSendingNotes] = useState(false);
  const sendNotes = async () => {
    if (sendingNotes) return;
    setSendingNotes(true);
    try { await deliverNotes(root, t, toast); } finally { setSendingNotes(false); }
  };
  // 보낸 메모 모두 해결(지우기) — 레포 전체, 안 보낸 건 남김
  const resolveSent = () => { if (!saveDiffNotes(root, unsent(loadDiffNotes(root)))) toast(t("prReview.saveFailed"), "error"); };
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
    setStatus("loading"); setLines(null); setTokens([]); setHead(undefined); setPick(null); setOpenRuns(new Set()); // head·고른 줄도 — 다시 받으면 줄·커밋 기준이 바뀔 수 있음(입력칸은 로딩 동안 어차피 사라짐, 리뷰)
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

  const byLine = new Map<number, Finding[]>();
  for (const f of findings) if (f.file === file && f.status !== "discarded") byLine.set(f.line, [...(byLine.get(f.line) ?? []), f]);
  const threadAt = new Map<string, LineComment[]>(); // "LEFT:12" → 그 줄(범위면 끝 줄)에 달린 스레드(첫 댓글), GitHub처럼
  for (const c of threads) if (c.path === file && c.inReplyTo == null && !c.outdated && c.line) { const k = `${c.side ?? "RIGHT"}:${c.line}`; threadAt.set(k, [...(threadAt.get(k) ?? []), c]); }
  const reloadThreads = () => setThreadTick((n) => n + 1);
  // 줄 밑 상자(지적·AI 노트·스레드·보류·입력칸, #1145·#1147) 폭 = 패널 − 34px(왼쪽 여백 + 오른쪽 미니맵 14px 안 덮게). 아주 좁으면 0(음수 폭은 무시돼 전체 폭이 됨, #1149)
  const boxW = paneW ? { width: Math.max(0, paneW - 34) } : undefined;
  const draftAt = new Map<string, DraftComment[]>();
  for (const d of drafts) if (d.path === file) draftAt.set(`${d.side}:${d.line}`, [...(draftAt.get(`${d.side}:${d.line}`) ?? []), d]);
  const sel = pick?.file === file ? pick : null;
  const noteAt = new Map<number, DiffNote[]>(); // #1169 이 파일·이 diff의 메모(새 코드 줄 번호, 범위면 끝 줄)
  for (const n of dnotes) if (n.path === file && n.scope === scope) noteAt.set(n.line, [...(noteAt.get(n.line) ?? []), n]);
  // 메모 자리의 지금 코드(범위면 범위 전체) — 달 때 저장한 것과 비교해 "줄이 바뀜"(리뷰: 범위 중간 줄이 바뀌어도 잡게)
  // 새 줄 번호 → 줄 위치 표를 한 번만(메모마다 diff 전체를 훑지 않게 — 큰 파일·메모 많을 때, 리뷰)
  const rowByNew = new Map<number, number>();
  if (!pr) lines.forEach((l, i) => { if (l.kind !== "del" && l.kind !== "meta" && l.kind !== "hunk" && l.newN != null) rowByNew.set(l.newN, i); });
  const noteText = (start: number | undefined, end: number) => {
    const out: string[] = [];
    for (let n = start ?? end; n <= end; n++) { const k = rowByNew.get(n); if (k === undefined) return ""; out.push(lines[k].text); }
    return out.join("\n");
  };
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
  // 변경 구간 → 시작 줄에 버튼(위), 끝 줄에 노트(아래) 앵커.
  const allHunks = groupHunks(lines);
  const hunkStart = new Map(allHunks.map((h) => [h.startLine, h]));
  const hunkEnd = new Map(allHunks.map((h) => [h.endLine, h]));
  // #1218 안 바뀐 구간 접기 — 바뀐 줄에서 foldCtx줄보다 먼 안 바뀐 줄이 4줄 이상 이어지면 "N줄 펼치기" 한 줄로(diffFold).
  // 메모·댓글·보류·지적·AI 설명 버튼/노트가 달린 줄, 고른 줄(입력칸 — 설정을 바꿔도 쓰던 글이 안 사라지게, 리뷰)은 안 접음
  const inSelOf = (l: DLine) => { const selLn = sel?.side === "LEFT" ? l.oldN : l.newN; return !!sel && selLn != null && l.kind !== (sel.side === "LEFT" ? "add" : "del") && selLn >= (sel.start ?? sel.line) && selLn <= sel.line; }; // 범위 테두리 — LEFT 범위엔 안 바뀐 줄도(옛 번호로)
  const keep = (i: number) => { const l = lines[i]; return inSelOf(l) || (!pr && (hunkStart.has(i) || hunkEnd.has(i))) // AI 설명 버튼·노트 자리(구간 = 바뀐 줄 ±3이라 3줄보다 좁게는 안 접힘)
    || (l.newN != null && (byLine.has(l.newN) || noteAt.has(l.newN) || threadAt.has(`RIGHT:${l.newN}`) || draftAt.has(`RIGHT:${l.newN}`)))
    || (l.oldN != null && (threadAt.has(`LEFT:${l.oldN}`) || draftAt.has(`LEFT:${l.oldN}`))); };
  const { hidden, runLen } = fold ? foldRuns(lines.map((l) => l.kind), foldCtx, keep, openRuns) : { hidden: new Map<number, number>(), runLen: new Map<number, number>() };
  // #1218 나란히 보기 단위 — 안 바뀐 줄 하나 = {l, r} 같은 위치, 지운 줄 묶음·뒤따르는 추가 줄 묶음은 차례로 짝
  const units: { l?: number; r?: number }[] = [];
  if (view === "split") for (let i = 0; i < lines.length;) {
    const k = lines[i].kind;
    if (k === "ctx") { units.push({ l: i, r: i }); i++; continue; }
    const dels: number[] = [], adds: number[] = [];
    while (i < lines.length && lines[i].kind === "del") dels.push(i++);
    while (i < lines.length && lines[i].kind === "add") adds.push(i++);
    if (!dels.length && !adds.length) { i++; continue; } // meta·hunk
    for (let j = 0; j < Math.max(dels.length, adds.length); j++) units.push({ l: dels[j], r: adds[j] });
  }
  // 오버뷰 룰러용: 연속 "같은 종류(추가/삭제)" 줄을 한 블록으로. 수정(삭제+추가)은 빨강 블록·초록 블록 따로 →
  // 삭제도 빨강으로 보임. (줄마다 틱 찍으면 새파일서 바코드 벽이라 병합.)
  // #1218 위치는 화면에 그린 행 기준 — 접힌 묶음은 한 행, 나란히는 짝 하나가 한 행(리뷰: 줄 수로 재면 마크가 밀림). 기본(한 줄·접기 끔)은 예전과 같음
  const rows: ("add" | "del" | null)[] = [];
  if (view === "split") units.forEach((u) => {
    if (u.l === u.r) { const r = hidden.get(u.l!); if (r === undefined || r === u.l) rows.push(null); }
    else rows.push(u.r === undefined ? "del" : "add"); // 짝(수정)·추가만은 초록, 지운 것만은 빨강
  });
  else lines.forEach((l, i) => {
    const r = hidden.get(i);
    if (r !== undefined) { if (r === i) rows.push(null); return; }
    rows.push(l.kind === "add" ? "add" : l.kind === "del" ? "del" : null);
  });
  const total = Math.max(1, rows.length);
  const blocks: { top: number; height: number; add: boolean }[] = [];
  { let s = -1; let kind: "add" | "del" | null = null;
    const flush = (end: number) => { if (s >= 0 && kind) blocks.push({ top: (s / total) * 100, height: Math.max(0.5, ((end - s) / total) * 100), add: kind === "add" }); };
    rows.forEach((k, i) => {
      if (k) { if (s < 0) { s = i; kind = k; } else if (k !== kind) { flush(i); s = i; kind = k; } }
      else if (s >= 0) { flush(i); s = -1; kind = null; }
    });
    if (s >= 0) flush(rows.length);
  }
  // 줄 위치 → 그 줄의 하이라이트 토큰(코드줄 순서대로 칠했음 — 접기·나란히로 그리는 순서가 바뀌어도 맞게)
  const tokAt = new Map<number, ThemedToken[]>();
  { let k = 0; lines.forEach((l, i) => { if (l.kind === "add" || l.kind === "del" || l.kind === "ctx") { const tk = tokens[k++]; if (tk) tokAt.set(i, tk); } }); }
  const codeOf = (i: number) => { const tok = tokAt.get(i); return tok ? tok.map((tk, j) => <span key={j} style={{ color: tk.color }}>{txt(tk.content)}</span>) : <span className="text-zinc-700 dark:text-zinc-200">{txt(lines[i].text)}</span>; };
  const sideOf = (l: DLine): "LEFT" | "RIGHT" => (l.kind === "del" ? "LEFT" : "RIGHT"); // 바뀌지 않은 줄은 새 코드 쪽에
  const lnOf = (l: DLine) => (sideOf(l) === "LEFT" ? l.oldN : l.newN) ?? 0;
  const findingsOf = (l: DLine) => (pr && l.newN != null ? byLine.get(l.newN) : undefined); // #1127 이 줄의 에이전트 지적
  const markOf = (l: DLine) => (l.kind === "add" ? "+" : l.kind === "del" ? "−" : " ");
  const markClsOf = (l: DLine) => (l.kind === "add" ? "text-emerald-600 dark:text-emerald-500" : l.kind === "del" ? "text-rose-600 dark:text-rose-500" : "text-transparent");
  const bgOf = (l: DLine) => (l.kind === "add" ? "bg-emerald-500/20" : l.kind === "del" ? "bg-rose-500/20" : "");
  const numCls = "w-9 shrink-0 select-none border-r border-zinc-100 px-1 text-right text-[10px] text-zinc-300 dark:border-zinc-800 dark:text-zinc-600";
  // #1127 지적 있는 줄 — 옛 줄번호 칸 왼쪽에 눈에 띄는 배지(오른쪽 정렬 번호는 3자리까지 안 가림, 코드 정렬 그대로), 누르면 지적 펼침
  const findingBadge = (lineF: Finding[], lineN: number) => (
    <button type="button" title={lineF.map((f) => f.title).join("\n")} aria-label={`${t("github.tabAgentReview")}: ${lineF.map((f) => f.title).join(", ")}`} aria-expanded={openLines.has(lineN)} aria-controls={`prf-${lineN}`}
      onClick={() => setOpenLines((s) => { const x = new Set(s); if (x.has(lineN)) x.delete(lineN); else x.add(lineN); return x; })}
      className="absolute inset-y-px left-0 z-[1] flex w-[14px] items-center justify-center rounded-r bg-mustard-500 text-brown-900 shadow-sm hover:bg-mustard-400">
      <IconRobot size={12} stroke={2.2} aria-hidden />
    </button>
  );
  // #1145 줄 댓글 + / #1169 메모 + — 줄에 올리면 보임, Shift+누름 = 범위. left = 그 칸 안 위치
  const plusBtn = (i: number, left: string) => {
    const l = lines[i], side = sideOf(l), ln = lnOf(l);
    // PR: 이 diff의 커밋을 모르면(받는 사이 push·조회 실패) 없음 — 지금 head로 달면 엉뚱한 줄(리뷰). 작업 폴더·커밋 diff: 새 코드 줄에만, 모은 메모는 위 막대에서 에이전트로
    const show = ln > 0 && (pr ? !!head && near[i] : side === "RIGHT");
    if (!show) return null;
    const label = pr ? t("github.lineCommentAdd") : t("diffNotes.add");
    return (
      <button type="button" onClick={(e) => choose(side, ln, e.shiftKey)} title={label} aria-label={`${label} ${ln}`}
        className={`absolute inset-y-px ${left} z-[1] flex w-[14px] items-center justify-center rounded bg-mustard-500 text-brown-900 opacity-0 shadow-sm hover:bg-mustard-400 focus:opacity-100 group-hover:opacity-100`}>
        <IconPlus size={11} stroke={2.6} aria-hidden />
      </button>
    );
  };
  // #1218 줄바꿈이면 남은 폭 안에서 다음 줄로(넘치는 긴 낱말만 끊음), 공백 보이기면 ·/→. 나란히는 반쪽 폭이라 늘 줄바꿈
  const codeCls = (w: boolean) => (w ? "min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] px-1" : "whitespace-pre px-1");
  const unifiedRow = (i: number) => {
    const l = lines[i], lineF = findingsOf(l);
    return (
      <div className={`group relative flex ${wrap ? "w-full" : "w-max min-w-full"} ${bgOf(l)} ${lineF || inSelOf(l) ? "ring-1 ring-inset ring-mustard-500/70" : ""}`}>
        {lineF && findingBadge(lineF, l.newN as number)}
        <span className={numCls}>{l.oldN ?? ""}</span>
        {plusBtn(i, "left-9")}
        <span className={numCls}>{l.newN ?? ""}</span>
        <span className={`w-4 shrink-0 select-none text-center ${markClsOf(l)}`}>{markOf(l)}</span>
        <span className={codeCls(wrap)}>{codeOf(i)}</span>
      </div>
    );
  };
  // #1218 나란히 한쪽 — LEFT = 옛 코드(지운 줄·안 바뀐 줄), RIGHT = 새 코드(추가 줄·안 바뀐 줄). 댓글·메모 +는 한 줄 보기와 같은 쪽에만(지운 줄 = 왼쪽, 나머지 = 오른쪽)
  const half = (i: number | undefined, which: "LEFT" | "RIGHT") => {
    const edge = which === "RIGHT" ? "border-l border-zinc-200 dark:border-zinc-800" : "";
    if (i === undefined) return <div className={`w-1/2 min-w-0 bg-zinc-50 dark:bg-zinc-900/40 ${edge}`} />;
    const l = lines[i], lineF = which === "RIGHT" ? findingsOf(l) : undefined;
    const mine = sideOf(l) === which; // 안 바뀐 줄은 RIGHT
    const ring = lineF || (inSelOf(l) && sel?.side === which);
    return (
      <div className={`group relative flex w-1/2 min-w-0 ${edge} ${bgOf(l)} ${ring ? "ring-1 ring-inset ring-mustard-500/70" : ""}`}>
        {lineF && findingBadge(lineF, l.newN as number)}
        {mine && plusBtn(i, "left-0")}
        <span className={numCls}>{(which === "LEFT" ? l.oldN : l.newN) ?? ""}</span>
        <span className={`w-4 shrink-0 select-none text-center ${markClsOf(l)}`}>{markOf(l)}</span>
        <span className={codeCls(true)}>{codeOf(i)}</span>
      </div>
    );
  };
  // 접힌 줄 — 묶음 첫 줄 자리에만 펼치기 버튼, 나머지는 안 그림. 안 접힌 줄은 undefined
  const foldBtn = (i: number) => {
    const runAt = hidden.get(i);
    if (runAt === undefined) return undefined;
    return runAt !== i ? null : (
      <button key={`fold-${i}`} type="button" onClick={() => setOpenRuns((s) => new Set(s).add(i))}
        className="sticky left-0 flex w-full items-center gap-1 border-y border-zinc-100 bg-zinc-50 py-0.5 pl-[4.75rem] font-sans text-[10.5px] text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
        <IconArrowsVertical size={11} stroke={2} aria-hidden />{t("codeDiff.expand", { n: runLen.get(i) ?? 0 })}
      </button>
    );
  };
  // 줄 위(AI 구간 설명 버튼)·줄 밑(지적·스레드·보류·입력칸·메모·AI 노트) — 한 줄 보기·나란히 둘 다 같은 자리
  const parts = (i: number) => {
    const l = lines[i], side = sideOf(l), ln = lnOf(l), lineN = l.newN as number;
    const startH = pr ? undefined : hunkStart.get(i); // PR diff는 AI 설명 없음 // 구간 시작 → 위에 설명 버튼
    const endH = pr ? undefined : hunkEnd.get(i); // 구간 끝 → 아래에 노트(PR diff는 없음)
    const lineF = findingsOf(l);
    const lineD = pr ? draftAt.get(`${side}:${ln}`) ?? [] : [];
    const composeHere = !!sel && !!head && sel.side === side && sel.line === ln;
    const lineT = pr ? [...(l.oldN != null && l.kind !== "add" ? threadAt.get(`LEFT:${l.oldN}`) ?? [] : []), ...(l.newN != null ? threadAt.get(`RIGHT:${l.newN}`) ?? [] : [])] : [];
    // #1169 이 줄의 메모 + 입력칸(PR 아닌 diff)
    const lineNotes = !pr && side === "RIGHT" ? noteAt.get(ln) ?? [] : [];
    const noteHere = !pr && !!sel && sel.side === "RIGHT" && side === "RIGHT" && sel.line === ln;
    const opened = !!lineF && openLines.has(lineN);
    const startNote = startH ? notes[hunkKey(startH)] : undefined;
    const endNote = endH ? notes[hunkKey(endH)] : undefined;
    const pre = startH ? (
      <div key={`hs-${i}`} className="flex items-center py-1 pl-[4.75rem]">
        <button type="button" onClick={() => void explainHunk(startH)} disabled={startNote?.status === "loading"}
          className="inline-flex items-center gap-1 rounded-md bg-mustard-500/12 px-2 py-0.5 text-[10px] font-semibold text-mustard-700 ring-1 ring-inset ring-mustard-500/35 transition hover:bg-mustard-500/20 disabled:opacity-60 dark:bg-mustard-400/12 dark:text-mustard-400 dark:ring-mustard-400/30 dark:hover:bg-mustard-400/20">
          {startNote?.status === "loading"
            ? <><IconLoader2 size={11} stroke={2.5} className="animate-spin" aria-hidden />{t("workspace.hunkExplaining")}</>
            : startNote?.status === "done"
            ? <><IconRefresh size={11} stroke={2.5} aria-hidden />{t("workspace.hunkReexplain")}</>
            : <><IconSparkles size={11} stroke={2.5} aria-hidden />{t("workspace.hunkExplain")}</>}
        </button>
      </div>
    ) : null;
    const post = (
      <Fragment key={`p-${i}`}>
        {opened && <div id={`prf-${lineN}`}>{lineF.map((f) => (
          <div key={f.id} style={boxW} className="sticky left-0 z-[5] my-1 ml-2.5 rounded-lg border border-mustard-500/30 bg-mustard-50/80 px-3 py-2 font-sans dark:bg-mustard-500/[0.07]">
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
          <div key={`t-${c.id}`} style={boxW} className="sticky left-0 z-[5] my-1 ml-2.5 bg-white font-sans dark:bg-[var(--s-pane)]">
            <Thread root={root} number={pr!} prTitle="" top={c} replies={threads.filter((x) => x.inReplyTo === c.id)} onChanged={reloadThreads} />
          </div>
        ))}
        {lineD.map((d) => (
          <div key={`d-${d.id}`} style={boxW} className="sticky left-0 z-[5] my-1 ml-2.5 rounded-lg border border-dashed border-mustard-500/50 bg-white px-3 py-2 font-sans dark:bg-[var(--s-pane)]">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-mustard-700 dark:text-mustard-400">
              <IconClock size={11} stroke={2} aria-hidden />{t("github.draftPending")}{d.startLine ? ` · ${d.startLine}-${d.line}` : ""}
              <button type="button" onClick={() => { if (!saveDrafts(root, pr!, removeDraft(loadDrafts(root, pr!), d.id))) toast(t("prReview.saveFailed"), "error"); }}
                className="ml-auto inline-flex items-center gap-0.5 rounded px-1 font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"><IconX size={11} aria-hidden />{t("github.delete")}</button>
            </div>
            <div className="prose prose-sm max-w-none text-[11.5px] leading-relaxed text-zinc-700 dark:prose-invert dark:text-zinc-200 prose-p:my-1"><Markdown>{d.body}</Markdown></div>
          </div>
        ))}
        {composeHere && sel && (
          <div style={boxW} className="sticky left-0 z-[5] my-1 ml-2.5 font-sans">
            <LineComposer root={root} pr={pr!} file={file} sel={sel} head={head}
              code={sel.side === "RIGHT" ? rangeRows("RIGHT", sel.start ?? sel.line, sel.line)?.map((k) => lines[k].text) ?? null : null}
              onClose={() => setPick(null)} onPosted={reloadThreads} />
          </div>
        )}
        {lineNotes.map((n) => (
          <div key={`n-${n.id}`} style={boxW} className="sticky left-0 z-[5] my-1 ml-2.5 rounded-lg border border-dashed border-mustard-500/50 bg-white px-3 py-2 font-sans dark:bg-[var(--s-pane)]">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-mustard-700 dark:text-mustard-400">
              <IconClock size={11} stroke={2} aria-hidden />{n.sentAt ? t("diffNotes.sent") : t("diffNotes.pending")}{n.startLine ? ` · ${n.startLine}-${n.line}` : ""}
              {n.text !== undefined && n.text !== noteText(n.startLine, n.line) && <span className="font-medium text-amber-600 dark:text-amber-400">· {t("diffNotes.lineChanged")}</span>}
              <button type="button" onClick={() => { if (!saveDiffNotes(root, removeNote(loadDiffNotes(root), n.id))) toast(t("prReview.saveFailed"), "error"); }}
                className="ml-auto inline-flex items-center gap-0.5 rounded px-1 font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"><IconX size={11} aria-hidden />{n.sentAt ? t("diffNotes.resolve") : t("github.delete")}</button>
            </div>
            <div className="prose prose-sm max-w-none text-[11.5px] leading-relaxed text-zinc-700 dark:prose-invert dark:text-zinc-200 prose-p:my-1"><Markdown>{n.body}</Markdown></div>
          </div>
        ))}
        {noteHere && sel && (
          <div style={boxW} className="sticky left-0 z-[5] my-1 ml-2.5 font-sans">
            <NoteComposer root={root} file={file} scope={scope} sel={sel} lineText={noteText(sel.start, sel.line)} onClose={() => setPick(null)} />
          </div>
        )}
        {/* 구간 끝: 아래에 노트(변경 코드 밑) */}
        {endNote?.status === "done" && (
          <div style={boxW} className="sticky left-0 z-[5] my-1 ml-2.5 rounded-lg border border-mustard-500/30 bg-mustard-500/10 px-3 py-2 font-sans backdrop-blur-sm dark:border-mustard-400/30 dark:bg-mustard-400/12">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-mustard-700 dark:text-mustard-400"><IconSparkles size={11} stroke={2.5} aria-hidden />{t("workspace.hunkNote")}</div>
            <div className="prose prose-sm max-w-none text-[12px] leading-relaxed text-zinc-700 dark:prose-invert dark:text-zinc-200 prose-headings:my-1 prose-headings:text-[12px] prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-li:my-0"><Markdown>{endNote.text ?? ""}</Markdown></div>
          </div>
        )}
        {endNote?.status === "error" && (
          <div className="my-1 ml-[4.75rem] flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-500"><IconAlertTriangle size={12} stroke={2} aria-hidden />{t("workspace.hunkNoteError")}</div>
        )}
      </Fragment>
    );
    return { pre, post };
  };
  const body = (
    <div className={`relative bg-white dark:bg-[var(--s-pane)] min-h-0 flex-1`}
      onMouseEnter={() => { if (hideTimer.current) clearTimeout(hideTimer.current); setShowRuler(true); }}
      onMouseLeave={() => { if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setShowRuler(false), 400); }}>
      <div ref={scrollRef} onScroll={() => { syncVp(); reveal(); }} style={font} className="h-full overflow-auto pr-3 leading-[1.55] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {view === "split"
        ? units.map((u) => {
            // #1218 나란히 — 안 바뀐 줄은 양쪽에 같은 줄, 지운 줄·추가 줄 묶음은 차례로 짝지음(남는 쪽은 빈 칸)
            if (u.l === u.r) { const fb = foldBtn(u.l!); if (fb !== undefined) return fb; }
            const ps = [...new Set([u.l, u.r])].filter((x): x is number => x !== undefined).map(parts);
            return (
              <Fragment key={`u-${u.l ?? "x"}-${u.r ?? "x"}`}>
                {ps.map((p) => p.pre)}
                <div className="flex w-full">{half(u.l, "LEFT")}{half(u.r, "RIGHT")}</div>
                {ps.map((p) => p.post)}
              </Fragment>
            );
          })
        : lines.map((l, i) => {
            // meta(diff/index/+++/---) + hunk(@@) 헤더 숨김 — -U100000으로 전체 컨텍스트라 생략 구분선 불필요.
            if (l.kind === "meta" || l.kind === "hunk") return null;
            const fb = foldBtn(i);
            if (fb !== undefined) return fb;
            const p = parts(i);
            return <Fragment key={i}>{p.pre}{unifiedRow(i)}{p.post}</Fragment>;
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
  // #1169 메모가 있을 때만 위 막대(PR 머리 띠와 같은 모양) — 안 보낸 것 보내기 + 보낸 것 모두 해결. 없으면 예전 그대로
  // 바깥 틀은 늘 같게 — 막대가 생기고 없어질 때 diff 전체가 다시 그려져 스크롤이 튀지 않게(리뷰)
  if (!pr) return (
    <div className="flex h-full flex-col">
      {dnotes.length > 0 && <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
        <IconRobot size={13} stroke={2} className="shrink-0" aria-hidden />
        <span className="min-w-0 truncate font-medium">{pendingNotes.length > 0 ? t("diffNotes.bar", { n: pendingNotes.length }) : t("diffNotes.sentBar", { n: sentNotes })}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {sentNotes > 0 && <button type="button" onClick={resolveSent}
            className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"><IconX size={11} aria-hidden />{t("diffNotes.resolveAll", { n: sentNotes })}</button>}
          {pendingNotes.length > 0 && <button type="button" onClick={() => void sendNotes()} disabled={sendingNotes}
            className="inline-flex items-center gap-1 rounded-md bg-mustard-500/12 px-2 py-0.5 text-[10px] font-semibold text-mustard-700 ring-1 ring-inset ring-mustard-500/35 transition hover:bg-mustard-500/20 disabled:opacity-60 dark:bg-mustard-400/12 dark:text-mustard-400 dark:ring-mustard-400/30 dark:hover:bg-mustard-400/20">
            {sendingNotes ? <IconLoader2 size={11} stroke={2.5} className="animate-spin" aria-hidden /> : <IconRobot size={11} stroke={2.5} aria-hidden />}{t("diffNotes.send")}
          </button>}
        </span>
      </div>}
      {body}
    </div>
  );
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
    if (r?.ok) { onPosted(); onClose(); window.dispatchEvent(new CustomEvent(PR_REVIEW_EVENT, { detail: prReviewKey(root, pr) })); } else setErr(r?.detail || t("github.error")); // 이벤트 = 변경 파일 댓글 수·대화 탭도 다시
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
        <span className="min-w-0 break-all font-mono text-[10.5px] text-zinc-400 dark:text-zinc-500">{file}:{sel.start ? `${sel.start}-` : ""}{sel.line}</span>
        <MarkdownToolbar taRef={taRef} setValue={setText} className="ml-auto shrink-0" />
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

const notesInFlight = new Map<string, Promise<void>>(); // #1169 레포별 보내는 중(같은 레포 diff 화면이 여럿이어도 한 묶음은 한 번만)
const sentUnmarked = new Set<string>(); // 보냈지만 보냄 표시 저장에 실패한 메모 — 기다리던 다음 보내기가 몰래 또 보내지 않게(리뷰). 다시 누르면 다시 보냄

// #1169 안 보낸 메모(only면 그 메모 하나만)를 이 레포 에이전트 터미널로 — 위 막대 "에이전트에게 보내기"와 입력칸 "바로 보내기"가 같이 씀
async function deliverNotes(root: string, t: ReturnType<typeof useT>, toast: ReturnType<typeof useToast>, only?: string) {
  // 보내는 중이면 끝나길 기다렸다가 아직 안 보낸 것만 다시 셈 — 두 번 보내지도, 조용히 버려지지도 않게(리뷰)
  let waited = false;
  while (notesInFlight.has(root)) { waited = true; await notesInFlight.get(root)?.catch(() => {}); } // 앞 보내기가 실패해도 이쪽은 계속
  const pending = unsent(loadDiffNotes(root)).filter((n) => !only || n.id === only);
  const list = pending.filter((n) => !(waited && sentUnmarked.has(n.id)));
  if (pending.length > list.length) toast(t("diffNotes.markFailed", { n: pending.length - list.length }), "error"); // 건너뛴 보냈지만 표시 못 한 것 — 조용히 넘기지 않고 다시 누르라고(리뷰)
  if (!list.length) return;
  const run = send(list);
  notesInFlight.set(root, run);
  try { await run; } finally { notesInFlight.delete(root); }

  async function send(list: DiffNote[]) {
    let r: Awaited<ReturnType<typeof sendToAgent>>;
    try { r = await sendToAgent(root, formatNotes(list)); } catch { r = { ok: false, reason: "error" }; } // IPC 예외도 실패 안내로(리뷰)
    if (!r.ok) { toast(t(r.reason === "no-agent" ? "browser.pickNoAgent" : "github.sendFailed"), "error"); return; }
    // 보냈으니 보냄 표시는 꼭 — 저장 실패면 한 번 더, 그래도 실패면 "보냈지만 표시 못 함"(다시 누르면 또 보내지니까, 리뷰)
    const ids = new Set(list.map((n) => n.id));
    const marked = saveDiffNotes(root, markSent(loadDiffNotes(root), ids, Date.now())) || saveDiffNotes(root, markSent(loadDiffNotes(root), ids, Date.now()));
    for (const id of ids) { if (marked) sentUnmarked.delete(id); else sentUnmarked.add(id); }
    toast(marked ? t("diffNotes.sentToast", { n: list.length }) : t("diffNotes.markFailed", { n: list.length }), marked ? undefined : "error");
    requestTerminalFocus(root, r.id); // 보낸 터미널 탭으로 — 에이전트가 받는 걸 보이게(브라우저 보내기와 같음)
  }
}

// #1169 diff 줄 메모 입력칸(PR 아닌 diff) — [취소] [바로 보내기] [담아 두기]. ⌘Enter 저장, Esc 취소. 모은 메모는 위 막대에서 에이전트로 한꺼번에, 바로 보내기는 그 메모만. PR LineComposer와 같은 모양.
function NoteComposer({ root, file, scope, sel, lineText, onClose }: { root: string; file: string; scope: string; sel: { line: number; start?: number }; lineText: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // 담아 두기 — now면 남긴 그 메모만 바로 보냄(모으지 않고, PR "바로 달기"처럼)
  const save = (now?: boolean) => {
    const body = text.trim();
    if (!body) return;
    const cur = loadDiffNotes(root);
    const id = crypto.randomUUID();
    const next = addNote(cur, { path: file, line: sel.line, startLine: sel.start, body, scope, text: lineText }, id, Date.now());
    if (next === cur) { setErr(t(isFull(cur) ? "diffNotes.full" : "diffNotes.notAdded")); return; } // 꽉 참 / 같은 자리·같은 글
    if (!saveDiffNotes(root, next)) { toast(t("prReview.saveFailed"), "error"); return; }
    onClose();
    if (now) void deliverNotes(root, t, toast, id); // 못 보내면 보낼 메모로 남음(안내는 deliverNotes가)
  };
  const btn = "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-50";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-[var(--s-pane)]">
      <div className="mb-1 flex items-center gap-1">
        <span className="min-w-0 break-all font-mono text-[10.5px] text-zinc-400 dark:text-zinc-500">{file}:{sel.start ? `${sel.start}-` : ""}{sel.line}</span>
        <MarkdownToolbar taRef={taRef} setValue={setText} className="ml-auto shrink-0" />
      </div>
      <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus placeholder={t("diffNotes.placeholder")}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); } else if (e.key === "Escape") onClose(); }}
        className="w-full resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-700 outline-none focus:border-mustard-500/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
      <div className="mt-1 flex justify-end gap-1">
        <button type="button" onClick={onClose} className={`${btn} text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200`}>{t("github.cancel")}</button>
        <button type="button" onClick={() => save(true)} disabled={!text.trim()} className={`${btn} border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}>{t("diffNotes.sendNow")}</button>
        <button type="button" onClick={() => save()} disabled={!text.trim()} title={t("diffNotes.saveHint")} className={`${btn} bg-zinc-800 text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white`}>{t("diffNotes.save")}</button>
      </div>
      {err && <p className="mt-1 break-words text-[10.5px] text-rose-500">{err}</p>}
    </div>
  );
}
