import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // 데스크톱(Electron) 패키징용 자족 서버 산출 — .next/standalone/apps/mustard/server.js(모노레포 중첩).
  output: "standalone",
  // 모노레포서 NFT(파일 추적) 루트를 레포 루트로 고정(#898). 미지정 시 "whole project traced" 경고 +
  // 비결정적 레이아웃. hoist된 루트 node_modules를 정확히 추적하려면 루트 기준 필요.
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  // 모노레포 워크스페이스 패키지(#885) — node_modules의 TS 소스라 Next가 트랜스파일하게 명시.
  transpilePackages: ["@mustard/core", "@mustard/nunopi"],
  // 에이전트 런타임 SDK는 별도 node 프로세스를 fork로 띄운다(네이티브 better-sqlite3 포함).
  // 번들에 넣지 않고 런타임에 node_modules에서 require하도록 외부화.
  // tree-sitter(WASM 심볼 추출)는 런타임에 node_modules서 .wasm 로드 — 번들 시 grammar wasm 파싱 실패.
  // #1340 proxy.ts가 요청 본문을 메모리에 복제(기본 10MB, 넘으면 잘림) — 큰 본문(이미지·파일)이 잘리지 않게 넉넉히.
  experimental: { proxyClientMaxBodySize: "100mb" },
  serverExternalPackages: ["@sna-sdk/core", "@sna-sdk/client", "better-sqlite3", "web-tree-sitter", "tree-sitter-wasms"],
};

export default nextConfig;
