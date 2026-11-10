"use client";

import { useRef, useState } from "react";
import { useT, useToast } from "@mustard/core";

// 작업 폴더 setup 줄(#1170·#1174) — 폴더마다 setup 스크립트를 하나씩 돌리고, 다 끝나면 then 실행.
// 승인 안 된 스크립트면 setup에 내용을 담아 멈춤 → decide(true=믿고 돌림 / false=이번엔 안 돌림)로 이어 감.
// 새 작업공간 창과 겨루기 화면(#1313)이 같이 씀. lock = 줄이 끝날 때까지 chain을 켜 둠(겨루기: 첫 setup이 끝나도 나머지가 남음)
const post = async (body: Record<string, unknown>) => (await fetch("/api/repo/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

export function useSetupChain(root: string) {
  const t = useT();
  const toast = useToast();
  const [setup, setSetup] = useState<{ dir: string; script: string } | null>(null); // 승인 기다리는 setup
  const [deciding, setDeciding] = useState(false);
  const [chain, setChain] = useState(false);
  const queue = useRef<string[]>([]);
  const after = useRef<(() => void) | null>(null); // setup이 전부 끝난 뒤(겨루기: 그때 에이전트를 띄움 — setup 중에 같은 폴더를 건드리지 않게)

  const finish = () => {
    const next = queue.current.shift();
    if (next) { void runSetup(next); return; }
    const go = after.current; after.current = null;
    setChain(false);
    go?.();
  };
  const runSetup = async (dir: string) => {
    const s = await post({ action: "setup", path: root, dir }).catch(() => null);
    if (!s?.ok) { toast(t("newWs.setupFailed"), "error"); finish(); return; }
    if (s.status === "untrusted") { setSetup({ dir, script: s.script }); return; }
    if (s.status === "too-long") toast(t("newWs.setupTooLong"), "error");
    else if (s.status === "failed") toast(t("newWs.setupFailed"), "error");
    else if (s.status === "ok") toast(t("newWs.setupOk"));
    finish();
  };
  const decide = async (trust: boolean) => {
    if (!setup) return;
    setDeciding(true);
    const r = await post({ action: "trust", kind: "setup", path: root, dir: setup.dir, script: setup.script, skip: !trust }).catch(() => null);
    setDeciding(false);
    if (!r?.ok) { toast(t("newWs.setupChanged"), "error"); setSetup(null); finish(); return; }
    const dir = setup.dir;
    setSetup(null);
    if (trust) { toast(t("newWs.setupRunning")); void runSetup(dir); } else finish();
  };
  // dirs[0]부터 차례로. 첫 setup 결과(또는 승인 묻기)까지 기다렸다 돌아옴
  const start = async (dirs: string[], then: () => void, lock = false) => {
    if (!dirs.length) { then(); return; }
    queue.current = dirs.slice(1);
    after.current = then;
    if (lock) setChain(true);
    await runSetup(dirs[0]);
  };
  return { setup, deciding, chain, decide, start };
}

// 겨루기 후보 만들기(#1174) — 서버가 후보마다 작업 폴더·브랜치를 만들고 기록을 남김
export type FanoutCreated = { ok: true; id: string; candidates: { agent: string; dir: string }[] } | { ok: false; error: string };
export async function createFanoutRun(o: { root: string; name: string; prompt: string; agents: string[]; base: string; prefix: string }): Promise<FanoutCreated> {
  const r = await fetch("/api/repo/fanout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", path: o.root, name: o.name, prompt: o.prompt, agents: o.agents, base: o.base, prefix: o.prefix }) })
    .then((x) => x.json()).catch((e) => ({ ok: false, error: String(e) }));
  return r.ok ? { ok: true, id: r.fanout.id, candidates: r.fanout.candidates } : { ok: false, error: String(r.error ?? "") };
}
