import assert from "node:assert/strict";
import test from "node:test";
import { layoutOverlappingBlocks } from "./sectionPackages.js";

const block = (over) => ({
  day: "M",
  startMin: 10 * 60,
  endMin: 11 * 60,
  ...over,
});

const byId = (laid, id) => laid.find((b) => b.id === id);

test("non-overlapping meetings keep full width", () => {
  const laid = layoutOverlappingBlocks([
    block({ id: "a", startMin: 10 * 60, endMin: 11 * 60 }),
    block({ id: "b", startMin: 11 * 60, endMin: 12 * 60 }),
  ]);
  assert.equal(byId(laid, "a").colCount, 1);
  assert.equal(byId(laid, "b").colCount, 1);
});

test("two overlapping meetings sit in adjacent columns", () => {
  const laid = layoutOverlappingBlocks([
    block({ id: "a", startMin: 10 * 60, endMin: 11 * 60 }),
    block({ id: "b", startMin: 10 * 60 + 30, endMin: 11 * 60 + 30 }),
  ]);
  assert.equal(laid.length, 2);
  assert.equal(byId(laid, "a").colCount, 2);
  assert.equal(byId(laid, "b").colCount, 2);
  assert.notEqual(byId(laid, "a").col, byId(laid, "b").col);
});

test("a chain of overlaps shares two columns, not three", () => {
  // A 10–12, B 11–13, C 12:30–14 — A and C do not overlap, so C reuses A's column.
  const laid = layoutOverlappingBlocks([
    block({ id: "a", startMin: 10 * 60, endMin: 12 * 60 }),
    block({ id: "b", startMin: 11 * 60, endMin: 13 * 60 }),
    block({ id: "c", startMin: 12 * 60 + 30, endMin: 14 * 60 }),
  ]);
  assert.equal(byId(laid, "a").colCount, 2);
  assert.equal(byId(laid, "b").colCount, 2);
  assert.equal(byId(laid, "c").colCount, 2);
  assert.equal(byId(laid, "a").col, byId(laid, "c").col);
  assert.notEqual(byId(laid, "a").col, byId(laid, "b").col);
});

test("three mutually overlapping meetings each get their own column", () => {
  const laid = layoutOverlappingBlocks([
    block({ id: "a", startMin: 10 * 60, endMin: 12 * 60 }),
    block({ id: "b", startMin: 10 * 60 + 15, endMin: 12 * 60 }),
    block({ id: "c", startMin: 10 * 60 + 30, endMin: 12 * 60 }),
  ]);
  assert.deepEqual(
    [byId(laid, "a"), byId(laid, "b"), byId(laid, "c")].map((b) => b.colCount),
    [3, 3, 3]
  );
  assert.equal(new Set(laid.map((b) => b.col)).size, 3);
});

test("an empty day lays out as nothing", () => {
  assert.deepEqual(layoutOverlappingBlocks([]), []);
});
