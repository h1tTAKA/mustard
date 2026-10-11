"use client";

// 홈 엔트리(#896/#902). 첫 실행이면 온보딩, 그 다음 nunopiEnabled로 학습 홈 vs 워크스페이스 전용 홈 분기.
// 학습 홈은 React.lazy 동적 로드 → nunopi off(Mustard-only) 경로는 학습 청크를 안 싣는다.
// onboarded 판정은 client 마운트 후(localStorage) — SSR 하이드레이션 불일치 방지(null=미확정→배경).
import { lazy, Suspense, useEffect, useState } from "react";
import { isNunopiEnabled } from "@/lib/product";
import WorkspaceOnlyHome from "./WorkspaceOnlyHome";
import Onboarding from "./Onboarding";
import BrowserWindowView from "./BrowserWindowView";

const LearningHome = lazy(() => import("./LearningHome"));
const SPLASH = <div className="h-full w-full bg-white dark:bg-zinc-950" />;

export default function Home() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [browserWin, setBrowserWin] = useState<{ url: string; repo: string } | null>(null); // #1034 분리 브라우저 창
  useEffect(() => {
    let done = true; // localStorage 불가 환경이면 온보딩 스킵(true)
    try { done = localStorage.getItem("mustard:onboarded") === "1"; } catch { /* keep true */ }
    // client 마운트 후 1회 판정 — SSR 하이드레이션 불일치 회피용 의도된 set-state-in-effect.
    const q = new URLSearchParams(window.location.search);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (q.get("win") === "browser") setBrowserWin({ url: q.get("url") || "", repo: q.get("repo") || "" });
    setOnboarded(done);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  if (browserWin) return <BrowserWindowView url={browserWin.url} repo={browserWin.repo} />;
  if (onboarded === null) return SPLASH;                 // client 마운트 전 — 깜빡임 방지
  if (!onboarded) return <Onboarding onDone={() => setOnboarded(true)} />;
  if (!isNunopiEnabled()) return <WorkspaceOnlyHome />;
  return (
    <Suspense fallback={SPLASH}>
      <LearningHome />
    </Suspense>
  );
}
