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
assert.ok(!/"Read"/.test(src), "읽기 도구는 앱 없이 허용 안 함(비밀 경로)");
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
// 앱이 없을 때 할 일 목록(TodoWrite)만 바로 허용(기다리지 않음) — 읽기는 비밀 경로일 수 있어 기다림
const dead = await free();
const rd = await new Promise<{ out: string; ms: number }>((res) => {
  const t0 = Date.now();
  const p = spawn(process.execPath, [hook, `--url=http://127.0.0.1:${dead}`, "--run=x", "--token=y"]);
  let out = ""; p.stdout.on("data", (c) => (out += c));
  p.on("close", () => res({ out, ms: Date.now() - t0 }));
  p.stdin.end(JSON.stringify({ tool_name: "TodoWrite", tool_input: {} }));
});
assert.match(rd.out, /"permissionDecision":"allow"/); assert.ok(rd.ms < 2500, "기다리지 않음");
// "전부 허용" 모드 채팅은 앱이 없어도 바로 허용(토큰이 맞을 때만) — 훅 옆 폴더의 채팅 파일로 판단
const id = "11111111-2222-3333-4444-555555555555";
const sub = join(dir, "abc"); (await import("node:fs")).mkdirSync(sub, { recursive: true });
writeFileSync(join(sub, `${id}.json`), JSON.stringify({ id, mode: "full", token: "tok" }));
const runAs = (token: string, tool: string, killMs: number) => new Promise<{ out: string; ms: number }>((res) => {
  const t0 = Date.now();
  const p = spawn(process.execPath, [hook, `--url=http://127.0.0.1:${dead}`, `--run=${id}`, `--token=${token}`]);
  let out = ""; p.stdout.on("data", (c) => (out += c));
  const k = setTimeout(() => p.kill(), killMs);
  p.on("close", () => { clearTimeout(k); res({ out, ms: Date.now() - t0 }); });
  p.stdin.end(JSON.stringify({ tool_name: tool, tool_input: { file_path: "/x" } }));
});
const full = await runAs("tok", "Write", 5000);
assert.match(full.out, /"permissionDecision":"allow"/, "전부 허용 모드는 앱 없이 허용"); assert.ok(full.ms < 2500);
const wrong = await runAs("bad", "Write", 2500);
assert.equal(wrong.out, "", "토큰이 다르면 바로 허용 안 함(앱을 기다림)");
writeFileSync(join(sub, `${id}.json`), JSON.stringify({ id, mode: "default", token: "tok" }));
const def = await runAs("tok", "Write", 2500);
assert.equal(def.out, "", "기본 모드는 앱을 기다림");
console.log("chatHook ok");
