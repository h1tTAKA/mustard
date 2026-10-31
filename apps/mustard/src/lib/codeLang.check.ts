// codeLang self-check — 실행: node --experimental-strip-types src/lib/codeLang.check.ts
import assert from "node:assert/strict";
import { langOf } from "./codeLang.ts";

// #1272 손 표에 없던 언어
for (const [f, l] of [["lib/main.dart", "dart"], ["App.vue", "vue"], ["a.svelte", "svelte"], ["init.lua", "lua"], ["main.tf", "tf"]]) assert.equal(langOf(f), l, f);
// 예전에 되던 확장자는 계속 색칠(이름은 shiki 별칭이어도 됨)
for (const f of ["a.ts", "a.tsx", "a.js", "a.mjs", "a.py", "a.go", "a.rs", "a.json", "a.md", "a.yml", "a.sh", "a.kts", "a.cs", "a.toml", "A.TS"]) assert.notEqual(langOf(f), "text", f);
// 별칭이 아닌 확장자·파일 이름
assert.equal(langOf("x.h"), "c");
assert.equal(langOf("x.hpp"), "cpp");
assert.equal(langOf("android/build.gradle"), "groovy");
assert.equal(langOf("Dockerfile"), "docker");
assert.equal(langOf("sub/Makefile"), "make");
assert.equal(langOf("CMakeLists.txt"), "cmake");
assert.equal(langOf(".env.local"), "dotenv");
// 모르는 것·기본 속성 이름·확장자 없음은 text
for (const f of ["a.zzz", "a.constructor", "README", ".gitignore", "a.txt"]) assert.equal(langOf(f), "text", f);
console.log("codeLang ok");
