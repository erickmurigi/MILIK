import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FaBoxes, FaRedoAlt } from "react-icons/fa";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";

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

  /* Group rows by location for cleaner presentation */
  const grouped = rows.reduce((acc, row) => {
    const key = row.location?._id || "unknown";
    if (!acc[key]) acc[key] = { name: row.location?.name || "Unknown", rows: [], subtotal: 0 };
    acc[key].rows.push(row);
    acc[key].subtotal += row.totalValue || 0;
    return acc;
  }, {});

  return (
    <InventoryShell
      title="Stock Valuation"
      action={
        <button type="button" onClick={refetch} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#1a5c3a] hover:bg-[#F1F6F3]">
          <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Filter strip */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
          <div className="flex items-baseline gap-4 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <span>SKUs on Hand: <strong className="text-[#1a5c3a]">{rows.length}</strong></span>
            <span>Stock Value: <strong className="text-[#1a5c3a]">{formatMoney(grandTotal)}</strong></span>
          </div>
          <div className="ml-auto">
            <select value={locFilter} onChange={(e) => setLocFilter(e.target.value)}
              className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#1a5c3a]">
              <option value="">All Locations</option>
              {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
          </div>
        </div>

        <table className="w-full min-w-[700px] text-xs">
          <thead className="bg-[#1a5c3a] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Product</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">SKU</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Unit</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Balance</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Unit Cost</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Total Value</th>
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
                {/* Location header row */}
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
                    <td className="px-3 py-2 text-right font-extrabold text-[#1a5c3a]">{formatMoney(row.totalValue)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
          {rows.length > 0 && !loading && (
            <tfoot>
              <tr className="border-t-2 border-[#1a5c3a] bg-[#EDF5F1]">
                <td colSpan={5} className="px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-[#1a5c3a]">
                  Grand Total
                </td>
                <td className="px-3 py-2 text-right text-sm font-extrabold text-[#1a5c3a]">
                  {formatMoney(grandTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </InventoryShell>
  );
};

export default InvStockValuation;
