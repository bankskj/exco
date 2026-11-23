/**
 * Client Billing & Cost Allocation — shared type contract.
 *
 * The allocation engine (src/lib/allocation.ts) is a pure function over these
 * types; src/data/billing.ts loads PeriodInput from D1 and persists results.
 * All money is INTEGER CENTS (suffix C). Periods are 'YYYY-MM'.
 */

export type Treatment = "revenue" | "people" | "direct" | "overhead" | "excluded";
export type OverheadBasis = "revenue" | "direct_cost" | "fixed";
/** Where a split piece lands: a project, the pool, excluded, or a STAFF
 * MEMBER (the piece joins that person's people cost and follows their share %). */
export type TargetKind = "project" | "overhead" | "excluded" | "staff";

export type BillingClient = {
  id: string;
  name: string;
  shortName: string | null;
  isGeneral: boolean;
  sortOrder: number;
  active: boolean;
};

export type BillingProject = {
  id: string;
  clientId: string;
  name: string;
  code: string | null;
  isDefault: boolean;
  billingType: "fixed" | "retainer" | "time" | "recurring";
  contractValueC: number | null;
  startPeriod: string | null;
  endPeriod: string | null;
  status: "open" | "closed";
};

export type GlCategory = {
  code: string;
  name: string;
  kind: "revenue" | "cost";
  reportGroup: string;
  treatment: Treatment;
  sortOrder: number;
};

export type RevenueLine = {
  id: string;
  period: string;
  txnDate: string;
  source: "xero" | "csv" | "manual";
  docNumber: string | null;
  docType: string | null;
  contactName: string | null;
  clientId: string | null; // resolved via client_contacts; null = unmapped
  projectId: string | null; // manual override; null = client's default project
  glCode: string | null;
  description: string | null;
  amountC: number; // credit notes negative
};

export type CostLine = {
  id: string;
  period: string;
  txnDate: string;
  source: "xero" | "csv" | "manual";
  docKind: string | null; // bill|spend
  supplier: string | null;
  reference: string | null;
  description: string | null;
  glCode: string | null;
  employeeId: string | null; // set when payee matched staff_payees
  amountC: number;
};

export type StaffMember = {
  employeeId: string;
  name: string;
  defaultTarget: "general" | "overhead";
  loadingPct: number;
  /** Exco payroll gross for THIS period, in cents, when captured; else null. */
  payrollGrossC: number | null;
  /** Exco payroll PAYE for THIS period, in cents (drives 'paye'-mode rules). */
  payrollPayeC: number | null;
};

/** One allocation row. Engine receives ALL rows with period <= input period
 * and resolves carry-forward itself (latest period <= current, per employee). */
export type StaffAllocation = {
  employeeId: string;
  period: string;
  targetKind: "project" | "overhead";
  projectId: string | null;
  pct: number;
};

export type CostSplit = {
  costLineId: string;
  targetKind: TargetKind; // project|overhead|excluded|staff
  projectId: string | null;
  employeeId: string | null; // set when targetKind = staff
  pct: number;
};

export type CostRuleSplit = {
  targetKind: "project" | "overhead" | "staff";
  projectId: string | null;
  employeeId: string | null; // set when targetKind = staff
  pct: number | null; // percent mode
  fixedC: number | null; // fixed mode
  isRemainder: boolean;
};

export type CostRule = {
  id: string;
  name: string;
  priority: number;
  supplierMatch: string | null; // case-insensitive contains; all given must match
  descriptionMatch: string | null;
  glCode: string | null; // exact match
  /** percent/fixed use the splits; 'paye' splits across staff by each person's
   * payroll PAYE for the month (fallback: payroll gross; else the pool). */
  mode: "percent" | "fixed" | "paye";
  effectiveFrom: string | null; // YYYY-MM-DD compared to line txn_date
  effectiveTo: string | null;
  active: boolean;
  splits: CostRuleSplit[];
};

export type ProjectBudget = { projectId: string; period: string; revenueC: number; costC: number };

export type OverheadFixedShare = { clientId: string; pct: number };

export type PeriodInput = {
  period: string;
  overheadBasis: OverheadBasis;
  fixedShares: OverheadFixedShare[]; // used when basis = fixed
  clients: BillingClient[];
  projects: BillingProject[];
  categories: GlCategory[];
  revenueLines: RevenueLine[]; // this period only
  costLines: CostLine[]; // this period only
  staff: StaffMember[];
  allocations: StaffAllocation[]; // all rows with period <= this period
  costSplits: CostSplit[]; // for this period's cost lines
  rules: CostRule[]; // active rules, splits included
  budgets: ProjectBudget[]; // this period only
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type StaffPiece = { employeeId: string; name: string; amountC: number; estimated: boolean };
export type GroupAmount = { group: string; amountC: number };
export type SupplierAmount = { supplier: string; amountC: number };

export type ProjectResult = {
  projectId: string;
  name: string;
  isDefault: boolean;
  revenueC: number;
  revenueByGroup: GroupAmount[];
  peopleC: number;
  peopleByStaff: StaffPiece[];
  directC: number;
  directByGroup: GroupAmount[];
  directBySupplier: SupplierAmount[];
  contributionC: number;
  overheadC: number;
  /** Share of a General Sales loss carried by this project (negative on General Sales itself — the offsetting credit). */
  carryC: number;
  netC: number;
  budgetRevenueC: number | null;
  budgetCostC: number | null;
};

export type ClientResult = {
  clientId: string;
  name: string;
  shortName: string | null;
  isGeneral: boolean;
  revenueC: number;
  revenueByGroup: GroupAmount[];
  peopleC: number;
  peopleByStaff: StaffPiece[];
  directC: number;
  directByGroup: GroupAmount[];
  directBySupplier: SupplierAmount[];
  contributionC: number;
  contributionPct: number | null; // null when revenue is 0
  overheadC: number;
  /** Share of a General Sales loss carried by this client (negative on General Sales — the offsetting credit). Nets to zero across clients. */
  carryC: number;
  netC: number;
  netPct: number | null;
  budgetRevenueC: number | null;
  budgetCostC: number | null;
  projects: ProjectResult[];
};

export type PeriodExceptions = {
  /** Revenue contacts with no client mapping (landed in General Sales). */
  unmappedContacts: { contactName: string; amountC: number; lineCount: number }[];
  /** Direct-treatment lines with no split or rule (landed in General Sales). */
  unassignedDirect: { costLineId: string; supplier: string | null; description: string | null; amountC: number }[];
  /** People-treatment lines whose payee matched no staff member. */
  unmatchedStaff: { costLineId: string; supplier: string | null; description: string | null; amountC: number }[];
  /** Staff costed from Exco payroll because no Xero payment matched. */
  estimatedStaff: { employeeId: string; name: string; amountC: number }[];
  /** Staff whose allocation rows total more than 100% (data error). */
  overAllocated: { employeeId: string; name: string; totalPct: number }[];
};

export type PeriodResult = {
  period: string;
  overheadBasis: OverheadBasis;
  clients: ClientResult[]; // all 12, report order
  poolC: number; // Shared Overhead pool
  excludedC: number; // excluded cost total (reported, never allocated)
  excludedRevenueC: number; // excluded revenue total
  totals: {
    revenueC: number;
    peopleC: number;
    directC: number;
    contributionC: number;
    overheadC: number;
    carryC: number; // always 0 — carry is a redistribution
    netC: number;
  };
  /** Magnitude of the General Sales loss redistributed this period (0 when General Sales breaks even or profits). */
  carriedLossC: number;
  reconciliation: {
    /** Σ non-excluded cost lines + Σ payroll estimates. */
    costInC: number;
    /** Σ clients (people + direct + overhead). */
    costAllocatedC: number;
    revenueInC: number;
    revenueAllocatedC: number;
    ok: boolean; // both equalities hold to the cent
  };
  exceptions: PeriodExceptions;
};
