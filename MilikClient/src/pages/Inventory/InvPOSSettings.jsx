import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaCog, FaRedoAlt, FaSave } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";

const inputClass = "w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const labelClass = "mb-0.5 block text-xs font-semibold text-slate-700";

const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex cursor-pointer items-start gap-3">
    <div className="relative mt-0.5 shrink-0">
      <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
      <div className={`h-4 w-7 rounded-full transition-colors ${checked ? "bg-[#0B3B2E]" : "bg-slate-300"}`} />
      <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-3.5" : "translate-x-0.5"}`} />
    </div>
    <div>
      <span className="block text-xs font-semibold text-slate-800">{label}</span>
      {hint && <span className="block text-[10px] text-slate-500">{hint}</span>}
    </div>
  </label>
);

const Section = ({ title, children }) => (
  <div className="border border-slate-200 bg-white">
    <div className="border-b border-slate-200 bg-[#EDF5F1] px-4 py-2">
      <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">{title}</h3>
    </div>
    <div className="space-y-4 p-4">{children}</div>
  </div>
);

const defaultSettings = {
  receiptHeader: "", receiptFooter: "Thank you for your business!",
  showVATBreakdown: true, showCashierName: true, showReceiptNumber: true,
  autoReceiptPrint: false, currency: "KES", currencySymbol: "Ksh",
  vatPIN: "", kraETIMSEnabled: false, decimalPlaces: 2,
};

const InvPOSSettings = () => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(defaultSettings);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["inv-pos-settings"],
    queryFn: async () => {
      const d = await inventoryApi.getPOSSettings();
      return d;
    },
  });

  useEffect(() => {
    if (data) {
      setForm({
        receiptHeader:     data.receiptHeader     ?? "",
        receiptFooter:     data.receiptFooter     ?? "Thank you for your business!",
        showVATBreakdown:  data.showVATBreakdown  ?? true,
        showCashierName:   data.showCashierName   ?? true,
        showReceiptNumber: data.showReceiptNumber ?? true,
        autoReceiptPrint:  data.autoReceiptPrint  ?? false,
        currency:          data.currency          ?? "KES",
        currencySymbol:    data.currencySymbol    ?? "Ksh",
        vatPIN:            data.vatPIN            ?? "",
        kraETIMSEnabled:   data.kraETIMSEnabled   ?? false,
        decimalPlaces:     data.decimalPlaces     ?? 2,
      });
      setDirty(false);
    }
  }, [data]);

  const set = (key) => (val) => {
    setForm((f) => ({ ...f, [key]: val }));
    setDirty(true);
  };
  const setVal = (key) => (e) => set(key)(e.target.type === "checkbox" ? e.target.checked : e.target.value);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await inventoryApi.updatePOSSettings({ ...form, decimalPlaces: Number(form.decimalPlaces) });
      queryClient.invalidateQueries({ queryKey: ["inv-pos-settings"] });
      toast.success("Settings saved");
      setDirty(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <InventoryShell lockScroll>
      <div className="flex h-full flex-col overflow-hidden">
        {/* toolbar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
          <FaCog className="text-[#0B3B2E] text-[11px]" />
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">POS &amp; Receipt Settings</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={refetch} className="inline-flex h-7 items-center border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              <FaRedoAlt className={isLoading ? "animate-spin" : ""} />
            </button>
            {dirty && (
              <button type="submit" form="pos-settings-form" disabled={saving}
                className="inline-flex h-7 items-center gap-1 bg-[#FF8C00] px-3 text-[10px] font-bold text-white hover:bg-[#E67E00] disabled:opacity-60">
                <FaSave /> {saving ? "Saving…" : "Save Changes"}
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-slate-400 text-sm">Loading…</div>
          ) : (
            <form id="pos-settings-form" onSubmit={handleSave}>
              <div className="mx-auto max-w-2xl space-y-4">

                <Section title="Currency &amp; Formatting">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelClass}>Currency Code</label>
                      <input className={inputClass} value={form.currency} onChange={setVal("currency")} placeholder="KES" />
                    </div>
                    <div>
                      <label className={labelClass}>Currency Symbol</label>
                      <input className={inputClass} value={form.currencySymbol} onChange={setVal("currencySymbol")} placeholder="Ksh" />
                    </div>
                    <div>
                      <label className={labelClass}>Decimal Places</label>
                      <select className={inputClass} value={form.decimalPlaces} onChange={setVal("decimalPlaces")}>
                        <option value={0}>0</option>
                        <option value={2}>2</option>
                        <option value={4}>4</option>
                      </select>
                    </div>
                  </div>
                </Section>

                <Section title="Receipt Printing">
                  <div>
                    <label className={labelClass}>Receipt Header</label>
                    <textarea rows={3} className="w-full resize-none rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                      value={form.receiptHeader} onChange={setVal("receiptHeader")}
                      placeholder="Business name, address, phone — appears at top of receipt" />
                    <p className="mt-0.5 text-[10px] text-slate-400">Supports multiple lines. Leave blank to use company name from settings.</p>
                  </div>
                  <div>
                    <label className={labelClass}>Receipt Footer</label>
                    <textarea rows={2} className="w-full resize-none rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                      value={form.receiptFooter} onChange={setVal("receiptFooter")}
                      placeholder="e.g. Thank you for your business!" />
                  </div>
                  <div className="space-y-3 pt-1">
                    <Toggle checked={form.showVATBreakdown} onChange={setVal("showVATBreakdown")} label="Show VAT breakdown on receipt" hint="Displays tax subtotals per rate line" />
                    <Toggle checked={form.showCashierName} onChange={setVal("showCashierName")} label="Show cashier name on receipt" />
                    <Toggle checked={form.showReceiptNumber} onChange={setVal("showReceiptNumber")} label="Show receipt number on receipt" />
                    <Toggle checked={form.autoReceiptPrint} onChange={setVal("autoReceiptPrint")} label="Auto-print receipt after sale" hint="Sends to default printer automatically" />
                  </div>
                </Section>

                <Section title="Tax / Fiscal Compliance">
                  <div>
                    <label className={labelClass}>VAT Registration PIN</label>
                    <input className={inputClass} value={form.vatPIN} onChange={setVal("vatPIN")} placeholder="e.g. P051234567B" />
                    <p className="mt-0.5 text-[10px] text-slate-400">Printed on receipts and invoices as required by KRA.</p>
                  </div>
                  <Toggle checked={form.kraETIMSEnabled} onChange={setVal("kraETIMSEnabled")}
                    label="Enable KRA eTIMS integration"
                    hint="Electronic Tax Invoice Management System — required for VAT-registered businesses in Kenya" />
                  {form.kraETIMSEnabled && (
                    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                      eTIMS integration requires additional configuration. Contact your system administrator.
                    </div>
                  )}
                </Section>

              </div>
            </form>
          )}
        </div>

        {dirty && !isLoading && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2">
            <span className="text-[10px] text-amber-600 font-semibold">You have unsaved changes</span>
            <button type="submit" form="pos-settings-form" disabled={saving}
              className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-[10px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-60">
              <FaSave /> {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        )}
      </div>
    </InventoryShell>
  );
};

export default InvPOSSettings;
