// cardEcoAI 점검 — node --experimental-strip-types src/lib/cardEcoAI.check.ts
import assert from "node:assert/strict";
import { ecoPrompt, parseEco } from "./cardEcoAI.ts";

assert.deepEqual(parseEco("1 Flutter\n2. React Native\n3: -\n**4** TypeScript — 표준\n5 없음", 6), ["Flutter", "React Native", "", "TypeScript", "", undefined]);
assert.deepEqual(parseEco("1 \"Git\"\n1 npm", 1), ["Git"], "따옴표 벗김, 같은 번호는 처음 것");
assert.deepEqual(parseEco("1 Flutter은 Dart 위젯 라이브러리야\n2 Next.js\n3 Node.js", 3), [undefined, "Next.js", "Node.js"], "문장 답은 이름 아님, .js는 허용");
assert.deepEqual(parseEco("1 Socket.IO\n2 Built with React\n3 Ruby on Rails", 3), ["Socket.IO", undefined, "Ruby on Rails"], "점 붙은 이름 허용, 짧은 영어 문장은 거름");
assert.deepEqual(parseEco("1 A-Frame\n2 Written in Rust", 2), ["A-Frame", undefined], "A-Frame은 이름, Written in Rust는 문장");
assert.ok(ecoPrompt([{ name: "Positioned", def: "Stack 안 위치" }]).includes("1. Positioned — Stack 안 위치"));
console.log("cardEcoAI ok");
