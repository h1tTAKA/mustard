"use client";

import { useCallback, useEffect, useState } from "react";
import { IconSitemap, IconSparkles, IconLoader2, IconChevronRight, IconRefresh, IconBinaryTree2, IconPlayerStop } from "@tabler/icons-react";
import { archJobKey, jobOf, startJob, stopJob, runningFeatures, useArchJobs } from "@/lib/repo/archJobs";
import { useT, useLocale } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { stripCardBlock } from "@mustard/core";
import { fetchGraphDigest } from "@/lib/repo/fetchDigest";
import { archGet, archPut, archBegin } from "@/lib/repo/archClient";

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

// 에이전트 스트림 읽기(chat 모드) — result.summary = 응답 텍스트. 전체 분석·차분 갱신 공용.
async function readStream(body: ReadableStream<Uint8Array>): Promise<{ answer: string; streamErr: string }> {
  const reader = body.getReader();
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
  return { answer, streamErr };
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
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null); // 실패 원인 상세(디버깅·안내)
  const [confirm, setConfirm] = useState<null | "reanalyze" | "update">(null); // 확인 모달(내용 바뀜·추가 경고)
  // #1329 진행 상태는 화면 밖 작업 목록에서 — 다른 화면에 갔다 와도 도는 중·멈춤이 보이고, 같은 분석을 두 번 안 시작함
  useArchJobs();
  const jobKey = archJobKey(root, "analyze");
  const job = jobOf(jobKey);
  const loading = job?.status === "running";
  const running = loading ? (job.mode as "reanalyze" | "update") : null; // 지금 도는 액션(그 버튼만 스핀)
  const bg = runningFeatures(root); // 기능 흐름·둘러보기가 백그라운드로 도는 기능
  const [restored, setRestored] = useState(false); // 저장분 확인 끝(전엔 "분석하기"를 잠가 저장분을 덮어쓰지 않게, 리뷰)
  // 저장된 카테고리 복원 — 새로고침/재시작/레포 재진입 시 재분석 없이 바로 목록 표시. 저장소=서버 파일(#1320).
  useEffect(() => {
    if (!root) return;
    let alive = true;
    // 레포가 바뀌면 이전 레포 목록을 먼저 비움 — 불러오는 사이 갱신이 다른 레포 목록을 섞어 저장하지 않게(리뷰).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 레포 전환 시 초기화
    setCats(null); setRestored(false); setErr(null); setDetail(null);
    void archGet<RepoCategory[]>(root, "cats").then(({ data, error }) => {
      if (!alive) return;
      if (error) { setErr(t("repo.loadFailed")); return; } // 서버 오류 — 분석하기를 잠가 둔 채(저장분 덮어쓰기 방지)
      setCats(data?.length ? data : null); setRestored(true);
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 레포가 바뀔 때만 다시 불러옴(언어 전환으로 목록이 비거나 저장과 경합하지 않게, 리뷰)
  }, [root]);

  // 다른 화면에서 시작해 끝난 분석 — 저장분 다시 읽어 목록 갱신
  const doneSeq = job?.status === "done" ? job.seq : 0;
  useEffect(() => {
    if (!doneSeq || !root) return;
    let alive = true;
    void archGet<RepoCategory[]>(root, "cats").then(({ data, error }) => { if (alive && !error && data?.length) { setCats(data); setRestored(true); } });
    return () => { alive = false; };
  }, [doneSeq, root]);

  // merge=true(갱신): 기존 목록에 새 항목만 추가. false(분석/재분석): 전체 교체.
  const analyze = useCallback(async (merge = false) => {
    const h = startJob(jobKey, merge ? "update" : "reanalyze");
    if (!h) return; // 이미 도는 중
    const signal = h.signal;
    let ok = false;
    setErr(null);
    setDetail(null);
    const fail = (d: string) => { if (signal.aborted) return; setErr(t("repo.analyzeError")); setDetail(d); }; // 멈춤은 오류로 안 보임
    try {
      // #1320 차분 갱신 — 저장 뒤 구조가 바뀐 파일이 없으면 AI 없이 끝(스냅샷만 새로), 있으면 그 파일들만 보여 주고 새 기능만 받음.
      const g = merge && cats ? await archGet<RepoCategory[]>(root, "cats", undefined, "token") : null;
      if (g?.error) { fail("load failed"); return; }
      const d = g?.diff ?? null;
      const token = g?.token ?? await archBegin(root); // 분석 시작 시점 스냅샷(AI가 도는 사이 고친 파일은 다음 갱신 대상으로)
      const save = async (items: RepoCategory[]) => { if (signal.aborted) return; if (await archPut(root, "cats", items, undefined, { token })) ok = true; else fail("save failed"); }; // 멈춘 뒤엔 저장 안 함
      if (d && !d.structural.length) { await save(cats!); return; }
      if (d) {
        const name = root.split("/").filter(Boolean).pop() ?? root;
        const ctx = `레포: ${name}\n\n[지금 기능 목록]\n${cats!.map((c) => `\`${c.id}\` · ${c.title}${c.blurb ? ` · ${c.blurb}` : ""}`).join("\n")}\n\n[분석 뒤 구조가 바뀌었거나 새로 생긴 파일]\n${d.structural.slice(0, 200).join("\n")}`;
        const prompt = `위 바뀐 파일들 때문에 "지금 기능 목록"에 없는 새 기능/영역이 생겼으면 그것만 같은 형식으로 한 줄씩 적어줘. 이미 있는 기능에 속하는 변경이면 적지 마. 새 기능이 없으면 "없음" 한 줄만. 인사·설명 없이:\n\`slug\` · 제목 · 한줄설명`;
        const res = await fetch("/api/agent/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: [{ role: "user", content: prompt }], providerSettings } }),
          signal,
        });
        if (!res.ok || !res.body) { fail(`analyze HTTP ${res.status}`); return; }
        const { answer, streamErr } = await readStream(res.body);
        if (streamErr) { fail(`agent: ${streamErr}`); return; }
        const text = stripCardBlock(answer);
        const found = parseCategories(text);
        // 목록 줄이 없으면 "없음"일 때만 정상 — 빈 답·엉뚱한 답이면 스냅샷 안 앞당기고 오류(리뷰).
        if (!found.length && !/^[\s"'`*.。-]*(없음|none|なし)[\s"'`*.。-]*$/i.test(text)) { fail(`no list — ${text.slice(0, 160)}`); return; }
        const next = mergeCats(cats!, found);
        if (signal.aborted) return;
        setCats(next);
        await save(next);
        return;
      }
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
        signal,
      });
      if (!res.ok || !res.body) { const b = await res.text().catch(() => ""); fail(`analyze HTTP ${res.status}${b ? ` ${b.slice(0, 160)}` : ""}`); return; }
      const { answer, streamErr } = await readStream(res.body);
      if (streamErr) { fail(`agent: ${streamErr}`); return; }
      if (!answer.trim()) { fail(t("repo.emptyResponseDetail")); return; }
      const parsed = parseCategories(stripCardBlock(answer)); // 튜터 자동 카드 블록 제거 후 파싱
      if (!parsed.length) { fail(`no JSON array — ${answer.slice(0, 160)}`); return; }
      const next = merge && cats ? mergeCats(cats, parsed) : parsed;
      if (signal.aborted) return;
      setCats(next);
      await save(next); // 영속(#743 → #1320 서버)
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      h.finish(ok);
    }
  }, [root, providerId, providerSettings, locale, t, cats, jobKey]);

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
        {/* #1329 멈춤 — 도는 분석을 끊음(끝난 부분은 남음) */}
        {loading && (
          <button type="button" onClick={() => stopJob(jobKey)} title={t("job.stop")} aria-label={t("job.stop")}
            className="shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
            <IconPlayerStop size={13} stroke={2} aria-hidden />
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
          <button type="button" onClick={() => void analyze(false)} disabled={loading || !restored}
            className="inline-flex shrink-0 items-center gap-1 rounded bg-mustard-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-mustard-700 ring-1 ring-inset ring-mustard-500/35 transition hover:bg-mustard-500/20 disabled:opacity-50 dark:bg-mustard-400/12 dark:text-mustard-400 dark:ring-mustard-400/30 dark:hover:bg-mustard-400/20">
            {loading ? <IconLoader2 size={11} stroke={2} className="animate-spin" aria-hidden /> : <IconSparkles size={11} stroke={2} aria-hidden />} {t("repo.analyzeRun")}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {job?.status === "stopped" && (
          <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="mr-auto">{t("job.stopped")}</span>
            <button type="button" onClick={() => void analyze(job.mode === "update")}
              className="inline-flex shrink-0 items-center gap-1 rounded bg-mustard-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-mustard-700 ring-1 ring-inset ring-mustard-500/35 transition hover:bg-mustard-500/20 dark:bg-mustard-400/12 dark:text-mustard-400 dark:ring-mustard-400/30 dark:hover:bg-mustard-400/20">
              <IconSparkles size={11} stroke={2} aria-hidden /> {t("job.resume")}
            </button>
          </div>
        )}
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
                {bg.has(c.title)
                  ? <span title={t("job.running")} className="mt-0.5 shrink-0"><IconLoader2 size={12} stroke={2} className="animate-spin text-mustard-600 dark:text-mustard-400" aria-label={t("job.running")} /></span>
                  : <IconChevronRight size={12} stroke={2} className="mt-0.5 shrink-0 text-zinc-400 group-hover:text-mustard-600 dark:group-hover:text-mustard-400" aria-hidden />}
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
