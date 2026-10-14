// node:sqlite 최소 타입(#1086) — 런타임(Node 22.13+ / Electron 내장 Node 24)엔 있지만 @types/node 20엔 없음.
// 쓰는 것만(읽기 전용 열기 + prepare/get/all + close). @types/node를 22+로 올리면 이 파일 삭제.
declare module "node:sqlite" {
  interface StatementSync {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean; open?: boolean });
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
