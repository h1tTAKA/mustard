"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconExternalLink, IconTrash } from "@tabler/icons-react";
import { useT } from "@mustard/core";
import { useConfirm, CKEYS } from "@mustard/core";
import { useToast } from "@mustard/core";
import type { Card } from "@mustard/core";
import { canGoToSource } from "../../lib/srs/cardSource";
import { cardFrame } from "../../lib/srs/cardFrame";
import { deleteCard } from "../../lib/srs/deleteCard";
import type { AgentProviderKind, ProviderSettings } from "../../lib/agent";
import CardExplainPanel from "./CardExplainPanel";
import MemorizeChat from "./MemorizeChat";
import CardInfoPanel from "./CardInfoPanel";
import CardStageBar from "./CardStageBar";
import { CardTitle } from "./CardTitle";
import { EcoTag } from "./EcoTag";

const SYMBOL = "/brand/nunopi-symbol-darkeye-transparent.png";
// 도착 후 화면 중앙에서 멈춰 있는 자세(살짝 기운 채 확대). 낙하는 이 자세에서 이어진다.
const REST = "translate3d(0px,-6px,0) rotateZ(-4deg) scale(2.85)";

interface Fly {
  id: number;
  card: Card; // 실제 카드 — 면 렌더 + 추가설명/챗 패널에 사용
  inKf: Keyframe[]; // 도착 애니(출발점 → 중앙 정지)
  sway: number; // 낙하 방향(좌/우)
  fallY: number; // 낙하 목표 y(화면 밖)
  openChat?: boolean; // peek 뜰 때 챗룸을 바로 열기(전역 히스토리 카드챗 이동용)
  instant?: boolean; // 설정서 애니 끔(#641) — 비행 스킵, 카드 즉시 표시
}

// throwCard(card, origin?): origin(DOMRect) 위치에서 카드가 3D로 날아와 중앙에 멈춘다.
// 멈추면 왼쪽에 추가설명, 우하단에 챗봇(플래시카드 세션과 동일). 오버레이 클릭 시 낙하·사라짐.
// origin 생략 시 등록된 originRef(부채꼴 자리)에서 출발.
interface FlyApi {
  throwCard: (card: Card, origin?: DOMRect, opts?: { openChat?: boolean }) => void;
  originRef: React.RefObject<HTMLElement | null>; // 출발점으로 쓸 요소(부채꼴 컨테이너) 등록용
}

const FlyCtx = createContext<FlyApi>({ throwCard: () => {}, originRef: { current: null } });
export function useFlyCard(): FlyApi {
  return useContext(FlyCtx);
}

// 카드 던지기 애니를 화면 어디서든 공유 — 포탈 오버레이 + Web Animations API 재생을 소유.
// DeckFan(부채꼴)·MemorizeInsights(인사이트 항목)가 같은 연출을 재사용한다.
export function FlyCardProvider({
  active = true,
  providerId,
  providerSettings,
  sourceIds,
  onGoToSource,
  children,
}: {
  active?: boolean; // 암기 탭이 화면에 켜져 있는지 — 꺼지면(분석 보는 중) 오버레이 숨김(fly 상태는 유지)
  providerId: AgentProviderKind;
  providerSettings: ProviderSettings;
  sourceIds: Set<string>; // 현존 분석 히스토리 id — 출처 이동 버튼 노출 판별
  onGoToSource: (card: Card) => void; // 카드 출처로 이동(종류별 분기는 상위에서)
  children: React.ReactNode;
}) {
  const t = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const [fly, setFly] = useState<Fly | null>(null);
  const [arrived, setArrived] = useState(false); // 중앙 도착·정지 완료(이후 클릭하면 낙하)
  const [dropping, setDropping] = useState(false); // 낙하 진행 중
  const flyId = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const inAnimRef = useRef<Animation | null>(null); // 도착 애니 핸들 — 낙하 시작 전 정리용
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const throwCard = useCallback((card: Card, origin?: DOMRect, opts?: { openChat?: boolean }) => {
    if (reduced || typeof window === "undefined") return;
    // 출발점: 넘겨받은 origin, 없으면 등록된 originRef(부채꼴), 그것도 없으면 화면 중앙.
    const r = origin ?? originRef.current?.getBoundingClientRect();
    const cx = r ? r.left + r.width / 2 : window.innerWidth / 2;
    const cy = r ? r.top + r.height / 2 : window.innerHeight / 2;
    // 출발점 중심 → 화면 중앙 기준 px 오프셋(그 자리에서 출발).
    const sx = cx - window.innerWidth / 2;
    const sy = cy - window.innerHeight / 2;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const sway = Math.random() < 0.5 ? -1 : 1;
    const spin = (Math.random() < 0.5 ? -1 : 1) * rnd(160, 460); // 날아오며 회전(패턴 랜덤)
    const s1 = rnd(60, 140), s2 = rnd(40, 100); // 바람 흔들림 폭(px)
    const fallY = window.innerHeight * 1.25; // 화면 밑으로 완전히
    // 출발 스케일 — 누른 카드 폭 기준(카드 엘리먼트 w-36=144px). 그 크기에서 떠올라 peek(REST≈2.85)까지 블렌드.
    const REST_S = 2.85;
    const s0 = Math.max(0.5, r ? r.width / 144 : 0.6); // 하한 가드(극단적 좁은 origin 방어)
    const sA = s0 + (REST_S - s0) * 0.25;
    const sB = s0 + (REST_S - s0) * 0.6;
    // 도착: 카드 자리(원본 크기) → 바람에 흔들리며 곡선으로 → 가운데 부딪힘 → 바운스 → 중앙 정지(REST).
    const inKf: Keyframe[] = [
      { offset: 0, opacity: 0.6, transform: `translate3d(${sx}px,${sy}px,-120px) rotateZ(${rnd(-25, 25)}deg) scale(${s0})`, easing: "cubic-bezier(0.3,0.7,0.4,1)" },
      { offset: 0.18, opacity: 1, transform: `translate3d(${sx * 0.7 + sway * s1}px,${sy * 0.7 - s1}px,-90px) rotateY(${spin * 0.4}deg) rotateZ(${sway * 12}deg) scale(${sA})`, easing: "ease-in-out" },
      { offset: 0.46, opacity: 1, transform: `translate3d(${sx * 0.35 - sway * s2}px,${sy * 0.4 + s2 * 0.4}px,-40px) rotateY(${spin * 0.7}deg) rotateZ(${-sway * 8}deg) scale(${sB})`, easing: "ease-in-out" },
      { offset: 0.72, opacity: 1, transform: `translate3d(0,0,0) rotateX(7deg) rotateY(-11deg) rotateZ(-7deg) scale(2.95)`, easing: "cubic-bezier(0.2,0.9,0.3,1)" }, // 부딪힘
      { offset: 0.85, opacity: 1, transform: `translate3d(0,-18px,0) rotateX(7deg) rotateY(-11deg) rotateZ(-7deg) scale(2.74)` }, // 바운스
      { offset: 1, opacity: 1, transform: REST }, // 중앙 정지
    ];
    // 설정서 애니 끔(#641) — throw 시점 localStorage 직접 읽어 즉시 반영. off면 비행 스킵.
    const instant = typeof localStorage !== "undefined" && localStorage.getItem("nunopi:card-fly") === "off";
    setArrived(false);
    setDropping(false);
    setFly({ id: ++flyId.current, card, inKf, sway, fallY, openChat: opts?.openChat, instant });
  }, [reduced]);

  // 도착 애니 — fly 세팅 시 재생, 끝나면 중앙에 정지 유지(fill forwards) + arrived 플래그.
  useLayoutEffect(() => {
    if (!fly || !cardRef.current) return;
    const anim = cardRef.current.animate(fly.inKf, { duration: fly.instant ? 0 : 1700, fill: "forwards" });
    inAnimRef.current = anim;
    const onArrive = () => setArrived((a) => (fly.id === flyId.current ? true : a));
    anim.addEventListener("finish", onArrive);
    if (fly.instant) onArrive(); // 즉시표시 — duration 0 finish에 의존 않고 바로 peek(레이스 방어)
    return () => anim.cancel();
  }, [fly]);

  // 낙하 애니 — 클릭으로 dropping 켜지면 REST 자세에서 아래로 떨어져 사라진 뒤 제거.
  useLayoutEffect(() => {
    if (!dropping || !fly || !cardRef.current) return;
    inAnimRef.current?.cancel(); // 정지(fill forwards) 도착 애니 제거 후 낙하로 인계
    const { sway, fallY } = fly;
    const outKf: Keyframe[] = [
      { offset: 0, opacity: 1, transform: REST },
      { offset: 0.12, opacity: 1, transform: `translate3d(0,-30px,0) rotateZ(-6deg) scale(2.86)`, easing: "cubic-bezier(0.45,0.05,0.6,1)" }, // 살짝 들렸다가
      { offset: 0.9, opacity: 1, transform: `translate3d(${sway * 24}px,${fallY * 0.72}px,0) rotateZ(${sway * 16}deg) scale(2.5)` },
      { offset: 1, opacity: 0, transform: `translate3d(${sway * 34}px,${fallY}px,0) rotateZ(${sway * 22}deg) scale(2.4)` },
    ];
    const anim = cardRef.current.animate(outKf, { duration: fly.instant ? 0 : 1100, fill: "forwards" });
    const done = () => { setFly(null); setArrived(false); setDropping(false); };
    anim.addEventListener("finish", done);
    anim.addEventListener("cancel", done);
    return () => anim.cancel();
  }, [dropping, fly]);

  const api = useMemo<FlyApi>(() => ({ throwCard, originRef }), [throwCard]);
  const peek = !!fly && arrived && !dropping; // 중앙 정지 상태 — 추가설명/챗 노출

  // 카드 삭제 — 확인 모달(되돌릴 수 없음) 후 삭제 + peek 닫기.
  async function handleDelete() {
    if (!fly) return;
    const card = fly.card;
    const ok = await confirm({ skipKey: CKEYS.skipDelete, title: t("mem.deleteCardTitle"), message: t("mem.deleteCardMsg"), confirmText: t("common.delete"), danger: true });
    if (!ok) return;
    deleteCard(card);
    setFly(null); setArrived(false); setDropping(false);
    toast(t("card.deleted", { term: card.front }));
  }

  return (
    <FlyCtx.Provider value={api}>
      {children}
      {fly && typeof document !== "undefined" && createPortal(
        <div
          className={`fixed inset-0 z-[70] flex items-center justify-center ${!active ? "hidden" : peek ? "bg-black/85" : "pointer-events-none"}`}
          style={{ perspective: "1200px" }}
        >
          {/* 중앙 카드(확대) — 이 카드를 클릭해야만 낙하·닫힘(배경 클릭은 무효). */}
          <div
            ref={cardRef}
            onClick={() => { if (peek) setDropping(true); }}
            className={`relative aspect-[5/7] w-36 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 ${peek ? "cursor-pointer" : ""}`}
            style={{ transformStyle: "preserve-3d" }}
          >
            {/* 실제 카드 면 — 흰 포커카드(파란 이중 프레임 + 심볼 + 용어 + 설명). 확대 시 읽힌다. */}
            <span className={`pointer-events-none absolute inset-[6%] rounded-[10%] border-2 ${cardFrame(fly.card.source).outer}`} />
            <span className={`pointer-events-none absolute inset-[9%] rounded-[8%] border ${cardFrame(fly.card.source).inner}`} />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3.5 py-4 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={SYMBOL} alt="" className="h-5 w-5 shrink-0 object-contain" />
              <EcoTag name={fly.card.eco} className="text-[7px]" />{/* #1388 소속 언어·프레임워크 — 확대 카드에도 */}
              <CardTitle text={fly.card.front} className="text-[11px] font-bold leading-tight text-zinc-900" />
              <span className="line-clamp-6 whitespace-pre-wrap text-[7px] leading-snug text-zinc-600">
                {fly.card.back || t("mem.noExplanation")}
              </span>
            </div>
          </div>

          {/* 도착·정지 후 — 플래시카드 세션처럼 왼쪽 추가설명 + 우하단 챗 + 안내(패널 클릭은 낙하 안 되게 stopPropagation). */}
          {peek && (
            <>
              {/* 왼쪽 — 추가설명 패널(있으면 캐시, 없으면 생성) */}
              <div
                className="absolute left-20 top-1/2 hidden -translate-y-1/2 cursor-auto xl:block"
                onClick={(e) => e.stopPropagation()}
              >
                <CardExplainPanel card={fly.card} providerId={providerId} providerSettings={providerSettings} flipped />
              </div>

              {/* 우상단 — 카드 정보 패널 + 암기 단계(플래시카드 세션과 동일 스택) */}
              <div
                className="absolute right-20 top-16 hidden w-56 flex-col gap-2 cursor-auto xl:flex"
                onClick={(e) => e.stopPropagation()}
              >
                <CardInfoPanel card={fly.card} />
                <CardStageBar card={fly.card} />
              </div>

              {/* 우하단 — 카드 저장 챗 세션 */}
              <div className="cursor-auto" onClick={(e) => e.stopPropagation()}>
                <MemorizeChat card={fly.card} providerId={providerId} providerSettings={providerSettings} autoOpen={fly.openChat} />
              </div>

              {/* 하단 — 출처로 이동 + 삭제 + 안내 */}
              <div className="absolute bottom-10 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  {canGoToSource(fly.card, sourceIds) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const c = fly.card;
                        // 카드발 출처는 같은 화면(갤러리)로 가므로 peek을 닫아 갤러리가 보이게.
                        // analysis발은 다른 뷰로 전환·복귀 위해 fly 유지(active로 오버레이만 숨김).
                        if (c.sourceKind === "card") { setFly(null); setArrived(false); setDropping(false); }
                        onGoToSource(c);
                      }}
                      className="flex cursor-pointer items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 transition hover:bg-white/20"
                    >
                      {t("mem.goToSource")}
                      <IconExternalLink size={13} stroke={2} aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDelete(); }}
                    className="flex cursor-pointer items-center gap-1 rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/35"
                  >
                    {t("common.delete")}
                    <IconTrash size={13} stroke={2} aria-hidden />
                  </button>
                </div>
                <span className="text-xs font-medium text-white/70">{t("mem.flyDismiss")}</span>
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </FlyCtx.Provider>
  );
}
