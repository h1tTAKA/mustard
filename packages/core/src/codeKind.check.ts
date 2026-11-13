// codeKind 점검 — node --experimental-strip-types packages/core/src/codeKind.check.ts
import assert from "node:assert/strict";
import { codeKind } from "./codeKind.ts";

const cases: [string, string][] = [
  // 경로·파일
  ["ios/Runner/Info.plist:9", "path"], ["ios/Runner/Info.plist:29-36", "path"], ["lib/", "path"], ["Info.plist", "path"], ["main.dart", "path"], ["src/a.ts", "path"], ["app.tsx", "path"], ["App.js", "path"], ["path.ts", "path"], ["Button.js", "path"], ["next.config.js", "path"], ["express.js", "path"], ["app.log", "path"], ["app.env", "path"],
  // 함수
  ["application(_:didFinishLaunchingWithOptions:)", "fn"], ["testExample()", "fn"], ["GeneratedPluginRegistrant.register(with:)", "fn"], ["super.application(...)", "fn"], ["AppState.load()", "fn"],
  // 타입
  ["AppDelegate", "type"], ["FlutterAppDelegate", "type"], ["XCTestCase", "type"], ["List<String>", "type"],
  // 설정 키
  ["MAX_FILES", "key"], ["--merge", "key"], ["<key>", "key"], ["<true/>", "key"],
  // 값
  ["#D1D6DB", "val"], ["0xFFD1D6DB", "val"], ["false", "val"], ["42", "val"], ["\"玄関\"", "val"], ["$(FLUTTER_BUILD_NAME)", "val"], ["16px", "val"],
  // 키워드
  ["static", "kw"], ["const", "kw"], ["await", "kw"], ["@main", "kw"],
  // 모르는 것
  ["fieldLine", "plain"], ["Node.js", "plain"], ["Vue.js", "plain"], ["process.env", "plain"], ["this.log", "plain"], ["req.log", "plain"], ["window.env", "plain"], ["API", "plain"], ["JSON", "plain"], ["console.log", "plain"], ["catchup.enabled", "plain"], ["and/or", "plain"], ["GET/POST", "plain"], ["src/lib", "path"], ["https://x.com/a", "path"], ["static const fieldLine", "plain"], ["", "plain"],
];
for (const [s, k] of cases) assert.equal(codeKind(s), k, s);
console.log("codeKind ok");
