"use client";

import { useT } from "@mustard/core";
import { cardFrame } from "../../lib/srs/cardFrame";
import type { SrsSource } from "@mustard/core";
import { CardTitle } from "./CardTitle";
import { EcoTag } from "./EcoTag";

interface FlashCardProps {
  front: string;
  back: string;
  source: SrsSource; // 테두리 색 구분(token=emerald, concept=amber, term=blue)
  eco?: string; // #1388 토큰 카드 소속(Flutter 등) — 로고와 이름 사이
  flipped: boolean;
  onFlip: () => void;
  reduced: boolean; // prefers-reduced-motion — true면 회전 애니 생략
}

const SYMBOL = "/brand/nunopi-symbol-darkeye-transparent.png";

// 3D 플립 카드 — 흰색 포커카드. 앞: 나노피 심볼 위 + 용어. 뒤: 좌상단 작은 심볼 + 용어 + 설명.
export default function FlashCard({ front, back, source, eco, flipped, onFlip, reduced }: FlashCardProps) {
  const t = useT();
  const f = cardFrame(source);
  return (
    <div className="mx-auto aspect-[5/7] w-full max-w-xs [perspective:1200px]">
      <button
        type="button"
        onClick={onFlip}
        aria-label={flipped ? back : front}
        className={`relative h-full w-full cursor-pointer [transform-style:preserve-3d] ${
          reduced ? "" : "transition-transform duration-500"
        } ${flipped ? "[transform:rotateY(180deg)]" : ""}`}
      >
        {/* 앞면 — 심볼 + 용어. 가장자리 장식 프레임(텍스트는 중앙 여백에 또렷). */}
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-xl [backface-visibility:hidden]">
          <span className={`pointer-events-none absolute inset-2.5 rounded-xl border-2 ${f.outer}`} />
          <span className={`pointer-events-none absolute inset-[14px] rounded-lg border ${f.inner}`} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SYMBOL} alt="" className="relative h-12 w-12 object-contain" />
          <EcoTag name={eco} className="-mb-2 text-sm" />
          <CardTitle text={front} className="relative text-xl font-bold text-zinc-900" />
          <span className="relative text-xs text-zinc-400">{t("mem.flipHint")}</span>
        </span>
        {/* 뒷면 — 심볼(제목 위 중앙) + 용어 + 설명. 앞면과 같은 배치. */}
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-xl [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <span className={`pointer-events-none absolute inset-2.5 rounded-xl border-2 ${f.outer}`} />
          <span className={`pointer-events-none absolute inset-[14px] rounded-lg border ${f.inner}`} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SYMBOL} alt="" className="relative h-12 w-12 object-contain" />
          <EcoTag name={eco} className="-mb-1.5 text-xs" />
          <CardTitle text={front} className="relative text-lg font-bold text-zinc-900" />
          <span className="relative whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">
            {back || t("mem.noExplanation")}
          </span>
        </span>
      </button>
    </div>
  );
}
