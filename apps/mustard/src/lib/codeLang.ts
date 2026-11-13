// 파일 확장자 → 문법 색칠 언어(shiki) — 코드 보기·diff·캐치업이 같이 씀(#1229에서 한곳으로).
// #1272 손으로 적은 표(30개)에 없던 dart 등이 색 없이 나왔음 → shiki가 아는 이름·별칭(346개)에서 바로 찾음.
// shiki/langs는 언어별 지연 import 목록뿐이라 가벼움(캐치업은 shiki 본체를 늦게 불러옴).
import { bundledLanguages } from "shiki/langs";

// 확장자가 shiki 별칭이 아닌 것만
const EXT_LANG: Record<string, string> = {
  h: "c", hpp: "cpp", hh: "cpp", hxx: "cpp", cc: "cpp", cxx: "cpp", m: "objective-c", mm: "objective-cpp",
  pl: "perl", ml: "ocaml", ex: "elixir", exs: "elixir", sol: "solidity", gradle: "groovy",
  svg: "xml", plist: "xml", cfg: "ini", conf: "ini",
  // #1322 내용은 XML인데 확장자가 낯선 것 — Xcode(storyboard·xib·xcscheme…)·.NET(csproj·resx…)·Android·기타
  storyboard: "xml", xib: "xml", xcscheme: "xml", xcworkspacedata: "xml", xcsettings: "xml", entitlements: "xml", strings: "text",
  csproj: "xml", vbproj: "xml", fsproj: "xml", vcxproj: "xml", props: "xml", targets: "xml", resx: "xml", nuspec: "xml", config: "xml", xaml: "xml", axaml: "xml",
  xsd: "xml", xsl: "xml", xslt: "xml", wsdl: "xml", rss: "xml", atom: "xml", kml: "xml", gpx: "xml", fxml: "xml", iml: "xml", tmx: "xml",
  podspec: "ruby", gemspec: "ruby", rake: "ruby", xcconfig: "ini", resolved: "json", pbxproj: "text", gyp: "python", bzl: "python", star: "python",
};
// 확장자로 못 잡는 파일 이름
const NAME_LANG: Record<string, string> = {
  dockerfile: "docker", makefile: "make", gnumakefile: "make", "cmakelists.txt": "cmake",
  // #1322 확장자 없는 빌드·설정 파일
  podfile: "ruby", gemfile: "ruby", rakefile: "ruby", fastfile: "ruby", appfile: "ruby", brewfile: "ruby", vagrantfile: "ruby", dangerfile: "ruby", matchfile: "ruby",
  // .lock은 도구마다 형식이 달라 이름으로(Cargo·poetry=TOML, composer=JSON, 나머지 YAML 계열)
  "podfile.lock": "yaml", "pubspec.lock": "yaml", "yarn.lock": "yaml", "pnpm-lock.yaml": "yaml", "cargo.lock": "toml", "poetry.lock": "toml", "uv.lock": "toml", "composer.lock": "json", "flake.lock": "json", "gemfile.lock": "text", cartfile: "text", jenkinsfile: "groovy", procfile: "yaml",
  ".gitignore": "text", ".editorconfig": "ini", ".npmrc": "ini", ".gitconfig": "ini", ".gitattributes": "text",
};

// 확장자·이름으로 못 찾을 때 내용 첫머리로(#1322) — 어떤 언어 파일이든 색이 나오게. 확실한 신호만(오판하면 엉뚱한 색).
function sniff(head: string): string {
  const t = head.replace(/^\uFEFF/, "").trimStart();
  if (/^<\?xml[\s?]/.test(t) || /^<!DOCTYPE\s+(plist|html|svg)/i.test(t) || /^<(plist|svg|project|manifest|resources|document)[\s>]/.test(t)) return /^<!DOCTYPE\s+html/i.test(t) ? "html" : "xml";
  if (t.startsWith("#!")) { // "#!/bin/bash", "#!/usr/bin/env python3" → 실행기 이름
    const tok = t.slice(2).split("\n")[0].trim().split(/\s+/);
    let prog = tok[0]?.split("/").pop() ?? "";
    if (prog === "env") prog = tok.find((x, i) => i > 0 && !x.startsWith("-")) ?? "";
    const m: Record<string, string> = { bash: "bash", sh: "bash", zsh: "bash", dash: "bash", python: "python", node: "javascript", ruby: "ruby", perl: "perl", php: "php", deno: "typescript", bun: "typescript" };
    const k = prog.replace(/[\d.]+$/, "");
    if (Object.hasOwn(m, k)) return m[k];
  }
  // JSON — 4000자까지만 보므로 통째 파싱 대신 첫 모양으로: {"키" / [ 뒤에 값 시작({ [ " 숫자 ] true false null)
  // 배열은 값 문법까지 봄 — "[2026-11-14 10:00] 로그", "[1] 참고문헌", "[nullable] x" 같은 글이 JSON으로 칠해지지 않게(리뷰)
  if (/^\{\s*("|\})/.test(t) || /^\[\s*(\{|\[|\]\s*$|("[^"\n]*"|-?\d+(\.\d+)?|true|false|null)\s*(,|\]\s*$))/.test(t)) return "json";
  return "text";
}

// head = 파일 내용 앞부분(있으면 확장자로 모를 때 내용으로 판정). diff처럼 파일 중간 조각이면 넘기지 말 것.
export const langOf = (file: string, head?: string) => {
  const name = file.split("/").pop()?.toLowerCase() ?? "";
  if (Object.hasOwn(NAME_LANG, name)) return NAME_LANG[name];
  if (name === ".env" || name.startsWith(".env.")) return "dotenv";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  const byExt = Object.hasOwn(EXT_LANG, ext) ? EXT_LANG[ext] : Object.hasOwn(bundledLanguages, ext) ? ext : "text";
  return byExt === "text" && head ? sniff(head.slice(0, 4000)) : byExt;
};
