import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FaBoxes, FaRedoAlt } from "react-icons/fa";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";

const InvStockValuation = () => {
  const [locFilter, setLocFilter] = useState("");

  const { data: locations = [] } = useQuery({
    queryKey: ['inv-locations-ref'],
    queryFn: async () => {
      const data = await inventoryApi.listLocations({ active: true });
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
    staleTime: 5 * 60_000,
  });

  const { data: valuationData, isLoading: loading, refetch } = useQuery({
    queryKey: ['inv-stock-valuation', locFilter],
    queryFn: async () => {
      const res = await inventoryApi.getValuation({ location: locFilter || undefined });
      const rows = Array.isArray(res) ? res : (res?.data ?? []);
      const grandTotal = res?.grandTotal ?? rows.reduce((s, r) => s + (r.totalValue || 0), 0);
      return { rows, grandTotal };
    },
  });

  const rows = valuationData?.rows ?? [];
  const grandTotal = valuationData?.grandTotal ?? 0;

  const grouped = rows.reduce((acc, row) => {
    const key = row.location?._id || "unknown";
    if (!acc[key]) acc[key] = { name: row.location?.name || "Unknown", rows: [], subtotal: 0 };
    acc[key].rows.push(row);
    acc[key].subtotal += row.totalValue || 0;
    return acc;
  }, {});

  return (
    <InventoryShell lockScroll>
      <div className="flex h-full flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
        {/* Filter + action strip */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
          <div className="flex items-baseline gap-4 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <span>SKUs on Hand: <strong className="text-[#0B3B2E]">{rows.length}</strong></span>
            <span>Stock Value: <strong className="text-[#0B3B2E]">{formatMoney(grandTotal)}</strong></span>
          </div>
          <AppSelect value={locFilter} onChange={(v) => setLocFilter(v ?? "")} options={locations.map((l) => ({ value: l._id, label: l.name }))} placeholder="All Locations" clearable size="sm" />
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={refetch} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              <FaRedoAlt className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[700px] text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Product</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">SKU</th>
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-widest">Unit</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Balance</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Unit Cost</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-widest">Total Value</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr>
              ) : !rows.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-14 text-center">
                    <FaBoxes className="mx-auto mb-2 text-3xl text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">No stock on hand</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Receive stock via Purchase Orders or opening entries to see valuation here.
                    </p>
                  </td>
                </tr>
              ) : Object.values(grouped).map((group) => (
                <React.Fragment key={group.name}>
                  <tr className="bg-slate-100">
                    <td colSpan={5} className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-600">
                      {group.name}
                    </td>
                    <td className="px-3 py-1.5 text-right text-[10px] font-extrabold text-slate-600">
                      {formatMoney(group.subtotal)}
                    </td>
                  </tr>
                  {group.rows.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-semibold text-slate-800">{row.product?.name || "—"}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{row.product?.sku || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{row.product?.unitOfMeasure || "—"}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-800">{row.balance}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{formatMoney(row.unitCost)}</td>
                      <td className="px-3 py-2 text-right font-extrabold text-[#0B3B2E]">{formatMoney(row.totalValue)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
            {rows.length > 0 && !loading && (
              <tfoot>
                <tr className="border-t-2 border-[#0B3B2E] bg-[#EDF5F1]">
                  <td colSpan={5} className="px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-[#0B3B2E]">
                    Grand Total
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-extrabold text-[#0B3B2E]">
                    {formatMoney(grandTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </InventoryShell>
  );
};

export default InvStockValuation;
