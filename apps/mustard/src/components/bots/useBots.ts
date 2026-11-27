// 봇 목록 훅(#1397) — GET/POST /api/crew/bots. 이름·설명 표시 규칙도 여기(기본 역할은 i18n).
import { useCallback, useEffect, useRef, useState } from "react";
import type { Bot, BotOp } from "@/lib/crew/crewBots";
import type { CatalogItem } from "@/lib/crew/crewCatalog";

export type { Bot };
type T = (k: string, v?: Record<string, string | number>) => string;

// 기본 역할은 role.name이 비어 있어 i18n 이름. 봇 이름을 바꿨으면(meta.name) listBots가 이미 덮어 줌.
export const botName = (t: T, b: Bot) => b.name || (b.builtin ? t(`crew.role.${b.id}`) : b.id);
// 직접 만든 봇 = 임무 첫 줄, 기본 역할 = i18n 설명, 카탈로그 봇 = 설치 때 고른 언어 설명.
export const botDesc = (t: T, b: Bot) => b.mission?.split("\n")[0] || (b.builtin ? t(`crew.roleDesc.${b.id}`) : b.description);

export function useBots(active: boolean) {
  const [bots, setBots] = useState<Bot[] | null>(null); // null = 아직 못 읽음
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [error, setError] = useState(false);
  // 응답 순서(리뷰) — seq = 마지막 GET만 반영, gen = 설치·빼기가 끝날 때마다 +1.
  // GET은 보낼 때의 gen을 기억했다가, 그 사이 설치·빼기가 끝났으면 버림(옛 목록이 새 목록을 덮지 않게). 설치·빼기 결과는 늘 반영.
  const seq = useRef(0), gen = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve()); // 설치·빼기는 한 줄로 차례대로 — 겹치지 않으니 결과가 늘 최신(리뷰)
  const reload = useCallback(() => {
    const my = ++seq.current, g = gen.current;
    fetch("/api/crew/bots").then((r) => r.json()).then((j) => {
      if (my !== seq.current || g !== gen.current) return;
      if (!j?.ok) throw new Error(j?.error);
      setBots(j.bots); setCatalog(j.catalog); setError(false);
    }).catch(() => { if (my === seq.current && g === gen.current) setError(true); }); // 못 읽음 ≠ 봇 없음 — 빈 목록으로 두지 않음(첫 실행 화면으로 착각 방지)
  }, []);
  // 봇 홈이 보일 때마다 다시 읽음(다른 창·레포 패널에서 바뀌었을 수 있음)
  useEffect(() => { if (active) reload(); }, [active, reload]);
  const op = useCallback((body: BotOp): Promise<Bot[] | null> => {
    const run = async (): Promise<Bot[] | null> => {
      try {
        const j = await fetch("/api/crew/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }).then((r) => r.json()); // 멈춘 요청이 뒤 줄을 막지 않게(리뷰)
        if (!j?.ok) { reload(); return null; } // 서버가 거절(다른 창이 이미 바꿈 등) → 목록 다시 맞춤(리뷰)
        gen.current++;
        setBots(j.bots); setError(false);
        return j.bots as Bot[];
      } catch { setTimeout(reload, 2_000); return null; } // 시간 초과여도 서버가 곧 처리할 수 있음 → 조금 뒤 다시 맞춤(리뷰)
    };
    const p = chain.current.then(run, run);
    chain.current = p;
    return p;
  }, [reload]);
  return { bots, catalog, error, reload, op };
}
