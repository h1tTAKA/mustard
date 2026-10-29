// terminalRender 점검 — node --experimental-strip-types packages/core/src/terminalRender.check.ts
import assert from "node:assert";
import { readGpuMode as gpu, gpuAllowed as ok, resolveMinContrast as mc, isLightColor as light } from "./terminalRender.ts";

assert.strictEqual(gpu(undefined, true), "auto", "옛 켜짐 = 자동");
assert.strictEqual(gpu(undefined, false), "off", "옛 꺼짐 = 끄기");
assert.strictEqual(gpu(undefined, undefined), "auto");
assert.strictEqual(gpu("on", false), "on", "새 값이 있으면 그걸");
assert.strictEqual(gpu("nope", true), "auto");
assert.ok(ok("auto", false, null), "맥·윈도우 자동 = WebGL");
assert.ok(!ok("auto", true, "Mesa llvmpipe (LLVM 15)"), "리눅스 소프트웨어 렌더 = 일반 렌더");
assert.ok(!ok("auto", true, null), "리눅스에서 GPU 이름을 못 읽으면 일반 렌더");
assert.ok(ok("auto", true, "NVIDIA GeForce RTX 3080"));
assert.ok(ok("on", true, "llvmpipe") && !ok("off", false, null));
assert.strictEqual(mc("auto", true), 4.5);
assert.strictEqual(mc(undefined, false), 3);
assert.strictEqual(mc(1, true), 1, "1 = 끄기");
assert.strictEqual(mc(30, false), 21, "범위 1~21");
assert.ok(light("#ffffff") && light("#fff") && !light("#0a0a0a") && !light("#282c34"));
assert.ok(!light("nope"));
console.log("terminalRender ok");
