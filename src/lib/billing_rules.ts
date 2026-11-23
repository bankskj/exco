// Cost rule matching and split arithmetic for the Client Billing module.
// All amounts are integer cents; percentage application uses Math.round and
// the LAST piece always absorbs the rounding difference so pieces sum exactly.

import type { CostRule, TargetKind } from "./billing_types";

export type MatchableLine = {
  supplier: string | null;
  description: string | null;
  glCode: string | null;
  txnDate: string;
};

export function ruleMatches(rule: CostRule, line: MatchableLine): boolean {
  if (!rule.active) return false;
  if (rule.supplierMatch !== null) {
    if (line.supplier === null) return false;
    if (!line.supplier.toLowerCase().includes(rule.supplierMatch.toLowerCase())) return false;
  }
  if (rule.descriptionMatch !== null) {
    if (line.description === null) return false;
    if (!line.description.toLowerCase().includes(rule.descriptionMatch.toLowerCase())) return false;
  }
  if (rule.glCode !== null && line.glCode !== rule.glCode) return false;
  // YYYY-MM-DD strings compare correctly lexicographically.
  if (rule.effectiveFrom !== null && line.txnDate < rule.effectiveFrom) return false;
  if (rule.effectiveTo !== null && line.txnDate > rule.effectiveTo) return false;
  return true;
}

export function firstMatchingRule(rules: CostRule[], line: MatchableLine): CostRule | null {
  const ordered = [...rules].sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name)
  );
  for (const rule of ordered) {
    if (ruleMatches(rule, line)) return rule;
  }
  return null;
}

export type SplitPiece = { targetKind: TargetKind; projectId: string | null; amountC: number };

/** Percent splits: callers guarantee pcts total 100. Last split absorbs rounding. */
export function applyPctSplits(
  amountC: number,
  splits: { targetKind: TargetKind; projectId: string | null; pct: number }[]
): SplitPiece[] {
  if (splits.length === 0 || amountC === 0) return [];
  const pieces: SplitPiece[] = [];
  let allocated = 0;
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    const amt = i === splits.length - 1 ? amountC - allocated : Math.round((amountC * s.pct) / 100);
    allocated += amt;
    if (amt !== 0) pieces.push({ targetKind: s.targetKind, projectId: s.projectId, amountC: amt });
  }
  return pieces;
}

export function applyRuleSplits(amountC: number, rule: CostRule): SplitPiece[] {
  if (amountC === 0) return [];

  if (rule.mode === "percent") {
    const pctSplits = rule.splits
      .filter((s) => s.pct !== null)
      .map((s) => ({ targetKind: s.targetKind as TargetKind, projectId: s.projectId, pct: s.pct as number }));
    return applyPctSplits(amountC, pctSplits);
  }

  // Fixed mode.
  const pieces: SplitPiece[] = [];
  const push = (targetKind: TargetKind, projectId: string | null, amt: number) => {
    if (amt !== 0) pieces.push({ targetKind, projectId, amountC: amt });
  };
  const fixed = rule.splits.filter((s) => !s.isRemainder && s.fixedC !== null);
  const remainderSplit = rule.splits.find((s) => s.isRemainder) ?? null;
  const sumFixed = fixed.reduce((t, s) => t + (s.fixedC as number), 0);

  if (amountC >= sumFixed) {
    for (const s of fixed) push(s.targetKind, s.projectId, s.fixedC as number);
    const leftover = amountC - sumFixed;
    if (remainderSplit !== null) push(remainderSplit.targetKind, remainderSplit.projectId, leftover);
    else push("overhead", null, leftover); // no remainder split: leftover stays allocated via overhead
  } else if (sumFixed > 0) {
    // Shortfall (or negative amount): scale fixed amounts pro rata, last absorbs.
    let allocated = 0;
    for (let i = 0; i < fixed.length; i++) {
      const s = fixed[i];
      const amt =
        i === fixed.length - 1
          ? amountC - allocated
          : Math.round((amountC * (s.fixedC as number)) / sumFixed);
      allocated += amt;
      push(s.targetKind, s.projectId, amt);
    }
    // Remainder split gets 0 in a shortfall (dropped).
  } else if (remainderSplit !== null) {
    push(remainderSplit.targetKind, remainderSplit.projectId, amountC);
  } else {
    push("overhead", null, amountC);
  }
  return pieces;
}
