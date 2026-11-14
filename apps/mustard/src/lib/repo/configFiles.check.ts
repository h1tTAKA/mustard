// configFiles 점검(#1335) — node --experimental-strip-types apps/mustard/src/lib/repo/configFiles.check.ts
import assert from "node:assert/strict";
import { isConfigFile } from "./configFiles.ts";

for (const f of ["package.json", "apps/web/tsconfig.json", "tsconfig.app.json", "pubspec.yaml", "go.work", "android/app/src/main/AndroidManifest.xml", "ios/Runner/Info.plist", "next.config.mjs", "app/App.csproj", ".github/workflows/ci.yml", "pnpm-workspace.yaml"]) assert.ok(isConfigFile(f), f);
for (const f of ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "pubspec.lock", "go.sum", ".env", ".env.local", "data/users.json", "config/settings.yaml", "src/a.ts", "workflows/ci.yml"]) assert.ok(!isConfigFile(f), f);
console.log("configFiles ok");
