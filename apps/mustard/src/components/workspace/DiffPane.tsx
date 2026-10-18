"use client";
// 워크스페이스 diff 뷰(#649) — 커밋+파일의 git diff. shiki 신택스 하이라이팅 + 빨강(−)/초록(+) 배경.
import { Fragment, useEffect, useRef, useState } from "react";
import { codeToTokens, type ThemedToken, type BundledLanguage } from "shiki";
import { IconLoader2, IconAlertTriangle, IconGitCompare, IconSparkles, IconRefresh } from "@tabler/icons-react";
import { useLocale, useT } from "@mustard/core";
import { Markdown } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
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
  // 변경 구간별 에이전트 노트. key = diffText 해시(구간 내용 기반 안정 키 → 같은 diff 재오픈 시 매칭).
  const [notes, setNotes] = useState<Record<string, { status: "loading" | "done" | "error"; text?: string }>>({});
  const [lines, setLines] = useState<DLine[] | null>(null);
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
    setStatus("loading"); setLines(null); setTokens([]);
    (async () => {
      try {
        // 워킹트리(커밋 전) diff면 git-diff, 커밋 diff면 git-show.
        let raw: string;
        if (pr) { // PR diff — gh(Electron)로
          const r = await window.nunopiDesktop?.github?.prFileDiff?.(root, pr, file);
          if (cancelled) return;
          if (!r?.ok) { setStatus("error"); return; }
          raw = r.data?.diff ?? "";
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
  return (
    <div className="relative h-full bg-white dark:bg-[var(--s-pane)]"
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
        const row = (
          <div key={i} className={`flex w-max min-w-full ${bg}`}>
            <span className="w-9 shrink-0 select-none border-r border-zinc-100 px-1 text-right text-[10px] text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">{l.oldN ?? ""}</span>
            <span className="w-9 shrink-0 select-none border-r border-zinc-100 px-1 text-right text-[10px] text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">{l.newN ?? ""}</span>
            <span className={`w-4 shrink-0 select-none text-center ${markCls}`}>{mark}</span>
            <span className="whitespace-pre px-1">
              {tok ? tok.map((tk, j) => <span key={j} style={{ color: tk.color }}>{tk.content}</span>) : <span className="text-zinc-700 dark:text-zinc-200">{l.text}</span>}
            </span>
          </div>
        );
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
}
