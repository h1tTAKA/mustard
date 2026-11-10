// 에이전트 실행 설정(#1184) — 터미널 실행 때 main에 넘길 권한·유저 인자, 옛 추가 인자의 권한 플래그 옮기기.
import { AGENT_DEFAULTS, AKEYS, agentPermission, getSetting, setSetting } from "@mustard/core";
import { MODEL, MODEL_FLAG_AGENTS } from "@/lib/repo/fanoutJudge";

// 실행 payload — 권한(덮어쓰기 > 전체), 유저 인자(+ 이번만 붙일 것), 유저 환경변수 글(#1197). 해석·조립은 main 카탈로그가.
export function launchOpts(agent: string, extra = "") {
  return { permission: agentPermission(agent).choice, args: [getSetting<string>(AKEYS.args(agent), ""), extra].filter(Boolean).join(" "), env: getSetting<string>(AKEYS.env(agent), ""), trust: getSetting<boolean>(AKEYS.trustFolder, AGENT_DEFAULTS.trustFolder) };
}

// 겨루기 후보 모델(#1313) — `--model`을 받는 에이전트만(MODEL_FLAG_AGENTS). 설정 추가 인자 뒤에 붙어 이번 실행만 바뀜.
// 한계: 설정 인자에 이미 --model이 있으면 둘 다 붙음(대부분 뒤에 것이 이김).
// 서버도 검사하지만 실행 줄에 그대로 들어가니 여기서도 한 번 더(리뷰). 여기서 걸리는 건 손으로 고친 기록뿐 — 기본 모델로 띄우고 콘솔에 남김
export const modelArg = (agent: string, model?: string) => {
  if (!model || !MODEL_FLAG_AGENTS.has(agent)) return "";
  if (MODEL.test(model)) return `--model ${model}`;
  console.warn(`[fanout] bad model for ${agent}, launching with its default`);
  return "";
};

// 옛 추가 인자에 알려진 권한 플래그가 있으면 빼서 그 에이전트의 권한 덮어쓰기로 — 한 번만.
// 예: 예전에 claude 칸에 --dangerously-skip-permissions를 적어 둔 사람 → claude = 전체 액세스, 칸은 나머지만.
export async function liftStoredArgs(ids: string[]) {
  const lift = window.nunopiDesktop?.liftAgentArgs;
  if (!lift || getSetting<boolean>(AKEYS.argsLifted, false)) return;
  let failed = false;
  for (const id of ids) {
    const args = getSetting<string>(AKEYS.args(id), "");
    if (!args.trim() || getSetting<string>(AKEYS.permOf(id), "")) continue;
    const r = await lift(id, args).catch(() => { failed = true; return null; });
    if (r) { setSetting(AKEYS.args(id), r.rest); setSetting(AKEYS.permOf(id), r.choice); } // 동작은 예전과 같음(확인창 기록은 안 건드림 — 다음에 직접 고를 땐 확인, 리뷰)
  }
  if (!failed) setSetting(AKEYS.argsLifted, true); // 실패가 있으면 다음 실행에 다시(리뷰)
}
