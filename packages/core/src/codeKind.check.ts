// codeKind 점검 — node --experimental-strip-types packages/core/src/codeKind.check.ts
import assert from "node:assert/strict";
import { codeKind, codeSub } from "./codeKind.ts";

const cases: [string, string][] = [
  // 경로·파일
  ["ios/Runner/Info.plist:9", "path"], ["ios/Runner/Info.plist:29-36", "path"], ["lib/", "path"], ["Info.plist", "path"], ["main.dart", "path"], ["src/a.ts", "path"], ["app.tsx", "path"], ["App.js", "path"], ["path.ts", "path"], ["Button.js", "path"], ["next.config.js", "path"], ["express.js", "path"], ["app.log", "path"], ["app.env", "path"],
  ["src/lib", "path"], ["https://x.com/a", "path"], ["/api/tasks", "path"], [".gitignore", "path"], [".tsx", "path"], ["src\\a.ts", "path"],
  // 명령어·옵션
  ["gh run watch", "cmd"], ["gh pr merge 65 --merge --delete-branch", "cmd"], ["--exit-status", "cmd"], ["--merge", "cmd"], ["-q", "cmd"], ["-i ''", "cmd"], ["grep", "cmd"], ["npm test", "cmd"], ["2>&1", "cmd"], [">/dev/null 2>&1", "cmd"], ["s/old/new/g", "cmd"], ["find . -name x", "cmd"], ["open", "sym"], ["env", "sym"], ["head", "sym"],
  // 코드 이름 — 함수·변수·타입·키워드·상수는 한 색(유저 피드백: 같은 코드 이름이 제각각 색이던 것)
  ["application(_:didFinishLaunchingWithOptions:)", "sym"], ["testExample()", "sym"], ["GeneratedPluginRegistrant.register(with:)", "sym"], ["super.application(...)", "sym"], ["AppState.load()", "sym"], ["Color(0xFFD1D6DB)", "sym"], [".map(...)", "sym"],
  ["AppDelegate", "sym"], ["XCTestCase", "sym"], ["List<String>", "sym"], ["Record<string, string>", "sym"], ["MAX_FILES", "sym"], ["<key>", "sym"], ["<true/>", "sym"], ["<Text>", "sym"],
  ["fieldLine", "sym"], ["line", "sym"], ["useEffect", "sym"], ["static", "sym"], ["const", "sym"], ["@main", "sym"], ["static const fieldLine", "sym"], ["import { a } from 'b'", "sym"], ["as const", "sym"],
  ["console.log", "sym"], ["process.env", "sym"], ["catchup.enabled", "sym"], ["this.log", "sym"], [".ex1", "sym"], ["...ex1", "sym"], ["{ ko, ja, hl }", "sym"], ["?.", "sym"], ["??", "sym"], ["b === 0", "sym"], ["flex: 1", "sym"], ["Node.js", "sym"],
  // 값
  ["#D1D6DB", "val"], ["D1D6DB", "val"], ["0xFFD1D6DB", "val"], ["false", "val"], ["42", "val"], ["\"玄関\"", "val"], ["$(FLUTTER_BUILD_NAME)", "val"], ["16px", "val"],
  // 모르는 것(회색) — 약어·기호·한글·짝말·분수
  ["API", "plain"], ["JSON", "plain"], ["FF", "plain"], ["and/or", "plain"], ["GET/POST", "plain"], ["try/catch", "plain"], ["0/5", "plain"], ["|", "plain"], ["키: 값", "plain"], ["\\n", "plain"], ["ci:0", "plain"], ["/// ...", "plain"], ["", "plain"],
];
for (const [s, k] of cases) assert.equal(codeKind(s), k, s);
// 툴팁 세부 종류
const subs: [string, string | null][] = [
  ["AppState.load()", "method"], ["super.application(...)", "method"], [".map(...)", "method"], ["Color(0xFFD1D6DB)", "fn"], ["testExample()", "fn"],
  ["AppDelegate", "type"], ["List<String>", "type"], ["MAX_FILES", "const"], ["static", "keyword"], ["@main", "annotation"], ["<Text>", "tag"],
  ["console.log", "member"], [".ex1", "member"], ["fieldLine", "name"], ["static const fieldLine", "snippet"], ["b === 0", "logic"], ["?.", "logic"], ["{ ko, ja, hl }", "logic"],
  ["gh run watch", "command"], ["--merge", "flag"], ["2>&1", "redirect"],
  ["src/a.ts", "file"], ["Info.plist:9", "fileLine"], ["lib/", "dir"], ["https://x.com/a", "url"], ["/api/tasks", "route"], ["src/lib", "path"], [".gitignore", "file"],
  ["#D1D6DB", "color"], ["D1D6DB", "color"], ["16px", "number"], ["\"玄関\"", "string"], ["false", "bool"], ["$(X)", "buildVar"], ["API", null],
];
for (const [s, k] of subs) assert.equal(codeSub(s), k, s);
console.log("codeKind ok");
