import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaArrowLeft, FaBalanceScale, FaCheckCircle, FaPlus, FaSave, FaTrash, FaUser,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const fmt = formatMoney;
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

let _key = 0;
const makeRow = () => ({
  _key: ++_key,
  plate: "",
  customerName: "",
  phone: "",
  amount: "",
  date: todayISO(),
  notes: "",
  found: null, // null | "found" | "new"
});

const ic = "h-8 w-full border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none";

export default function CarWashOpeningBalances() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([makeRow()]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const debounceRefs = useRef({});

  const loadSaved = useCallback(async () => {
    setLoadingSaved(true);
    try {
      const res = await carWashApi.listJobs({ jobType: "balance_bf", limit: 200 });
      setSaved(normalizeListPayload(res, "jobs"));
    } catch { /* silent */ }
    finally { setLoadingSaved(false); }
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const addRow = () => setRows((p) => [...p, makeRow()]);

  const removeRow = (key) =>
    setRows((p) => (p.length > 1 ? p.filter((r) => r._key !== key) : p));

  const updateRow = (key, field, value) =>
    setRows((p) => p.map((r) => (r._key === key ? { ...r, [field]: value } : r)));

  const handlePlateChange = (key, raw) => {
    const plate = raw.toUpperCase();
    updateRow(key, "plate", plate);
    clearTimeout(debounceRefs.current[key]);
    if (plate.length < 4) { updateRow(key, "found", null); return; }
    debounceRefs.current[key] = setTimeout(async () => {
      try {
        const result = await carWashApi.lookupPlate(plate);
        if (result?.customer) {
          setRows((p) => p.map((r) =>
            r._key === key
              ? { ...r, customerName: r.customerName || result.customer.name || "", phone: r.phone || result.customer.phone || "", found: "found" }
              : r
          ));
        } else {
          setRows((p) => p.map((r) => r._key === key ? { ...r, found: "new" } : r));
        }
      } catch { /* silent */ }
    }, 600);
  };

  const validRows = rows.filter((r) => r.plate.trim() && Number(r.amount) > 0);

  const handleSave = async () => {
    if (!validRows.length) { toast.error("Add at least one row with a plate and amount"); return; }
    setSaving(true);
    const results = await Promise.allSettled(
      validRows.map((r) =>
        carWashApi.createJob({
          jobType: "balance_bf",
          plateNumber: r.plate.trim(),
          customerName: r.customerName.trim(),
          phone: r.phone.trim(),
          serviceLines: [{ serviceName: "Opening Balance (B/F)", price: Number(r.amount) }],
          status: "done",
          notes: r.notes.trim() || "Pre-existing balance at system go-live",
        })
      )
    );
    setSaving(false);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.filter((r) => r.status === "rejected").length;
    if (ok) {
      toast.success(`${ok} opening balance${ok !== 1 ? "s" : ""} recorded`);
      setRows([makeRow()]);
      loadSaved();
    }
    if (fail) toast.error(`${fail} entr${fail !== 1 ? "ies" : "y"} failed — check amounts and plates`);
  };

  const totalValid = validRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalOutstanding = saved.filter((j) => j.paymentStatus !== "paid").reduce((s, j) => s + (j.price || 0), 0);

  return (
    <CarWashShell
      title="Opening Balances"
      action={
        <button
          type="button"
          onClick={() => navigate("/carwash/customers")}
          className="inline-flex h-7 items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
        >
          <FaArrowLeft size={9} /> Customers
        </button>
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">

        {/* Info banner */}
        <div className="flex items-start gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-xs">
          <FaBalanceScale className="mt-0.5 shrink-0 text-amber-600 text-sm" />
          <div>
            <p className="font-extrabold text-amber-900">One-time migration — Opening Balances (B/F)</p>
            <p className="mt-0.5 text-amber-700">
              Record amounts customers already owed before you started using this system.
              Each entry creates an unpaid balance that staff can collect via the Customers page settle flow.
            </p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_340px]">

          {/* ── Left: new entry rows ─────────────────────────────────────── */}
          <div className="flex flex-col border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-[#EDF5F1] px-4 py-2">
              <p className="text-xs font-extrabold uppercase tracking-wide text-[#0B3B2E]">New Entries</p>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
              >
                <FaPlus size={9} /> Add Row
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-xs">
                <thead>
                  <tr className="bg-[#0B3B2E]">
                    <th className="w-[130px] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Plate *</th>
                    <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Customer Name</th>
                    <th className="w-[120px] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Phone</th>
                    <th className="w-[110px] px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Amount (KES) *</th>
                    <th className="w-[130px] px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Date</th>
                    <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Notes</th>
                    <th className="w-8 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row._key}>
                      <td className="px-3 py-1.5">
                        <div className="relative">
                          <input
                            className={`${ic} font-mono uppercase ${row.found === "found" ? "border-emerald-400" : row.found === "new" ? "border-amber-400" : ""}`}
                            value={row.plate}
                            onChange={(e) => handlePlateChange(row._key, e.target.value)}
                            placeholder="KAA 123X"
                          />
                          {row.found === "found" && (
                            <FaCheckCircle className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-500" size={9} />
                          )}
                        </div>
                        {row.found === "found" && <p className="mt-0.5 text-[9px] font-semibold text-emerald-600">Customer found ✓</p>}
                        {row.found === "new"   && <p className="mt-0.5 text-[9px] font-semibold text-amber-600">New plate</p>}
                      </td>
                      <td className="px-3 py-1.5">
                        <input className={ic} value={row.customerName} onChange={(e) => updateRow(row._key, "customerName", e.target.value)} placeholder="Auto-filled from plate" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input className={ic} type="tel" value={row.phone} onChange={(e) => updateRow(row._key, "phone", e.target.value)} placeholder="0712…" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          className={`${ic} text-right font-bold text-slate-900 ${Number(row.amount) > 0 ? "border-emerald-300" : ""}`}
                          type="number"
                          min="1"
                          step="1"
                          value={row.amount}
                          onChange={(e) => updateRow(row._key, "amount", e.target.value)}
                          placeholder="0"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input className={ic} type="date" value={row.date} onChange={(e) => updateRow(row._key, "date", e.target.value)} />
                      </td>
                      <td className="px-3 py-1.5">
                        <input className={ic} value={row.notes} onChange={(e) => updateRow(row._key, "notes", e.target.value)} placeholder="e.g. Jan–Mar balance" />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(row._key)}
                          disabled={rows.length === 1}
                          className="p-1 text-red-400 hover:text-red-600 disabled:opacity-20"
                          title="Remove row"
                        >
                          <FaTrash size={10} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {validRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-[#EDF5F1]">
                      <td colSpan={3} className="px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-slate-600">
                        {validRows.length} entr{validRows.length !== 1 ? "ies" : "y"} ready
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-black text-[#0B3B2E]">{fmt(totalValid)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Footer / save */}
            <div className="flex-shrink-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] text-slate-500">
                {validRows.length === 0
                  ? "Enter a plate and amount to enable saving"
                  : `${validRows.length} of ${rows.length} row${rows.length !== 1 ? "s" : ""} ready · Total ${fmt(totalValid)}`}
              </p>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || validRows.length === 0}
                className="inline-flex items-center gap-2 bg-[#0B3B2E] px-5 py-2 text-xs font-extrabold uppercase tracking-wide text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaSave size={10} />
                {saving ? "Saving…" : `Save ${validRows.length || ""} Balance${validRows.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>

          {/* ── Right: already recorded ──────────────────────────────────── */}
          <div className="flex flex-col border border-slate-200 bg-white shadow-sm lg:max-h-[600px]">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-[#EDF5F1] px-4 py-2">
              <p className="text-xs font-extrabold uppercase tracking-wide text-[#0B3B2E]">Already Recorded</p>
              <span className="text-[10px] font-semibold text-slate-500">{saved.length} total</span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
              {loadingSaved ? (
                <p className="py-8 text-center text-xs text-slate-400">Loading…</p>
              ) : saved.length === 0 ? (
                <div className="py-10 text-center px-4">
                  <FaUser className="mx-auto mb-2 text-slate-200" size={22} />
                  <p className="text-xs font-semibold text-slate-400">No opening balances recorded yet</p>
                </div>
              ) : saved.map((job) => (
                <div key={job._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold font-mono text-slate-800">{job.plateNumber || "—"}</p>
                    <p className="text-[10px] text-slate-500 truncate">{job.customerName || "No name"}</p>
                    <p className="text-[9px] text-slate-400">{fmtDate(job.createdAt)}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={`text-xs font-black ${job.paymentStatus === "paid" ? "text-emerald-600" : "text-red-600"}`}>
                      {fmt(job.price)}
                    </p>
                    <span className={`inline-block rounded px-1.5 py-0 text-[9px] font-bold uppercase ${job.paymentStatus === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      {job.paymentStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {saved.length > 0 && (
              <div className="flex-shrink-0 flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
                <span className="text-slate-500">Total outstanding</span>
                <span className="font-black text-red-600">{fmt(totalOutstanding)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </CarWashShell>
  );
}
