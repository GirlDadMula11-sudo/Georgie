import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const ROOT = () => path.resolve(process.env.GEORGIE_DATA_DIR || "data", "expenses");
const FILE = () => path.join(ROOT(), "business-expenses.json");

const DEFAULT = {
  updatedAt: null,
  monthlyBudget: null,
  vendors: [],
  transactions: [],
  alerts: []
};

async function readState() {
  try {
    const raw = await fs.readFile(FILE(), "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT, ...parsed, vendors: parsed.vendors || [], transactions: parsed.transactions || [], alerts: parsed.alerts || [] };
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Expense state read failed:", error instanceof Error ? error.message : error);
    return structuredClone(DEFAULT);
  }
}

async function writeState(state) {
  await fs.mkdir(ROOT(), { recursive: true, mode: 0o700 });
  const target = FILE();
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const next = { ...state, updatedAt: new Date().toISOString() };
  await fs.writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
  await fs.rename(temp, target);
  return next;
}

function money(n) { const x = Number(n); return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0; }

export async function upsertVendor(input = {}) {
  const state = await readState();
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Vendor name is required");
  const key = String(input.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-|-$/g, "").slice(0, 120);
  const existing = state.vendors.find(v => v.id === key);
  const vendor = {
    id: key,
    name,
    category: String(input.category || existing?.category || "software"),
    cadence: String(input.cadence || existing?.cadence || "monthly"),
    expectedAmount: money(input.expectedAmount ?? existing?.expectedAmount),
    required: input.required ?? existing?.required ?? true,
    status: String(input.status || existing?.status || "active"),
    source: String(input.source || existing?.source || "manual"),
    notes: String(input.notes || existing?.notes || ""),
    lastVerifiedAt: input.lastVerifiedAt || existing?.lastVerifiedAt || null
  };
  if (existing) Object.assign(existing, vendor); else state.vendors.push(vendor);
  await writeState(state);
  return vendor;
}

export async function addExpenseTransaction(input = {}) {
  const state = await readState();
  const vendor = String(input.vendor || "").trim();
  const amount = money(input.amount);
  if (!vendor || !amount) throw new Error("Vendor and non-zero amount are required");
  const tx = {
    id: String(input.id || crypto.randomUUID()),
    vendor,
    amount,
    occurredAt: input.occurredAt || new Date().toISOString(),
    category: String(input.category || "software"),
    source: String(input.source || "manual"),
    reference: String(input.reference || ""),
    recurring: Boolean(input.recurring),
    notes: String(input.notes || "")
  };
  state.transactions.push(tx);
  state.transactions = state.transactions.slice(-5000);
  await writeState(state);
  return tx;
}

export async function setExpenseBudget(monthlyBudget) {
  const state = await readState();
  state.monthlyBudget = money(monthlyBudget);
  await writeState(state);
  return { monthlyBudget: state.monthlyBudget };
}

function monthKey(d) { return new Date(d).toISOString().slice(0, 7); }

export async function getExpenseSnapshot() {
  const state = await readState();
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const monthTransactions = state.transactions.filter(t => monthKey(t.occurredAt) === currentMonth);
  const actualThisMonth = money(monthTransactions.reduce((s, t) => s + Number(t.amount || 0), 0));
  const recurringRunRate = money(state.vendors.filter(v => v.status === "active").reduce((s, v) => {
    const a = Number(v.expectedAmount || 0);
    if (v.cadence === "annual") return s + a / 12;
    if (v.cadence === "weekly") return s + a * 52 / 12;
    if (v.cadence === "daily") return s + a * 365 / 12;
    return s + a;
  }, 0));
  const budget = Number(state.monthlyBudget || 0);
  const projectedMonthEnd = Math.max(actualThisMonth, recurringRunRate);
  const variance = budget ? money(projectedMonthEnd - budget) : null;
  const alerts = [];
  if (budget && projectedMonthEnd > budget) alerts.push({ type: "budget_overrun", severity: "high", amountOver: money(projectedMonthEnd - budget) });
  for (const t of monthTransactions) {
    const vendor = state.vendors.find(v => v.name.toLowerCase() === t.vendor.toLowerCase());
    if (vendor?.expectedAmount && t.amount > vendor.expectedAmount * 1.2) alerts.push({ type: "vendor_variance", severity: "medium", vendor: t.vendor, expected: vendor.expectedAmount, actual: t.amount });
  }
  return { currentMonth, monthlyBudget: budget || null, actualThisMonth, recurringRunRate, projectedMonthEnd, variance, vendors: state.vendors, recentTransactions: state.transactions.slice(-50).reverse(), alerts, updatedAt: state.updatedAt };
}
