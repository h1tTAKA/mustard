"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconSitemap, IconX, IconLoader2, IconChevronDown, IconRefresh, IconCode, IconBook2, IconSparkles, IconMessageCircle, IconPlayerPlay, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useT, useLocale } from "@mustard/core";
import type { AgentProviderKind, ProviderSettings } from "@mustard/core";
import { Markdown } from "@mustard/core";
import { stripCardBlock } from "@mustard/core";
import { fetchGraphDigest } from "@/lib/repo/fetchDigest";
import { archGet, archPut, archSkeleton, archBegin, archPatch } from "@/lib/repo/archClient";
import { useViewDepth } from "@/lib/repo/viewDepth";
import { DEPTHS } from "@/lib/repo/graphView";
import { applyFlowDiff, mergeFlow, tourOrder } from "@/lib/repo/flowMerge";
import type { SnapDiff } from "@/lib/repo/incremental";

// 기능별 아키텍처 플로우(#743) — 레이어=밴드(위→아래), 알약 노드, 노드→코드 점프.
// next(다음 노드)를 받아 SVG 곡선으로 연결해 흐름을 직관적으로.
type FlowNode = { name: string; file?: string; line?: number; role?: string; next?: string[] };
type FlowSection = { layer: string; nodes: FlowNode[] };
type Overviews = { dev?: string; expert?: string };
type Tour = { depth: string; steps: { name: string; text: string }[] }; // #1322 둘러보기 단계(처음 한 번 AI, 저장) // #1322 깊이별 설명글(overview 자체 = 초보용 기본)
type StreamEvent = { type: string; message?: string; response?: { summary?: string } };
// 지하철식 직각 배선: 소스 노드 왼쪽에서 나와 → 왼쪽 거터의 전용 레인(세로) → 타깃 왼쪽으로 들어감.
// 박스는 거터 오른쪽에만 있어 선이 박스를 뚫지 않음. 소스별 레인·색 분리로 스파게티 방지.
type Line = { key: string; sk: string; tk: string; color: string; laneX: number; xs: number; ys: number; xt: number; yt: number; grounded: boolean };

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const nk = (s: string) => s.trim().toLowerCase(); // 노드 이름 정규화 키(엣지 매칭용)
const DIFF_FULL = 30; // #1320 구조가 바뀐 파일이 이보다 많으면 차분 말고 처음부터 다시(부분 수선보다 정확)
// 출처(source 노드)별 색 — 겹쳐도 어디서 나왔는지 구분되게. 다크 배경서 잘 보이는 톤.
const EDGE_COLORS = ["#60a5fa", "#f87171", "#34d399", "#fbbf24", "#c084fc", "#f472b6", "#2dd4bf", "#fb923c", "#a3e635", "#38bdf8"];
// 거터는 좁은 패널서 박스 폭을 뺏지 않게 상한(MAX_GUTTER)까지만. 레인이 상한 넘으면 x 재사용(색으로 구분).
const MAX_GUTTER = 48, LANE_GAP = 5, LANE_MARGIN = 6, LANE_PAD = 10, CORNER = 5; // px
const MAX_LANES = Math.max(1, Math.floor((MAX_GUTTER - LANE_MARGIN - LANE_PAD) / LANE_GAP));

// 튜터가 내는 "레이어 | 이름 | 파일:라인 | 역할 | →다음노드" 라인을 섹션으로. JSON 안 옴(튜터 페르소나).
function parseFlow(text: string): FlowSection[] {
  const order: string[] = [];
  const byLayer = new Map<string, FlowNode[]>();
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^[-*•\d.)\s]+/, "");
    if (!line.includes("|")) continue;
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) continue;
    const layer = parts[0], name = parts[1];
    if (/^(레이어|layer)$/i.test(layer) || /^(표시이름|이름|name|노드)$/i.test(name)) continue; // 형식 예시 헤더 에코 제거
    let file: string | undefined, lineNo: number | undefined, role: string | undefined, next: string[] | undefined;
    // 3번째 칸부터 순서 무관하게: 화살표=다음노드, 파일처럼 생김=파일:라인, 나머지=역할.
    for (const p of parts.slice(2)) {
      if (!p) continue;
      const arrow = p.match(/^(?:→|->|=>|다음\s*[:：]?)\s*(.+)$/);
      if (arrow) { next = arrow[1].split(/\s*[,，/、]\s*/).map((x) => x.trim().replace(/^[→>\-\s]+/, "")).filter(Boolean); continue; }
      if (!file && /[/.]/.test(p) && !/\s/.test(p.replace(/:\d+$/, ""))) {
        const m = p.match(/^(.*?):(\d+)$/);
        file = (m ? m[1] : p).replace(/^\.?\//, ""); lineNo = m ? Number(m[2]) : undefined; continue;
      }
      if (!role) role = p;
    }
    if (!byLayer.has(layer)) { byLayer.set(layer, []); order.push(layer); }
    byLayer.get(layer)!.push({ name, file, line: lineNo, role, next });
  }
  return order.map((layer) => ({ layer, nodes: byLayer.get(layer)! }));
}

// 응답에서 설명(산문) 추출 — 노드 라인(| 포함)·섹션 마커([설명]/[흐름])만 빼고, 문단 구분(빈 줄)은 보존.
function parseOverview(text: string): string {
  const cut = text.search(/```|nunopi-cards/i); // 카드 블록/코드펜스 이후는 설명 아님 → 자름(누수 방지)
  if (cut >= 0) text = text.slice(0, cut);
  const isMarker = (l: string) => /^\s*\[?\s*(설명|흐름|説明|フロー|流れ|explanation|flow)\s*[\]:：]?\s*$/i.test(l); // [설명]/[흐름]/설명:/흐름: 만 마커로(실제 소제목은 보존)
  const kept = text.split("\n").filter((l) => !l.includes("|") && !isMarker(l.trim()));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(); // 과도한 빈 줄만 축소
}

export default function RepoFlowPane({ feature, root, providerId, providerSettings, onOpenFile, onAskArch, onQuoteNode, onClose }: {
  feature?: string | null;
  root?: string;
  providerId?: AgentProviderKind;
  providerSettings?: ProviderSettings;
  onOpenFile?: (file: string, line?: number) => void;
  onAskArch?: (feature: string) => void; // 이 아키텍처에 대해 질문(우측 챗에 arch 세션 열기, #746)
  onQuoteNode?: (text: string) => void;  // 카드 클릭 시 그 노드+연결 노드 지칭 문구를 챗 입력창에(#746)
  onClose?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [sections, setSections] = useState<FlowSection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]); // 노드 간 연결선(측정된 좌표)
  const [overview, setOverview] = useState<string | null>(null); // 이 아키텍처 설명(초보용 산문)
  const [overviewOpen, setOverviewOpen] = useState(true);        // 설명 박스 펼침
  const [confirm, setConfirm] = useState<null | "regen" | "update">(null); // 확인 모달
  const [running, setRunning] = useState<null | "regen" | "update">(null);  // 지금 도는 액션(그 버튼만 스핀)
  const reqRef = useRef(0); // 최신 요청만 반영(빠른 feature 전환 경합 방지)
  const sectionsRef = useRef<FlowSection[] | null>(null); // 최신 sections 미러(갱신 병합 기준, load 의존성 회피)
  const flowRef = useRef<HTMLDivElement | null>(null); // 연결선 좌표 기준 컨테이너
  const nodeEls = useRef(new Map<string, HTMLElement>()); // 이름키 → 노드 DOM(엣지 끝점 측정)

  const [diff, setDiff] = useState<SnapDiff | null>(null); // #1320 저장 뒤 바뀐 파일(서버 저장분 기준)
  const [note, setNote] = useState<string | null>(null);    // #1320 방금 갱신이 한 일(AI 안 부름 / N개 파일 살펴봄)
  const overviewRef = useRef<string | null>(null);           // 최신 overview 미러(차분 갱신은 설명 유지)
  const [savedDepth, setDepth] = useViewDepth();             // #1322 보기 깊이(그래프 모달과 공유)
  const depth = savedDepth ?? "beginner";                    // 안 골랐으면 초보 = 지금까지 보던 기본 설명(회귀 없음, 리뷰)
  const [overviews, setOverviews] = useState<Overviews>({}); // #1322 개발자·숙련자용 설명(없으면 초보용 기본을 보여 줌)
  const [writing, setWriting] = useState(false);             // 깊이별 설명 쓰는 중
  const [tour, setTour] = useState<Tour | null>(null);       // #1322 저장된 둘러보기
  const unsavedRef = useRef(false);                          // 화면 흐름이 저장 실패 상태 — 서버 흐름과 다를 수 있어 덧붙임(설명·단계) 안 함(리뷰)
  const atRef = useRef<number | null>(null);                 // 지금 보이는 흐름의 저장 판(at) — 덧붙임이 같은 흐름에 붙는지 서버가 확인
  const [tourIdx, setTourIdx] = useState<number | null>(null); // 지금 단계(null = 둘러보기 안 하는 중)
  const [tourBusy, setTourBusy] = useState(false);           // 단계 설명 만드는 중
  const [loadFailed, setLoadFailed] = useState(false);
  const loadFailedRef = useRef(false); // load 안에서 보는 미러(확인창이 열린 채 실패해도 재생성이 못 지나가게)       // 저장분 불러오기 실패 — 재생성으로 저장분을 덮어쓰지 않게 잠금(리뷰)
  const secOfRef = useRef<string | null>(null);              // 지금 보이는 흐름이 어느 기능 것인지(전환 중 갱신이 엉뚱한 기능에 저장되지 않게, 리뷰)
  const [connKeys, setConnKeys] = useState<Set<string>>(new Set()); // 실측 연결 "fileA|fileB"(방향 보존, 조회는 양방향). #842 서브4

  // 이름-레벨 엣지 = LLM next + 실측 뒷받침(grounded) + LLM이 놓친 실측 연결 보강. 곡선·레인·인접의 단일 소스.
  const edges = useMemo(() => {
    const list: { sk: string; tk: string; grounded: boolean }[] = [];
    if (!sections) return list;
    const hasConn = connKeys.size > 0; // 실측 없으면(미로드/조회실패/연결0) 기존 룩 유지 — grounded 취급(회귀 방지)
    const keyToFile = new Map<string, string | undefined>();
    const fileToRep = new Map<string, string>(); // 파일 → 대표 노드키(첫 등장). 플로우 노드는 대체로 파일당 1개.
    for (const s of sections) for (const n of s.nodes) {
      const k = nk(n.name);
      if (!keyToFile.has(k)) keyToFile.set(k, n.file);
      if (n.file && !fileToRep.has(n.file)) fileToRep.set(n.file, k);
    }
    const backs = (fa?: string, fb?: string) => !!fa && !!fb && (connKeys.has(`${fa}|${fb}`) || connKeys.has(`${fb}|${fa}`));
    const seen = new Set<string>();
    // 1) LLM next 엣지 — 실측 뒷받침 여부 태깅(실측 없으면 grounded 유지).
    for (const s of sections) for (const n of s.nodes) {
      const sk = nk(n.name);
      for (const target of n.next ?? []) {
        const tk = nk(target);
        const pk = `${sk}->${tk}`;
        if (sk === tk || seen.has(pk)) continue;
        seen.add(pk);
        list.push({ sk, tk, grounded: !hasConn || backs(n.file, keyToFile.get(tk)) });
      }
    }
    // 2) LLM이 놓친 실측 연결 보강 — 대표 노드끼리, 중복(방향 무관) 아니면 grounded 엣지 추가.
    // 한계: 파일당 대표 1노드만 연결(한 파일에 노드 여럿이면 나머진 생략), 필요시 확장.
    if (hasConn) for (const ck of connKeys) {
      const [fa, fb] = ck.split("|");
      const sk = fileToRep.get(fa), tk = fileToRep.get(fb);
      if (!sk || !tk || sk === tk) continue;
      if (seen.has(`${sk}->${tk}`) || seen.has(`${tk}->${sk}`)) continue;
      seen.add(`${sk}->${tk}`);
      list.push({ sk, tk, grounded: true });
    }
    return list;
  }, [sections, connKeys]);

  const laneKeys = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const e of edges) if (!seen.has(e.sk)) { seen.add(e.sk); out.push(e.sk); }
    return out;
  }, [edges]);

  // 에이전트 한 번 묻기(chat 모드 스트림 → result.summary). 흐름 생성·차분 갱신 공용.
  const ask = useCallback(async (ctx: string, prompt: string): Promise<{ text: string; err?: string }> => {
    const res = await fetch("/api/agent/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, request: { code: ctx, locale, providerId, mode: "chat", messages: [{ role: "user", content: prompt }], providerSettings } }),
    });
    if (!res.ok || !res.body) return { text: "", err: `HTTP ${res.status}` };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", answer = "", streamErr = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const ls = buf.split("\n"); buf = ls.pop() ?? "";
      for (const l of ls) { if (!l.trim()) continue; let ev: StreamEvent; try { ev = JSON.parse(l) as StreamEvent; } catch { continue; } if (ev.type === "result") answer = ev.response?.summary ?? ""; else if (ev.type === "error") streamErr = ev.message ?? "error"; }
    }
    return streamErr ? { text: "", err: streamErr } : { text: answer };
  }, [providerId, providerSettings, locale]);

  // mode: "cache"=저장분 우선(자동), "regen"=전체 새로, "update"=저장 뒤 바뀐 파일만 반영(#1320, 차분 정보 없으면 옛 방식: 새 노드만 병합).
  const load = useCallback(async (mode: "cache" | "regen" | "update" = "cache") => {
    if (!feature || !root || !providerId || !providerSettings) return;
    const my = ++reqRef.current;
    if (mode !== "update") { nodeEls.current.clear(); setLines([]); setDiff(null); setNote(null); setTour(null); }
    setTourIdx(null); // 다시 불러오거나 고치면 둘러보기는 끝냄
    // 자동(cache)일 때만 저장분 먼저 — 에이전트 재호출 없이 즉시 복원. 저장소=서버 파일(#1320, 옛 localStorage는 1회 이전).
    if (mode === "cache") {
      // 서버 왕복 동안은 이전 흐름을 그대로 두되(깜빡임 없음) 로딩 중이라 갱신·재생성 버튼은 잠김, 갱신은 secOfRef로 한 번 더 막음.
      setLoading(true); setErr(null); setLoadFailed(false); loadFailedRef.current = false;
      const { data, error } = await archGet<{ sections: FlowSection[]; overview: string | null; overviews?: Overviews; tour?: Tour; at?: number }>(root, "flow", feature);
      if (my !== reqRef.current) return;
      // 서버 오류면 새로 분석해 저장분을 덮어쓰지 않음(리뷰) — 오류만 보여 줌.
      if (error) { setSections(null); setOverview(null); secOfRef.current = null; setErr(t("flow.loadFailed")); setLoadFailed(true); loadFailedRef.current = true; setConfirm(null); setLoading(false); return; } // 열려 있던 재생성 확인창도 닫음(잠금 우회 방지, 리뷰)
      if (data?.sections?.length) {
        setSections(data.sections); setOverview(data.overview ?? null); setOverviews(data.overviews ?? {}); setTour(Array.isArray(data.tour?.steps) ? data.tour! : null); atRef.current = data.at ?? null; unsavedRef.current = false; secOfRef.current = feature; setLoading(false);
        // 낡음 표시용 차분은 따로(그래프 맞추느라 느릴 수 있음) — 흐름은 먼저 보여 줌(리뷰).
        void archGet(root, "flow", feature, true).then(({ diff: d }) => { if (my === reqRef.current) setDiff(d); });
        return;
      }
    }
    if (mode === "regen" && loadFailedRef.current) return; // 저장분 불러오기 실패 상태 — 재생성으로 덮어쓰지 않음(리뷰)
    if (mode === "update" && (secOfRef.current !== feature || !sectionsRef.current)) return; // 다른 기능 흐름이 보이는 중엔 갱신 안 함(리뷰)
    setLoading(true); setRunning(mode === "update" ? "update" : "regen"); setErr(null); setNote(null);
    if (mode !== "update") { setSections(null); setOverview(null); setOverviews({}); secOfRef.current = null; } // 갱신은 기존 유지
    try {
      // #1320 차분 갱신 — 저장 뒤 바뀐 파일을 서버에서 받아: 구조 변화 0이면 AI 없이 지운 파일 노드만 정리,
      // 너무 많으면 처음부터, 그 외엔 바뀐 파일만 AI에 보여 줌.
      let inc: SnapDiff | null = null, d: SnapDiff | null = null, token: string | undefined;
      // 저장 실패(서버는 썼는데 응답만 못 받았을 수도) → 판을 모름으로. 다음 덧붙임이 판 불일치로 계속 버려지지 않게(리뷰).
      // 판·저장상태는 지금 화면의 요청일 때만 고침 — 그새 다른 기능으로 바꿨으면 그 기능 상태를 건드리지 않게(리뷰).
      const saveFailed = () => { if (my === reqRef.current) { atRef.current = null; unsavedRef.current = true; setErr(t("flow.saveFailed")); } };
      if (mode === "update") {
        const g = await archGet(root, "flow", feature, "token");
        if (g.error) { if (my === reqRef.current) setErr(t("flow.loadFailed")); return; }
        d = g.diff; token = g.token;
        if (my !== reqRef.current) return;
        // 한계: 이 길은 노드 줄 번호를 안 고침(본문만 바뀌어 줄이 밀리면 코드 열기가 조금 어긋남). 연결선은 실측 연결 조회로 따로 갱신됨.
        if (d && !d.structural.length) {
          const next = applyFlowDiff(sectionsRef.current ?? [], [], d.removed, []);
          setSections(next);
          // 구조 변화 없음 = 노드 의미 그대로 → 깊이별 설명도 유지(#1322).
          const at = await archPut(root, "flow", { sections: next, overview: overviewRef.current }, feature, { token, keepExtras: true });
          if (!at) return saveFailed();
          if (my === reqRef.current) { atRef.current = at; unsavedRef.current = false; }
          if (my === reqRef.current) { setDiff(null); setNote(t("flow.noStructural", { n: d.changed.length + d.removed.length })); }
          return;
        }
        if (d && d.structural.length <= DIFF_FULL) inc = d;
      }
      if (inc) {
        const skel = await archSkeleton(root, inc.structural);
        const cur = (sectionsRef.current ?? []).flatMap((s) => s.nodes.map((n) => `${s.layer} | ${n.name} | ${n.file ?? ""}${n.line ? `:${n.line}` : ""} | ${n.role ?? ""}${n.next?.length ? ` | → ${n.next.join(", ")}` : ""}`));
        const ctx = `레포: ${basename(root)}\n\n[지금 "${feature}" 흐름]\n${cur.join("\n")}\n\n[분석 뒤 구조가 바뀌었거나 새로 생긴 파일과 그 심볼]\n${skel || inc.structural.slice(0, 30).join("\n")}${inc.removed.length ? `\n\n[지워진 파일]\n${inc.removed.slice(0, 30).join("\n")}` : ""}`;
        const prompt = `"${feature}" 기능 흐름을 바뀐 코드에 맞춰 고치려고 해. 위 "바뀐 파일" 중 이 기능과 관련된 파일만 골라서, 그 파일에 해당하는 노드를 모두 아래 형식으로 한 줄씩 써줘(그 파일의 기존 노드가 아직 맞으면 그대로 다시 포함, 새 함수·파일이 흐름에 끼면 추가). 관련 없는 파일은 쓰지 마. 관련된 게 하나도 없으면 "없음" 한 줄만. 설명·인사 없이 줄만:\n레이어 | 표시이름 | 파일경로:라인 | 한줄역할 | → 다음노드이름\n(레이어 이름과 다음노드 표시이름은 지금 흐름에 있는 것과 정확히 맞춰. 파일경로는 위 실제 경로만.)`;
        const answer = await ask(ctx, prompt);
        if (my !== reqRef.current) return;
        if (answer.err) { setErr(answer.err); return; }
        const text = stripCardBlock(answer.text);
        const parsed = parseFlow(text);
        // 줄이 하나도 없으면 "없음"(관련 변경 없음)일 때만 정상 — 빈 답·엉뚱한 산문이면 스냅샷을 앞당기지 않고 오류로(다시 갱신 가능, 리뷰).
        if (!parsed.length && !/^[\s"'`*.。-]*(없음|none|なし)[\s"'`*.。-]*$/i.test(text)) { setErr(`no flow — ${text.slice(0, 140)}`); return; }
        const next = applyFlowDiff(sectionsRef.current ?? [], parsed, inc.removed, inc.structural);
        setSections(next); setOverviews({}); setTour(null); // 노드가 바뀜 → 깊이별 설명은 버림(저장도 안 넘김)
        const at = await archPut(root, "flow", { sections: next, overview: overviewRef.current }, feature, { token });
        if (!at) return saveFailed();
        if (my === reqRef.current) { atRef.current = at; unsavedRef.current = false; }
        if (my === reqRef.current) { setDiff(null); setNote(t("flow.diffUpdated", { n: inc.structural.length })); }
        return;
      }
      token ??= await archBegin(root); // 분석 시작 시점 스냅샷(AI가 도는 사이 고친 파일은 다음 갱신 대상으로 남게)
      const tr = await fetch("/api/repo/tree", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root }) });
      const td = await tr.json().catch(() => null);
      const files: string[] = td && Array.isArray(td.files) ? td.files : [];
      const list = files.filter((f) => !/(^|\/)(node_modules|\.git|dist|build|\.next|\.turbo)(\/|$)/.test(f)).slice(0, 600);
      const name = basename(root);
      // 실측 그래프 다이제스트(모듈·의존·허브) — 있으면 관련 파일 누락·환각↓(#842 서브3). 실패 시 폴백.
      const digest = await fetchGraphDigest(root);
      const ctx = `레포: ${name}\n파일 목록:\n${list.join("\n")}${digest ? `\n\n${digest}` : ""}`;
      const prompt = `레포 "${name}"에서 "${feature}" 기능의 아키텍처를 정리해줘.${digest ? " 아래 실측 코드그래프 구조(모듈·의존·허브)를 근거로, 이 기능에 실제로 연결된 파일을 허브·의존 따라 빠짐없이 찾되 없는 파일은 지어내지 마." : ""} 아래 두 부분을 순서대로:\n\n[설명]\n이 기능이 전체적으로 어떻게 동작하는지, 각 조각이 왜 있고 서로 어떻게 이어지는지, 데이터가 어디서 어디로 흐르는지를 개발 초보도 완전히 이해할 수 있게 친절하고 자세히. 형식은 마크다운으로:\n- 맨 위 큰 제목 한 줄(\`## 제목\`).\n- 흐름을 논리적 구간(예: 진입, 처리, provider 호출, 후처리·렌더)으로 나눠 **각 구간마다 \`### 소제목\` + 2~4문장**, 구간 사이는 \`---\` 한 줄로 구분.\n- 파일/함수 이름은 백틱(\`)으로 감싸. 파이프(|) 기호는 쓰지 마.\n\n[흐름]\n그 다음 각 노드를 한 줄씩, 아래 형식으로만:\n레이어 | 표시이름 | 파일경로:라인 | 한줄역할 | → 다음노드이름\n(진입(UI/route)→처리(IPC/handler)→서비스/로직→데이터/외부 순. 파일경로는 위 목록의 실제 경로. 라인 모르면 파일만. "→ 다음노드"는 흐름상 이어지는 노드 표시이름들(쉼표로 여러 개), 없으면 생략. 표시이름은 서로 정확히 일치시켜 연결되게. **중요: 이 기능과 관련된 파일은 하나도 빠뜨리지 말고 전부 노드로 넣어. [설명]에서 언급한 파일은 반드시 [흐름]에도 노드로 포함. 관련 있으면 확실치 않아도 넣되, 없는 파일을 지어내진 마.** 예: 진입·UI | AnalyzeControls | src/components/AnalyzeControls.tsx | 분석 버튼 | → analyze route)`;
      const answer = await ask(ctx, prompt);
      if (my !== reqRef.current) return; // 더 최신 요청이 진행 중 → 폐기
      if (answer.err) { setErr(answer.err); return; }
      const clean = stripCardBlock(answer.text); // 튜터가 자동으로 붙이는 nunopi-cards 블록 제거
      const parsed = parseFlow(clean);
      if (!parsed.length) { setErr(`no flow — ${clean.slice(0, 140)}`); return; }
      const ov = parseOverview(clean) || null;
      // 차분 정보 없는 갱신(옛 저장분)=기존 흐름에 새 노드만 병합, 그 외(재생성·구조 변화가 많은 갱신)=교체.
      const base = sectionsRef.current;
      const nextSecs = mode === "update" && base && !d ? mergeFlow(base, parsed) : parsed;
      setSections(nextSecs); setOverview(ov); setOverviews({}); setTour(null); secOfRef.current = feature;
      const at = await archPut(root, "flow", { sections: nextSecs, overview: ov }, feature, { token }); // 영속(#743 → #1320 서버)
      if (!at) return saveFailed();
      if (my === reqRef.current) { atRef.current = at; unsavedRef.current = false; }
      if (my === reqRef.current) setDiff(null); // 방금 저장 = 최신
    } catch (e) {
      if (my === reqRef.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === reqRef.current) { setLoading(false); setRunning(null); }
    }
  }, [feature, root, providerId, providerSettings, ask, t]);

  // 기능이 바뀌면 열려 있던 갱신·재생성 확인창을 닫음(다른 기능에 적용되지 않게, 리뷰).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 기능 전환 시 확인창 초기화
  useEffect(() => { setConfirm(null); }, [feature]);

  // 최신 sections·overview 미러(갱신 병합 기준).
  useEffect(() => { sectionsRef.current = sections; }, [sections]);
  useEffect(() => { overviewRef.current = overview; }, [overview]);

  // #1322 둘러보기 — 흐름 순서(tourOrder)대로 단계. 지금 흐름에 없는 노드 단계는 건너뜀(구조 변화 없는 갱신으로 지워진 노드).
  const tourSteps = useMemo(() => {
    if (!tour || !sections) return [];
    const have = new Set(sections.flatMap((s) => s.nodes.map((n) => nk(n.name))));
    return tour.steps.filter((st) => have.has(nk(st.name)));
  }, [tour, sections]);
  const startTour = useCallback(async () => {
    if (!feature || !root || !sectionsRef.current) return;
    if (tourSteps.length) { setTourIdx(0); return; }
    if (unsavedRef.current) { setErr(t("flow.saveFailed")); return; } // 저장 안 된 흐름엔 단계를 안 만듦 // 지금 흐름에 남은 단계가 없으면(노드가 다 지워짐) 새로 만듦(리뷰)
    const f = feature, d = depth, my = reqRef.current, at0 = atRef.current;
    setTourBusy(true); setErr(null);
    try {
      const order = tourOrder(sectionsRef.current);
      const byKey = new Map(sectionsRef.current.flatMap((s) => s.nodes.map((n) => [nk(n.name), { ...n, layer: s.layer }] as const)));
      const lines = order.map((name, i) => { const n = byKey.get(nk(name))!; return `${i + 1}. ${n.layer} | ${n.name} | ${n.file ?? ""}${n.line ? `:${n.line}` : ""} | ${n.role ?? ""}`; });
      const who = d === "beginner" ? "개발 초보도 이해하게 쉬운 말로" : d === "dev" ? "개발자 눈높이로 설계 이유와 데이터 흐름 위주로" : "숙련자 눈높이로 짧고 밀도 있게";
      const ctx = `레포: ${basename(root)}\n\n["${f}" 흐름 — 둘러볼 순서]\n${lines.join("\n")}${overviewRef.current ? `\n\n[설명]\n${overviewRef.current}` : ""}`;
      const prompt = `위 순서대로 "${f}" 기능을 처음 보는 사람에게 한 단계씩 안내하려고 해. 각 노드마다 ${who} 2~3문장으로, 이 단계에서 무슨 일이 일어나고 앞 단계에서 뭘 받아 다음 단계로 뭘 넘기는지 설명해줘. 형식은 노드마다 한 줄만, 순서 그대로:\n표시이름 | 설명\n(표시이름은 위와 정확히 같게. 설명 안에 파이프(|) 기호 금지. 인사·머리말 없이 줄만.)`;
      const answer = await ask(ctx, prompt);
      if (my !== reqRef.current) return;
      if (answer.err) { setErr(answer.err); return; }
      const got = new Map<string, string>();
      for (const raw of stripCardBlock(answer.text).split("\n")) {
        const line = raw.trim().replace(/^(?:[-*•]\s*|\d+[.)]\s+)/, ""); // 목록 표시만 뗌(숫자로 시작하는 이름 404.tsx 보존, 리뷰)
        const at = line.indexOf("|");
        if (at > 0) got.set(nk(line.slice(0, at)), line.slice(at + 1).trim());
      }
      // AI가 빠뜨린 노드는 한줄역할로 채움(단계가 비지 않게). 하나도 못 받으면 오류.
      if (!got.size) { setErr(`no tour — ${answer.text.slice(0, 140)}`); return; }
      const next: Tour = { depth: d, steps: order.map((name) => ({ name, text: got.get(nk(name)) || byKey.get(nk(name))?.role || "" })) };
      const saved = await archPatch(root, f, { tour: next }, at0);
      if (saved === "stale") return; // 그사이 흐름이 바뀜 — 버림
      if (saved === "fail") { if (my === reqRef.current) setErr(t("flow.saveFailed")); return; }
      if (my !== reqRef.current) return;
      setTour(next); setTourIdx(0);
    } finally { setTourBusy(false); }
  }, [feature, root, depth, ask, t, tourSteps.length]);

  // 지금 단계 카드 = 포커스 빛 + 화면 안으로.
  const tourName = tourIdx != null ? tourSteps[tourIdx]?.name : undefined;
  useEffect(() => {
    if (!tourName) return;
    const k = nk(tourName);
    setFocused(k); // 단계 이동 시 그 카드 포커스(기존 포커스 강조 재사용)
    nodeEls.current.get(k)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [tourName]);
  // 키보드 ←/→/Esc(입력창에 쓰는 중이면 무시).
  useEffect(() => {
    if (tourIdx == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return; // 그래프 모달 등이 위에 떠 있으면 그쪽 키(리뷰)
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowRight") setTourIdx((i) => (i == null ? i : Math.min(i + 1, tourSteps.length - 1)));
      else if (e.key === "ArrowLeft") setTourIdx((i) => (i == null ? i : Math.max(i - 1, 0)));
      else if (e.key === "Escape") { setTourIdx(null); setFocused(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tourIdx, tourSteps.length]);

  // #1322 지금 깊이(개발자·숙련자)로 설명글만 다시 쓰기 — 흐름(노드)은 그대로, 덧붙임으로만 저장(스냅샷 안 건드림).
  const writeDepth = useCallback(async () => {
    if (!feature || !root || depth === "beginner" || !sectionsRef.current) return;
    if (unsavedRef.current) { setErr(t("flow.saveFailed")); return; } // 저장 안 된 흐름엔 설명을 안 붙임
    const f = feature, d = depth, my = reqRef.current, at0 = atRef.current; // 쓰는 사이 재생성·갱신·기능 전환이 있으면(my 바뀜) 버림 — 새 흐름에 옛 설명이 붙지 않게
    setWriting(true); setErr(null);
    try {
      const cur = sectionsRef.current.flatMap((s) => s.nodes.map((n) => `${s.layer} | ${n.name} | ${n.file ?? ""}${n.line ? `:${n.line}` : ""} | ${n.role ?? ""}${n.next?.length ? ` | → ${n.next.join(", ")}` : ""}`));
      const ctx = `레포: ${basename(root)}\n\n["${f}" 흐름]\n${cur.join("\n")}${overviewRef.current ? `\n\n[초보용 설명]\n${overviewRef.current}` : ""}`;
      const who = d === "dev"
        ? "언어·프레임워크 기본은 아는 개발자 눈높이로. 비유는 빼고, 각 조각이 왜 이렇게 나뉘었는지(설계 이유), 데이터가 어떤 모양으로 어디서 어디로 가는지, 고칠 때 조심할 점 위주로"
        : "이 코드를 직접 고칠 숙련자 눈높이로 짧고 밀도 있게. 모듈 경계·지켜야 할 규칙(불변식)·실패하거나 경합이 생길 수 있는 지점·설계 트레이드오프 위주로";
      const prompt = `위 "${f}" 기능 흐름을 ${who} 설명해줘. 형식은 마크다운: 맨 위 \`## 제목\` 한 줄, 흐름을 구간으로 나눠 구간마다 \`### 소제목\` + 몇 문장, 구간 사이는 \`---\`. 파일/함수 이름은 백틱으로. 파이프(|) 기호와 흐름 줄 목록은 쓰지 마. 설명만.`;
      const answer = await ask(ctx, prompt);
      if (my !== reqRef.current) return;
      if (answer.err) { setErr(answer.err); return; }
      const text = parseOverview(stripCardBlock(answer.text));
      if (!text) { setErr(`no overview — ${answer.text.slice(0, 140)}`); return; }
      const saved = await archPatch(root, f, { overviews: { [d]: text } }, at0);
      if (saved === "stale") return; // 그사이 흐름이 바뀜(재생성·갱신) — 버림
      if (saved === "fail") { if (my === reqRef.current) setErr(t("flow.saveFailed")); return; }
      if (my === reqRef.current) setOverviews((o) => ({ ...o, [d]: text }));
    } finally { setWriting(false); }
  }, [feature, root, depth, ask, t]);

  // 코드그래프 실측 연결 조회 — 플로우 노드 파일들 사이 실제 imports/calls. 곡선 근거화(#842 서브4).
  useEffect(() => {
    const files = sections && root ? [...new Set(sections.flatMap((s) => s.nodes.map((n) => n.file).filter((f): f is string => !!f)))] : [];
    if (!root || !files.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 초기화(이미 비었으면 no-op)
      setConnKeys((prev) => (prev.size ? new Set() : prev));
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/repo/codegraph/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: root, files }) });
        const d = await r.json().catch(() => null);
        if (!alive || !Array.isArray(d?.connections)) return;
        const set = new Set<string>();
        for (const c of d.connections as { from: string; to: string }[]) set.add(`${c.from}|${c.to}`);
        setConnKeys(set);
      } catch { /* 그래프 조회 실패 → 근거화 없이 LLM 곡선만(graceful) */ }
    })();
    return () => { alive = false; };
  }, [sections, root]);

  // 연결선 좌표 측정 — 각 노드 DOM 위치를 컨테이너 기준 상대좌표로. wrap/리사이즈 후 다시.
  const measure = useCallback(() => {
    const cont = flowRef.current;
    if (!cont || !edges.length) { setLines([]); return; }
    const cr = cont.getBoundingClientRect();
    const keys = laneKeys;
    // 1) 유효 엣지 수집(양끝 DOM 존재하는 것만).
    const raw: { srcKey: string; tgtKey: string; grounded: boolean; a: HTMLElement; b: HTMLElement }[] = [];
    for (const e of edges) {
      const a = nodeEls.current.get(e.sk), b = nodeEls.current.get(e.tk);
      if (!a || !b || a === b) continue;
      raw.push({ srcKey: e.sk, tgtKey: e.tk, grounded: e.grounded, a, b });
    }
    // 2) 타깃별 incoming 개수 — 진입 y를 박스 높이에 분산(겹침 방지). 나감은 위쪽 한 점(버스)으로 모음.
    const inCount = new Map<string, number>();
    for (const r of raw) inCount.set(r.tgtKey, (inCount.get(r.tgtKey) ?? 0) + 1);
    const inIdx = new Map<string, number>();
    const out: Line[] = [];
    for (const r of raw) {
      const li = keys.indexOf(r.srcKey);
      const color = EDGE_COLORS[li % EDGE_COLORS.length];
      const laneX = LANE_MARGIN + (li % MAX_LANES) * LANE_GAP;
      const ar = r.a.getBoundingClientRect(), br = r.b.getBoundingClientRect();
      const xs = ar.left - cr.left, ys = ar.top - cr.top + ar.height * 0.24; // 나감: 위쪽(진입 밴드와 분리)
      const n = inCount.get(r.tgtKey)!;
      const k = inIdx.get(r.tgtKey) ?? 0; inIdx.set(r.tgtKey, k + 1);
      const frac = n === 1 ? 0.6 : 0.46 + ((k + 0.5) / n) * 0.44; // 들어옴: 0.46~0.90 균등 분산
      out.push({ key: `${r.srcKey}->${r.tgtKey}#${k}`, sk: r.srcKey, tk: r.tgtKey, color, laneX, xs, ys, xt: br.left - cr.left, yt: br.top - cr.top + br.height * frac, grounded: r.grounded });
    }
    setLines(out);
  }, [edges, laneKeys]);

  // feature 바뀌면 자동 로드.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 비동기 로드(내부 setState는 이펙트 동기 실행 아님)
  useEffect(() => { void load(); }, [load]);

  // 렌더 후 연결선 측정 + 컨테이너 리사이즈(wrap 변화) 시 재측정.
  useLayoutEffect(() => {
    measure();
    const cont = flowRef.current;
    if (!cont || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(cont);
    return () => ro.disconnect();
  }, [measure]);

  const [hovered, setHovered] = useState<string | null>(null); // 호버 카드 키(연결 강조)
  const [focused, setFocused] = useState<string | null>(null); // 클릭 포커스 카드 키(무관 어둡게)
  const anyEdge = edges.length > 0; // 엣지 있으면 선으로, 없으면 꺾쇠 폴백

  // 노드별 인접집합(자기 + 연결 대상, 양방향). edges 기반이라 실측 보강 연결도 호버 강조됨.
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => { let s = m.get(a); if (!s) { s = new Set([a]); m.set(a, s); } s.add(b); };
    if (sections) for (const sec of sections) for (const n of sec.nodes) add(nk(n.name), nk(n.name)); // 고립 노드도 자기 포함
    for (const e of edges) { add(e.sk, e.tk); add(e.tk, e.sk); }
    return m;
  }, [sections, edges]);
  const relatedOf = useCallback((key: string | null) => (key ? adjacency.get(key) ?? new Set([key]) : null), [adjacency]);

  // 포커스(클릭)는 밖·다른카드 누르기 전까지 계속 유지, 호버는 그 위에 추가 강조 — 두 집합 합집합.
  const hoverSet = relatedOf(hovered);
  const focusSet = relatedOf(focused);
  const inFocus = (k: string) => !!focused && !!focusSet?.has(k);
  const inHover = (k: string) => !!hovered && !!hoverSet?.has(k);
  const gutter = anyEdge // 왼쪽 배선 레인 폭 — 상한 캡(좁은 패널 보호)
    ? Math.min(MAX_GUTTER, LANE_MARGIN + Math.min(laneKeys.length, MAX_LANES) * LANE_GAP + LANE_PAD)
    : 0;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white dark:bg-[var(--s-pane)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <IconSitemap size={14} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
        <span className="mr-auto truncate text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{feature || t("flow.title")}</span>
        {feature && (
          <>
            {/* 이 아키텍처에 대해 질문 — 우측 챗에 arch 세션 열기(#746). 흐름 미생성이어도 가능(컨텍스트 폴백). */}
            {onAskArch && (
              <button type="button" onClick={() => onAskArch(feature)} title={t("flow.ask")} aria-label={t("flow.ask")}
                className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
                <IconMessageCircle size={13} stroke={2} aria-hidden />
              </button>
            )}
            {/* #1322 둘러보기 — 흐름 순서대로 카드 하나씩(단계 설명은 처음 한 번 AI). 흐름 없으면 비활성. */}
            <button type="button" onClick={() => void startTour()} disabled={loading || !sections || tourBusy} title={t("flow.tourTitle")} aria-label={t("flow.tourTitle")}
              className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-mustard-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-mustard-400">
              {tourBusy ? <IconLoader2 size={13} stroke={2} className="animate-spin" aria-hidden /> : <IconPlayerPlay size={13} stroke={2} aria-hidden />}
            </button>
            {/* 갱신 — 새 노드만 병합 추가(모달 확인). 흐름 없으면 비활성. */}
            <button type="button" onClick={() => setConfirm("update")} disabled={loading || !sections || writing || tourBusy} title={t("flow.updateTitle")} aria-label={t("flow.updateTitle")}
              className="shrink-0 rounded p-1 text-amber-500 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800">
              {running === "update" ? <IconLoader2 size={13} stroke={2} className="animate-spin" aria-hidden /> : <IconRefresh size={13} stroke={2} aria-hidden />}
            </button>
            {/* 재생성 — 전체 새로(모달 확인). */}
            <button type="button" onClick={() => setConfirm("regen")} disabled={loading || loadFailed || writing || tourBusy} title={t("flow.regenerateTitle")} aria-label={t("flow.regenerateTitle")}
              className="shrink-0 rounded p-1 text-mustard-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-mustard-400 dark:hover:bg-zinc-800">
              {running === "regen" ? <IconLoader2 size={13} stroke={2} className="animate-spin" aria-hidden /> : <IconSparkles size={13} stroke={2} aria-hidden />}
            </button>
          </>
        )}
        {onClose && (
          <button type="button" onClick={onClose} title={t("mem.close")} aria-label={t("mem.close")}
            className={`${feature ? "" : "ml-auto "}shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200`}>
            <IconX size={14} stroke={2} aria-hidden />
          </button>
        )}
      </div>
      <div className="nunopi-scroll min-h-0 flex-1 overflow-auto p-4">
        {!feature ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-zinc-400 dark:text-zinc-500">{t("flow.pickFeature")}</div>
        ) : loading && !sections ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-zinc-400 dark:text-zinc-500"><IconLoader2 size={16} stroke={2} className="animate-spin" aria-hidden /> {t("flow.loading")}</div>
        ) : err ? (
          <div className="flex flex-col gap-1"><p className="text-[12px] text-rose-500">{t("flow.error")}</p><p className="break-words text-[10px] text-zinc-400 dark:text-zinc-500">{err}</p></div>
        ) : sections ? (
          <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-3">
            {/* #1322 둘러보기 단계 박스 — 지금 단계 이름·설명 + 이전/다음/끝. 카드는 포커스 빛으로 따라감. */}
            {tourIdx != null && tourSteps[tourIdx] && (
              <div className="sticky top-0 z-30 rounded-lg border border-mustard-500/40 bg-white p-2.5 shadow-sm dark:border-mustard-400/40 dark:bg-[var(--s-bar)]">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 font-mono text-[10px] text-mustard-700 dark:text-mustard-400">{tourIdx + 1}/{tourSteps.length}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-700 dark:text-zinc-100">{tourSteps[tourIdx].name}</span>
                  <button type="button" onClick={() => setTourIdx((i) => Math.max((i ?? 0) - 1, 0))} disabled={tourIdx === 0} title={t("flow.tourPrev")} aria-label={t("flow.tourPrev")}
                    className="shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"><IconChevronLeft size={14} stroke={2} aria-hidden /></button>
                  <button type="button" onClick={() => setTourIdx((i) => Math.min((i ?? 0) + 1, tourSteps.length - 1))} disabled={tourIdx >= tourSteps.length - 1} title={t("flow.tourNext")} aria-label={t("flow.tourNext")}
                    className="shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"><IconChevronRight size={14} stroke={2} aria-hidden /></button>
                  <button type="button" onClick={() => { setTourIdx(null); setFocused(null); }} title={t("flow.tourEnd")} aria-label={t("flow.tourEnd")}
                    className="shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"><IconX size={13} stroke={2} aria-hidden /></button>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">{tourSteps[tourIdx].text}</p>
              </div>
            )}
            {/* #1320 낡음 표시 — 저장 뒤 바뀐 파일 수 + 갱신, 또는 방금 갱신이 한 일. 기존 보조 문구 톤 한 줄(새 패널 없음). */}
            {(note || (diff && diff.changed.length + diff.removed.length > 0)) && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {note ?? t("flow.stale", { n: diff!.changed.length + diff!.removed.length, m: diff!.structural.length + diff!.removed.length })}
                {!note && (
                  <button type="button" onClick={() => setConfirm("update")} disabled={loading || writing || tourBusy}
                    className="ml-1.5 font-medium text-mustard-700 hover:underline disabled:opacity-50 dark:text-mustard-400">{t("flow.updateTitle")}</button>
                )}
              </p>
            )}
            {/* 이 아키텍처 설명(초보용) — 흐름 위 접이식 박스(#743). */}
            {/* #1322 보기 깊이 — 초보=기본 설명, 개발자·숙련자=그 깊이로 다시 쓴 설명(없으면 기본 + 쓰기 버튼). 스위치는 제목 줄 오른쪽. */}
            {overview && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-800/40">
                <div className="flex w-full items-center gap-1.5 px-3 py-2">
                  <button type="button" onClick={() => setOverviewOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                    <IconBook2 size={13} stroke={2} className="shrink-0 text-mustard-600 dark:text-mustard-400" aria-hidden />
                    <span className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">{t("flow.overview")}</span>
                    <IconChevronDown size={14} stroke={2} className={`shrink-0 text-zinc-400 transition ${overviewOpen ? "" : "-rotate-90"}`} aria-hidden />
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5" role="group" title={t("graph.depthTitle")}>
                    {DEPTHS.map((d) => (
                      <button key={d} type="button" onClick={() => setDepth(d)} aria-pressed={depth === d}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${depth === d ? "bg-mustard-500/15 text-mustard-700 dark:bg-mustard-400/15 dark:text-mustard-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"}`}>{t(`graph.depth.${d}`)}</button>
                    ))}
                  </div>
                </div>
                {overviewOpen && (
                  <div className="border-t border-zinc-200/70 px-3.5 py-3 text-[12.5px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                    {depth !== "beginner" && !overviews[depth] && (
                      <p className="mb-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                        {t("flow.depthFallback")}
                        <button type="button" onClick={() => void writeDepth()} disabled={writing || loading}
                          className="ml-1.5 inline-flex items-center gap-1 font-medium text-mustard-700 hover:underline disabled:opacity-50 dark:text-mustard-400">
                          {writing && <IconLoader2 size={11} stroke={2} className="animate-spin" aria-hidden />}{t("flow.depthWrite", { depth: t(`graph.depth.${depth}`) })}
                        </button>
                      </p>
                    )}
                    <Markdown>{(depth !== "beginner" && overviews[depth]) || overview}</Markdown>
                  </div>
                )}
              </div>
            )}
            {/* 세로 단일컬럼 흐름 — 왼쪽 거터에 소스별 레인, 지하철식 직각 배선으로 박스를 안 뚫고 연결. 빈 곳 클릭 → 포커스 해제. */}
            <div ref={flowRef} onClick={() => setFocused(null)} style={{ paddingLeft: gutter }} className="relative flex w-full flex-col gap-2">
            {/* 배선 오버레이 — 노드보다 뒤에 깔림, 클릭은 통과. 화살촉은 타깃 왼쪽으로 진입. */}
            <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full overflow-visible" aria-hidden>
              <defs>
                {/* context-stroke: 화살촉이 각 선 색을 그대로 상속(선마다 색 달라도 한 marker로) */}
                <marker id="flow-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="context-stroke" />
                </marker>
              </defs>
              {lines.map((l) => {
                const sgn = l.yt >= l.ys ? 1 : -1;                          // 세로 진행 방향
                const r = Math.min(CORNER, Math.abs(l.yt - l.ys) / 2 || 0); // 짧은 세로구간에선 모서리 축소
                // 소스 왼쪽 → 레인까지 수평 → 레인 세로 → 타깃 왼쪽 수평(화살촉). 모서리 2곳 라운드.
                const d = `M ${l.xs} ${l.ys} L ${l.laneX + r} ${l.ys} Q ${l.laneX} ${l.ys} ${l.laneX} ${l.ys + sgn * r} L ${l.laneX} ${l.yt - sgn * r} Q ${l.laneX} ${l.yt} ${l.laneX + r} ${l.yt} L ${l.xt} ${l.yt}`;
                const incidentFocus = !!focused && (l.sk === focused || l.tk === focused);
                const incidentHover = !!hovered && (l.sk === hovered || l.tk === hovered);
                const hot = incidentFocus || incidentHover;                 // 포커스/호버 노드에 붙은 선 → 굵게
                const dim = !!focused && !incidentFocus && !incidentHover;   // 포커스 시 무관선 흐리게(호버선은 살림)
                // grounded(실측 뒷받침)=실선/진하게, LLM 추측만=점선/연하게 — 룩 유지, 근거 여부만 구분.
                return <path key={l.key} d={d} fill="none" stroke={l.color} strokeWidth={hot ? 3 : 1.75}
                  strokeDasharray={l.grounded ? undefined : "4 3"}
                  opacity={dim ? 0.1 : hot ? 1 : l.grounded ? 0.9 : 0.5} markerEnd="url(#flow-arrow)" className="transition-[stroke-width,opacity] duration-150" />;
              })}
            </svg>
            {sections.map((s, i) => (
              <div key={s.layer + i} className="relative flex flex-col gap-1.5 rounded-lg border border-zinc-100 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-800/30">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{s.layer}</div>
                {s.nodes.map((n, j) => {
                  const key = nk(n.name);
                  const lifted = inFocus(key) || inHover(key);           // 포커스 연결 대상(유지) + 호버 연결 대상 → 빛남
                  const dimmed = !!focused && !inFocus(key) && !inHover(key); // 포커스 시 무관 카드 어둡게(호버 대상은 살림)
                  const toggleFocus = () => setFocused((prev) => (prev === key ? null : key));
                  // 카드 클릭 시 그 노드 + 연결된 노드(나감 next + 들어옴)를 지칭하는 질문 좌표를 챗 입력창에(#746).
                  // 최대 축약 — 노드명만 지칭([name]). 연결 관계는 arch 세션 컨텍스트에 이미 들어있음.
                  const quote = () => { if (onQuoteNode) onQuoteNode(t("flow.quoteSolo", { name: n.name })); };
                  return (
                  // 카드 본문 클릭 = 포커스만(코드 자동 X). 코드/diff 패널은 우상단 아이콘으로만 연다(#743).
                  <div key={j} role="button" tabIndex={0}
                    ref={(el) => { if (el) nodeEls.current.set(key, el); }}
                    onMouseEnter={() => setHovered(key)} onMouseLeave={() => setHovered(null)}
                    onClick={(e) => { e.stopPropagation(); toggleFocus(); quote(); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFocus(); quote(); } }}
                    style={{ opacity: dimmed ? 0.3 : 1 }}
                    className={`group relative flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 pr-7 text-left transition duration-150 ${lifted ? "z-20 scale-[1.03] border-mustard-500 shadow-[0_0_16px_0_rgba(212,160,23,0.55)] dark:border-mustard-400 dark:shadow-[0_0_18px_0_rgba(232,185,58,0.55)]" : "z-10 border-zinc-200 hover:border-mustard-500 dark:border-zinc-700 dark:hover:border-mustard-400"} bg-white dark:bg-zinc-800/60`}>
                    {n.file && (
                      <button type="button" title={t("flow.openCode")} aria-label={t("flow.openCode")}
                        onClick={(e) => { e.stopPropagation(); onOpenFile?.(n.file!, n.line); }}
                        className="absolute right-1 top-1 rounded p-1 text-zinc-300 opacity-0 transition hover:bg-zinc-100 hover:text-mustard-600 group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-mustard-400">
                        <IconCode size={13} stroke={2} aria-hidden />
                      </button>
                    )}
                    <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-100">{n.name}</span>
                    {n.file && <span className="break-all font-mono text-[9px] text-mustard-600 dark:text-mustard-400">{n.file}{n.line ? `:${n.line}` : ""}</span>}
                    {n.role && <span className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{n.role}</span>}
                  </div>
                  );
                })}
                {!anyEdge && i < sections.length - 1 && (
                  <div className="flex justify-center text-zinc-300 dark:text-zinc-600"><IconChevronDown size={16} stroke={2} aria-hidden /></div>
                )}
              </div>
            ))}
            </div>
          </div>
        ) : null}
      </div>
      {/* 갱신·재생성 확인 모달 — 내용이 바뀌거나 추가될 수 있어 먼저 물어봄(#743). */}
      {confirm && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[18rem] rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-[var(--s-bar)]">
            <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-100">{confirm === "regen" ? t("flow.regenerateTitle") : t("flow.updateTitle")}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{confirm === "regen" ? t("flow.regenerate") : t("flow.update")}</p>
            <div className="mt-3 flex justify-end gap-1.5">
              <button type="button" onClick={() => setConfirm(null)}
                className="rounded-md px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">{t("confirm.cancel")}</button>
              <button type="button" onClick={() => { const m = confirm; setConfirm(null); void load(m); }}
                className="rounded-md bg-mustard-500/12 px-2.5 py-1 text-[11px] font-semibold text-mustard-700 ring-1 ring-inset ring-mustard-500/35 transition hover:bg-mustard-500/20 dark:bg-mustard-400/12 dark:text-mustard-400 dark:ring-mustard-400/30 dark:hover:bg-mustard-400/20">{t("confirm.ok")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
