import React, { useState, useMemo, useEffect } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FaBoxOpen, FaExclamationTriangle, FaFileInvoice, FaRedoAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import InventoryShell from "./InventoryShell";
import { inventoryApi } from "../../services/inventoryApi";
import AppSelect from "../../components/common/AppSelect";

const Pill = ({ children, color }) => (
  <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase ${color}`}>{children}</span>
);

const InvLowStock = () => {
  const navigate = useNavigate();
  const [categoryFilter, setCategoryFilter] = useTabState("/inventory/low-stock:categoryFilter", "");

  const { data: rawItems = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ["inv-low-stock"],
    queryFn: async () => {
      const res = await inventoryApi.getLowStock();
      return Array.isArray(res) ? res : (res?.data ?? []);
    },
  });

  useEffect(() => { if (error) toast.error("Failed to load low-stock report"); }, [error]);

  const categories = useMemo(
    () => [...new Set(rawItems.map((i) => i.product?.category?.name).filter(Boolean))].sort(),
    [rawItems]
  );

  const items = useMemo(
    () => categoryFilter ? rawItems.filter((i) => i.product?.category?.name === categoryFilter) : rawItems,
    [rawItems, categoryFilter]
  );

  const outCount = useMemo(() => items.filter((i) => i.balance <= 0).length, [items]);
  const lowCount = useMemo(() => items.filter((i) => i.balance > 0 && i.balance <= i.reorderLevel).length, [items]);

  return (
    <InventoryShell
      title="Low Stock Alerts"
      action={
        <button
          type="button"
          onClick={refetch}
          className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
        >
          <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      }
    >
      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        {/* Summary strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Total Alerts: <strong className="text-[#0B3B2E]">{rawItems.length}</strong>
          </span>
          {outCount > 0 && (
            <span className="text-[11px] font-bold uppercase tracking-wide text-red-600">
              Out of Stock: <strong>{outCount}</strong>
            </span>
          )}
          {lowCount > 0 && (
            <span className="text-[11px] font-bold uppercase tracking-wide text-amber-600">
              Below Reorder: <strong>{lowCount}</strong>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <AppSelect value={categoryFilter} onChange={(v) => setCategoryFilter(v ?? "")} options={categories.map((c) => ({ value: c, label: c }))} placeholder="All Categories" clearable size="sm" />
            <button
              type="button"
              onClick={() => navigate("/inventory/purchase-orders")}
              className="inline-flex h-7 items-center gap-1.5 bg-[#FF8C00] px-3 text-[11px] font-bold text-white hover:bg-[#E67E00]"
            >
              <FaFileInvoice className="text-[9px]" /> Create PO
            </button>
          </div>
        </div>

        <table className="w-full min-w-[750px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Product</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Category</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Unit</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Balance</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Reorder Level</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Deficit</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-slate-400">Loading…</td>
              </tr>
            ) : !items.length ? (
              <tr>
                <td colSpan={8} className="px-3 py-16 text-center">
                  <FaBoxOpen className="mx-auto mb-2 text-3xl text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">
                    {categoryFilter ? "No low-stock alerts for this category" : "All products are above reorder level"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Set a reorder level on products to receive alerts here.
                  </p>
                </td>
              </tr>
            ) : items.map(({ product: p, balance, reorderLevel, deficit }) => {
              const isOut  = balance <= 0;
              const isLow  = !isOut && balance <= reorderLevel;
              return (
                <tr key={p._id} className={`border-b border-slate-100 hover:bg-slate-50 ${isOut ? "bg-red-50/40" : isLow ? "bg-amber-50/30" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                      <FaExclamationTriangle className={`shrink-0 text-[10px] ${isOut ? "text-red-500" : "text-amber-500"}`} />
                      {p.name}
                    </div>
                    {p.sku && <div className="font-mono text-[10px] text-slate-400">{p.sku}</div>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{p.category?.name || "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{p.unitOfMeasure || "—"}</td>
                  <td className={`px-3 py-2 text-right font-extrabold ${isOut ? "text-red-600" : "text-amber-600"}`}>
                    {balance}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{reorderLevel}</td>
                  <td className={`px-3 py-2 text-right font-bold ${deficit > 0 ? "text-red-600" : "text-slate-400"}`}>
                    {deficit > 0 ? deficit : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {isOut
                      ? <Pill color="border-red-200 bg-red-50 text-red-700">Out of Stock</Pill>
                      : <Pill color="border-amber-200 bg-amber-50 text-amber-700">Low Stock</Pill>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => navigate("/inventory/adjustments")}
                        className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
                      >
                        Adjust
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/inventory/purchase-orders")}
                        className="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 hover:bg-amber-100"
                      >
                        Order
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </InventoryShell>
  );
};

export default InvLowStock;
