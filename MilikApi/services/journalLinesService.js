// Multi-line ("normal accounting") journals: any number of debit / credit lines that must balance, each line optionally
// tagged with a module, sale project, deal, listing, agent, property and cost centre. Old two-line journals
// (debitAccount / creditAccount / amount) are untouched and keep their own path in the journal controller.
import mongoose from "mongoose";
import { createError } from "../utils/error.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import Property from "../models/Property.js";
import SaleProject from "../modules/propertySale/models/SaleProject.js";
import SaleDeal from "../modules/propertySale/models/SaleDeal.js";
import SaleListing from "../modules/propertySale/models/SaleListing.js";
import SaleAgent from "../modules/propertySale/models/SaleAgent.js";
import { postEntry, postReversal } from "./ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "./chartAccountAggregationService.js";

export const LINE_JOURNAL_TYPES = [
  "general_manual_journal", "company_journal", "adjustment", "accrual", "reclassification", "opening_balance", "allocation",
];
export const JOURNAL_MODULES = ["general", "propertyManagement", "propertySale", "carwash", "hr", "inventory", "clients", "accounts"];

const MIN_LINES = 2;
const MAX_LINES = 100;
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v ?? ""));
const cents = (n) => Math.round(Number(n) * 100);
const fromCents = (c) => c / 100;
const blank = (v) => v === undefined || v === null || v === "";

// Tag kinds -> the model that must own the id (all scoped to the company)
const TAG_MODELS = { project: SaleProject, deal: SaleDeal, listing: SaleListing, agent: SaleAgent, property: Property };
const TAG_LABELS = { project: "Project", deal: "Deal", listing: "Listing / unit", agent: "Agent", property: "Property" };

/**
 * Checks and normalises the lines of a journal. Returns { lines, totalDebit, totalCredit } or throws a 400.
 * Rules: 2–100 lines; every account is an active posting account of this company; each line has a debit OR a credit
 * (not both, not neither); debits equal credits to the cent; tags belong to this company.
 */
export const validateJournalLines = async ({ businessId, lines }) => {
  if (!Array.isArray(lines) || lines.length < MIN_LINES) throw createError(400, "A journal needs at least two lines.");
  if (lines.length > MAX_LINES) throw createError(400, `A journal can have at most ${MAX_LINES} lines.`);

  const accountIds = [...new Set(lines.map((l) => String(l?.account?._id ?? l?.account ?? "")).filter(Boolean))];
  if (accountIds.some((id) => !isId(id))) throw createError(400, "A line has an invalid account.");
  const accounts = await ChartOfAccount.find({ _id: { $in: accountIds }, business: businessId })
    .select("_id code name isPosting isHeader active isActive")
    .lean();
  const accountById = new Map(accounts.map((a) => [String(a._id), a]));

  const tagIds = { project: new Set(), deal: new Set(), listing: new Set(), agent: new Set(), property: new Set() };
  const out = [];
  let debitCents = 0;
  let creditCents = 0;

  lines.forEach((raw, i) => {
    const n = i + 1;
    const accountId = String(raw?.account?._id ?? raw?.account ?? "");
    const account = accountById.get(accountId);
    if (!accountId) throw createError(400, `Line ${n}: choose an account.`);
    if (!account) throw createError(400, `Line ${n}: account not found in this company's chart of accounts.`);
    if (account.isPosting === false || account.isHeader === true) {
      throw createError(400, `Line ${n}: ${account.code} ${account.name} is a header account and cannot be posted to.`);
    }
    if (account.active === false || account.isActive === false) {
      throw createError(400, `Line ${n}: ${account.code} ${account.name} is inactive.`);
    }

    const debit = blank(raw.debit) ? 0 : Number(raw.debit);
    const credit = blank(raw.credit) ? 0 : Number(raw.credit);
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
      throw createError(400, `Line ${n}: amounts must be numbers of 0 or more.`);
    }
    if (debit > 0 && credit > 0) throw createError(400, `Line ${n}: enter a debit or a credit, not both.`);
    if (cents(debit) === 0 && cents(credit) === 0) throw createError(400, `Line ${n}: enter an amount.`);

    const source = raw.dimensions && typeof raw.dimensions === "object" ? raw.dimensions : {};
    const dimensions = {};
    if (!blank(source.module)) {
      if (!JOURNAL_MODULES.includes(source.module)) throw createError(400, `Line ${n}: unknown module "${source.module}".`);
      dimensions.module = source.module;
    }
    for (const kind of Object.keys(TAG_MODELS)) {
      const value = source[kind]?._id ?? source[kind];
      if (blank(value)) continue;
      if (!isId(value)) throw createError(400, `Line ${n}: invalid ${TAG_LABELS[kind].toLowerCase()}.`);
      dimensions[kind] = String(value);
      tagIds[kind].add(String(value));
    }
    const costCentre = String(source.costCentre ?? "").trim().slice(0, 40);
    if (costCentre) dimensions.costCentre = costCentre;

    debitCents += cents(debit);
    creditCents += cents(credit);
    out.push({
      account: accountId,
      debit: fromCents(cents(debit)),
      credit: fromCents(cents(credit)),
      description: String(raw.description ?? "").trim().slice(0, 200),
      dimensions,
    });
  });

  if (debitCents !== creditCents) {
    const diff = Math.abs(debitCents - creditCents) / 100;
    throw createError(400, `The journal does not balance: debits ${fromCents(debitCents).toFixed(2)} and credits ${fromCents(creditCents).toFixed(2)} differ by ${diff.toFixed(2)}.`);
  }
  if (debitCents === 0) throw createError(400, "The journal total must be more than zero.");

  // every tagged record must belong to this company (one query per kind)
  await Promise.all(
    Object.entries(tagIds).map(async ([kind, ids]) => {
      if (!ids.size) return;
      const found = await TAG_MODELS[kind].find({ _id: { $in: [...ids] }, business: businessId }).select("_id").lean();
      if (found.length !== ids.size) throw createError(400, `${TAG_LABELS[kind]} not found in this company.`);
    })
  );

  return { lines: out, totalDebit: fromCents(debitCents), totalCredit: fromCents(creditCents) };
};

const monthBounds = (date) => ({
  start: new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0),
  end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999),
});

/**
 * Posts every line of a multi-line journal to the ledger as one balanced group. If any line is refused (a locked period,
 * an account that went inactive) the lines already posted are reversed, so a journal is never half in the ledger.
 */
export const postLinesJournalToLedger = async ({ journal, actorUserId }) => {
  const already = await FinancialLedgerEntry.find({
    business: journal.business,
    sourceTransactionType: "manual_adjustment",
    sourceTransactionId: String(journal._id),
    $or: [{ reversalOf: { $exists: false } }, { reversalOf: null }],
    status: "approved",
  }).select("_id").lean();
  if (already.length) return already;

  const date = new Date(journal.date || Date.now());
  const { start, end } = monthBounds(date);
  const journalGroupId = new mongoose.Types.ObjectId();
  const narration = String(journal.narration || journal.reference || `Journal ${journal.journalNo}`).trim();
  const posted = [];

  try {
    for (const [index, line] of journal.lines.entries()) {
      const isDebit = Number(line.debit) > 0;
      const tags = line.dimensions || {};
      const dimensions = {};
      const module = tags.module || (journal.sourceModule && journal.sourceModule !== "accounts" ? journal.sourceModule : null);
      if (module) dimensions.module = module;
      if (tags.project) dimensions.saleProject = tags.project;
      if (tags.deal) dimensions.saleDeal = tags.deal;
      if (tags.listing) dimensions.saleListing = tags.listing;
      if (tags.agent) dimensions.saleAgent = tags.agent;
      if (tags.costCentre) dimensions.costCentre = tags.costCentre;

      posted.push(
        await postEntry({
          business: journal.business,
          property: tags.property || null,
          sourceTransactionType: "manual_adjustment",
          sourceTransactionId: String(journal._id),
          transactionDate: date,
          statementPeriodStart: start,
          statementPeriodEnd: end,
          category: "ADJUSTMENT",
          accountId: line.account,
          direction: isDebit ? "debit" : "credit",
          amount: isDebit ? line.debit : line.credit,
          payer: "manager",
          receiver: "system",
          notes: line.description || narration,
          journalGroupId,
          createdBy: actorUserId,
          approvedBy: actorUserId,
          approvedAt: new Date(),
          status: "approved",
          dimensions,
          metadata: {
            journalEntryId: String(journal._id),
            journalNo: journal.journalNo,
            journalType: journal.journalType,
            lineNo: index + 1,
            reference: journal.reference || "",
            includeInLandlordStatement: false,
          },
        })
      );
    }
  } catch (error) {
    for (const entry of posted) {
      await postReversal({ entryId: entry._id, reason: `Auto-reversal: journal ${journal.journalNo} could not be posted`, userId: actorUserId }).catch(() => null);
    }
    throw createError(422, error?.message || "The journal could not be posted.");
  }

  journal.status = "posted";
  journal.postedAt = new Date();
  journal.postedBy = actorUserId;
  journal.journalGroupId = journalGroupId;
  journal.ledgerEntries = posted.map((e) => e._id);
  await journal.save();

  await aggregateChartOfAccountBalances(journal.business, [...new Set(journal.lines.map((l) => String(l.account)))]);
  return posted;
};
