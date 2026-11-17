// chatHook 점검 — node --experimental-strip-types src/lib/chat/chatHook.check.ts
// 실제 Crew 훅 소스(crewRunner.ts의 HOOK_SRC)로 채팅 훅을 만들어 돌려 봄: 앱(서버)이 늦게 떠도 다시 시도해 답을 받음.
import assert from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chatHookSrc } from "./chatHook.ts";

const crew = readFileSync(new URL("../crew/crewRunner.ts", import.meta.url), "utf8");
const base = crew.match(/export const HOOK_SRC = `([\s\S]*?)`;\n/)![1];
const src = chatHookSrc(base);
assert.ok(src.includes("/api/chat/permission") && !src.includes("/api/crew/permission"));
assert.ok(src.includes("for (;;)"), "다시 시도 고리가 들어감");
const dir = mkdtempSync(join(tmpdir(), "chat-hook-"));
const hook = join(dir, "hook.cjs");
writeFileSync(hook, src);

const free = () => new Promise<number>((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });
const run = (port: number) => new Promise<{ out: string; ms: number }>((res) => {
  const t0 = Date.now();
  const p = spawn(process.execPath, [hook, `--url=http://127.0.0.1:${port}`, "--run=x", "--token=y"]);
  let out = ""; p.stdout.on("data", (c) => (out += c));
  p.on("close", () => res({ out, ms: Date.now() - t0 }));
  p.stdin.end(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }));
});

const port = await free();
let seen = "";
const srv = createServer((q, r) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { seen = q.url + " " + b; r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ decision: "allow" })); }); });
setTimeout(() => srv.listen(port, "127.0.0.1"), 3500); // 앱이 3.5초 뒤에 다시 열림
const a = await run(port);
srv.close();
assert.match(a.out, /"permissionDecision":"allow"/, "앱이 늦게 떠도 다시 시도해 허용을 받음");
assert.ok(a.ms >= 3000, "기다렸다가");
assert.match(seen, /^\/api\/chat\/permission .*"run":"x".*"token":"y"/);
// 앱이 없을 때 읽기 도구는 바로 허용(기다리지 않음)
const dead = await free();
const rd = await new Promise<{ out: string; ms: number }>((res) => {
  const t0 = Date.now();
  const p = spawn(process.execPath, [hook, `--url=http://127.0.0.1:${dead}`, "--run=x", "--token=y"]);
  let out = ""; p.stdout.on("data", (c) => (out += c));
  p.on("close", () => res({ out, ms: Date.now() - t0 }));
  p.stdin.end(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x" } }));
});
assert.match(rd.out, /"permissionDecision":"allow"/); assert.ok(rd.ms < 2500, "기다리지 않음");
console.log("chatHook ok");
