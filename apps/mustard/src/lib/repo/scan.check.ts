// scan.ts self-check(#1003) — 실행: node --experimental-strip-types src/lib/repo/scan.check.ts
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanRepo, scanAllFiles } from "./scan.ts";

const root = mkdtempSync(join(tmpdir(), "scan-check-"));
const put = (rel: string, body = "x") => { const p = join(root, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, body); };
// Unity 프로젝트가 레포 하위(client/)에
put("client/Assets/Scripts/Player.cs", "class Player {}");
put("client/ProjectSettings/ProjectVersion.txt", "m_EditorVersion: 6000.0.0f1");
put("client/Library/PackageCache/com.unity.x/Engine.cs", "class Engine {}");
put("client/Temp/gen.cs", "class Gen {}");
put("client/Logs/a.cs", "class L {}");
// Unreal
put("unreal/Game.uproject", "{}");
put("unreal/Source/Game/Hero.cpp", "void f(){}");
put("unreal/Intermediate/Build/Gen.cpp", "void g(){}");
put("unreal/Binaries/x.cpp", "void h(){}");
// 엔진 아닌 곳의 Library는 진짜 코드 — 유지
put("web/Library/util.ts", "export const a = 1;");

const r = scanRepo(root);
const has = (p: string) => r.files.includes(p);
assert.ok(has("client/Assets/Scripts/Player.cs"), "Unity 스크립트 포함");
assert.ok(!r.files.some((f) => f.startsWith("client/Library/")), "Unity Library 제외");
assert.ok(!has("client/Temp/gen.cs") && !has("client/Logs/a.cs"), "Unity Temp·Logs 제외");
assert.ok(has("unreal/Source/Game/Hero.cpp"), "Unreal 소스 포함");
assert.ok(!has("unreal/Intermediate/Build/Gen.cpp") && !has("unreal/Binaries/x.cpp"), "Unreal 생성 폴더 제외");
assert.ok(has("web/Library/util.ts"), "엔진 아닌 Library는 유지");
assert.deepStrictEqual([...r.engines].sort(), ["unity", "unreal"], "엔진 감지");
// #1155 패키징 산출물(.app 안 소스 사본) — 그래프·파일 트리 둘 다 제외
put("dist_electron/mac-arm64/Mustard.app/Contents/Resources/app/src/a.ts", "export const copy = 1;");
assert.ok(!scanRepo(root).files.some((f) => f.startsWith("dist_electron/")), "dist_electron 제외");
assert.ok(!scanAllFiles(root).files.some((f) => f.startsWith("dist_electron/")), "파일 트리도 dist_electron 제외");
const all = scanAllFiles(root);
assert.ok(!all.files.some((f) => f.startsWith("client/Library/")), "파일 트리도 Library 제외");
assert.ok(all.files.includes("client/ProjectSettings/ProjectVersion.txt"), "파일 트리는 ProjectSettings 유지");
// 대소문자 무시(리뷰) — 소문자 폴더명 Unity
put("lower/assets/a.cs", "class A {}"); put("lower/projectsettings/x.txt", "v"); put("lower/library/z.cs", "class Z {}");
const r2 = scanRepo(root);
assert.ok(r2.files.includes("lower/assets/a.cs") && !r2.files.includes("lower/library/z.cs"), "소문자 Unity 폴더도 감지·제외");
// .NET 프로젝트(#1007) — csproj 옆 obj/·bin/ 제외, csproj 없는 bin/은 진짜 코드라 유지, 하위 폴더 obj는 영향 없음
put("sim/Core/Core.csproj", "<Project/>");
put("sim/Core/Sim.cs", "class Sim {}");
put("sim/Core/obj/Debug/net8.0/Core.AssemblyInfo.cs", "// gen");
put("sim/Core/BIN/Debug/x.cs", "// gen");
put("sim/Core/Models/obj/Real.cs", "class Real {}");
put("tools/bin/run.py", "print(1)");
const r3 = scanRepo(root);
assert.ok(r3.files.includes("sim/Core/Sim.cs"), ".NET 소스 포함");
assert.ok(!r3.files.some((f) => f.startsWith("sim/Core/obj/") || f.startsWith("sim/Core/BIN/")), "csproj 옆 obj·bin(대소문자 무시) 제외");
assert.ok(r3.files.includes("sim/Core/Models/obj/Real.cs"), "csproj 바로 아래가 아닌 obj는 유지");
assert.ok(r3.files.includes("tools/bin/run.py"), "csproj 없는 bin은 유지");
assert.ok(!scanAllFiles(root).files.some((f) => f.startsWith("sim/Core/obj/")), "파일 트리도 obj 제외");
put("tmpl/.csproj", ""); put("tmpl/bin/keep.py", "print(1)"); // 이름 없는 ".csproj"(템플릿 등)는 프로젝트 아님(#1008 리뷰)
assert.ok(scanRepo(root).files.includes("tmpl/bin/keep.py"), "이름 없는 .csproj는 .NET 표식 아님");
// Unity 에셋(#1009) — Assets/ 아래 씬·프리팹·데이터 에셋만 스캔, ProjectSettings/*.asset·머티리얼은 제외
put("client/Assets/Scenes/Main.unity", "%YAML 1.1"); put("client/Assets/Prefabs/Cat.prefab", "%YAML 1.1");
put("client/Assets/Data/Balance.asset", "%YAML 1.1"); put("client/Assets/Art/cat.mat", "%YAML 1.1");
put("client/ProjectSettings/QualitySettings.asset", "%YAML 1.1");
const r4 = scanRepo(root).files;
for (const f of ["client/Assets/Scenes/Main.unity", "client/Assets/Prefabs/Cat.prefab", "client/Assets/Data/Balance.asset"]) assert.ok(r4.includes(f), `Unity 에셋 포함 ${f}`);
assert.ok(!r4.includes("client/ProjectSettings/QualitySettings.asset"), "ProjectSettings 설정 에셋 제외");
assert.ok(!r4.includes("client/Assets/Art/cat.mat"), "머티리얼 제외");
put("web/src/assets/data.asset", "x"); // 엔진 루트 밖 assets/ — Unity 에셋 아님(#1010 리뷰)
assert.ok(!scanRepo(root).files.includes("web/src/assets/data.asset"), "Unity 루트 밖 assets/*.asset 제외");
console.log("scan.check OK");
