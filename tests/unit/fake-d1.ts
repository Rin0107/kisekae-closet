/// <reference types="node" />
// テスト用の D1 (Node の SQLite に migrations/ を流したもの)。本物の D1 と同じ SQL がそのまま動く。
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

class Stmt {
  constructor(
    readonly db: DatabaseSync,
    readonly sql: string,
    readonly args: unknown[] = [],
  ) {}
  bind(...args: unknown[]) {
    return new Stmt(this.db, this.sql, args);
  }
  #params(): SQLInputValue[] {
    return this.args.map((a) => (a instanceof Uint8Array ? new Uint8Array(a) : a)) as SQLInputValue[];
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.#params()) as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.#params()) as T[] };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.#params());
    return { meta: { changes: Number(r.changes) } };
  }
}

export class FakeD1 {
  readonly db = new DatabaseSync(":memory:");
  constructor(foreignKeys = true) {
    this.db.exec(`PRAGMA foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
    for (const f of readdirSync("migrations").sort()) this.db.exec(readFileSync(`migrations/${f}`, "utf8"));
  }
  prepare(sql: string) {
    return new Stmt(this.db, sql);
  }
  async batch(stmts: Stmt[]) {
    this.db.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  /** テストで中身を直接見る。 */
  rows(sql: string, ...args: SQLInputValue[]) {
    return this.db.prepare(sql).all(...args);
  }
}

/** foreignKeys: false は、消す順の確かめ用 (ON DELETE CASCADE に頼らずに全部消すか)。 */
export function fakeEnv(foreignKeys = true) {
  const d1 = new FakeD1(foreignKeys);
  return { d1, env: { DB: d1 as unknown as D1Database } };
}
