"use client";

import { IconEraser, IconMessageCircle } from "@tabler/icons-react";
import type { AgentProviderKind } from "../../lib/agent";
import CodeEditor from "./CodeEditor";
import { ProviderSelect, AnalyzeButton, AnalyzeError } from "./AnalyzeControls";
import { useT } from "@mustard/core";

// 에디터 하이라이팅용 언어 선택 — 분석/탐지 도메인(SupportedLanguage)과 별개로
// 개발자가 흔히 쓰는 언어를 폭넓게 제공. 값은 그대로 CodeEditor가 Monaco id로 매핑.
export type LanguageChoice =
  | "auto"
  | "react"
  | "typescript"
  | "javascript"
  | "tailwindcss"
  | "html"
  | "css"
  | "scss"
  | "json"
  | "yaml"
  | "markdown"
  | "python"
  | "java"
  | "csharp"
  | "cpp"
  | "c"
  | "go"
  | "rust"
  | "ruby"
  | "php"
  | "swift"
  | "kotlin"
  | "dart"
  | "sql"
  | "shell"
  | "dockerfile";

const LANGUAGE_OPTIONS: { value: LanguageChoice; label: string }[] = [
  { value: "auto", label: "자동 감지" },
  { value: "react", label: "React (JSX/TSX)" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "csharp", label: "C#" },
  { value: "cpp", label: "C++" },
  { value: "c", label: "C" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "dart", label: "Dart" },
  { value: "sql", label: "SQL" },
  { value: "shell", label: "Shell / Bash" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "scss", label: "SCSS" },
  { value: "tailwindcss", label: "Tailwind CSS" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "markdown", label: "Markdown" },
  { value: "dockerfile", label: "Dockerfile" },
];

interface CodeInputAreaProps {
  code: string;
  isLoading: boolean;
  languageChoice: LanguageChoice;
  // Monaco 하이라이팅용 언어 문자열(자동 감지면 SupportedLanguage, 아니면 선택값).
  editorLanguage: string;
  onLanguageChoiceChange: (choice: LanguageChoice) => void;
  onCodeChange: (nextCode: string) => void;
  activeLine?: number | null;
  onLineClick?: (line: number) => void;
  markedLines?: number[];
  chatOpen?: boolean;
  onToggleChat?: () => void;
  // 분석 결과가 있으면 입력 잠금(실수 수정 방지). 클리어로만 새 입력.
  locked?: boolean;
  onClear?: () => void;
  // 분석 컨트롤 — 툴바 strip 해체로 입력 헤더에 들어옴.
  providerId: AgentProviderKind;
  onProviderChange: (id: AgentProviderKind) => void;
  onAnalyze: () => void | Promise<void>;
  onCancel: () => void;
  resumable?: boolean;
  onResume?: () => void;
  errorMessage?: string | null;
}

export default function CodeInputArea({
  code,
  isLoading,
  languageChoice,
  editorLanguage,
  onLanguageChoiceChange,
  onCodeChange,
  activeLine = null,
  onLineClick,
  markedLines,
  chatOpen,
  onToggleChat,
  locked = false,
  onClear,
  providerId,
  onProviderChange,
  onAnalyze,
  onCancel,
  resumable = false,
  onResume,
  errorMessage = null,
}: CodeInputAreaProps) {
  const t = useT();
  return (
    <div className="flex h-full flex-col gap-2 bg-white p-4 dark:bg-[var(--ink)]">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t("input.codeTitle")}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <ProviderSelect providerId={providerId} onProviderChange={onProviderChange} disabled={isLoading} />
          <select
            value={languageChoice}
            disabled={isLoading || locked}
            onChange={(event) =>
              onLanguageChoiceChange(event.target.value as LanguageChoice)
            }
            aria-label={t("input.selectCodeLang")}
            title={
              languageChoice === "auto"
                ? t("input.autoDetectedLang", { lang: editorLanguage })
                : t("input.selectCodeLang")
            }
            className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 outline-none transition focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-500"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.value === "auto" ? t("input.autoDetect") : opt.label}
              </option>
            ))}
          </select>
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
              title={t("input.clearCodeHint")}
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

      {/* flex-1로 데스크톱 높이를 채우고, 모바일(높이 미고정)에선 min-h로 바닥 확보 */}
      <div className="min-h-[160px] flex-1 md:min-h-[320px]">
        <CodeEditor
          value={code}
          onChange={onCodeChange}
          language={editorLanguage}
          readOnly={isLoading || locked}
          fill
          activeLine={activeLine}
          onLineClick={onLineClick}
          markedLines={markedLines}
        />
      </div>
    </div>
  );
}