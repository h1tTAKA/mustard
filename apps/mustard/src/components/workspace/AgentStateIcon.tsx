// 에이전트 상태 아이콘(#764/#765, #1036) — 레포 탭·호버 카드·터미널 탭 공용. 작업중=앰버 스피너, 대기(yes/no)=앰버 물음표,
// 막힘=빨간 경고, 완료=초록 체크. 예상 밖 값은 아무것도 안 그림(빨간 삼각형 오탐 방지).
import { IconCircleCheck, IconLoader2, IconQuestionMark, IconAlertTriangle } from "@tabler/icons-react";

export function AgentStateIcon({ state }: { state: string | null | undefined }) {
  if (state === "done") return <IconCircleCheck size={13} stroke={2} className="shrink-0 text-emerald-500" aria-hidden />;
  if (state === "working") return <IconLoader2 size={13} stroke={2.5} className="shrink-0 animate-spin text-amber-500" aria-hidden />;
  if (state === "waiting") return <IconQuestionMark size={13} stroke={2.5} className="shrink-0 text-amber-500" aria-hidden />;
  if (state === "blocked") return <IconAlertTriangle size={13} stroke={2.5} className="shrink-0 text-rose-500" aria-hidden />;
  return null;
}
