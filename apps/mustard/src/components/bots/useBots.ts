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
  // 응답 순서 — 늦게 끝난 옛 GET이 설치·빼기 뒤 목록을 덮지 않게, 요청마다 번호를 매기고 마지막 번호만 반영(리뷰)
  const seq = useRef(0);
  const reload = useCallback(() => {
    const my = ++seq.current;
    fetch("/api/crew/bots").then((r) => r.json()).then((j) => {
      if (my !== seq.current) return;
      if (!j?.ok) throw new Error(j?.error);
      setBots(j.bots); setCatalog(j.catalog); setError(false);
    }).catch(() => { if (my === seq.current) setError(true); }); // 못 읽음 ≠ 봇 없음 — 빈 목록으로 두지 않음(첫 실행 화면으로 착각 방지)
  }, []);
  // 봇 홈이 보일 때마다 다시 읽음(다른 창·레포 패널에서 바뀌었을 수 있음)
  useEffect(() => { if (active) reload(); }, [active, reload]);
  const op = useCallback(async (body: BotOp): Promise<Bot[] | null> => {
    const my = ++seq.current;
    try {
      const j = await fetch("/api/crew/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (!j?.ok) return null;
      if (my === seq.current) { setBots(j.bots); setError(false); }
      return j.bots as Bot[];
    } catch { return null; }
  }, []);
  return { bots, catalog, error, reload, op };
}
