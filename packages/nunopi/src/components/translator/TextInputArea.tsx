"use client";

import { IconEraser, IconMessageCircle } from "@tabler/icons-react";
import type { ItTerm } from "@mustard/core";
import type { AgentProviderKind } from "../../lib/agent";
import { highlightTerms } from "../../lib/highlightTerms";
import { ProviderSelect, AnalyzeButton, AnalyzeError } from "./AnalyzeControls";
import { useT } from "@mustard/core";

interface TextInputAreaProps {
  code: string; // 붙여넣은 글(분석 입력).
  isLoading: boolean;
  onCodeChange: (next: string) => void;
  chatOpen?: boolean;
  onToggleChat?: () => void;
  // 분석 결과가 있으면 입력 잠금(실수 수정 방지). 클리어로만 새 입력.
  locked?: boolean;
  onClear?: () => void;
  // 분석된 IT 용어 — locked 읽기 오버레이에서 하이라이트/클릭에 사용.
  terms?: ItTerm[];
  // 글 안의 용어를 클릭하면 학습패널의 그 용어 카드로 스크롤(termId 전달).
  onTermClick?: (termId: string) => void;
  // 분석 컨트롤 — 툴바 strip 해체로 입력 헤더에 들어옴.
  providerId: AgentProviderKind;
  onProviderChange: (id: AgentProviderKind) => void;
  onAnalyze: () => void | Promise<void>;
  onCancel: () => void;
  resumable?: boolean;
  onResume?: () => void;
  errorMessage?: string | null;
}

// 글(IT 용어) 분석 모드 입력 — 산문을 붙여넣는 plain textarea.
// (코드 모드의 Monaco 에디터는 산문 하이라이팅이 부적합해 별도 컴포넌트로 둔다.)
export default function TextInputArea({ code, isLoading, onCodeChange, chatOpen, onToggleChat, locked = false, onClear, terms, onTermClick, providerId, onProviderChange, onAnalyze, onCancel, resumable = false, onResume, errorMessage = null }: TextInputAreaProps) {
  const t = useT();
  const charCount = code.trim().length;
  // 분석 완료(locked)면 textarea 대신 읽기 오버레이로 용어를 하이라이트한다.
  const showHighlighted = locked && (terms?.length ?? 0) > 0;
  const segments = showHighlighted ? highlightTerms(code, terms ?? []) : [];

  return (
    <div className="flex h-full flex-col gap-2 bg-white p-4 dark:bg-[var(--ink)]">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t("input.textTitle")}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <ProviderSelect providerId={providerId} onProviderChange={onProviderChange} disabled={isLoading} />
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{t("input.chars", { n: charCount })}</span>
          <AnalyzeButton
            isLoading={isLoading}
            resumable={resumable}
            locked={locked}
            onAnalyze={onAnalyze}
            onCancel={onCancel}
            onResume={onResume}
          />
          {locked && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-red-100 hover:text-red-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              title={t("input.clearTextHint")}
            >
              <IconEraser size={14} stroke={2} aria-hidden /> {t("input.clear")}
            </button>
          )}
          {onToggleChat && (
            <button
              type="button"
              onClick={onToggleChat}
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium transition ${
                chatOpen
                  ? "bg-lime-600 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
              title={t("chat.toggleLearning")}
            >
              <IconMessageCircle size={14} stroke={2} aria-hidden /> {t("input.ask")}
            </button>
          )}
          {errorMessage && <AnalyzeError message={errorMessage} onRetry={onAnalyze} />}
        </div>
      </div>

      {/* flex-1로 데스크톱 높이를 채우고, 모바일에선 min-h로 바닥 확보 */}
      <div className="min-h-[160px] flex-1 md:min-h-[320px]">
        {showHighlighted ? (
          // 읽기 오버레이 — 분석된 용어를 클릭 가능한 하이라이트로. 줄바꿈/공백 보존.
          <div className="nunopi-scroll h-full w-full overflow-y-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-[#F2F0E8] p-4 text-sm leading-relaxed text-zinc-900 dark:border-zinc-800 dark:bg-[#1A1B26] dark:text-zinc-100">
            {segments.map((seg, idx) =>
              seg.termId ? (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onTermClick?.(seg.termId!)}
                  className="rounded bg-blue-100 px-0.5 font-medium text-blue-700 underline decoration-blue-400 decoration-dotted underline-offset-2 transition hover:bg-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
                  title={t("term.viewInPanel")}
                >
                  {seg.text}
                </button>
              ) : (
                <span key={idx}>{seg.text}</span>
              ),
            )}
          </div>
        ) : (
          <textarea
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            disabled={isLoading}
            readOnly={locked}
            spellCheck={false}
            placeholder={t("input.textPlaceholder")}
            className="h-full w-full resize-none rounded-xl border border-zinc-200 bg-[#F2F0E8] p-4 text-sm leading-relaxed text-zinc-900 outline-none transition focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-[#1A1B26] dark:text-zinc-100 dark:focus:border-zinc-600"
          />
        )}
      </div>
    </div>
  );
}