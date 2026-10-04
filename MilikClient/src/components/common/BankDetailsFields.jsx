import React, { useMemo, useState } from "react";
import { FaPlus } from "react-icons/fa";
import AppSelect from "./AppSelect";
import { KENYAN_BANKS, bankInputClass, bankLabelClass } from "../../utils/bankDetails";

/**
 * The shared bank block used by landlords, service providers and payment vouchers.
 *
 * values      — { bankName, branchName, accountName, accountNumber, mobileNumber }
 * onChange    — (field, value) => void
 * knownBanks  — bank names already on other records, offered in the list
 * errors      — optional { field: message }
 * required    — shows the required marker (not used for blocking)
 */
const BankDetailsFields = ({ values = {}, onChange, knownBanks = [], errors = {}, title = "Bank & Payment Details", hideBranch = false }) => {
  const [customBanks, setCustomBanks] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newBank, setNewBank] = useState("");

  const bankOptions = useMemo(() => {
    const names = [...KENYAN_BANKS, ...customBanks, ...knownBanks, values.bankName]
      .map((name) => String(name || "").trim())
      .filter(Boolean);
    const seen = new Map();
    names.forEach((name) => {
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    });
    return Array.from(seen.values())
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name }));
  }, [customBanks, knownBanks, values.bankName]);

  const addBank = () => {
    const name = newBank.trim();
    if (!name) return;
    if (!customBanks.some((b) => b.toLowerCase() === name.toLowerCase())) {
      setCustomBanks((prev) => [...prev, name]);
    }
    onChange("bankName", name);
    setNewBank("");
    setAdding(false);
  };

  const field = (name, label, placeholder, extra = {}) => (
    <div>
      <label className={bankLabelClass} htmlFor={`bank-${name}`}>{label}</label>
      <input
        id={`bank-${name}`}
        type={extra.type || "text"}
        inputMode={extra.inputMode}
        value={values[name] || ""}
        onChange={(e) => onChange(name, e.target.value)}
        onBlur={extra.onBlur}
        placeholder={placeholder}
        className={bankInputClass(Boolean(errors[name]))}
        aria-invalid={Boolean(errors[name])}
      />
      {errors[name] && <p className="mt-0.5 text-[11px] font-semibold text-red-600">{errors[name]}</p>}
    </div>
  );

  return (
    <section className="border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
      </div>
      <div className={`grid grid-cols-2 gap-x-3 gap-y-2 p-2.5 ${hideBranch ? "md:grid-cols-4" : "md:grid-cols-5"}`}>
        <div>
          <label className={bankLabelClass}>Bank Name</label>
          <AppSelect
            value={values.bankName || ""}
            onChange={(v) => onChange("bankName", v || "")}
            options={bankOptions}
            placeholder="Select bank"
            searchable
            clearable
            size="sm"
          />
          {adding ? (
            <div className="mt-1 flex gap-1">
              <input
                type="text"
                value={newBank}
                onChange={(e) => setNewBank(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addBank(); }
                  if (e.key === "Escape") { setAdding(false); setNewBank(""); }
                }}
                placeholder="Bank name"
                autoFocus
                className={bankInputClass()}
              />
              <button type="button" onClick={addBank} className="h-7 shrink-0 bg-[#0B3B2E] px-2.5 text-xs font-bold text-white hover:bg-[#0A3127]">Add</button>
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
              <FaPlus size={8} /> Add bank
            </button>
          )}
        </div>
        {!hideBranch && field("branchName", "Branch", "e.g. Westlands")}
        {field("accountName", "Account Name", "As it appears on the account")}
        {field("accountNumber", "Account Number", "e.g. 0123456789")}
        {field("mobileNumber", "M-Pesa Number", "0712 345 678", { type: "tel", inputMode: "tel" })}
      </div>
    </section>
  );
};

export default BankDetailsFields;
