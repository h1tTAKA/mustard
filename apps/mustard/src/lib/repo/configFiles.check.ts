// configFiles 점검(#1335) — node --experimental-strip-types apps/mustard/src/lib/repo/configFiles.check.ts
import assert from "node:assert/strict";
import { isConfigFile } from "./configFiles.ts";

for (const f of ["package.json", "apps/web/tsconfig.json", "tsconfig.app.json", "pubspec.yaml", "go.work", "android/app/src/main/AndroidManifest.xml", "ios/Runner/Info.plist", "next.config.mjs", "app/App.csproj", ".github/workflows/ci.yml", "pnpm-workspace.yaml"]) assert.ok(isConfigFile(f), f);
for (const f of ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "pubspec.lock", "go.sum", ".env", ".env.local", "data/users.json", "config/settings.yaml", "src/a.ts", "workflows/ci.yml"]) assert.ok(!isConfigFile(f), f);
console.log("configFiles ok");

// #1335 연결 — pnpm 모노레포·Dart 다중 패키지·go.work
{
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { configEdges, pubspecDeps, goWorkUses } = await import("./configEdges.ts");
  const { workspacePackages, dartPackages } = await import("./imports.ts");
  const r = mkdtempSync(join(tmpdir(), "cfg-edges-"));
  const files: string[] = [];
  const put = (rel: string, body: string) => { const p = join(r, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, body); files.push(rel); };
  put("package.json", JSON.stringify({ name: "root", private: true }));
  put("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
  put("apps/web/package.json", JSON.stringify({ name: "web", dependencies: { "@acme/ui": "workspace:*", react: "^19" } }));
  put("apps/web/tsconfig.json", JSON.stringify({ extends: "../../tsconfig.base.json" }));
  put("tsconfig.base.json", "{}");
  put("packages/ui/package.json", JSON.stringify({ name: "@acme/ui", main: "./dist/index.js" }));
  put("packages/ui/src/index.ts", "export {}");
  put("app/pubspec.yaml", "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  core:\n    path: ../core\n");
  put("app/lib/main.dart", "void main(){}");
  put("core/pubspec.yaml", "name: core\n");
  put("core/lib/core.dart", "");
  put("go.work", "go 1.22\nuse (\n  ./svc\n)\n");
  put("svc/go.mod", "module x/svc\n");
  put("svc/main.go", "package main");
  put("web.config.unused/next.config.mjs", "export default {}"); // 위 폴더(루트) package.json으로
  put("android/settings.gradle.kts", 'include(":app")\n');
  put("android/app/build.gradle.kts", "");
  put("android/app/src/main/AndroidManifest.xml", "<manifest/>");
  const fs = new Set(files);
  const e = configEdges(r, files, fs, workspacePackages(r), dartPackages(r, files)).map((x) => `${x.source} -${x.relation}-> ${x.target}`);
  for (const want of [
    "pnpm-workspace.yaml -contains-> apps/web/package.json", "pnpm-workspace.yaml -contains-> packages/ui/package.json",
    "apps/web/package.json -imports-> packages/ui/package.json", "packages/ui/package.json -imports-> packages/ui/src/index.ts",
    "apps/web/tsconfig.json -extends-> tsconfig.base.json",
    "app/pubspec.yaml -imports-> core/pubspec.yaml", "app/pubspec.yaml -imports-> app/lib/main.dart", "core/pubspec.yaml -imports-> core/lib/core.dart",
    "go.work -contains-> svc/go.mod", "svc/go.mod -imports-> svc/main.go",
    "package.json -contains-> web.config.unused/next.config.mjs", "android/settings.gradle.kts -contains-> android/app/build.gradle.kts", "android/app/build.gradle.kts -contains-> android/app/src/main/AndroidManifest.xml",
  ]) assert.ok(e.includes(want), `${want}\n${e.join("\n")}`);
  assert.ok(!e.some((x) => x.includes("react")), "외부 의존은 버림");
  assert.deepEqual(pubspecDeps("name: a\ndependencies:\n  x: ^1\n  y:\n    path: ../y\ndev_dependencies:\n  z: any\nflutter:\n  uses: true\n"), ["x", "y", "z"]);
  assert.deepEqual(goWorkUses("use ./a\nuse (\n  ./b\n  ./c/\n)\n").sort(), ["a", "b", "c"]);
  console.log("configEdges ok");
}
