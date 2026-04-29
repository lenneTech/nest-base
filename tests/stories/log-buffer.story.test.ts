import { describe, expect, it } from "vitest";

import { LogBuffer } from "../../src/core/dx/log-buffer.js";

const rec = (level: number, msg: string) => ({ level, time: Date.now(), msg });

describe("Story · Log-Buffer Ring", () => {
  it("speichert Records in der Reihenfolge des Push", () => {
    const buf = new LogBuffer({ maxRecords: 5 });
    buf.push(rec(30, "a"));
    buf.push(rec(30, "b"));
    buf.push(rec(30, "c"));
    expect(buf.recent().map((r) => r.msg)).toEqual(["a", "b", "c"]);
  });

  it("verwirft älteste Records ab Kapazität (FIFO)", () => {
    const buf = new LogBuffer({ maxRecords: 3 });
    buf.push(rec(30, "a"));
    buf.push(rec(30, "b"));
    buf.push(rec(30, "c"));
    buf.push(rec(30, "d"));
    buf.push(rec(30, "e"));
    expect(buf.recent().map((r) => r.msg)).toEqual(["c", "d", "e"]);
    expect(buf.size()).toBe(3);
  });

  it("vergibt monoton wachsende Sequenznummern", () => {
    const buf = new LogBuffer();
    buf.push(rec(30, "a"));
    buf.push(rec(30, "b"));
    buf.push(rec(30, "c"));
    const seqs = buf.recent().map((r) => r.seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it("liefert nur Records nach dem since-Cursor", () => {
    const buf = new LogBuffer();
    buf.push(rec(30, "a"));
    buf.push(rec(30, "b"));
    buf.push(rec(30, "c"));
    expect(buf.since(1).map((r) => r.msg)).toEqual(["b", "c"]);
    expect(buf.since(99).map((r) => r.msg)).toEqual([]);
  });

  it("recent(n) trimt auf die letzten n Records", () => {
    const buf = new LogBuffer({ maxRecords: 10 });
    for (let i = 0; i < 10; i++) buf.push(rec(30, String(i)));
    expect(buf.recent(3).map((r) => r.msg)).toEqual(["7", "8", "9"]);
  });

  it("clear() leert den Buffer", () => {
    const buf = new LogBuffer();
    buf.push(rec(30, "a"));
    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.recent()).toEqual([]);
  });
});
