// E8 reconcile — spec §4 scenarios against the pure helpers.
import { describe, expect, it } from "vitest";
import { matchReplacements, staleRows, type LedgerRow } from "../src/data/sync_reconcile";

const row = (o: Partial<LedgerRow> & { id: string }): LedgerRow => ({
  sourceRef: o.id,
  docId: "doc-1",
  period: "2026-07",
  glCode: "429",
  amountC: 100_000,
  projectId: null,
  hasSplits: false,
  ...o,
});

const kept = (entries: Record<string, string[]>) =>
  new Map(Object.entries(entries).map(([d, refs]) => [d, new Set(refs)]));

describe("staleRows", () => {
  it("scenario 1 — doc edited from two lines to one: the dropped ref is stale", () => {
    const current = [row({ id: "a", sourceRef: "ref-a" }), row({ id: "b", sourceRef: "ref-b" })];
    const stale = staleRows(current, kept({ "doc-1": ["ref-a"] }));
    expect(stale.map((r) => r.id)).toEqual(["b"]);
  });

  it("scenario 2 — reissued LineItemIDs: every old ref is stale, new ones were inserted", () => {
    const current = [
      row({ id: "a", sourceRef: "old-1" }),
      row({ id: "b", sourceRef: "old-2" }),
      row({ id: "c", sourceRef: "new-1" }),
      row({ id: "d", sourceRef: "new-2" }),
    ];
    const stale = staleRows(current, kept({ "doc-1": ["new-1", "new-2"] }));
    expect(stale.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("documents not part of this sync are left alone", () => {
    const current = [row({ id: "a", docId: "doc-9", sourceRef: "ref-a" })];
    expect(staleRows(current, kept({ "doc-1": ["x"] }))).toEqual([]);
  });

  it("a NULL source_ref inside a synced doc is stale (pre-refactor rows)", () => {
    const current = [row({ id: "a", sourceRef: null })];
    expect(staleRows(current, kept({ "doc-1": ["ref-b"] })).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("matchReplacements", () => {
  it("scenario 2 — same gl_code and amount: splits/project carry to the unique new line", () => {
    const stale = [
      row({ id: "a", sourceRef: "old-1", glCode: "429", amountC: 60_000, hasSplits: true }),
      row({ id: "b", sourceRef: "old-2", glCode: "433", amountC: 40_000, projectId: "cl-axio" }),
    ];
    const keptRows = new Map([
      [
        "doc-1",
        [
          row({ id: "c", sourceRef: "new-1", glCode: "429", amountC: 60_000 }),
          row({ id: "d", sourceRef: "new-2", glCode: "433", amountC: 40_000 }),
        ],
      ],
    ]);
    const repl = matchReplacements(stale, keptRows);
    expect(repl.get("a")?.id).toBe("c");
    expect(repl.get("b")?.id).toBe("d");
  });

  it("scenario 3 — R1,000 line split into 600 + 400: no amount match, so an orphan", () => {
    const stale = [row({ id: "a", glCode: "429", amountC: 100_000, hasSplits: true })];
    const keptRows = new Map([
      [
        "doc-1",
        [
          row({ id: "b", glCode: "429", amountC: 60_000 }),
          row({ id: "c", glCode: "429", amountC: 40_000 }),
        ],
      ],
    ]);
    expect(matchReplacements(stale, keptRows).size).toBe(0);
  });

  it("ambiguous match (two identical kept lines) yields no carry", () => {
    const stale = [row({ id: "a", amountC: 50_000, hasSplits: true })];
    const keptRows = new Map([
      ["doc-1", [row({ id: "b", amountC: 50_000 }), row({ id: "c", amountC: 50_000 })]],
    ]);
    expect(matchReplacements(stale, keptRows).size).toBe(0);
  });

  it("rows with nothing manual on them are skipped entirely", () => {
    const stale = [row({ id: "a", amountC: 50_000 })];
    const keptRows = new Map([["doc-1", [row({ id: "b", amountC: 50_000 })]]]);
    expect(matchReplacements(stale, keptRows).size).toBe(0);
  });
});
