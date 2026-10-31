// 파일 확장자 → 문법 색칠 언어(shiki) — 코드 보기·diff·캐치업이 같이 씀(#1229에서 한곳으로).
// #1272 손으로 적은 표(30개)에 없던 dart 등이 색 없이 나왔음 → shiki가 아는 이름·별칭(346개)에서 바로 찾음.
// shiki/langs는 언어별 지연 import 목록뿐이라 가벼움(캐치업은 shiki 본체를 늦게 불러옴).
import { bundledLanguages } from "shiki/langs";

// 확장자가 shiki 별칭이 아닌 것만
const EXT_LANG: Record<string, string> = {
  h: "c", hpp: "cpp", hh: "cpp", hxx: "cpp", cc: "cpp", cxx: "cpp", m: "objective-c", mm: "objective-cpp",
  pl: "perl", ml: "ocaml", ex: "elixir", exs: "elixir", sol: "solidity", gradle: "groovy",
  svg: "xml", plist: "xml", cfg: "ini", conf: "ini",
};
// 확장자로 못 잡는 파일 이름
const NAME_LANG: Record<string, string> = { dockerfile: "docker", makefile: "make", gnumakefile: "make", "cmakelists.txt": "cmake" };

export const langOf = (file: string) => {
  const name = file.split("/").pop()?.toLowerCase() ?? "";
  if (Object.hasOwn(NAME_LANG, name)) return NAME_LANG[name];
  if (name === ".env" || name.startsWith(".env.")) return "dotenv";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  if (Object.hasOwn(EXT_LANG, ext)) return EXT_LANG[ext];
  return Object.hasOwn(bundledLanguages, ext) ? ext : "text";
};
