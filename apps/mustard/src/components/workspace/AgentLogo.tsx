// 에이전트 브랜드 로고 + 프로세스명 식별(#764) — 레포탭 호버 카드에서 "어떤 에이전트가 도는가"를 아이콘으로.
// 잘 알려진 에이전트는 인라인 브랜드 마크(CSP 안전), 그 외 알려진 에이전트는 브랜드색 모노그램. 셸/미지 프로세스는 에이전트 아님.

import CodexLogo from "@/components/workspace/CodexLogo";
import AntigravityLogo from "@/components/workspace/AntigravityLogo";
import HermesLogo from "@/components/workspace/HermesLogo";
import CursorLogo from "@/components/workspace/CursorLogo";
import OpenCodeLogo from "@/components/workspace/OpenCodeLogo";
import OmpLogo from "@/components/workspace/OmpLogo";

export type AgentId = "claude" | "codex" | "gemini" | "antigravity" | "hermes" | "aider" | "opencode" | "cursor" | "copilot" | "amp" | "grok" | "omp" | "other";

// 프로세스명 → 에이전트 매칭. foreground 프로세스명(node-pty proc.process)에 대해 검사.
const MATCH: [AgentId, RegExp][] = [
  ["claude", /claude/i],
  ["codex", /codex/i],
  ["gemini", /gemini/i],
  ["antigravity", /antigravity/i],
  ["hermes", /hermes/i],
  ["aider", /aider/i],
  ["opencode", /open-?code/i],
  ["cursor", /cursor/i],
  ["copilot", /copilot/i],
  ["amp", /^amp$/i],
  ["grok", /grok/i],
  ["omp", /^omp$/i],
];

// 셸 프로세스명(유휴 상태 — 에이전트 안 돎). 선행 "-"(login shell) 정규화 후 비교.
const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "ksh", "pwsh", "powershell", "cmd", "login", "screen", "tmux"]);

function norm(processName: string | undefined): string {
  return (processName || "").trim().toLowerCase().replace(/^-+/, "");
}

// 알려진 에이전트면 그 id, 아니면 null(셸이든 다른 프로세스든). 카드가 null을 "유휴/기타"로 분기.
export function identifyAgent(processName: string | undefined): AgentId | null {
  const p = norm(processName);
  if (!p) return null;
  for (const [id, re] of MATCH) if (re.test(p)) return id;
  return null;
}

// 셸(프롬프트 대기 = 유휴)인가.
export function isShellProcess(processName: string | undefined): boolean {
  return SHELLS.has(norm(processName));
}

export const AGENT_META: Record<AgentId, { label: string; color: string }> = {
  claude: { label: "Claude", color: "#D97757" },   // Anthropic coral
  codex: { label: "Codex", color: "#7C6BF5" },     // Codex 앱 블루퍼플
  gemini: { label: "Gemini", color: "#4285F4" },   // Google blue
  antigravity: { label: "Antigravity", color: "#1A73E8" }, // Google Antigravity blue
  hermes: { label: "Hermes", color: "#C026D3" },   // Nous Hermes magenta
  aider: { label: "Aider", color: "#14B8A6" },
  opencode: { label: "OpenCode", color: "#F59E0B" },
  cursor: { label: "Cursor", color: "#6B7280" },
  copilot: { label: "Copilot", color: "#8B5CF6" },
  amp: { label: "Amp", color: "#F34E3F" },   // 로고(lobe-icons)와 같은 색
  grok: { label: "Grok Build", color: "#9CA3AF" },  // 중립 그레이(흑백 브랜드 — 양 테마서 보이게)
  omp: { label: "OMP", color: "#F97316" },          // oh-my-pi — 브랜드 주황
  other: { label: "Agent", color: "#6B7280" },
};

// 에이전트 브랜드 마크. 알려진 에이전트는 공식 로고(인라인), 그 외는 브랜드색 모노그램 원형.
export function AgentLogo({ agent, size = 14 }: { agent: AgentId; size?: number }) {
  const c = AGENT_META[agent]?.color ?? "#6B7280";
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  if (agent === "claude") {
    // Anthropic 선버스트 — 중심에서 12방향 광선.
    return (
      <svg {...common}>
        <g stroke={c} strokeWidth={1.9} strokeLinecap="round">
          {[0, 30, 60, 90, 120, 150].map((deg) => {
            const a = (deg * Math.PI) / 180, dx = Math.cos(a) * 10.6, dy = Math.sin(a) * 10.6;
            return <line key={deg} x1={12 - dx} y1={12 - dy} x2={12 + dx} y2={12 + dy} />;
          })}
        </g>
      </svg>
    );
  }
  if (agent === "gemini") {
    // Gemini 4점 스파클.
    return <svg {...common}><path d="M12 2c.4 5.3 4.3 9.6 10 10-5.7.4-9.6 4.3-10 10-.4-5.7-4.3-9.6-10-10 5.7-.4 9.6-4.3 10-10z" fill={c} /></svg>;
  }
  if (agent === "codex") return <CodexLogo size={size} />;    // 공식 로고(#803)
  if (agent === "antigravity") return <AntigravityLogo size={size} />;   // 공식 로고(#803)
  if (agent === "hermes") return <HermesLogo size={size} />;   // 공식 로고(#803, currentColor)
  if (agent === "cursor") return <CursorLogo size={size} />;   // 공식 로고(#803, PNG 에셋)
  if (agent === "opencode") return <OpenCodeLogo size={size} />; // 공식 마크(#864, 유저 SVG)
  if (agent === "omp") return <OmpLogo size={size} />;          // oh-my-pi(#864, 레포 SVG)
  if (agent === "grok") {
    // Grok(xAI) 공식 로고 — 단일 path·currentColor(탭 글자색 따라감, 양 테마 가시).
    return <svg {...common} fill="currentColor" style={{ fillRule: "evenodd" }}><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" /></svg>;
  }
  if (agent === "copilot") {
    // GitHub Copilot 공식 아이콘(primer/octicons copilot-24) — currentColor(양 테마 가시).
    return <svg {...common} fill="currentColor"><path d="M23.922 16.992c-.861 1.495-5.859 5.023-11.922 5.023-6.063 0-11.061-3.528-11.922-5.023A.641.641 0 0 1 0 16.736v-2.869a.841.841 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.195 10.195 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952 1.399-1.136 3.392-2.093 6.122-2.093 2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.832.832 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256ZM12.172 11h-.344a4.323 4.323 0 0 1-.355.508C10.703 12.455 9.555 13 7.965 13c-1.725 0-2.989-.359-3.782-1.259a2.005 2.005 0 0 1-.085-.104L4 11.741v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.323 4.323 0 0 1-.355-.508h-.016.016Zm.641-2.935c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z" /><path d="M14.5 14.25a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Zm-5 0a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Z" /></svg>;
  }
  if (agent === "amp") {
    // Amp(Sourcegraph) 마크 — lobehub/lobe-icons amp-color(#F34E3F).
    return <svg {...common} fill="#F34E3F"><path d="M15.087 23.18L12.03 24l-2.097-7.823-5.738 5.738-2.251-2.251 5.718-5.719-7.769-2.082.82-3.057 11.294 3.08 3.08 11.295z" /><path d="M19.505 18.762l-3.057.82-2.564-9.573-9.572-2.564.819-3.057 11.295 3.079 3.08 11.295z" /><path d="M23.893 14.374l-3.057.82-2.565-9.572L8.7 3.057 9.52 0l11.295 3.08 3.079 11.294z" /></svg>;
  }
  if (agent === "aider") {
    // Aider 공식 favicon(aider.chat assets/icons) 픽셀 "a" — 6×5 격자를 그대로 옮김.
    return <svg {...common}><rect width={24} height={24} rx={4} fill="#013720" /><g fill="#00FFB1"><rect x={6} y={3.0} width={3} height={3.6} /><rect x={9} y={3.0} width={3} height={3.6} /><rect x={12} y={3.0} width={3} height={3.6} /><rect x={15} y={6.6} width={3} height={3.6} /><rect x={6} y={10.2} width={3} height={3.6} /><rect x={9} y={10.2} width={3} height={3.6} /><rect x={12} y={10.2} width={3} height={3.6} /><rect x={15} y={10.2} width={3} height={3.6} /><rect x={3} y={13.8} width={3} height={3.6} /><rect x={15} y={13.8} width={3} height={3.6} /><rect x={6} y={17.4} width={3} height={3.6} /><rect x={9} y={17.4} width={3} height={3.6} /><rect x={12} y={17.4} width={3} height={3.6} /><rect x={18} y={17.4} width={3} height={3.6} /></g></svg>;
  }
  // 그 외 알려진 에이전트 — 브랜드색 원형 + 첫 글자 모노그램.
  const label = AGENT_META[agent]?.label ?? "A";
  return (
    <svg {...common}>
      <circle cx={12} cy={12} r={9} fill="none" stroke={c} strokeWidth={1.6} />
      <text x={12} y={16} textAnchor="middle" fontSize={11} fontWeight={700} fill={c}>{label[0]}</text>
    </svg>
  );
}
