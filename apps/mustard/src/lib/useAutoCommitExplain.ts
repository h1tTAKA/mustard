"use client";
// 커밋 자동 설명(#1054) — 새 커밋이 생기면 그 커밋 파일들의 변경 구간을 "이 변경 설명"과 같은 방식으로 미리 설명·저장.
// diff를 열면 이미 설명이 붙어 있음. 커밋에만(워킹트리 diff X). 설정 > git "커밋 변경 자동 설명".
// 레포별 상태(localStorage) = { since: 마지막 확인 커밋 시각(초), done: 처리한 hash }. 처음 켜면 지금부터(옛 이력 X), 끄면 상태 삭제.
import { useEffect, useMemo, useRef } from "react";
import { useLocale, useSetting, withModel, GKEYS, GIT_DEFAULTS, CUKEYS, CATCHUP_DEFAULTS } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { parseDiff, groupHunks, noteStoreKey, loadNotes, saveNote, explainDiffText } from "@/lib/hunkNotes";
import { buildSessionItem } from "@/lib/sessionCard";

// #1056 캐치업 연동 — 파일 하나 설명이 끝나면 캐치업 카드(kind diff)로. key에 hash·파일을 담아 카드에서 diff를 열 수 있게.
export const CATCHUP_ITEM_EVENT = "nunopi:catchup-item"; // detail = { root, item } — 같은 창 캐치업이 즉시 추가
export const diffItemKey = (hash: string, file: string) => `diff|${hash}|${file}`;
export const parseDiffItemKey = (key: string) => { const m = /^diff\|([0-9a-fA-F]{4,64})\|(.+)$/.exec(key); return m ? { hash: m[1], file: m[2] } : null; };

const POLL_MS = 30_000;
const MAX_FILES = 10, MAX_HUNKS = 20; // ponytail: 커밋당 상한(토큰 방어) — 큰 커밋은 앞부분만, 나머지는 diff에서 버튼으로
// 설명 가치 없는 파일 — 문서·lockfile·이미지 등(삭제 파일은 상태 D로 따로 거름).
const SKIP_FILE = /\.(md|mdx|markdown|txt|rst|adoc|lock|png|jpe?g|gif|webp|ico|svg|pdf|zip)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i;

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

export function useAutoCommitExplain(root: string, providerId: AgentProviderKind, providerSettings: ProviderSettings) {
  const autoOn = useSetting<boolean>(GKEYS.autoExplainCommits, GIT_DEFAULTS.autoExplainCommits);
  const catchupOn = useSetting<boolean>(CUKEYS.enabled, CATCHUP_DEFAULTS.enabled);
  const diffProvider = useSetting<string>(CUKEYS.diffProvider, ""); // #1062 Diff AI("" = 워크스페이스 기본)
  const diffModel = useSetting<string>(CUKEYS.diffModel, "");
  const on = autoOn && catchupOn; // #1062 캐치업 전체 끄면 Diff 분석도 중지
  const { locale } = useLocale();
  const pid = (diffProvider || providerId) as AgentProviderKind;
  const ps = useMemo(() => withModel(providerSettings, pid, diffModel), [providerSettings, pid, diffModel]);
  const cfg = useRef({ providerId: pid, providerSettings: ps, locale });
  useEffect(() => { cfg.current = { providerId: pid, providerSettings: ps, locale }; }, [pid, ps, locale]);

  useEffect(() => {
    if (!root) return;
    const stateKey = `nunopi:auto-explain:${root}`;
    if (!on) { try { localStorage.removeItem(stateKey); } catch { /* ignore */ } return; } // 다시 켜면 그때부터
    type State = { since: number; done: string[] };
    const read = (): State | null => { try { return JSON.parse(localStorage.getItem(stateKey) || "null") as State | null; } catch { return null; } };
    const write = (st: State) => { try { localStorage.setItem(stateKey, JSON.stringify(st)); } catch { /* ignore */ } };
    let alive = true, busy = false;

    // info = 카드 메타("브랜치 · 커밋 제목", #1062) — tool 필드에 담아 저장(스키마 변경 없이).
    const explainCommit = async (hash: string, info: string) => {
      const list = await post("/api/repo/git-show", { path: root, hash });
      const files = ((list?.files ?? []) as { status: string; path: string }[]).filter((f) => f.status !== "D" && !SKIP_FILE.test(f.path)).slice(0, MAX_FILES);
      let budget = MAX_HUNKS;
      for (const f of files) {
        if (!alive || budget <= 0) return;
        const d = await post("/api/repo/git-show", { path: root, hash, file: f.path });
        const raw = String(d?.diff ?? "");
        if (!raw.trim() || /^Binary files /m.test(raw)) continue;
        const store = noteStoreKey(root, f.path, hash);
        const have = loadNotes(store);
        const texts: string[] = []; // 이 파일 구간 설명(순서대로) — 캐치업 카드 본문
        for (const h of groupHunks(parseDiff(raw))) {
          if (!alive) return;
          if (have[h.diffText]) { texts.push(have[h.diffText]); continue; } // 이미 설명됨(버튼으로 먼저 눌렀거나 재시도)
          if (budget <= 0) break;
          budget--;
          const { providerId: pid, providerSettings: ps, locale: loc } = cfg.current;
          try { const text = await explainDiffText(h.diffText, pid, ps, loc); saveNote(store, h.diffText, text); texts.push(text); } catch { /* 구간 하나 실패 — 다음 구간 */ }
        }
        if (texts.length && alive) {
          const item = { key: diffItemKey(hash, f.path), kind: "diff", target: `${f.path} @${hash.slice(0, 7)}`, tool: info || "diff", ts: Date.now(), expl: texts.join("\n\n---\n\n").slice(0, 8000) };
          void post("/api/repo/stream", { root, items: [item] }).catch(() => { /* 기록 실패 — 화면엔 이벤트로 뜸 */ });
          window.dispatchEvent(new CustomEvent(CATCHUP_ITEM_EVENT, { detail: { root, item } }));
        }
      }
    };

    const tick = async () => {
      if (busy || !alive || !cfg.current.providerId) return;
      busy = true;
      try {
        let st = read();
        if (!st) { write({ since: Math.floor(Date.now() / 1000), done: [] }); return; } // 처음 켬 → 지금부터
        const j = await post("/api/repo/git-recent", { path: root, since: st.since });
        const fresh = ((j?.commits ?? []) as { hash: string; ts: number; subject?: string }[]).filter((c) => !st!.done.includes(c.hash)).reverse(); // 오래된 것부터
        const branch = typeof j?.branch === "string" ? j.branch : "";
        for (const c of fresh) {
          if (!alive) return;
          await explainCommit(c.hash, [branch, c.subject].filter(Boolean).join(" · ").slice(0, 200));
          // #1064 이 커밋을 만든 에이전트 세션 → 요약 카드(원본은 서버에 저장, 카드에서 펼쳐 봄)
          if (alive) {
            const { providerId: sp, providerSettings: sps, locale: sl } = cfg.current;
            const item = await buildSessionItem(root, c.hash, c.ts, c.subject ?? "", branch, sp, sps, sl).catch(() => null);
            if (item && alive) {
              void post("/api/repo/stream", { root, items: [item] }).catch(() => { /* 기록 실패 — 화면엔 이벤트로 뜸 */ });
              window.dispatchEvent(new CustomEvent(CATCHUP_ITEM_EVENT, { detail: { root, item } }));
            }
          }
          if (!alive) return; // 중간에 꺼졌으면 처리 완료로 안 적음(다음에 이어서)
          st = { since: Math.max(st.since, c.ts), done: [...st.done, c.hash].slice(-50) }; // 같은 초 커밋은 done으로 중복 차단
          write(st);
        }
      } catch { /* 서버 미준비 등 — 다음 주기 */ } finally { busy = false; }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [on, root]);
}
