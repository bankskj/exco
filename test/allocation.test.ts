import { describe, it, expect } from "vitest";
import type {
  BillingClient,
  BillingProject,
  CostLine,
  CostRule,
  GlCategory,
  PeriodInput,
  PeriodResult,
  RevenueLine,
  StaffAllocation,
  StaffMember,
} from "../src/lib/billing_types";
import { computePeriod } from "../src/lib/allocation";
import { applyPctSplits, applyRuleSplits, firstMatchingRule, ruleMatches } from "../src/lib/billing_rules";

// ---------------------------------------------------------------------------
// Factories — all amounts in integer cents.
// ---------------------------------------------------------------------------

function client(id: string, name: string, sortOrder: number, isGeneral = false): BillingClient {
  return { id, name, shortName: null, isGeneral, sortOrder, active: true };
}

function project(id: string, clientId: string, isDefault = true): BillingProject {
  return {
    id,
    clientId,
    name: id,
    code: null,
    isDefault,
    billingType: "retainer",
    contractValueC: null,
    startPeriod: null,
    endPeriod: null,
    status: "open",
  };
}

function cat(code: string, kind: "revenue" | "cost", treatment: GlCategory["treatment"], reportGroup: string): GlCategory {
  return { code, name: code, kind, reportGroup, treatment, sortOrder: 0 };
}

function rev(over: Partial<RevenueLine> & { id: string; amountC: number }): RevenueLine {
  return {
    period: "2026-10",
    txnDate: "2026-10-15",
    source: "xero",
    docNumber: null,
    docType: null,
    contactName: null,
    clientId: null,
    projectId: null,
    glCode: null,
    description: null,
    ...over,
  };
}

function cost(over: Partial<CostLine> & { id: string; amountC: number }): CostLine {
  return {
    period: "2026-10",
    txnDate: "2026-10-15",
    source: "xero",
    docKind: "bill",
    supplier: null,
    reference: null,
    description: null,
    glCode: null,
    employeeId: null,
    ...over,
  };
}

function staffM(employeeId: string, name: string, defaultTarget: "general" | "overhead", payrollGrossC: number | null = null, loadingPct = 0, payrollPayeC: number | null = null): StaffMember {
  return { employeeId, name, defaultTarget, loadingPct, payrollGrossC, payrollPayeC };
}

function alloc(employeeId: string, period: string, pct: number, projectId: string | null, targetKind: "project" | "overhead" = "project"): StaffAllocation {
  return { employeeId, period, targetKind, projectId, pct };
}

function rule(over: Partial<CostRule> & { id: string; name: string; mode: CostRule["mode"]; splits: CostRule["splits"] }): CostRule {
  return {
    priority: 10,
    supplierMatch: null,
    descriptionMatch: null,
    glCode: null,
    effectiveFrom: null,
    effectiveTo: null,
    active: true,
    ...over,
  };
}

// Twelve active clients, seeded like production; General Sales last via sortOrder 99.
const CLIENT_IDS = ["abf", "axiomatic", "devco", "z1", "z2", "z3", "z4", "z5", "z6", "z7", "z8", "general"];

function twelveClients(): BillingClient[] {
  return CLIENT_IDS.map((suffix, i) =>
    suffix === "general"
      ? client("cl-general", "General Sales", 99, true)
      : client(`cl-${suffix}`, suffix.toUpperCase(), i + 1)
  );
}

function defaultProjects(): BillingProject[] {
  return CLIENT_IDS.map((suffix) => project(`pr-${suffix}`, `cl-${suffix}`));
}

function categories(): GlCategory[] {
  return [
    cat("216", "revenue", "revenue", "Development"),
    cat("202", "revenue", "revenue", "Retainers"),
    cat("203", "revenue", "revenue", "Other sales"),
    cat("312", "cost", "people", "Staff"),
    cat("310", "cost", "direct", "Contractors"),
    cat("315", "cost", "direct", "Hosting & Infra"),
    cat("446", "cost", "overhead", "Connectivity"),
    cat("456", "cost", "overhead", "Running costs"),
    cat("435", "cost", "people", "Staff"),
    cat("17015949", "cost", "excluded", "Interest"),
  ];
}

const hetznerRule = rule({
  id: "rule-hetzner",
  name: "Hetzner",
  priority: 1,
  supplierMatch: "hetzner",
  mode: "fixed",
  splits: [
    { targetKind: "project", projectId: "pr-axiomatic", pct: null, fixedC: 100_000, isRemainder: false },
    { targetKind: "overhead", projectId: null, pct: null, fixedC: null, isRemainder: true },
  ],
});

const afrihostRule = rule({
  id: "rule-afrihost",
  name: "Afrihost",
  priority: 2,
  supplierMatch: "afrihost",
  mode: "percent",
  splits: [{ targetKind: "project", projectId: "pr-abf", pct: 100, fixedC: null, isRemainder: false }],
});

function baseInput(over: Partial<PeriodInput> = {}): PeriodInput {
  return {
    period: "2026-10",
    overheadBasis: "revenue",
    fixedShares: [],
    clients: twelveClients(),
    projects: defaultProjects(),
    categories: categories(),
    revenueLines: [
      rev({ id: "rev-abf", glCode: "216", clientId: "cl-abf", contactName: "ABF", amountC: 30_000_000 }),
      rev({ id: "rev-axiomatic", glCode: "202", clientId: "cl-axiomatic", contactName: "Axiomatic", amountC: 5_000_000 }),
      rev({ id: "rev-other", glCode: "203", clientId: null, contactName: "Misc Customer", amountC: 5_000_000 }),
    ],
    costLines: [
      cost({ id: "cost-staff-a", glCode: "312", docKind: "spend", employeeId: "staff-a", supplier: "Staff A", amountC: 6_000_000 }),
      cost({ id: "cost-staff-b", glCode: "310", docKind: "spend", employeeId: "staff-b", supplier: "Staff B", amountC: 4_000_000 }),
      cost({ id: "cost-staff-c", glCode: "435", employeeId: "staff-c", supplier: "Staff C", amountC: 2_000_000 }),
      cost({ id: "cost-hetzner", glCode: "315", supplier: "Hetzner", amountC: 300_000 }),
      cost({ id: "cost-afrihost", glCode: "446", supplier: "Afrihost Uncapped Business", amountC: 94_800 }),
      cost({ id: "cost-rent", glCode: "456", supplier: "Property Co", amountC: 1_500_000 }),
      cost({ id: "cost-contractor", glCode: "310", supplier: "Freelance Dev", amountC: 3_000_000 }),
      cost({ id: "cost-interest", glCode: "17015949", supplier: "Bank", amountC: 50_000 }),
    ],
    staff: [
      staffM("staff-a", "Staff A", "general"),
      staffM("staff-b", "Staff B", "general"),
      staffM("staff-c", "Staff C", "overhead"),
    ],
    allocations: [
      alloc("staff-a", "2026-10", 100, "pr-abf"),
      alloc("staff-b", "2026-10", 50, "pr-axiomatic"),
      // staff-c: no allocation rows.
    ],
    costSplits: [],
    rules: [hetznerRule, afrihostRule],
    budgets: [],
    ...over,
  };
}

function cl(r: PeriodResult, clientId: string) {
  const found = r.clients.find((c) => c.clientId === clientId);
  if (!found) throw new Error(`client ${clientId} missing from result`);
  return found;
}

// ---------------------------------------------------------------------------
// billing_rules unit tests
// ---------------------------------------------------------------------------

describe("billing_rules", () => {
  const line = { supplier: "Hetzner Online GmbH", description: "Cloud servers", glCode: "315", txnDate: "2026-10-05" };

  it("matches case-insensitively on supplier/description, exactly on glCode, within date window", () => {
    const r = rule({
      id: "r1", name: "r1", mode: "percent",
      supplierMatch: "HETZNER", descriptionMatch: "cloud", glCode: "315",
      effectiveFrom: "2026-10-01", effectiveTo: "2026-10-31",
      splits: [{ targetKind: "overhead", projectId: null, pct: 100, fixedC: null, isRemainder: false }],
    });
    expect(ruleMatches(r, line)).toBe(true);
    expect(ruleMatches(r, { ...line, glCode: "316" })).toBe(false);
    expect(ruleMatches(r, { ...line, supplier: null })).toBe(false);
    expect(ruleMatches(r, { ...line, txnDate: "2026-09-30" })).toBe(false);
    expect(ruleMatches(r, { ...line, txnDate: "2026-11-01" })).toBe(false);
    expect(ruleMatches({ ...r, active: false }, line)).toBe(false);
  });

  it("firstMatchingRule picks lowest priority, ties broken by name", () => {
    const a = rule({ id: "a", name: "Beta", priority: 1, supplierMatch: "hetzner", mode: "percent", splits: [] });
    const b = rule({ id: "b", name: "Alpha", priority: 1, supplierMatch: "hetzner", mode: "percent", splits: [] });
    const c = rule({ id: "c", name: "First", priority: 0, supplierMatch: "nomatch", mode: "percent", splits: [] });
    expect(firstMatchingRule([a, c, b], line)?.id).toBe("b");
  });

  it("applyPctSplits: last split absorbs rounding, pieces sum exactly", () => {
    const pieces = applyPctSplits(10_000, [
      { targetKind: "project", projectId: "p1", pct: 33.33 },
      { targetKind: "project", projectId: "p2", pct: 33.33 },
      { targetKind: "overhead", projectId: null, pct: 33.34 },
    ]);
    expect(pieces.map((p) => p.amountC)).toEqual([3333, 3333, 3334]);
    expect(pieces.reduce((t, p) => t + p.amountC, 0)).toBe(10_000);
  });

  it("applyRuleSplits fixed: leftover without a remainder split goes to overhead", () => {
    const r = rule({
      id: "r", name: "r", mode: "fixed",
      splits: [{ targetKind: "project", projectId: "p1", pct: null, fixedC: 100_000, isRemainder: false }],
    });
    expect(applyRuleSplits(300_000, r)).toEqual([
      { targetKind: "project", projectId: "p1", employeeId: null, amountC: 100_000 },
      { targetKind: "overhead", projectId: null, employeeId: null, amountC: 200_000 },
    ]);
  });

  it("applyRuleSplits fixed: negative amount scales pro rata, remainder gets 0", () => {
    expect(applyRuleSplits(-50_000, hetznerRule)).toEqual([
      { targetKind: "project", projectId: "pr-axiomatic", employeeId: null, amountC: -50_000 },
    ]);
  });

  it("staff split piece joins the person's people cost and follows their share %", () => {
    // R10 000 batch line split 60% to Staff A (100% ABF) and 40% to Devco direct.
    const input = baseInput();
    input.costLines.push(cost({ id: "batch", glCode: "310", supplier: "DEV BATCH EFT", amountC: 10_000_00 }));
    input.costSplits.push(
      { costLineId: "batch", targetKind: "staff", projectId: null, employeeId: "staff-a", pct: 60 },
      { costLineId: "batch", targetKind: "project", projectId: "pr-devco", employeeId: null, pct: 40 },
    );
    const r = computePeriod(input);
    const abf = r.clients.find((c) => c.clientId === "cl-abf")!;
    // Staff A's month is now 60 000 00 (salary) + 6 000 00 (split piece), all to ABF.
    expect(abf.peopleC).toBe(66_000_00);
    const devco = r.clients.find((c) => c.clientId === "cl-devco")!;
    expect(devco.directC).toBe(4_000_00);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("paye-mode rule spreads a SARS PAYE payment across staff by payroll PAYE", () => {
    const input = baseInput();
    input.staff = [
      staffM("staff-a", "Staff A", "general", null, 0, 600_000), // PAYE R6 000
      staffM("staff-b", "Staff B", "general", null, 0, 400_000), // PAYE R4 000
      staffM("staff-c", "Staff C", "overhead", null, 0, 0),
    ];
    input.costLines.push(cost({ id: "paye", glCode: "428", supplier: "SARS", description: "Internet Pmt To Sarseflng 0096615178", amountC: 10_000_000 }));
    input.categories.push(cat("428", "cost", "people", "People"));
    input.rules.push({
      id: "r-paye", name: "SARS PAYE", priority: 1, supplierMatch: null, descriptionMatch: "sarseflng", glCode: "428",
      mode: "paye", effectiveFrom: null, effectiveTo: null, active: true, splits: [],
    });
    const r = computePeriod(input);
    // R100 000 splits 60/40 by PAYE: Staff A's slice follows 100% ABF, B's 50% Axiomatic.
    const abf = cl(r, "cl-abf");
    expect(abf.peopleC).toBe(12_000_000); // 60 000 salary + 60 000 PAYE slice
    const axio = cl(r, "cl-axiomatic");
    expect(axio.peopleC).toBe(4_000_000); // 50% of B's (40 000 salary + 40 000 PAYE)
    expect(r.exceptions.unmatchedStaff).toEqual([]);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("a rule with a staff leg beats the automatic payee match", () => {
    // Amit-style: the line is payee-matched to Staff B, but a saved rule splits
    // it 50% ABF direct / 50% to Staff B as people cost.
    const input = baseInput();
    input.costLines.push(cost({ id: "amit", glCode: "310", supplier: "Development Services - Amit", employeeId: "staff-b", amountC: 8_000_00 }));
    input.rules.push({
      id: "r-amit", name: "Amit split", priority: 5, supplierMatch: "Amit", descriptionMatch: null, glCode: null,
      mode: "percent", effectiveFrom: null, effectiveTo: null, active: true,
      splits: [
        { targetKind: "project", projectId: "pr-abf", employeeId: null, pct: 50, fixedC: null, isRemainder: false },
        { targetKind: "staff", projectId: null, employeeId: "staff-b", pct: 50, fixedC: null, isRemainder: false },
      ],
    });
    const r = computePeriod(input);
    const abf = r.clients.find((c) => c.clientId === "cl-abf")!;
    expect(abf.directBySupplier.find((s) => s.supplier === "Development Services - Amit")?.amountC).toBe(4_000_00);
    // Staff B's cost is 40 000 00 (salary) + 4 000 00 (rule piece): 50% to Axiomatic, rest to General.
    const axio = r.clients.find((c) => c.clientId === "cl-axiomatic")!;
    expect(axio.peopleC).toBe(22_000_00);
    expect(r.reconciliation.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Worked example from the spec
// ---------------------------------------------------------------------------

describe("computePeriod — worked example 2026-10", () => {
  const r = computePeriod(baseInput());

  it("returns all 12 active clients in report order", () => {
    expect(r.clients).toHaveLength(12);
    expect(r.clients[0].clientId).toBe("cl-abf");
    expect(r.clients[11].clientId).toBe("cl-general");
  });

  it("ABF figures", () => {
    const abf = cl(r, "cl-abf");
    expect(abf.revenueC).toBe(30_000_000);
    expect(abf.peopleC).toBe(6_000_000);
    expect(abf.directC).toBe(94_800);
    expect(abf.contributionC).toBe(23_905_200);
    expect(abf.overheadC).toBe(2_775_000);
    // General Sales nets -4 625 after overhead; ABF carries its revenue share
    // of that loss (300k of 350k carrier revenue): 462 500 x 6/7 = 396 429c.
    expect(abf.carryC).toBe(396_429);
    expect(abf.netC).toBe(20_733_771);
    expect(abf.peopleByStaff).toEqual([
      { employeeId: "staff-a", name: "Staff A", amountC: 6_000_000, estimated: false },
    ]);
    expect(abf.directBySupplier).toEqual([{ supplier: "Afrihost Uncapped Business", amountC: 94_800 }]);
    expect(abf.budgetRevenueC).toBeNull();
    expect(abf.budgetCostC).toBeNull();
  });

  it("Axiomatic figures", () => {
    const ax = cl(r, "cl-axiomatic");
    expect(ax.revenueC).toBe(5_000_000);
    expect(ax.peopleC).toBe(2_000_000);
    expect(ax.directC).toBe(100_000);
    expect(ax.contributionC).toBe(2_900_000);
    expect(ax.overheadC).toBe(462_500);
    expect(ax.carryC).toBe(66_071); // 462 500 x 1/7, largest remainder
    expect(ax.netC).toBe(2_371_429);
  });

  it("General Sales figures", () => {
    const gen = cl(r, "cl-general");
    expect(gen.revenueC).toBe(5_000_000);
    expect(gen.peopleC).toBe(2_000_000);
    expect(gen.directC).toBe(3_000_000);
    expect(gen.contributionC).toBe(0);
    expect(gen.contributionPct).toBe(0);
    expect(gen.overheadC).toBe(462_500);
    // Its 4 625 loss is carried by the key accounts; the credit zeroes it.
    expect(gen.carryC).toBe(-462_500);
    expect(gen.netC).toBe(0);
  });

  it("zero clients stay zero", () => {
    for (const suffix of ["z1", "z2", "z3", "z4", "z5", "z6", "z7", "z8"]) {
      const z = cl(r, `cl-${suffix}`);
      expect(z.revenueC).toBe(0);
      expect(z.peopleC).toBe(0);
      expect(z.directC).toBe(0);
      expect(z.overheadC).toBe(0);
      expect(z.netC).toBe(0);
      expect(z.contributionPct).toBeNull();
      // Default project still listed, with zeros.
      expect(z.projects).toHaveLength(1);
      expect(z.projects[0].isDefault).toBe(true);
      expect(z.projects[0].netC).toBe(0);
    }
  });

  it("pool, excluded and totals", () => {
    expect(r.poolC).toBe(3_700_000); // Staff C 20 000 + Hetzner remainder 2 000 + rent 15 000
    expect(r.excludedC).toBe(50_000);
    expect(r.excludedRevenueC).toBe(0);
    expect(r.totals).toEqual({
      revenueC: 40_000_000,
      peopleC: 10_000_000,
      directC: 3_194_800,
      contributionC: 26_805_200,
      overheadC: 3_700_000,
      carryC: 0, // carry is a redistribution — it always nets to zero
      netC: 23_105_200,
    });
    expect(r.carriedLossC).toBe(462_500);
  });

  it("reconciliation and exceptions", () => {
    expect(r.reconciliation.costInC).toBe(16_894_800);
    expect(r.reconciliation.costAllocatedC).toBe(16_894_800);
    expect(r.reconciliation.revenueInC).toBe(40_000_000);
    expect(r.reconciliation.revenueAllocatedC).toBe(40_000_000);
    expect(r.reconciliation.ok).toBe(true);
    expect(r.exceptions.unmappedContacts).toEqual([
      { contactName: "Misc Customer", amountC: 5_000_000, lineCount: 1 },
    ]);
    expect(r.exceptions.unassignedDirect).toEqual([
      { costLineId: "cost-contractor", supplier: "Freelance Dev", description: null, amountC: 3_000_000 },
    ]);
    expect(r.exceptions.unmatchedStaff).toEqual([]);
    expect(r.exceptions.estimatedStaff).toEqual([]);
    expect(r.exceptions.overAllocated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Further acceptance tests
// ---------------------------------------------------------------------------

describe("computePeriod — acceptance", () => {
  it("1. rounding: pool of 10 000 cents over 3 equal weights → 3334/3333/3333", () => {
    const r = computePeriod(
      baseInput({
        overheadBasis: "fixed",
        fixedShares: [
          { clientId: "cl-abf", pct: 1 },
          { clientId: "cl-axiomatic", pct: 1 },
          { clientId: "cl-devco", pct: 1 },
        ],
        revenueLines: [],
        costLines: [cost({ id: "cost-pool", glCode: "456", supplier: "Property Co", amountC: 10_000 })],
        staff: [],
        allocations: [],
        rules: [],
      })
    );
    expect(cl(r, "cl-abf").overheadC).toBe(3334);
    expect(cl(r, "cl-axiomatic").overheadC).toBe(3333);
    expect(cl(r, "cl-devco").overheadC).toBe(3333);
    expect(r.totals.overheadC).toBe(10_000);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("2. carry-forward: 2026-10 allocation rows apply to 2026-11", () => {
    const r = computePeriod(
      baseInput({
        period: "2026-11",
        revenueLines: [],
        costLines: [
          cost({ id: "cost-staff-b", period: "2026-11", txnDate: "2026-11-05", glCode: "310", employeeId: "staff-b", supplier: "Staff B", amountC: 4_000_000 }),
        ],
        staff: [staffM("staff-b", "Staff B", "general")],
        allocations: [alloc("staff-b", "2026-10", 50, "pr-axiomatic")],
        rules: [],
      })
    );
    expect(cl(r, "cl-axiomatic").peopleC).toBe(2_000_000);
    expect(cl(r, "cl-general").peopleC).toBe(2_000_000);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("3. over-allocation (110%) → exception, 100% to default target, reconciliation ok", () => {
    const r = computePeriod(
      baseInput({
        revenueLines: [],
        costLines: [
          cost({ id: "cost-staff-b", glCode: "310", employeeId: "staff-b", supplier: "Staff B", amountC: 4_000_000 }),
        ],
        staff: [staffM("staff-b", "Staff B", "general")],
        allocations: [
          alloc("staff-b", "2026-10", 60, "pr-abf"),
          alloc("staff-b", "2026-10", 50, "pr-axiomatic"),
        ],
        rules: [],
      })
    );
    expect(r.exceptions.overAllocated).toEqual([{ employeeId: "staff-b", name: "Staff B", totalPct: 110 }]);
    expect(cl(r, "cl-abf").peopleC).toBe(0);
    expect(cl(r, "cl-axiomatic").peopleC).toBe(0);
    expect(cl(r, "cl-general").peopleC).toBe(4_000_000);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("4. fixed rule shortfall: R600 bill vs R1 000 fixed → R600 to Axiomatic, R0 overhead", () => {
    const r = computePeriod(
      baseInput({
        revenueLines: [],
        costLines: [cost({ id: "cost-hetzner", glCode: "315", supplier: "Hetzner", amountC: 60_000 })],
        staff: [],
        allocations: [],
      })
    );
    expect(cl(r, "cl-axiomatic").directC).toBe(60_000);
    expect(r.poolC).toBe(0);
    expect(r.totals.overheadC).toBe(0);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("5. manual split beats rule: 100% pr-devco on the Hetzner line", () => {
    const r = computePeriod(
      baseInput({
        costSplits: [{ costLineId: "cost-hetzner", targetKind: "project", projectId: "pr-devco", pct: 100 }],
      })
    );
    expect(cl(r, "cl-devco").directC).toBe(300_000);
    expect(cl(r, "cl-axiomatic").directC).toBe(0);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("6a. all revenue 0 → revenue basis falls back to direct_cost", () => {
    const r = computePeriod(
      baseInput({
        revenueLines: [],
        costLines: [
          cost({ id: "cost-afrihost", glCode: "446", supplier: "Afrihost Uncapped Business", amountC: 94_800 }),
          cost({ id: "cost-rent", glCode: "456", supplier: "Property Co", amountC: 1_000_000 }),
        ],
        staff: [],
        allocations: [],
      })
    );
    // ABF carries all direct cost, so it takes the whole pool.
    expect(cl(r, "cl-abf").overheadC).toBe(1_000_000);
    expect(r.totals.overheadC).toBe(1_000_000);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("6b. all revenue AND direct 0 → equal split across the 12 active clients, largest-remainder", () => {
    const r = computePeriod(
      baseInput({
        revenueLines: [],
        costLines: [cost({ id: "cost-rent", glCode: "456", supplier: "Property Co", amountC: 10_007 })],
        staff: [],
        allocations: [],
        rules: [],
      })
    );
    // 10 007 / 12 = 833.92; first 11 clients in sort order absorb the 11 spare cents.
    const shares = r.clients.map((c) => c.overheadC);
    expect(shares).toEqual([834, 834, 834, 834, 834, 834, 834, 834, 834, 834, 834, 833]);
    expect(r.totals.overheadC).toBe(10_007);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("7. credit note: extra ABF revenue line of −R10 000 → ABF revenue 290 000", () => {
    const base = baseInput();
    base.revenueLines.push(
      rev({ id: "rev-abf-credit", glCode: "216", clientId: "cl-abf", contactName: "ABF", amountC: -1_000_000 })
    );
    const r = computePeriod(base);
    expect(cl(r, "cl-abf").revenueC).toBe(29_000_000);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("8. payroll estimate: no cost lines, payrollGrossC 50 000_00, loadingPct 0", () => {
    const r = computePeriod(
      baseInput({
        revenueLines: [],
        costLines: [],
        staff: [staffM("staff-d", "Staff D", "general", 5_000_000, 0)],
        allocations: [],
      })
    );
    const gen = cl(r, "cl-general");
    expect(gen.peopleC).toBe(5_000_000);
    expect(gen.peopleByStaff).toEqual([
      { employeeId: "staff-d", name: "Staff D", amountC: 5_000_000, estimated: true },
    ]);
    expect(r.exceptions.estimatedStaff).toEqual([{ employeeId: "staff-d", name: "Staff D", amountC: 5_000_000 }]);
    expect(r.reconciliation.costInC).toBe(5_000_000);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("9. unmatched staff payment: people-treatment line with employeeId null", () => {
    const r = computePeriod(
      baseInput({
        revenueLines: [],
        costLines: [cost({ id: "cost-temp", glCode: "312", supplier: "Temp Agency", amountC: 1_000_000 })],
        staff: [],
        allocations: [],
      })
    );
    const gen = cl(r, "cl-general");
    expect(gen.peopleC).toBe(1_000_000);
    expect(gen.peopleByStaff).toEqual([
      { employeeId: "", name: "Temp Agency", amountC: 1_000_000, estimated: false },
    ]);
    expect(r.exceptions.unmatchedStaff).toEqual([
      { costLineId: "cost-temp", supplier: "Temp Agency", description: null, amountC: 1_000_000 },
    ]);
    expect(r.reconciliation.ok).toBe(true);
  });

  it("10. split-to-excluded: manual split sending 100% of a line to excluded", () => {
    const r = computePeriod(
      baseInput({
        revenueLines: [],
        costLines: [cost({ id: "cost-hetzner", glCode: "315", supplier: "Hetzner", amountC: 300_000 })],
        staff: [],
        allocations: [],
        costSplits: [{ costLineId: "cost-hetzner", targetKind: "excluded", projectId: null, pct: 100 }],
      })
    );
    expect(r.excludedC).toBe(300_000);
    expect(cl(r, "cl-axiomatic").directC).toBe(0); // rule ignored
    expect(r.poolC).toBe(0);
    expect(r.reconciliation.costInC).toBe(0);
    expect(r.reconciliation.costAllocatedC).toBe(0);
    expect(r.reconciliation.ok).toBe(true);
  });
});
