import React from "react";
import { FaTimes, FaBook, FaFileInvoiceDollar, FaReceipt } from "react-icons/fa";

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return amount === 0
    ? "-"
    : new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(amount);
};

const JournalEntriesDrawer = ({
  open,
  onClose,
  title = "Journal Entries",
  sourceType = "receipt",
  context = {},
  lines = [],
}) => {
  if (!open) return null;

  const sourceIcon = sourceType === "invoice" ? <FaFileInvoiceDollar /> : <FaReceipt />;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-50" onClick={onClose} />
      <aside className="fixed top-0 right-0 h-full w-full max-w-2xl bg-white shadow-2xl border-l border-slate-200 z-[60] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900">
            <FaBook className="text-[#0B3B2E]" />
            <h3 className="font-bold text-sm uppercase tracking-wide">{title}</h3>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <FaTimes />
          </button>
        </div>

        <div className="px-5 py-4 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 uppercase mb-2">
            {sourceIcon}
            {sourceType}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <p className="text-slate-500">Transaction #</p>
            <p className="font-semibold text-slate-900">{context.transactionNumber || "-"}</p>
            <p className="text-slate-500">Date</p>
            <p className="font-semibold text-slate-900">{context.date || "-"}</p>
            <p className="text-slate-500">Tenant</p>
            <p className="font-semibold text-slate-900">{context.tenant || "-"}</p>
            <p className="text-slate-500">Property</p>
            <p className="font-semibold text-slate-900">{context.property || "-"}</p>
            <p className="text-slate-500">Unit</p>
            <p className="font-semibold text-slate-900">{context.unit || "-"}</p>
            <p className="text-slate-500">Cashbook</p>
            <p className="font-semibold text-slate-900">{context.cashbook || "-"}</p>
          </div>
        </div>

        <div className="p-5 overflow-auto flex-1">
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-3 py-2 text-left">Account Code</th>
                  <th className="px-3 py-2 text-left">Account Name</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                  <th className="px-3 py-2 text-left">Narration</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-slate-500">
                      No journal lines available for this transaction.
                    </td>
                  </tr>
                ) : (
                  lines.map((line, idx) => (
                    <tr key={`${line.accountCode}-${idx}`} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-2 font-mono text-slate-800">{line.accountCode}</td>
                      <td className="px-3 py-2 font-semibold text-slate-900">{line.accountName}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900">{formatCurrency(line.debit)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900">{formatCurrency(line.credit)}</td>
                      <td className="px-3 py-2 text-slate-700">{line.narration || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    </>
  );
};

export default JournalEntriesDrawer;
