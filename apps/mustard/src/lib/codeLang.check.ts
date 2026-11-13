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
// #1322 내용은 XML인데 낯선 확장자·확장자 없는 빌드 파일
for (const f of ["ios/Runner/Base.lproj/LaunchScreen.storyboard", "a.xib", "x/Runner.xcscheme", "a.csproj", "a.entitlements"]) assert.equal(langOf(f), "xml", f);
assert.equal(langOf("ios/Podfile"), "ruby");
assert.equal(langOf("a.podspec"), "ruby");
assert.equal(langOf("ios/Podfile.lock"), "yaml");
assert.equal(langOf("Cargo.lock"), "toml");
assert.equal(langOf("composer.lock"), "json");
// 확장자로 모르면 내용으로
assert.equal(langOf("a.zzz", '<?xml version="1.0"?>\n<a/>'), "xml");
assert.equal(langOf(".flutter-plugins-dependencies", '{"info":"x","plugins":{}}'), "json");
assert.equal(langOf("tool", "#!/usr/bin/env python3\nprint(1)"), "python");
assert.equal(langOf("run", "#!/bin/bash\necho"), "bash");
assert.equal(langOf("a.zzz", "hello"), "text");
for (const h of ["[2026-11-14 10:00] started", "[1] Smith et al.", "[1]: https://x", "[nullable] x", "[section]\nk=v", "{{ template }}", "[link](x)"]) assert.equal(langOf("notes", h), "text", h);
for (const h of ['[{"a":1}]', "[1, 2]", '["a", "b"]', "[]", "[true]", '{"k": 1}']) assert.equal(langOf("data", h), "json", h);
assert.equal(langOf("a.ts", "<?xml"), "ts"); // 확장자로 알면 내용 무시
console.log("codeLang ok");
