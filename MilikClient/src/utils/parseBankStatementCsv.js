import * as XLSX from "xlsx";

// Tolerant header matching — real bank CSV exports vary a lot in column naming. Supports either a
// separate Debit/Credit pair (the common shape for Kenyan bank exports) or a single signed Amount
// column (positive = money in = debit to the asset account, negative = money out = credit).
const HEADER_ALIASES = {
  date:        ["date", "transaction date", "value date", "posting date", "txn date"],
  description: ["description", "narration", "details", "particulars", "transaction details", "remarks"],
  reference:   ["reference", "ref", "ref no", "ref no.", "cheque no", "transaction id", "reference no"],
  debit:       ["debit", "debit (kes)", "withdrawal", "withdrawal (dr)", "money out", "out"],
  credit:      ["credit", "credit (kes)", "deposit", "deposit (cr)", "money in", "in"],
  amount:      ["amount", "amount (kes)", "value"],
};

const normHeader = (h) => String(h || "").trim().toLowerCase().replace(/\s+/g, " ");

const findKey = (row, aliases) => {
  const keys = Object.keys(row);
  return keys.find((k) => aliases.includes(normHeader(k))) || null;
};

const parseAmount = (v) => {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const parseStatementDate = (v) => {
  if (!v) return null;
  const direct = new Date(v);
  if (!Number.isNaN(direct.getTime())) return direct;
  // DD/MM/YYYY (or D/M/YY) — the common non-ISO bank export format the Date constructor can't read
  const m = String(v).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [, dd, mm, yyRaw] = m;
    const yy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
    const fallback = new Date(`${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
    if (!Number.isNaN(fallback.getTime())) return fallback;
  }
  return null;
};

// Returns { valid, errors, total, validCount, errorCount } — the exact shape ImportModal expects.
export const parseBankStatementCsv = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error || new Error("Could not read file"));
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: "" });

      const valid = [];
      const errors = [];

      rows.forEach((row, i) => {
        const rowNo = i + 2; // header is row 1
        const dateKey  = findKey(row, HEADER_ALIASES.date);
        const descKey  = findKey(row, HEADER_ALIASES.description);
        const refKey   = findKey(row, HEADER_ALIASES.reference);
        const debitKey = findKey(row, HEADER_ALIASES.debit);
        const creditKey = findKey(row, HEADER_ALIASES.credit);
        const amountKey = findKey(row, HEADER_ALIASES.amount);

        const date = dateKey ? parseStatementDate(row[dateKey]) : null;
        if (!date) { errors.push({ row: rowNo, errors: ["Missing or unreadable date"] }); return; }

        let amount = 0, direction = null;
        if (debitKey || creditKey) {
          const debit  = debitKey  ? parseAmount(row[debitKey])  : 0;
          const credit = creditKey ? parseAmount(row[creditKey]) : 0;
          if (debit > 0 && credit > 0) { errors.push({ row: rowNo, errors: ["Both Debit and Credit have a value"] }); return; }
          if (debit > 0)       { amount = debit;  direction = "debit"; }
          else if (credit > 0) { amount = credit; direction = "credit"; }
        } else if (amountKey) {
          const raw = parseAmount(row[amountKey]);
          amount = Math.abs(raw);
          direction = raw < 0 ? "credit" : "debit"; // money out (negative) = credit to the asset account
        }
        if (!amount || !direction) { errors.push({ row: rowNo, errors: ["Missing or invalid amount"] }); return; }

        valid.push({
          date: date.toISOString(),
          description: descKey ? String(row[descKey] || "").trim() : "",
          reference:   refKey  ? String(row[refKey]  || "").trim() : "",
          amount, direction,
        });
      });

      resolve({ valid, errors, total: rows.length, validCount: valid.length, errorCount: errors.length });
    } catch (err) {
      reject(err);
    }
  };
  reader.readAsArrayBuffer(file);
});

export default parseBankStatementCsv;
