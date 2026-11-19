// cardEcoAI 점검 — node --experimental-strip-types src/lib/cardEcoAI.check.ts
import assert from "node:assert/strict";
import { ecoPrompt, parseEco } from "./cardEcoAI.ts";

assert.deepEqual(parseEco("1 Flutter\n2. React Native\n3: -\n**4** TypeScript — 표준\n5 없음", 6), ["Flutter", "React Native", "", "TypeScript", "", undefined]);
assert.deepEqual(parseEco("1 \"Git\"\n1 npm", 1), ["Git"], "따옴표 벗김, 같은 번호는 처음 것");
assert.ok(ecoPrompt([{ name: "Positioned", def: "Stack 안 위치" }]).includes("1. Positioned — Stack 안 위치"));
console.log("cardEcoAI ok");
