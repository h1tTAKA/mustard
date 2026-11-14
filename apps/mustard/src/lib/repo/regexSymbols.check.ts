// regexSymbols 점검(#1331) — node --experimental-strip-types apps/mustard/src/lib/repo/regexSymbols.check.ts
import assert from "node:assert/strict";
import { regexSymbols } from "./regexSymbols.ts";
import { dartPackages, resolveDartPackage } from "./imports.ts";
import { detectLang } from "./langs.ts";

const dart = `import 'package:app/models.dart';
// class Fake {}
class HomePage extends StatelessWidget with Mixin implements Foo {
  final String title = 'class Nope {';
  @override
  Widget build(BuildContext context) {
    test('x', () {});
    return Scaffold(body: Header());
  }
  Future<void> _save() async { await repo.save(); }
}
void main() { runApp(HomePage()); }
`;
const r = regexSymbols(dart, "lib/home.dart");
const names = r.symbols.map((s) => `${s.kind}:${s.name}`);
assert.deepEqual(names.sort(), ["class:HomePage", "function:_save", "function:build", "function:main"].sort(), names.join());
assert.equal(r.symbols.find((s) => s.name === "build")!.owner, "HomePage");
assert.ok(r.heritage.some((h) => h.baseName === "StatelessWidget" && h.relation === "extends"));
assert.ok(r.calls.some((c) => c.calleeName === "Header") && r.calls.some((c) => c.calleeName === "HomePage")); // 위젯 생성 = 호출
assert.ok(!r.calls.some((c) => c.calleeName === "test" && c.callerId.endsWith("#test"))); // test(…)는 선언 아님
assert.deepEqual(detectLang("lib/a.dart")!.extract(`import 'dart:io';\nimport 'package:app/a.dart';\nexport 'b.dart';\npart 'c.dart';\n`), ["package:app/a.dart", "./b.dart", "./c.dart"]);

const rb = `class User < ApplicationRecord\n  def full_name\n    first + last\n  end\n\n  def self.find_by_x(x)\n  end\nend\n`;
const rr = regexSymbols(rb, "app/models/user.rb");
assert.deepEqual(rr.symbols.map((s) => s.name), ["User", "full_name", "find_by_x"]);
assert.equal(rr.symbols[1].owner, "User");
assert.ok(rr.heritage.some((h) => h.baseName === "ApplicationRecord"));

// package: 해석 — pubspec 없는 임시 레포는 빈 맵 → null
assert.equal(resolveDartPackage("package:app/a.dart", new Map([["app", ""]]), new Set(["lib/a.dart"])), "lib/a.dart");
assert.equal(resolveDartPackage("package:app/a.dart", new Map([["app", "packages/core"]]), new Set(["packages/core/lib/a.dart"])), "packages/core/lib/a.dart");
assert.equal(resolveDartPackage("package:flutter/material.dart", new Map(), new Set()), null);
assert.equal(dartPackages("/nonexistent", ["lib/a.dart"]).size, 0);
// #1331 언어 확장 추출기
const ex = (f: string, t: string) => detectLang(f)!.extract(t);
assert.deepEqual(ex("a.m", '#import "Foo.h"\n#import <UIKit/UIKit.h>\n'), ["./Foo.h"]);
assert.deepEqual(ex("a.lua", 'local u = require("util.str")\nlocal v = require "x"\n'), ["util/str", "x"]);
assert.deepEqual(ex("a.ex", "alias MyApp.Accounts.User\nalias MyApp.{A, B}\n"), ["ex:MyApp.Accounts.User", "ex:MyApp.A", "ex:MyApp.B"]);
assert.deepEqual(ex("a.zig", 'const std = @import("std");\nconst m = @import("m.zig");\n'), ["./m.zig"]);
assert.deepEqual(ex("a.vue", '<script setup lang="ts">\nimport { a } from "./a"\n</script>'), ["./a"]);
assert.deepEqual(ex("a.scala", "import a.b.C\n"), ["a/b/C"]);
// 리뷰: 문자열 속 /* · // 가 주석으로 오인돼 다음 선언을 지우던 것, 이름 없는 extension on
const tricky = `const g = '**/*.dart';\nclass B {}\nvoid f() { final u = 'https://x.y'; g2(); }\nextension on String { int get n => 1; }\n// it's a comment\nclass C {}\n`;
const tr = regexSymbols(tricky, "lib/t.dart").symbols.map((x) => x.name);
assert.ok(tr.includes("B") && tr.includes("f") && tr.includes("C"), tr.join());
assert.ok(!tr.includes("on"), tr.join());
assert.ok(regexSymbols(tricky, "lib/t.dart").calls.some((c) => c.calleeName === "g2")); // URL 뒤 같은 줄 호출도 살아 있음
console.log("regexSymbols ok");
