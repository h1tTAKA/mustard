// codeKind 점검 — node --experimental-strip-types packages/core/src/codeKind.check.ts
import assert from "node:assert/strict";
import { codeKind } from "./codeKind.ts";

const cases: [string, string][] = [
  // 경로·파일
  ["ios/Runner/Info.plist:9", "path"], ["ios/Runner/Info.plist:29-36", "path"], ["lib/", "path"], ["Info.plist", "path"], ["main.dart", "path"], ["src/a.ts", "path"], ["app.tsx", "path"], ["App.js", "path"], ["path.ts", "path"], ["Button.js", "path"], ["next.config.js", "path"], ["express.js", "path"], ["app.log", "path"], ["app.env", "path"],
  ["src/lib", "path"], ["https://x.com/a", "path"], ["/api/tasks", "path"], [".gitignore", "path"], [".tsx", "path"], ["src\\a.ts", "path"],
  // 명령어·옵션
  ["gh run watch", "cmd"], ["gh pr merge 65 --merge --delete-branch", "cmd"], ["--exit-status", "cmd"], ["--merge", "cmd"], ["-q", "cmd"], ["-i ''", "cmd"], ["grep", "cmd"], ["npm test", "cmd"], ["2>&1", "cmd"], [">/dev/null 2>&1", "cmd"], ["s/old/new/g", "cmd"], ["find . -name x", "cmd"], ["open", "sym"], ["env", "sym"], ["head", "sym"], ["node", "sym"], ["cp", "sym"], ["node --test", "cmd"],
  // 함수·메서드 호출·로직 식은 fn(빨강), 이름 하나(변수·타입·멤버·키워드)는 sym(파랑)
  ["application(_:didFinishLaunchingWithOptions:)", "fn"], ["testExample()", "fn"], ["GeneratedPluginRegistrant.register(with:)", "fn"], ["super.application(...)", "fn"], ["AppState.load()", "fn"], ["Color(0xFFD1D6DB)", "fn"], [".map(...)", "fn"],
  ["AppDelegate", "sym"], ["XCTestCase", "sym"], ["List<String>", "sym"], ["Record<string, string>", "sym"], ["MAX_FILES", "sym"], ["<key>", "sym"], ["<true/>", "sym"], ["<Text>", "sym"],
  ["fieldLine", "sym"], ["line", "sym"], ["useEffect", "sym"], ["static", "sym"], ["const", "sym"], ["@main", "sym"], ["static const fieldLine", "fn"], ["import { a } from 'b'", "fn"], ["as const", "fn"],
  ["console.log", "sym"], ["process.env", "sym"], ["catchup.enabled", "sym"], ["this.log", "sym"], [".ex1", "sym"], ["...ex1", "fn"], ["{ ko, ja, hl }", "fn"], ["?.", "fn"], ["??", "fn"], ["b === 0", "fn"], ["flex: 1", "fn"], ["Node.js", "sym"],
  // 값
  ["#D1D6DB", "val"], ["D1D6DB", "val"], ["0xFFD1D6DB", "val"], ["false", "val"], ["42", "val"], ["\"玄関\"", "val"], ["$(FLUTTER_BUILD_NAME)", "val"], ["16px", "val"],
  // 모르는 것(회색) — 약어·기호·한글·짝말·분수
  ["API", "plain"], ["JSON", "plain"], ["FF", "plain"], ["and/or", "plain"], ["GET/POST", "plain"], ["try/catch", "plain"], ["0/5", "plain"], ["|", "plain"], ["키: 값", "plain"], ["\\n", "plain"], ["ci:0", "plain"], ["/// ...", "plain"], ["", "plain"],
];
for (const [s, k] of cases) assert.equal(codeKind(s), k, s);
console.log("codeKind ok");
