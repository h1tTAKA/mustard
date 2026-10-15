"use client";

import { useCallback, useEffect, useState } from "react";
import { IconSitemap, IconSparkles, IconLoader2, IconChevronRight, IconRefresh, IconBinaryTree2 } from "@tabler/icons-react";
import { useT, useLocale } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { stripCardBlock } from "@mustard/core";
import { fetchGraphDigest } from "@/lib/repo/fetchDigest";

// 레포 기능 카테고리(#743) — 에이전트가 파일 목록 보고 나눔.
export type RepoCategory = { id: string; title: string; blurb?: string };
const nkey = (s: string) => s.trim().toLowerCase();
// 갱신: 기존 목록 유지 + 새로 발견된 것만 추가(slug·제목 중복 제외). 작업하다 늘어난 기능 반영용.
function mergeCats(existing: RepoCategory[], incoming: RepoCategory[]): RepoCategory[] {
  const seen = new Set(existing.flatMap((c) => [nkey(c.id), nkey(c.title)]));
  const add = incoming.filter((c) => !seen.has(nkey(c.id)) && !seen.has(nkey(c.title)));
  return [...existing, ...add];
}
type StreamEvent = { type: string; line?: string; message?: string; response?: { summary?: string } };

// 에이전트 응답 파싱 — 튜터 페르소나가 순수 JSON을 거부하므로(chatMode "Do not output JSON"),
// ①JSON 배열이 있으면 우선, ②없으면 "`slug` · 제목 · 설명" 라인 형식(튜터가 잘 내는)에서 추출. 이중 방어.
function parseCategories(text: string): RepoCategory[] {
  // ① JSON 배열
  const jm = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (jm) {
    try {
      const arr = JSON.parse(jm[0]);
      if (Array.isArray(arr)) {
        const r = arr.filter((x) => x && typeof x.title === "string").map((x, i) => ({ id: typeof x.id === "string" && x.id ? x.id : `cat-${i}`, title: String(x.title), blurb: typeof x.blurb === "string" ? x.blurb : undefined }));
        if (r.length) return r;
      }
    } catch { /* 라인 파싱으로 폴백 */ }
  }
  // ② 라인: (불릿/번호 제거) `slug` <구분자> 제목 [<구분자> 설명]
  const out: RepoCategory[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^[-*•\d.)\s]+/, "");
    const m = line.match(/^`([^`]+)`\s*[·|:\-–—]\s*(.+)$/);
    if (!m) continue;
    const id = m[1].trim();
    const parts = m[2].split(/\s*[·|]\s*|\s+[–—-]\s+/); // · | — - 로 제목/설명 분리
    const title = (parts[0] ?? m[2]).trim();
    const blurb = parts.length > 1 ? parts.slice(1).join(" · ").trim() : undefined;
    if (title) out.push({ id, title, blurb });
  }
  return out;
}

// 좌측 "레포 분석하기" 섹션(#743) — [분석하기] → 기능 카테고리 목록 → 클릭 → 플로우 패널(feature=title).
export default function RepoAnalyzeSection({ root, providerId, providerSettings, onOpenFlow, onOpenGraph }: {
  root: string;
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  onOpenFlow?: (feature: string) => void;
  onOpenGraph?: () => void; // 코드그래프 raw 뷰어 열기(#842 서브5, opt-in)
}) {
  const t = useT();
  const { locale } = useLocale();
  const [cats, setCats] = useState<RepoCategory[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null); // 실패 원인 상세(디버깅·안내)
  const [confirm, setConfirm] = useState<null | "reanalyze" | "update">(null); // 확인 모달(내용 바뀜·추가 경고)
  const [running, setRunning] = useState<null | "reanalyze" | "update">(null); // 지금 도는 액션(그 버튼만 스핀)
  const catsKey = root ? `nunopi:ws:${root}:analyze-cats` : null; // 레포별 카테고리 영속 키(#743)

  // 저장된 카테고리 복원 — 새로고침/재시작/레포 재진입 시 재분석 없이 바로 목록 표시.
  useEffect(() => {
    if (!catsKey) return;
    let saved: RepoCategory[] | null = null;
    try { const raw = localStorage.getItem(catsKey); if (raw) { const j = JSON.parse(raw); if (Array.isArray(j) && j.length) saved = j; } } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 레포별 저장 카테고리 1회 복원
    setCats(saved);
  }, [catsKey]);

  // merge=true(갱신): 기존 목록에 새 항목만 추가. false(분석/재분석): 전체 교체.
  const analyze = useCallback(async (merge = false) => {
    setLoading(true);
    setRunning(merge ? "update" : "reanalyze");
    setErr(null);
    setDetail(null);
    const fail = (d: string) => { setErr(t("repo.analyzeError")); setDetail(d); };
    try {
      // 1) 레포 파일 목록(컨텍스트) — 노이즈 제외 + 상한(토큰 방어).
      const tr = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      if (!tr.ok) { fail(`tree HTTP ${tr.status}`); return; }
      const td = await tr.json().catch(() => null);
      const files: string[] = td && Array.isArray(td.files) ? td.files : [];
      if (!files.length) { fail("no files (tree empty)"); return; }
      const list = files.filter((f) => !/(^|\/)(node_modules|\.git|dist|build|\.next|\.turbo)(\/|$)/.test(f)).slice(0, 600);
      const name = root.split("/").filter(Boolean).pop() ?? root;
      // 실측 그래프 다이제스트(모듈·의존·허브) — 있으면 카테고리를 실제 구조에 근거화(#842 서브3). 실패 시 폴백.
      const digest = await fetchGraphDigest(root);
      const ctx = `레포: ${name}\n파일 목록:\n${list.join("\n")}${digest ? `\n\n${digest}` : ""}`;
      const prompt = `위 레포 파일 목록${digest ? "과 실측 코드그래프 구조(모듈·의존·허브)" : ""}를 보고, 이 레포의 주요 기능/영역을 **빠짐없이** 나눠줘.${digest ? " 모듈 구조·허브 파일을 근거로 실제 경계에 맞춰 나누고, 파일 목록만으로 짐작하지 마." : ""} 개수를 억지로 제한하지 말고 실제로 있는 만큼(보통 8~20개), 중요한 영역이 하나도 누락되지 않게, 서로 겹치지 않게. 인사·서론·다른 설명 없이 **목록만**, 각 항목을 아래 형식으로 **한 줄씩** 적어줘:\n\`slug\` · 제목 · 한줄설명\n(slug은 kebab-case 영문. 예: \`token-usage\` · 토큰 사용량 모니터 · 로컬 토큰으로 provider usage API 호출)`;
      // 2) chat 모드 재사용(WorkspaceChat과 동일 경로) — 스트림 result.summary = 응답 텍스트.
      const res = await fetch("/api/agent/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: [{ role: "user", content: prompt }], providerSettings } }),
      });
      if (!res.ok || !res.body) { const b = await res.text().catch(() => ""); fail(`analyze HTTP ${res.status}${b ? ` ${b.slice(0, 160)}` : ""}`); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", answer = "", streamErr = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const ls = buf.split("\n"); buf = ls.pop() ?? "";
        for (const l of ls) {
          if (!l.trim()) continue;
          let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; }
          if (ev.type === "result") answer = ev.response?.summary ?? "";
          else if (ev.type === "error") streamErr = ev.message ?? "stream error";
        }
      }
      if (streamErr) { fail(`agent: ${streamErr}`); return; }
      if (!answer.trim()) { fail(t("repo.emptyResponseDetail")); return; }
      const parsed = parseCategories(stripCardBlock(answer)); // 튜터 자동 카드 블록 제거 후 파싱
      if (!parsed.length) { fail(`no JSON array — ${answer.slice(0, 160)}`); return; }
      setCats((prev) => {
        const next = merge && prev ? mergeCats(prev, parsed) : parsed;
        if (catsKey) { try { localStorage.setItem(catsKey, JSON.stringify(next)); } catch { /* ignore */ } } // 영속(#743)
        return next;
      });
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRunning(null);
    }
  }, [root, providerId, providerSettings, locale, t, catsKey]);

  const hasCats = !!(cats && cats.length);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-2.5 py-1 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        <IconSitemap size={11} stroke={2} className="shrink-0" aria-hidden />
        <span className="mr-auto truncate">{t("repo.analyzeSection")}</span>
        {/* 코드그래프 raw 뷰어(#842 서브5, opt-in) — 항상 열 수 있게. 서브4 플로우와 별개. */}
        {onOpenGraph && (
          <button type="button" onClick={onOpenGraph} title={t("graph.open")} aria-label={t("graph.open")}
            className="shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
            <IconBinaryTree2 size={13} stroke={2} aria-hidden />
          </button>
        )}
        {hasCats ? (
          <>
            {/* 갱신 — 이미 있는 목록에 새로 생긴 것만 추가(모달 확인). */}
            <button type="button" onClick={() => setConfirm("update")} disabled={loading}
              className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50">
              {running === "update" ? <IconLoader2 size={11} stroke={2} className="animate-spin" aria-hidden /> : <IconRefresh size={11} stroke={2} aria-hidden />} {t("confirm.updateTitle")}
            </button>
            {/* 재분석 — 전체 새로(모달 확인). */}
            <button type="button" onClick={() => setConfirm("reanalyze")} disabled={loading}
              className="inline-flex shrink-0 items-center gap-1 rounded bg-mustard-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-mustard-700 ring-1 ring-inset ring-mustard-500/35 transition hover:bg-mustard-500/20 disabled:opacity-50 dark:bg-mustard-400/12 dark:text-mustard-400 dark:ring-mustard-400/30 dark:hover:bg-mustard-400/20">
              {running === "reanalyze" ? <IconLoader2 size={11} stroke={2} className="animate-spin" aria-hidden /> : <IconSparkles size={11} stroke={2} aria-hidden />} {t("confirm.reanalyzeTitle")}
            </button>
          </>
        ) : (
          // 최초 분석 — 덮을 게 없어 바로 실행.
          <button type="button" onClick={() => void analyze(false)} disabled={loading}
            className="inline-flex shrink-0 items-center gap-1 rounded bg-mustard-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-mustard-700 ring-1 ring-inset ring-mustard-500/35 transition hover:bg-mustard-500/20 disabled:opacity-50 dark:bg-mustard-400/12 dark:text-mustard-400 dark:ring-mustard-400/30 dark:hover:bg-mustard-400/20">
            {loading ? <IconLoader2 size={11} stroke={2} className="animate-spin" aria-hidden /> : <IconSparkles size={11} stroke={2} aria-hidden />} {t("repo.analyzeRun")}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading && !cats ? (
          <p className="px-1 py-2 text-[11px] text-zinc-400 dark:text-zinc-500">{t("repo.analyzing")}</p>
        ) : err ? (
          <div className="px-1 py-2">
            <p className="text-[11px] text-rose-500">{err}</p>
            {detail && <p className="mt-1 break-words text-[10px] text-zinc-400 dark:text-zinc-500">{detail}</p>}
          </div>
        ) : cats ? (
          <div className="flex flex-col gap-0.5">
            {cats.map((c) => (
              <button key={c.id} type="button" onClick={() => onOpenFlow?.(c.title)}
                className="group flex items-start gap-1.5 rounded-md px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <IconChevronRight size={12} stroke={2} className="mt-0.5 shrink-0 text-zinc-400 group-hover:text-mustard-600 dark:group-hover:text-mustard-400" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{c.title}</span>
                  {c.blurb && <span className="block truncate text-[10px] text-zinc-400 dark:text-zinc-500">{c.blurb}</span>}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="px-1 py-2 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{t("repo.analyzeSoon")}</p>
        )}
      </div>
      {/* 재분석·갱신 확인 모달 — 내용이 바뀌거나 추가될 수 있어 먼저 물어봄(#743). */}
      {confirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[16rem] rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-[var(--s-bar)]">
            <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-100">{confirm === "reanalyze" ? t("confirm.reanalyzeTitle") : t("confirm.updateTitle")}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{confirm === "reanalyze" ? t("confirm.reanalyze") : t("confirm.update")}</p>
            <div className="mt-3 flex justify-end gap-1.5">
              <button type="button" onClick={() => setConfirm(null)}
                className="rounded-md px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">{t("confirm.cancel")}</button>
              <button type="button" onClick={() => { const merge = confirm === "update"; setConfirm(null); void analyze(merge); }}
                className="rounded-md bg-mustard-500/12 px-2.5 py-1 text-[11px] font-semibold text-mustard-700 ring-1 ring-inset ring-mustard-500/35 transition hover:bg-mustard-500/20 dark:bg-mustard-400/12 dark:text-mustard-400 dark:ring-mustard-400/30 dark:hover:bg-mustard-400/20">{t("confirm.ok")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
