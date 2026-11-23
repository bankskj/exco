// Client Billing & Cost Allocation engine.
// Pure function over PeriodInput — no I/O, no clock. All money is integer cents;
// every allocation path is exact-sum (last piece / largest remainder absorbs
// rounding) so the reconciliation equalities hold to the cent.

import type {
  BillingProject,
  ClientResult,
  GlCategory,
  GroupAmount,
  PeriodExceptions,
  PeriodInput,
  PeriodResult,
  ProjectResult,
  StaffAllocation,
  StaffPiece,
  SupplierAmount,
  Treatment,
} from "./billing_types";
import { applyPctSplits, applyRuleSplits, firstMatchingRule } from "./billing_rules";

type ProjAcc = {
  revenueC: number;
  revenueByGroup: Map<string, number>;
  peopleC: number;
  peopleByStaff: Map<string, StaffPiece>;
  directC: number;
  directByGroup: Map<string, number>;
  directBySupplier: Map<string, number>;
  overheadC: number;
};

function emptyAcc(): ProjAcc {
  return {
    revenueC: 0,
    revenueByGroup: new Map(),
    peopleC: 0,
    peopleByStaff: new Map(),
    directC: 0,
    directByGroup: new Map(),
    directBySupplier: new Map(),
    overheadC: 0,
  };
}

function addToMap(map: Map<string, number>, key: string, amountC: number): void {
  map.set(key, (map.get(key) ?? 0) + amountC);
}

/** Apportion total (cents) by weights, exact-sum via largest remainder.
 * Ties on fractional part go to the earlier index. Negative totals are
 * apportioned on the absolute value and negated. */
function largestRemainder(total: number, weights: number[]): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  const W = weights.reduce((a, b) => a + b, 0);
  if (n === 0 || total === 0 || W <= 0) return out;
  const sign = total < 0 ? -1 : 1;
  const T = Math.abs(total);
  const exact = weights.map((w) => (T * w) / W);
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    out[i] = Math.floor(exact[i]);
    allocated += out[i];
  }
  let rem = T - allocated;
  const order = exact
    .map((e, i) => ({ frac: e - Math.floor(e), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let k = 0;
  while (rem > 0) {
    out[order[k % n].i] += 1;
    k++;
    rem--;
  }
  if (sign < 0) for (let i = 0; i < n; i++) out[i] = -out[i];
  return out;
}

function sortedGroups(map: Map<string, number>): GroupAmount[] {
  return [...map.entries()]
    .map(([group, amountC]) => ({ group, amountC }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

function sortedSuppliers(map: Map<string, number>): SupplierAmount[] {
  return [...map.entries()]
    .map(([supplier, amountC]) => ({ supplier, amountC }))
    .sort((a, b) => b.amountC - a.amountC);
}

function sortedStaff(map: Map<string, StaffPiece>): StaffPiece[] {
  return [...map.values()].sort((a, b) => b.amountC - a.amountC);
}

export function computePeriod(input: PeriodInput): PeriodResult {
  // ----- Setup ---------------------------------------------------------------
  const catByCode = new Map<string, GlCategory>();
  for (const c of input.categories) catByCode.set(c.code, c);

  const treatmentOf = (glCode: string | null, kind: "revenue" | "cost"): Treatment => {
    const cat = glCode !== null ? catByCode.get(glCode) : undefined;
    if (cat) return cat.treatment;
    return kind === "cost" ? "overhead" : "revenue";
  };
  const groupOf = (glCode: string | null): string => {
    const cat = glCode !== null ? catByCode.get(glCode) : undefined;
    return cat ? cat.reportGroup : "Unmapped";
  };

  const activeClients = input.clients
    .filter((c) => c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const projectsByClient = new Map<string, BillingProject[]>();
  const defaultByClient = new Map<string, BillingProject>();
  for (const p of input.projects) {
    const list = projectsByClient.get(p.clientId);
    if (list) list.push(p);
    else projectsByClient.set(p.clientId, [p]);
    if (p.isDefault) defaultByClient.set(p.clientId, p);
  }
  for (const list of projectsByClient.values()) {
    list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  }

  const generalClient = activeClients.find((c) => c.isGeneral);
  const generalDefault = generalClient ? defaultByClient.get(generalClient.id) : undefined;
  if (!generalClient || !generalDefault) {
    throw new Error("computePeriod: active General Sales client with a default project is required");
  }

  const accs = new Map<string, ProjAcc>();
  const acc = (projectId: string): ProjAcc => {
    let a = accs.get(projectId);
    if (!a) {
      a = emptyAcc();
      accs.set(projectId, a);
    }
    return a;
  };

  const addDirect = (projectId: string, amountC: number, group: string, supplier: string | null): void => {
    if (amountC === 0) return;
    const a = acc(projectId);
    a.directC += amountC;
    addToMap(a.directByGroup, group, amountC);
    addToMap(a.directBySupplier, supplier ?? "(no supplier)", amountC);
  };

  const addPeople = (projectId: string, piece: StaffPiece): void => {
    if (piece.amountC === 0) return;
    const a = acc(projectId);
    a.peopleC += piece.amountC;
    const key = `${piece.employeeId}\u0000${piece.name}`;
    const existing = a.peopleByStaff.get(key);
    if (existing) {
      existing.amountC += piece.amountC;
      existing.estimated = existing.estimated || piece.estimated;
    } else {
      a.peopleByStaff.set(key, { ...piece });
    }
  };

  const exceptions: PeriodExceptions = {
    unmappedContacts: [],
    unassignedDirect: [],
    unmatchedStaff: [],
    estimatedStaff: [],
    overAllocated: [],
  };

  // ----- Revenue -------------------------------------------------------------
  let excludedRevenueC = 0;
  let revenueInC = 0;
  const unmapped = new Map<string, { amountC: number; lineCount: number }>();

  for (const line of input.revenueLines) {
    if (treatmentOf(line.glCode, "revenue") === "excluded") {
      excludedRevenueC += line.amountC;
      continue;
    }
    revenueInC += line.amountC;
    let projectId: string;
    if (line.projectId !== null) {
      projectId = line.projectId;
    } else if (line.clientId !== null && defaultByClient.has(line.clientId)) {
      projectId = defaultByClient.get(line.clientId)!.id;
    } else {
      projectId = generalDefault.id;
      if (line.clientId === null) {
        const name = line.contactName ?? "(no contact)";
        const entry = unmapped.get(name);
        if (entry) {
          entry.amountC += line.amountC;
          entry.lineCount += 1;
        } else {
          unmapped.set(name, { amountC: line.amountC, lineCount: 1 });
        }
      }
    }
    const a = acc(projectId);
    a.revenueC += line.amountC;
    addToMap(a.revenueByGroup, groupOf(line.glCode), line.amountC);
  }
  exceptions.unmappedContacts = [...unmapped.entries()].map(([contactName, e]) => ({
    contactName,
    amountC: e.amountC,
    lineCount: e.lineCount,
  }));

  // ----- Cost lines ----------------------------------------------------------
  let excludedCatC = 0; // category-excluded whole lines
  let splitExcludedC = 0; // pieces sent to excluded via manual splits
  let poolC = 0;
  let costInLinesC = 0; // Σ non-category-excluded cost line amounts

  const splitsByLine = new Map<string, typeof input.costSplits>();
  for (const s of input.costSplits) {
    const list = splitsByLine.get(s.costLineId);
    if (list) list.push(s);
    else splitsByLine.set(s.costLineId, [s]);
  }

  const peopleSums = new Map<string, number>(); // employeeId → cents

  for (const line of input.costLines) {
    const treatment = treatmentOf(line.glCode, "cost");
    if (treatment === "excluded") {
      excludedCatC += line.amountC;
      continue;
    }
    costInLinesC += line.amountC;

    const group = groupOf(line.glCode);

    // Manual splits are an explicit per-line decision — they beat the automatic
    // payee match and rules. A "staff" piece joins that person's people cost
    // and follows their share %; a piece with no employee set keeps the cents
    // allocated via the pool.
    const manual = splitsByLine.get(line.id);
    if (manual && manual.length > 0) {
      const pieces = applyPctSplits(
        line.amountC,
        manual.map((s) => ({ targetKind: s.targetKind, projectId: s.projectId, employeeId: s.employeeId, pct: s.pct }))
      );
      for (const p of pieces) {
        if (p.targetKind === "project") addDirect(p.projectId as string, p.amountC, group, line.supplier);
        else if (p.targetKind === "staff") {
          if (p.employeeId) addToMap(peopleSums, p.employeeId, p.amountC);
          else poolC += p.amountC;
        } else if (p.targetKind === "overhead") poolC += p.amountC;
        else splitExcludedC += p.amountC;
      }
      continue;
    }

    // Rules are explicit user config too, so they beat the automatic payee
    // match — a saved split on a recurring staff payment keeps applying even
    // though the payee alias would otherwise take the whole line.
    const rule = firstMatchingRule(input.rules, {
      supplier: line.supplier,
      description: line.description,
      glCode: line.glCode,
      txnDate: line.txnDate,
    });
    if (rule) {
      if (rule.mode === "paye") {
        // Split across staff by each person's payroll PAYE for the month
        // (fallback: payroll gross); exact-sum via largest remainder. With no
        // payroll captured at all, the line stays in the pool.
        let weights = input.staff.map((m) => Math.max(0, m.payrollPayeC ?? 0));
        if (!weights.some((w) => w > 0)) weights = input.staff.map((m) => Math.max(0, m.payrollGrossC ?? 0));
        if (weights.some((w) => w > 0)) {
          const pieces = largestRemainder(line.amountC, weights);
          input.staff.forEach((m, i) => {
            if (pieces[i] !== 0) addToMap(peopleSums, m.employeeId, pieces[i]);
          });
        } else {
          poolC += line.amountC;
        }
        continue;
      }
      for (const p of applyRuleSplits(line.amountC, rule)) {
        if (p.targetKind === "project") addDirect(p.projectId as string, p.amountC, group, line.supplier);
        else if (p.targetKind === "staff" && p.employeeId) addToMap(peopleSums, p.employeeId, p.amountC);
        else poolC += p.amountC;
      }
      continue;
    }

    // People lines follow the person regardless of GL treatment.
    if (line.employeeId !== null) {
      addToMap(peopleSums, line.employeeId, line.amountC);
      continue;
    }

    if (treatment === "people") {
      exceptions.unmatchedStaff.push({
        costLineId: line.id,
        supplier: line.supplier,
        description: line.description,
        amountC: line.amountC,
      });
      addPeople(generalDefault.id, {
        employeeId: "",
        name: line.supplier ?? "Unmatched staff payment",
        amountC: line.amountC,
        estimated: false,
      });
      continue;
    }

    if (treatment === "direct") {
      exceptions.unassignedDirect.push({
        costLineId: line.id,
        supplier: line.supplier,
        description: line.description,
        amountC: line.amountC,
      });
      addDirect(generalDefault.id, line.amountC, group, line.supplier);
    } else {
      poolC += line.amountC;
    }
  }

  // ----- People spreading ----------------------------------------------------
  let estimatesC = 0;
  const staffIds = new Set(input.staff.map((s) => s.employeeId));

  for (const member of input.staff) {
    let costC = peopleSums.get(member.employeeId) ?? 0;
    let estimated = false;
    if (costC === 0 && member.payrollGrossC !== null) {
      costC = Math.round(member.payrollGrossC * (1 + member.loadingPct / 100));
      estimated = true;
      exceptions.estimatedStaff.push({ employeeId: member.employeeId, name: member.name, amountC: costC });
      estimatesC += costC;
    }
    if (costC === 0) continue;

    // Carry-forward: latest allocation period <= input period, per employee.
    const mine = input.allocations.filter(
      (a) => a.employeeId === member.employeeId && a.period <= input.period
    );
    let used: StaffAllocation[] = [];
    if (mine.length > 0) {
      let best = "";
      for (const a of mine) if (a.period > best) best = a.period;
      used = mine.filter((a) => a.period === best);
    }

    const totalPct = used.reduce((t, a) => t + a.pct, 0);
    if (totalPct > 100 + 1e-9) {
      exceptions.overAllocated.push({ employeeId: member.employeeId, name: member.name, totalPct });
      used = [];
    }
    const usedPct = used.reduce((t, a) => t + a.pct, 0);
    const fullyAllocated = used.length > 0 && Math.abs(usedPct - 100) <= 1e-9;

    const pieces: number[] = [];
    let allocated = 0;
    for (let i = 0; i < used.length; i++) {
      const amt =
        fullyAllocated && i === used.length - 1
          ? costC - allocated
          : Math.round((costC * used[i].pct) / 100);
      allocated += amt;
      pieces.push(amt);
    }
    let remainder = costC - allocated;
    if (remainder < 0 && pieces.length > 0) {
      pieces[pieces.length - 1] += remainder;
      remainder = 0;
    }

    for (let i = 0; i < used.length; i++) {
      if (pieces[i] === 0) continue;
      if (used[i].targetKind === "project") {
        addPeople(used[i].projectId as string, {
          employeeId: member.employeeId,
          name: member.name,
          amountC: pieces[i],
          estimated,
        });
      } else {
        poolC += pieces[i];
      }
    }
    if (remainder !== 0) {
      if (member.defaultTarget === "general") {
        addPeople(generalDefault.id, {
          employeeId: member.employeeId,
          name: member.name,
          amountC: remainder,
          estimated,
        });
      } else {
        poolC += remainder;
      }
    }
  }

  // People lines whose employeeId has no staff record: keep the cents allocated.
  for (const [employeeId, amountC] of peopleSums) {
    if (!staffIds.has(employeeId) && amountC !== 0) {
      addPeople(generalDefault.id, { employeeId, name: employeeId, amountC, estimated: false });
    }
  }

  // ----- Pool and overhead recovery -------------------------------------------
  const clientBase = new Map<string, { revenueC: number; peopleC: number; directC: number }>();
  for (const c of activeClients) {
    let revenueC = 0;
    let peopleC = 0;
    let directC = 0;
    for (const p of projectsByClient.get(c.id) ?? []) {
      const a = accs.get(p.id);
      if (!a) continue;
      revenueC += a.revenueC;
      peopleC += a.peopleC;
      directC += a.directC;
    }
    clientBase.set(c.id, { revenueC, peopleC, directC });
  }

  type EffectiveBasis = "revenue" | "direct_cost" | "fixed" | "equal";
  const clientWeights = (basis: EffectiveBasis): number[] =>
    activeClients.map((c) => {
      const base = clientBase.get(c.id)!;
      let w: number;
      if (basis === "revenue") w = base.revenueC;
      else if (basis === "direct_cost") w = base.peopleC + base.directC;
      else if (basis === "fixed") w = input.fixedShares.find((s) => s.clientId === c.id)?.pct ?? 0;
      else w = 1;
      return w < 0 ? 0 : w;
    });

  const chain: EffectiveBasis[] =
    input.overheadBasis === "fixed"
      ? ["fixed", "revenue", "direct_cost", "equal"]
      : input.overheadBasis === "revenue"
        ? ["revenue", "direct_cost", "equal"]
        : ["direct_cost", "equal"];
  let effectiveBasis: EffectiveBasis = "equal";
  let weights: number[] = clientWeights("equal");
  for (const b of chain) {
    const w = clientWeights(b);
    if (w.some((x) => x > 0)) {
      effectiveBasis = b;
      weights = w;
      break;
    }
  }

  if (poolC !== 0) {
    const shares = largestRemainder(poolC, weights);
    for (let i = 0; i < activeClients.length; i++) {
      const share = shares[i];
      if (share === 0) continue;
      const client = activeClients[i];
      const projects = projectsByClient.get(client.id) ?? [];
      if (projects.length === 0) {
        throw new Error(`computePeriod: client ${client.id} has an overhead share but no projects`);
      }
      const projWeights = projects.map((p) => {
        const a = accs.get(p.id);
        let w = 0;
        if (effectiveBasis === "revenue") w = a?.revenueC ?? 0;
        else if (effectiveBasis === "direct_cost") w = (a?.peopleC ?? 0) + (a?.directC ?? 0);
        // "fixed" and "equal" have no project-level analogue → default project.
        return w < 0 ? 0 : w;
      });
      if (projWeights.some((w) => w > 0)) {
        const projShares = largestRemainder(share, projWeights);
        for (let j = 0; j < projects.length; j++) {
          if (projShares[j] !== 0) acc(projects[j].id).overheadC += projShares[j];
        }
      } else {
        const target = defaultByClient.get(client.id) ?? projects[0];
        acc(target.id).overheadC += share;
      }
    }
  }

  // ----- Outputs ---------------------------------------------------------------
  const budgetsByProject = new Map<string, { revenueC: number; costC: number }>();
  for (const b of input.budgets) {
    const e = budgetsByProject.get(b.projectId);
    if (e) {
      e.revenueC += b.revenueC;
      e.costC += b.costC;
    } else {
      budgetsByProject.set(b.projectId, { revenueC: b.revenueC, costC: b.costC });
    }
  }

  const clients: ClientResult[] = activeClients.map((client) => {
    const projects = projectsByClient.get(client.id) ?? [];
    const projectResults: ProjectResult[] = [];

    let revenueC = 0;
    let peopleC = 0;
    let directC = 0;
    let overheadC = 0;
    const revenueByGroup = new Map<string, number>();
    const directByGroup = new Map<string, number>();
    const directBySupplier = new Map<string, number>();
    const peopleByStaff = new Map<string, StaffPiece>();
    let hasBudget = false;
    let budgetRevenueC = 0;
    let budgetCostC = 0;

    for (const p of projects) {
      const a = accs.get(p.id) ?? emptyAcc();
      revenueC += a.revenueC;
      peopleC += a.peopleC;
      directC += a.directC;
      overheadC += a.overheadC;
      for (const [g, amt] of a.revenueByGroup) addToMap(revenueByGroup, g, amt);
      for (const [g, amt] of a.directByGroup) addToMap(directByGroup, g, amt);
      for (const [s, amt] of a.directBySupplier) addToMap(directBySupplier, s, amt);
      for (const [key, piece] of a.peopleByStaff) {
        const existing = peopleByStaff.get(key);
        if (existing) {
          existing.amountC += piece.amountC;
          existing.estimated = existing.estimated || piece.estimated;
        } else {
          peopleByStaff.set(key, { ...piece });
        }
      }

      const budget = budgetsByProject.get(p.id) ?? null;
      if (budget) {
        hasBudget = true;
        budgetRevenueC += budget.revenueC;
        budgetCostC += budget.costC;
      }

      const nonzero =
        a.revenueC !== 0 || a.peopleC !== 0 || a.directC !== 0 || a.overheadC !== 0 ||
        a.revenueByGroup.size > 0 || a.directByGroup.size > 0 || a.peopleByStaff.size > 0;
      if (!p.isDefault && !nonzero && !budget) continue;

      const contributionC = a.revenueC - a.peopleC - a.directC;
      projectResults.push({
        projectId: p.id,
        name: p.name,
        isDefault: p.isDefault,
        revenueC: a.revenueC,
        revenueByGroup: sortedGroups(a.revenueByGroup),
        peopleC: a.peopleC,
        peopleByStaff: sortedStaff(a.peopleByStaff),
        directC: a.directC,
        directByGroup: sortedGroups(a.directByGroup),
        directBySupplier: sortedSuppliers(a.directBySupplier),
        contributionC,
        overheadC: a.overheadC,
        carryC: 0,
        netC: contributionC - a.overheadC,
        budgetRevenueC: budget ? budget.revenueC : null,
        budgetCostC: budget ? budget.costC : null,
      });
    }

    const contributionC = revenueC - peopleC - directC;
    const netC = contributionC - overheadC;
    return {
      clientId: client.id,
      name: client.name,
      shortName: client.shortName,
      isGeneral: client.isGeneral,
      revenueC,
      revenueByGroup: sortedGroups(revenueByGroup),
      peopleC,
      peopleByStaff: sortedStaff(peopleByStaff),
      directC,
      directByGroup: sortedGroups(directByGroup),
      directBySupplier: sortedSuppliers(directBySupplier),
      contributionC,
      contributionPct: revenueC !== 0 ? (contributionC / revenueC) * 100 : null,
      overheadC,
      carryC: 0,
      netC,
      netPct: revenueC !== 0 ? (netC / revenueC) * 100 : null,
      budgetRevenueC: hasBudget ? budgetRevenueC : null,
      budgetCostC: hasBudget ? budgetCostC : null,
      projects: projectResults,
    };
  });

  // ----- Carry: a General Sales loss is carried by the key accounts -----------
  // When General Sales nets negative after overhead, that loss spreads across
  // the other clients by revenue share (fallback: direct cost, then equal) in
  // its own Carry column; General Sales takes the offsetting credit and lands
  // on exactly zero. Carry nets to zero in total, so reconciliation is untouched.
  let carriedLossC = 0;
  const generalResult = clients.find((c) => c.isGeneral);
  const carriers = clients.filter((c) => !c.isGeneral);
  if (generalResult && generalResult.netC < 0 && carriers.length > 0) {
    carriedLossC = -generalResult.netC;
    let w = carriers.map((c) => Math.max(0, c.revenueC));
    if (!w.some((x) => x > 0)) w = carriers.map((c) => Math.max(0, c.peopleC + c.directC));
    if (!w.some((x) => x > 0)) w = carriers.map(() => 1);
    const shares = largestRemainder(carriedLossC, w);
    carriers.forEach((c, i) => {
      const share = shares[i];
      if (share === 0) return;
      c.carryC = share;
      c.netC -= share;
      c.netPct = c.revenueC !== 0 ? (c.netC / c.revenueC) * 100 : null;
      const pw = c.projects.map((p) => Math.max(0, p.revenueC));
      if (pw.some((x) => x > 0)) {
        const ps = largestRemainder(share, pw);
        c.projects.forEach((p, j) => {
          p.carryC += ps[j];
          p.netC -= ps[j];
        });
      } else {
        const def = c.projects.find((p) => p.isDefault) ?? c.projects[0];
        if (def) {
          def.carryC += share;
          def.netC -= share;
        }
      }
    });
    // Every General Sales project zeroes out; the credits sum to the loss.
    for (const p of generalResult.projects) {
      p.carryC = p.netC;
      p.netC = 0;
    }
    generalResult.carryC = -carriedLossC;
    generalResult.netC = 0;
    generalResult.netPct = generalResult.revenueC !== 0 ? 0 : null;
  }

  const totals = { revenueC: 0, peopleC: 0, directC: 0, contributionC: 0, overheadC: 0, carryC: 0, netC: 0 };
  for (const c of clients) {
    totals.revenueC += c.revenueC;
    totals.peopleC += c.peopleC;
    totals.directC += c.directC;
    totals.contributionC += c.contributionC;
    totals.overheadC += c.overheadC;
    totals.carryC += c.carryC;
    totals.netC += c.netC;
  }

  const costInC = costInLinesC - splitExcludedC + estimatesC;
  const costAllocatedC = totals.peopleC + totals.directC + totals.overheadC;
  const revenueAllocatedC = totals.revenueC;

  return {
    period: input.period,
    overheadBasis: input.overheadBasis,
    clients,
    poolC,
    excludedC: excludedCatC + splitExcludedC,
    excludedRevenueC,
    totals,
    carriedLossC,
    reconciliation: {
      costInC,
      costAllocatedC,
      revenueInC,
      revenueAllocatedC,
      ok: costInC === costAllocatedC && revenueInC === revenueAllocatedC,
    },
    exceptions,
  };
}
