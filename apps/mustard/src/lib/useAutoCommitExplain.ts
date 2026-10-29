"use client";
// 커밋 자동 설명(#1054) — 새 커밋이 생기면 그 커밋 파일들의 변경 구간을 "이 변경 설명"과 같은 방식으로 미리 설명·저장.
// diff를 열면 이미 설명이 붙어 있음. 커밋에만(워킹트리 diff X). 설정 > git "커밋 변경 자동 설명".
// 레포별 상태(localStorage) = { since: 마지막 확인 커밋 시각(초), done: 처리한 hash }. 처음 켜면 지금부터(옛 이력 X), 끄면 상태 삭제.
import { useEffect, useMemo, useRef } from "react";
import { useLocale, useSetting, withModel, GKEYS, GIT_DEFAULTS, CUKEYS, CATCHUP_DEFAULTS } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { parseDiff, groupHunks, diffMark, DIFF_SEP, noteStoreKey, loadNotes, saveNote, explainDiffText } from "@/lib/hunkNotes";
import { buildSessionItem } from "@/lib/sessionCard";
import { useCatchupRepoPrefs } from "@/lib/useCatchupRepoPrefs";
import { isFailedNote, RUNTIME_FAIL_PREFIXES } from "@/lib/failText";

// #1056 캐치업 연동 — 파일 하나 설명이 끝나면 캐치업 카드(kind diff)로. key에 hash·파일을 담아 카드에서 diff를 열 수 있게.
export const CATCHUP_ITEM_EVENT = "nunopi:catchup-item"; // detail = { root, item } — 같은 창 캐치업이 즉시 추가
export const diffItemKey = (hash: string, file: string) => `diff|${hash}|${file}`;
export const parseDiffItemKey = (key: string) => { const m = /^diff\|([0-9a-fA-F]{4,64})\|(.+)$/.exec(key); return m ? { hash: m[1], file: m[2] } : null; };

const POLL_MS = 30_000;
const RETRY_MS = [5_000, 20_000, -1]; // #1093 덩어리 재시도 간격(-1 = 마지막 시도)
const EXPLAIN_CONCURRENCY = 4; // #1090 덩어리 설명 동시 호출 수(AI CLI 동시 실행 — 너무 많으면 레이트 리밋)
// 설명 가치 없는 파일 — 문서·lockfile·이미지 등(삭제 파일은 상태 D로 따로 거름).
const SKIP_FILE = /\.(md|mdx|markdown|txt|rst|adoc|lock|png|jpe?g|gif|webp|avif|bmp|ico|svg|pdf|zip|gz|tgz|7z|rar|mp3|wav|ogg|flac|m4a|aac|mp4|mov|webm|avi|mkv|woff2?|ttf|otf|eot|wasm|exe|dll|so|dylib|bin)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i;

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

export function useAutoCommitExplain(root: string, providerId: AgentProviderKind, providerSettings: ProviderSettings) {
  const repoPrefs = useCatchupRepoPrefs(root); // #1239 이 레포만 끈 분석
  const autoOn = useSetting<boolean>(GKEYS.autoExplainCommits, GIT_DEFAULTS.autoExplainCommits) && !repoPrefs.isOff("diffAnalyze");
  const catchupOn = useSetting<boolean>(CUKEYS.enabled, CATCHUP_DEFAULTS.enabled);
  const diffProvider = useSetting<string>(CUKEYS.diffProvider, ""); // #1062 Diff AI("" = 워크스페이스 기본)
  const diffModel = useSetting<string>(CUKEYS.diffModel, "");
  // #1064 세션 분석 — Diff 분석과 따로 켜고 끔(같은 새 커밋 감시를 공유). AI·모델도 따로.
  const sessionsOn = useSetting<boolean>(CUKEYS.sessionsAnalyze, CATCHUP_DEFAULTS.sessionsAnalyze) && !repoPrefs.isOff("sessionsAnalyze");
  const sessProvider = useSetting<string>(CUKEYS.sessionsProvider, "");
  const sessModel = useSetting<string>(CUKEYS.sessionsModel, "");
  const on = catchupOn && (autoOn || sessionsOn); // #1062 캐치업 전체 끄면 전부 중지
  // #1239 레포 설정 받기 전엔 tick만 쉼(on에 섞으면 앱 켤 때마다 꺼짐 → 상태 지움 → 꺼진 동안 커밋·미룬 카드·되살리기가 날아감, 리뷰)
  const prefsLoaded = repoPrefs.loaded;
  const { locale } = useLocale();
  const pid = (diffProvider || providerId) as AgentProviderKind;
  const ps = useMemo(() => withModel(providerSettings, pid, diffModel), [providerSettings, pid, diffModel]);
  const spid = (sessProvider || providerId) as AgentProviderKind;
  const sps = useMemo(() => withModel(providerSettings, spid, sessModel), [providerSettings, spid, sessModel]);
  const cfg = useRef({ providerId: pid, providerSettings: ps, locale, diffOn: autoOn, sessOn: sessionsOn, spid, sps, loaded: prefsLoaded });
  useEffect(() => { cfg.current = { providerId: pid, providerSettings: ps, locale, diffOn: autoOn, sessOn: sessionsOn, spid, sps, loaded: prefsLoaded }; }, [pid, ps, locale, autoOn, sessionsOn, spid, sps, prefsLoaded]);

  useEffect(() => {
    if (!root) return;
    const stateKey = `nunopi:auto-explain:${root}`;
    if (!on) { try { localStorage.removeItem(stateKey); } catch { /* ignore */ } return; } // 다시 켜면 그때부터
    // pending = 세션 턴이 아직 안 끝나 카드를 미룬 커밋(#1064) — 다음 주기마다 다시, 20분 지나면 그대로 만듦
    type Pend = { hash: string; ts: number; subject: string; branch: string; at: number; merge?: boolean; errAt?: number; rv?: 1 }; // rv = 되살리기로 넣은 것(새 커밋 뒤에 처리)
    type State = { since: number; done: string[]; pending?: Pend[]; revived?: number; reviveTries?: number; reviveAt?: number };
    const read = (): State | null => { try { return JSON.parse(localStorage.getItem(stateKey) || "null") as State | null; } catch { return null; } };
    const write = (st: State) => { try { localStorage.setItem(stateKey, JSON.stringify(st)); } catch { /* ignore */ } };
    let alive = true, busy = false;
    let budget = 0; // #1235 주기마다 세션 카드 조회 5번까지(되살리기로 쌓여도 새 커밋 설명·서버를 오래 붙잡지 않게, 리뷰) — tick 시작에 채움

    // info = 카드 메타("브랜치 · 커밋 제목", #1062) — tool 필드에 담아 저장(스키마 변경 없이).
    // #1090 커밋의 모든 파일 덩어리를 한 작업 목록으로 → 동시 EXPLAIN_CONCURRENCY개씩 설명(차례로 하면 큰 커밋 하나에 수십 분).
    //  파일의 덩어리가 다 끝나면 그 파일 카드를 바로 — 카드 시각 = 끝난 시각(끝난 순서대로 맨 위에 쌓임, 유저 요청).
    // #1093 opts — 복구용: only = 그 파일만, ts = 원래 카드 시각 유지, replace = 같은 key 카드 교체.
    const explainCommit = async (hash: string, info: string, opts: { only?: string; ts?: number; replace?: boolean } = {}) => {
      const list = await post("/api/repo/git-show", { path: root, hash });
      const files = ((list?.files ?? []) as { status: string; path: string }[]).filter((f) => f.status !== "D" && !SKIP_FILE.test(f.path) && (!opts.only || f.path === opts.only));
      type FileJob = { path: string; store: string; texts: (string | null)[]; left: number };
      const jobs: { file: FileJob; i: number; h: ReturnType<typeof groupHunks>[number] }[] = [];
      const emit = (f: FileJob) => {
        const texts = f.texts.filter((x): x is string => !!x);
        if (!texts.length || !alive) return;
        const item = { key: diffItemKey(hash, f.path), kind: "diff", target: `${f.path} @${hash.slice(0, 7)}`, tool: info || "diff", ts: opts.ts ?? Date.now(), expl: texts.join(DIFF_SEP) }; // #1074 자르지 않음
        void post("/api/repo/stream", { root, items: [item], replace: !!opts.replace }).catch(() => { /* 기록 실패 — 화면엔 이벤트로 뜸 */ });
        window.dispatchEvent(new CustomEvent(CATCHUP_ITEM_EVENT, { detail: { root, item } }));
      };
      for (const f of files) { // #1074 커밋당 파일·구간 상한 없음 — 큰 커밋도 바뀐 코드 전부 캐치업에(유저 요청)
        if (!alive || !cfg.current.diffOn) return false; // #1239 도중에 (레포에서) diff 분석 끄면 멈춤 — 끝나지 않았다고 알림(done에 안 넣게, 리뷰)
        const d = await post("/api/repo/git-show", { path: root, hash, file: f.path });
        const raw = String(d?.diff ?? "");
        if (!raw.trim() || /^Binary files /m.test(raw)) continue;
        const store = noteStoreKey(root, f.path, hash, undefined, cfg.current.locale); const have = loadNotes(store);
        const hunks = groupHunks(parseDiff(raw));
        const file: FileJob = { path: f.path, store, texts: hunks.map((h) => (have[h.diffText] ? diffMark(h) + have[h.diffText] : null)), left: 0 };
        hunks.forEach((h, i) => { if (!file.texts[i]) { file.left++; jobs.push({ file, i, h }); } }); // 이미 설명된 구간(버튼·재시도)은 건너뜀
        if (!file.left) emit(file);
      }
      let next = 0;
      const worker = async () => {
        while (alive && cfg.current.diffOn && next < jobs.length) { // 도중에 끄면 남은 구간 안 함
          const { file, i, h } = jobs[next++];
          const { providerId: pid, providerSettings: ps, locale: loc } = cfg.current;
          for (const wait of RETRY_MS) { // #1093 실패면 잠시 뒤 다시(런타임 상한·일시 오류) — 최대 3번
            if (!alive || !cfg.current.diffOn) return; // 재시도 대기 뒤에도 다시 확인
            try { const text = await explainDiffText(h.diffText, pid, ps, loc); saveNote(file.store, h.diffText, text); file.texts[i] = diffMark(h) + text; break; }
            catch { if (wait < 0) break; await new Promise((r) => setTimeout(r, wait)); } // 끝내 실패 — 카드엔 빠지고 복구 주기에서 다시
          }
          if (--file.left === 0) emit(file); // 이 파일 끝 → 바로 카드
        }
      };
      await Promise.all(Array.from({ length: Math.min(EXPLAIN_CONCURRENCY, jobs.length) }, worker));
      return alive && cfg.current.diffOn; // 끝까지 했나(도중에 끄면 false — 그 커밋은 처리 완료로 안 적음, 다시 켜면 이어서)
    };

    // 미룬 세션 카드 — 턴 끝났으면(또는 20분 지남) 요약해서 카드로(카드 시각 = 만든 시각), 세션 없으면 버림
    const flushPending = async () => {
      const st0 = read(); if (!st0?.pending?.length) return;
      const keep: Pend[] = [], skipped: Pend[] = []; // skipped = 이번 주기에 못 본 것 — 다음엔 먼저(오래 열린 세션들이 몫을 계속 차지하지 않게)
      for (const pd of [...st0.pending.filter((p) => !p.rv), ...st0.pending.filter((p) => p.rv)]) { // 새 커밋 먼저, 되살리기는 몫이 남을 때(리뷰)
        if (!alive) return;
        if (budget <= 0) { skipped.push(pd); continue; } // 이번 주기 몫 다 씀 — 다음 주기에
        if (!cfg.current.sessOn) continue; // 세션 분석 꺼짐 — 미룬 것도 버림
        if (Date.now() - pd.at > 60 * 60_000) continue; // 1시간 넘게 계속 실패 — 포기
        const { spid: sp, sps: sset, locale: sl } = cfg.current;
        budget--;
        const r = await buildSessionItem(root, pd.hash, pd.ts, pd.subject, pd.branch, sp, sset, sl, Date.now() - pd.at > 20 * 60_000, !!pd.merge).catch(() => "error" as const);
        if (r === "wait") { keep.push({ ...pd, errAt: undefined }); continue; } // 오류 창은 연속 오류만(옛 오류 시각이 남아 나중 한 번에 버려지지 않게, 리뷰)
        if (r === "error") { const at = pd.errAt ?? Date.now(); if (Date.now() - at < 5 * 60_000) keep.push({ ...pd, errAt: at }); continue; } // 서버 오류 — 처음 실패부터 5분까지만 다시(리뷰)
        if (r !== "none" && alive) {
          void post("/api/repo/stream", { root, items: [r] }).catch(() => { /* 기록 실패 — 화면엔 이벤트로 뜸 */ });
          window.dispatchEvent(new CustomEvent(CATCHUP_ITEM_EVENT, { detail: { root, item: r } }));
        }
      }
      if (alive) { const cur = read() ?? st0; write({ ...cur, pending: [...skipped, ...keep, ...(cur.pending ?? []).filter((p) => !st0.pending!.some((q) => q.hash === p.hash))] }); }
    };

    // #1093 복구 — 실패 문구가 설명으로 저장된 diff 카드를 찾아 그 파일만 다시(캐시된 정상 구간은 재사용, 실패 구간만 AI).
    //  카드 시각은 원래대로(목록 제자리), 같은 key로 교체. 한 주기에 최대 5개(새 커밋 설명이 밀리지 않게).
    const repairTries = new Map<string, { n: number; next: number }>(); // key → 시도 수·다음 시도 시각(계속 실패하는 파일이 30초마다 도는 것 방지)
    const repairFailed = async () => {
      if (!cfg.current.diffOn) return;
      const found = await Promise.all(RUNTIME_FAIL_PREFIXES.map((q) => fetch(`/api/repo/stream?root=${encodeURIComponent(root)}&q=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null))); // #1095 언어별 실패 문구
      const bad = found.flatMap((j) => (j?.items ?? []) as { key: string; kind: string; tool: string; ts: number; expl: string }[]).filter((x, i, a) => a.findIndex((y) => y.key === x.key) === i).filter((x) => {
        if (x.kind !== "diff" || !x.expl.split(DIFF_SEP).some(isFailedNote)) return false; // 설명 구간이 실패 문구로 시작할 때만(본문에 그 말이 나올 뿐인 카드 제외)
        const t = repairTries.get(x.key);
        return !t || (t.n < 3 && Date.now() >= t.next); // 카드당 최대 3번, 5분·10분 간격
      }).slice(0, 5);
      for (const it of bad) {
        if (!alive) return;
        const k = parseDiffItemKey(it.key); if (!k) continue;
        const n = (repairTries.get(it.key)?.n ?? 0) + 1; repairTries.set(it.key, { n, next: Date.now() + n * 5 * 60_000 });
        await explainCommit(k.hash, it.tool === "diff" ? "" : it.tool, { only: k.file, ts: it.ts, replace: true });
      }
    };

    const tick = async () => {
      if (busy || !alive || !cfg.current.providerId || !cfg.current.loaded) return; // 레포 설정 받기 전엔 쉼(상태는 안 건드림)
      busy = true;
      budget = 5;
      try {
        let st = read();
        if (!st) { write({ since: Math.floor(Date.now() / 1000), done: [], revived: 1 }); return; } // 처음 켬 → 지금부터
        // #1235 되살리기(레포마다 1회) — 예전엔 서버 일시 오류도 "세션 없음"으로 버려 세션 카드가 빠졌음.
        //  최근 24시간 처리한 커밋 중 저장된 세션이 없는 것만 다시 줄 세움(카드 있는 커밋은 세션 파일이 있어 건너뜀, 사람 커밋은 다시 none).
        //  ponytail: 최대 100개 — 하루에 커밋이 더 많으면 오래된 쪽은 못 되살림(done도 최근 50개만 기억).
        //  세션 분석이 꺼져 있으면 되살리기는 건너뛰고 끝으로 찍음(나중에 켰을 때 꺼져 있던 동안의 커밋을 한꺼번에 요약하지 않게, 리뷰).
        //  한계: 이 기능 전부터 켜 둔 레포에서, 켜기 전 24시간 안 커밋도 처리된 것으로 봄(최대 100개 1회).
        if (!st.revived && !cfg.current.sessOn) { st = { ...st, revived: 1 }; write(st); }
        if (!st.revived && Date.now() >= (st.reviveAt ?? 0)) {
          const back = await post("/api/repo/git-recent", { path: root, since: Math.floor(Date.now() / 1000) - 86_400, limit: 100 }).catch(() => null); // 실패도 아래 재시도 상한으로
          const add: Pend[] = [];
          let failed = !Array.isArray(back?.commits) || !!back?.note; // git 실패도 빈 목록으로 옴(note) — 실패로 봄
          for (const c of (failed ? [] : back.commits) as { hash: string; ts: number; subject?: string; merge?: boolean; branch?: string }[]) {
            if (!alive) return;
            const handled = c.ts < st.since || st.done.includes(c.hash); // 이미 지나간 커밋(done은 50개만 기억 — 시각으로도 판정)
            if (!handled) continue; // 아직 안 본 커밋은 평소 흐름이 처리
            const saved = await fetch(`/api/repo/session-link?root=${encodeURIComponent(root)}&hash=${c.hash}`).then((r) => r.json()).catch(() => null);
            if (saved?.ok !== true) { failed = true; continue; } // 확인 못 함 — 이번엔 건너뛰고 다음에 다시
            if (saved.session) continue; // 이미 카드 있음
            if (add.length >= 20) break; // 한 번에 20개까지(5개/주기라 2분 안에 처리 — 1시간 만료에 안 걸리게, 리뷰)
            add.push({ hash: c.hash, ts: c.ts, subject: c.subject ?? "", branch: c.branch || back.branch || "", at: Date.now(), merge: !!c.merge, rv: 1 });
          }
          if (!alive) return; // 꺼진 뒤 옛 상태로 덮어쓰지 않게(리뷰)
          // 일시 오류면 끝으로 찍지 않음 — 5분 뒤 다시, 3번까지(몇 분 이어지는 오류도 견디고, 계속 실패해도 매 주기 훑지 않게, 리뷰)
          //  되살리기 조회(대화 기록 파일 읽기)는 주기 몫 밖 — 레포마다 한 번(실패 시 3번), 로컬 파일이라 감수.
          //  한계: 세션 파일은 있는데 카드가 없는 커밋(턴이 1시간 넘게 안 끝나 버린 것 등)은 "있음"으로 보고 되살리지 않음.
          const cur = read() ?? st, tries = (cur.reviveTries ?? 0) + 1;
          st = { ...cur, ...(failed && tries < 3 ? { reviveTries: tries, reviveAt: Date.now() + 5 * 60_000 } : { revived: 1 }), pending: [...(cur.pending ?? []), ...add.filter((a) => !cur.pending?.some((p) => p.hash === a.hash))] };
          write(st);
        }
        const j = await post("/api/repo/git-recent", { path: root, since: st.since });
        const pendingAdd: Pend[] = [];
        const all = ((j?.commits ?? []) as { hash: string; ts: number; subject?: string; merge?: boolean; branch?: string }[]).reverse(); // 오래된 것부터
        const fresh = all.filter((c) => !st!.done.includes(c.hash));
        const head = typeof j?.branch === "string" ? j.branch : "";
        for (const c of fresh) {
          if (!alive) return;
          const branch = c.branch || head; // #1068 그 커밋을 만들 때 브랜치(reflog)
          if (cfg.current.diffOn && !c.merge && !(await explainCommit(c.hash, [branch, c.subject].filter(Boolean).join(" · ").slice(0, 200)))) return; // 도중에 끔 — 이 커밋부터 다음 주기에(리뷰)
          // #1064 이 커밋을 만든 에이전트 세션 → 요약 카드. 턴이 끝날 때까지(마무리 말 포함) 미뤘다가 만듦.
          if (alive && cfg.current.sessOn) pendingAdd.push({ hash: c.hash, ts: c.ts, subject: c.subject ?? "", branch, at: Date.now(), merge: !!c.merge });
          if (!alive) return; // 중간에 꺼졌으면 처리 완료로 안 적음(다음에 이어서)
          st = { ...st, since: Math.max(st.since, c.ts), done: [...st.done, c.hash].slice(-50), pending: [...(st.pending ?? []), ...pendingAdd.splice(0)] }; // 같은 초 커밋은 done으로 중복 차단
          write(st);
          await flushPending(); // #1090 커밋 하나 끝날 때마다 그 세션 카드도 바로(회차 전체를 기다리지 않음)
          st = read() ?? st;
        }
        await flushPending();
        await repairFailed();
      } catch { /* 서버 미준비 등 — 다음 주기 */ } finally { busy = false; }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [on, root]);
}
