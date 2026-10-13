"use client";
// 커밋 자동 설명(#1054) — 새 커밋이 생기면 그 커밋 파일들의 변경 구간을 "이 변경 설명"과 같은 방식으로 미리 설명·저장.
// diff를 열면 이미 설명이 붙어 있음. 커밋에만(워킹트리 diff X). 설정 > git "커밋 변경 자동 설명".
// 레포별 상태(localStorage) = { since: 마지막 확인 커밋 시각(초), done: 처리한 hash }. 처음 켜면 지금부터(옛 이력 X), 끄면 상태 삭제.
import { useEffect, useMemo, useRef } from "react";
import { useLocale, useSetting, withModel, GKEYS, GIT_DEFAULTS, CUKEYS, CATCHUP_DEFAULTS } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { parseDiff, groupHunks, diffMark, DIFF_SEP, noteStoreKey, loadNotes, saveNote, explainDiffText } from "@/lib/hunkNotes";
import { buildSessionItem } from "@/lib/sessionCard";

// #1056 캐치업 연동 — 파일 하나 설명이 끝나면 캐치업 카드(kind diff)로. key에 hash·파일을 담아 카드에서 diff를 열 수 있게.
export const CATCHUP_ITEM_EVENT = "nunopi:catchup-item"; // detail = { root, item } — 같은 창 캐치업이 즉시 추가
export const diffItemKey = (hash: string, file: string) => `diff|${hash}|${file}`;
export const parseDiffItemKey = (key: string) => { const m = /^diff\|([0-9a-fA-F]{4,64})\|(.+)$/.exec(key); return m ? { hash: m[1], file: m[2] } : null; };

const POLL_MS = 30_000;
const MAX_FILES = 10, MAX_HUNKS = 20; // ponytail: 커밋당 상한(토큰 방어) — 큰 커밋은 앞부분만, 나머지는 diff에서 버튼으로
// 설명 가치 없는 파일 — 문서·lockfile·이미지 등(삭제 파일은 상태 D로 따로 거름).
const SKIP_FILE = /\.(md|mdx|markdown|txt|rst|adoc|lock|png|jpe?g|gif|webp|avif|bmp|ico|svg|pdf|zip|gz|tgz|7z|rar|mp3|wav|ogg|flac|m4a|aac|mp4|mov|webm|avi|mkv|woff2?|ttf|otf|eot|wasm|exe|dll|so|dylib|bin)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i;

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

export function useAutoCommitExplain(root: string, providerId: AgentProviderKind, providerSettings: ProviderSettings) {
  const autoOn = useSetting<boolean>(GKEYS.autoExplainCommits, GIT_DEFAULTS.autoExplainCommits);
  const catchupOn = useSetting<boolean>(CUKEYS.enabled, CATCHUP_DEFAULTS.enabled);
  const diffProvider = useSetting<string>(CUKEYS.diffProvider, ""); // #1062 Diff AI("" = 워크스페이스 기본)
  const diffModel = useSetting<string>(CUKEYS.diffModel, "");
  // #1064 세션 분석 — Diff 분석과 따로 켜고 끔(같은 새 커밋 감시를 공유). AI·모델도 따로.
  const sessionsOn = useSetting<boolean>(CUKEYS.sessionsAnalyze, CATCHUP_DEFAULTS.sessionsAnalyze);
  const sessProvider = useSetting<string>(CUKEYS.sessionsProvider, "");
  const sessModel = useSetting<string>(CUKEYS.sessionsModel, "");
  const on = catchupOn && (autoOn || sessionsOn); // #1062 캐치업 전체 끄면 전부 중지
  const { locale } = useLocale();
  const pid = (diffProvider || providerId) as AgentProviderKind;
  const ps = useMemo(() => withModel(providerSettings, pid, diffModel), [providerSettings, pid, diffModel]);
  const spid = (sessProvider || providerId) as AgentProviderKind;
  const sps = useMemo(() => withModel(providerSettings, spid, sessModel), [providerSettings, spid, sessModel]);
  const cfg = useRef({ providerId: pid, providerSettings: ps, locale, diffOn: autoOn, sessOn: sessionsOn, spid, sps });
  useEffect(() => { cfg.current = { providerId: pid, providerSettings: ps, locale, diffOn: autoOn, sessOn: sessionsOn, spid, sps }; }, [pid, ps, locale, autoOn, sessionsOn, spid, sps]);

  useEffect(() => {
    if (!root) return;
    const stateKey = `nunopi:auto-explain:${root}`;
    if (!on) { try { localStorage.removeItem(stateKey); } catch { /* ignore */ } return; } // 다시 켜면 그때부터
    // pending = 세션 턴이 아직 안 끝나 카드를 미룬 커밋(#1064) — 다음 주기마다 다시, 20분 지나면 그대로 만듦
    type Pend = { hash: string; ts: number; subject: string; branch: string; at: number; merge?: boolean; seq?: number }; // seq = 같은 초 커밋 순서(#1072)
    type State = { since: number; done: string[]; pending?: Pend[] };
    const read = (): State | null => { try { return JSON.parse(localStorage.getItem(stateKey) || "null") as State | null; } catch { return null; } };
    const write = (st: State) => { try { localStorage.setItem(stateKey, JSON.stringify(st)); } catch { /* ignore */ } };
    let alive = true, busy = false;

    // info = 카드 메타("브랜치 · 커밋 제목", #1062) — tool 필드에 담아 저장(스키마 변경 없이).
    const explainCommit = async (hash: string, info: string, ts: number) => {
      const list = await post("/api/repo/git-show", { path: root, hash });
      const files = ((list?.files ?? []) as { status: string; path: string }[]).filter((f) => f.status !== "D" && !SKIP_FILE.test(f.path));
      let explained = 0; // #1068 상한은 실제 설명한 파일만 셈 — 바이너리가 앞자리를 다 먹어 뒤의 코드·설정 파일이 빠지던 것
      let budget = MAX_HUNKS;
      for (const f of files) {
        if (!alive || budget <= 0) return;
        const d = await post("/api/repo/git-show", { path: root, hash, file: f.path });
        const raw = String(d?.diff ?? "");
        if (!raw.trim() || /^Binary files /m.test(raw)) continue;
        if (++explained > MAX_FILES) return;
        const store = noteStoreKey(root, f.path, hash);
        const have = loadNotes(store);
        const texts: string[] = []; // 이 파일 구간 설명(순서대로) — 캐치업 카드 본문
        for (const h of groupHunks(parseDiff(raw))) {
          if (!alive) return;
          if (have[h.diffText]) { texts.push(diffMark(h) + have[h.diffText]); continue; } // 이미 설명됨(버튼으로 먼저 눌렀거나 재시도)
          if (budget <= 0) break;
          budget--;
          const { providerId: pid, providerSettings: ps, locale: loc } = cfg.current;
          try { const text = await explainDiffText(h.diffText, pid, ps, loc); saveNote(store, h.diffText, text); texts.push(diffMark(h) + text); } catch { /* 구간 하나 실패 — 다음 구간 */ }
        }
        if (texts.length && alive) {
          // #1068 카드 시각 = 커밋 시각(앱이 꺼져 있다가 몰아서 처리해도 그때 자리에)
          const item = { key: diffItemKey(hash, f.path), kind: "diff", target: `${f.path} @${hash.slice(0, 7)}`, tool: info || "diff", ts, expl: texts.join(DIFF_SEP).slice(0, 8000) };
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
        const pendingAdd: Pend[] = [];
        const all = ((j?.commits ?? []) as { hash: string; ts: number; subject?: string; merge?: boolean; branch?: string }[]).reverse(); // 오래된 것부터
        const fresh = all.filter((c) => !st!.done.includes(c.hash));
        const head = typeof j?.branch === "string" ? j.branch : "";
        for (const c of fresh) {
          if (!alive) return;
          // #1072 같은 초에 여러 커밋(에이전트가 한 명령으로 연달아) — 카드 시각에 ms로 순서를 더해 나중 커밋이 위로(표시 시각은 같음)
          const seq = all.slice(0, all.indexOf(c)).filter((x) => x.ts === c.ts).length; // 이미 처리한 같은 초 커밋까지 세서(재시작 후 이어서 해도 순서 유지)
          const branch = c.branch || head; // #1068 그 커밋을 만들 때 브랜치(reflog)
          if (cfg.current.diffOn && !c.merge) await explainCommit(c.hash, [branch, c.subject].filter(Boolean).join(" · ").slice(0, 200), c.ts * 1000 + seq);
          // #1064 이 커밋을 만든 에이전트 세션 → 요약 카드. 턴이 끝날 때까지(마무리 말 포함) 미뤘다가 만듦.
          if (alive && cfg.current.sessOn) pendingAdd.push({ hash: c.hash, ts: c.ts, subject: c.subject ?? "", branch, at: Date.now(), merge: !!c.merge, seq });
          if (!alive) return; // 중간에 꺼졌으면 처리 완료로 안 적음(다음에 이어서)
          st = { since: Math.max(st.since, c.ts), done: [...st.done, c.hash].slice(-50), pending: [...(st.pending ?? []), ...pendingAdd.splice(0)] }; // 같은 초 커밋은 done으로 중복 차단
          write(st);
        }
        // 미룬 세션 카드 — 턴 끝났으면(또는 20분 지남) 요약해서 카드로, 세션 없으면 버림
        const keep: Pend[] = [];
        for (const pd of st.pending ?? []) {
          if (!alive) return;
          if (!cfg.current.sessOn) continue; // 세션 분석 꺼짐 — 미룬 것도 버림
          if (Date.now() - pd.at > 60 * 60_000) continue; // 1시간 넘게 계속 실패 — 포기
          const { spid: sp, sps: sset, locale: sl } = cfg.current;
          const r = await buildSessionItem(root, pd.hash, pd.ts, pd.subject, pd.branch, sp, sset, sl, Date.now() - pd.at > 20 * 60_000, !!pd.merge, pd.seq ?? 0).catch(() => "wait" as const);
          if (r === "wait") { keep.push(pd); continue; }
          if (r !== "none" && alive) {
            void post("/api/repo/stream", { root, items: [r] }).catch(() => { /* 기록 실패 — 화면엔 이벤트로 뜸 */ });
            window.dispatchEvent(new CustomEvent(CATCHUP_ITEM_EVENT, { detail: { root, item: r } }));
          }
        }
        if (alive) { st = { ...(read() ?? st), pending: keep }; write(st); }
      } catch { /* 서버 미준비 등 — 다음 주기 */ } finally { busy = false; }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [on, root]);
}
