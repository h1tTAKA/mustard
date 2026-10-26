// 컴퓨터 사용 도우미(#1189) → dist/Mustard Computer Use.app
// 자기 번들 id·사용 설명을 가진 .app이어야 macOS 권한(접근성·화면 기록)이 Mustard가 아니라 이 도우미에 붙음.
// 서명은 여기선 임시(ad-hoc) — 패키징 때 electron-builder가 앱과 같은 인증서로 다시 서명.
// 한계: 지금 맥의 아키텍처로만 빌드(패키징 대상이 mac-arm64 하나라서). 인텔 배포가 필요하면 --arch x86_64를 더해 lipo.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NAME = "Mustard Computer Use";
const BIN = "MustardComputerUse";
const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: here, stdio: "inherit" }); if (r.status !== 0) process.exit(r.status ?? 1); };

const app = join(here, "dist", `${NAME}.app`);
rmSync(app, { recursive: true, force: true }); // 빌드 실패 때 옛 .app이 패키징되지 않게 먼저 지움(리뷰)
run("swift", ["build", "-c", "release"]);
mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
copyFileSync(join(here, ".build", "release", BIN), join(app, "Contents", "MacOS", BIN));
// 아이콘 = Mustard 앱 아이콘(시스템 설정 권한 목록에서 Mustard와 같은 모양으로 보이게)
const iconset = join(here, ".build", "AppIcon.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
for (const n of [16, 32, 128, 256, 512]) {
  run("sips", ["-z", String(n), String(n), join(here, "..", "..", "build", "icon.png"), "--out", join(iconset, `icon_${n}x${n}.png`)]);
  run("sips", ["-z", String(n * 2), String(n * 2), join(here, "..", "..", "build", "icon.png"), "--out", join(iconset, `icon_${n}x${n}@2x.png`)]);
}
mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
run("iconutil", ["-c", "icns", iconset, "-o", join(app, "Contents", "Resources", "AppIcon.icns")]);
writeFileSync(join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>ai.neuradex.mustard.computer-use</string>
  <key>CFBundleName</key><string>${NAME}</string>
  <key>CFBundleDisplayName</key><string>${NAME}</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleExecutable</key><string>${BIN}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAccessibilityUsageDescription</key><string>Lets your coding agents in Mustard read and operate app windows when you allow computer use.</string>
  <key>NSScreenCaptureUsageDescription</key><string>Lets your coding agents in Mustard take screenshots of app windows when you allow computer use.</string>
</dict></plist>
`);
run("codesign", ["--force", "--sign", "-", app]);
console.log(`[computer-use] ${app}`);
