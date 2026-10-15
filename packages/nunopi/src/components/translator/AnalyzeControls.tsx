"use client";

import type { AgentProviderKind } from "../../lib/agent";
import { PROVIDER_CATALOG } from "../../lib/agent/catalog";
import { useConfirm } from "@mustard/core";
import { useT } from "@mustard/core";

// 입력 패널 헤더에 분산 배치되는 분석 컨트롤 조각들 — 코드/글 입력 영역 공용.
// (예전 ProviderToolbar strip을 해체해 여기로 옮김.)

export function ProviderSelect({
  providerId,
  onProviderChange,
  disabled = false,
}: {
  providerId: AgentProviderKind;
  onProviderChange: (id: AgentProviderKind) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <select
      value={providerId}
      disabled={disabled}
      onChange={(e) => onProviderChange(e.target.value as AgentProviderKind)}
      aria-label={t("input.provider")}
      title={t("input.provider")}
      className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 outline-none transition focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-500"
    >
      {PROVIDER_CATALOG.map((p) => (
        <option key={p.id} value={p.id}>
          {t(`provider.${p.id}`)}
        </option>
      ))}
    </select>
  );
}

// 단일 버튼이 상태에 따라 교체:
//  분석중→멈추기(회색) / 중단·resumable→이어서하기 / 완료(locked)→재분석 요청(경고 confirm) / else→분석요청하기.
export function AnalyzeButton({
  isLoading,
  resumable = false,
  locked = false,
  onAnalyze,
  onCancel,
  onResume,
}: {
  isLoading: boolean;
  resumable?: boolean;
  locked?: boolean;
  onAnalyze: () => void | Promise<void>;
  onCancel: () => void;
  onResume?: () => void;
}) {
  const confirm = useConfirm();
  const t = useT();
  if (isLoading) {
    return (
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 whitespace-nowrap rounded-lg bg-zinc-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-600 dark:bg-zinc-600 dark:hover:bg-zinc-500"
      >
        {t("input.stop")}
      </button>
    );
  }
  if (resumable && onResume) {
    return (
      <button
        type="button"
        onClick={onResume}
        title={t("analyze.resumeHint")}
        className="shrink-0 whitespace-nowrap rounded-lg bg-[#3B34E2] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#322bc9]"
      >
        {t("input.resume")}
      </button>
    );
  }
  // 이미 분석이 끝난 입력 → 재분석은 기존 결과를 덮어쓰므로 경고 confirm 후 진행.
  if (locked) {
    return (
      <button
        type="button"
        onClick={async () => {
          if (await confirm({ title: t("confirm.reanalyzeTitle"), message: t("confirm.reanalyze"), confirmText: t("confirm.reanalyzeTitle") })) void onAnalyze();
        }}
        title={t("analyze.reanalyzeHint")}
        className="shrink-0 whitespace-nowrap rounded-lg bg-[#3B34E2] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#322bc9]"
      >
        {t("input.reanalyze")}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        void onAnalyze();
      }}
      className="shrink-0 whitespace-nowrap rounded-lg bg-[#3B34E2] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#322bc9]"
    >
      {t("input.analyze")}
    </button>
  );
}

export function AnalyzeError({ message, onRetry }: { message: string; onRetry: () => void | Promise<void> }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
      <span>{message}</span>
      <button
        type="button"
        onClick={() => {
          void onRetry();
        }}
        className="font-medium underline hover:no-underline"
      >
        {t("input.retry")}
      </button>
    </div>
  );
}
