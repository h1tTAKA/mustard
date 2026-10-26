// SNA 동시 세션 줄(#1093, #1162 우선순위) — snaAgentProvider에서 뗌(점검 가능).
// #1093 SNA 런타임 동시 세션 상한(기본 5) — 넘으면 "Max active sessions" 에러. 우리 호출(자동 설명·해설·요약·질문)을
// 프로세스 단위 슬롯으로 줄 세우고(1개는 다른 사용처 몫으로 남김), 그래도 상한이면(다른 곳이 쓰는 중) 기다렸다 재시도.
export const SNA_SLOTS = 4;
// globalThis — Next가 라우트마다(analyze·observe·backfill) 이 모듈을 따로 번들해도 한 프로세스에서 한 줄.
export const snaQ = ((globalThis as unknown as { __nunopiSnaQ?: { busy: number; waiters: (() => void)[] } }).__nunopiSnaQ ??= { busy: 0, waiters: [] });
// #1162 priority = 사람이 기다리는 답(Crew 대화방) — 대기 줄 맨 앞에(앱 켠 직후 캐치업 자동 설명이 칸을 차지해도 바로 다음 차례).
export async function acquireSnaSlot(signal?: AbortSignal, priority = false): Promise<() => void> {
  while (snaQ.busy >= SNA_SLOTS) {
    let woken = false;
    await new Promise<void>((res) => {
      const wake = () => { woken = true; signal?.removeEventListener("abort", onAbort); res(); };
      const onAbort = () => { const i = snaQ.waiters.indexOf(wake); if (i >= 0) snaQ.waiters.splice(i, 1); res(); }; // 취소 = 줄에서 빠지고 바로 깸
      if (priority) snaQ.waiters.unshift(wake); else snaQ.waiters.push(wake);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    if (signal?.aborted) { if (woken) snaQ.waiters.shift()?.(); throw new Error("Analysis cancelled."); } // 깨움을 받았으면 다음 대기자에게
  }
  snaQ.busy++;
  let done = false;
  return () => { if (done) return; done = true; snaQ.busy--; snaQ.waiters.shift()?.(); };
}

// #1162 취소하면 다음 이벤트를 안 기다리고 바로 던짐 → 자리 즉시 반납(SDK runOnceStream엔 signal이 없음, 조용히 멈춘 CLI면 600초 동안 자리 붙잡았음).
// 한계: SNA 쪽 실행은 자기 timeout까지 남을 수 있음(SNA 상한 5 중 1개 여유 + 상한 에러 재시도로 버팀) — SDK가 signal 받으면 그걸로.
export async function* abortable<T>(src: AsyncIterable<T>, signal?: AbortSignal): AsyncGenerator<T> {
  if (!signal) { yield* src; return; }
  const it = src[Symbol.asyncIterator]();
  let f = () => {};
  const stop = new Promise<never>((_, rej) => {
    f = () => rej(new Error("Analysis cancelled."));
    if (signal.aborted) f(); else signal.addEventListener("abort", f, { once: true });
  });
  stop.catch(() => {});
  try {
    for (;;) { const r = await Promise.race([it.next(), stop]); if (r.done) return; yield r.value; }
  } finally { signal.removeEventListener("abort", f); void it.return?.(undefined)?.catch(() => {}); } // return은 멈춘 next 뒤에 줄 섬 — 연결 닫기는 최선만
}
