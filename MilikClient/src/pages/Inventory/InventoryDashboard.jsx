import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaBoxes, FaExchangeAlt, FaExclamationTriangle, FaFileInvoice, FaMapMarkerAlt,
  FaRedoAlt, FaShoppingCart, FaTruck, FaWarehouse,
} from "react-icons/fa";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";

const STATUS_BADGE = {
  draft:               "border-slate-200  bg-slate-50  text-slate-600",
  sent:                "border-blue-200   bg-blue-50   text-blue-700",
  partially_received:  "border-amber-200  bg-amber-50  text-amber-700",
  received:            "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled:           "border-red-200    bg-red-50    text-red-700",
  in_transit:          "border-orange-200 bg-orange-50 text-orange-700",
};

const StatusPill = ({ status }) => (
  <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_BADGE[status] || "border-slate-200 bg-slate-50 text-slate-500"}`}>
    {String(status || "").replace(/_/g, " ")}
  </span>
);

const KpiCard = ({ label, value, sub, icon: Icon, accent }) => (
  <div className={`flex items-center justify-between gap-3 border-l-4 border-slate-200 bg-white px-4 py-3 shadow-sm ${accent}`}>
    <div>
      <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold text-slate-800">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>}
    </div>
    <Icon className="shrink-0 text-3xl text-slate-200" />
  </div>
);

const Section = ({ title, children }) => (
  <section className="border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-200 bg-[#0B3B2E] px-3 py-2">
      <h2 className="text-[11px] font-extrabold uppercase tracking-wide text-white">{title}</h2>
    </div>
    {children}
  </section>
);

const InventoryDashboard = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [recentTransfers, setRecentTransfers] = useState([]);
  const [recentPOs, setRecentPOs] = useState([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [val, transfers, pos, lowStock] = await Promise.allSettled([
        inventoryApi.getValuation(),
        inventoryApi.listTransfers({ limit: 6 }),
        inventoryApi.listPurchaseOrders({ limit: 6 }),
        inventoryApi.getLowStock(),
      ]);
      if (val.status === "fulfilled") setSummary(val.value);
      if (transfers.status === "fulfilled") {
        const d = transfers.value;
        setRecentTransfers(Array.isArray(d) ? d : (d?.data ?? []));
      }
      if (pos.status === "fulfilled") {
        const d = pos.value;
        setRecentPOs(Array.isArray(d) ? d : (d?.data ?? []));
      }
      if (lowStock.status === "fulfilled") {
        const d = lowStock.value;
        const arr = Array.isArray(d) ? d : (d?.data ?? []);
        setLowStockCount(arr.length);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalValue  = summary?.grandTotal ?? 0;
  const skuCount    = Array.isArray(summary?.data) ? summary.data.length : 0;
  const openPOs     = recentPOs.filter((p) => p.status === "draft" || p.status === "sent").length;
  const inTransit   = recentTransfers.filter((t) => t.status === "in_transit").length;

  const QUICK_LINKS = [
    { label: "Products",        icon: FaBoxes,               path: "/inventory/products" },
    { label: "Purchase Orders", icon: FaFileInvoice,          path: "/inventory/purchase-orders" },
    { label: "Transfers",       icon: FaExchangeAlt,          path: "/inventory/transfers" },
    { label: "Low Stock",       icon: FaExclamationTriangle,  path: "/inventory/low-stock" },
    { label: "POS Sales",       icon: FaShoppingCart,         path: "/pos/sales" },
  ];

  return (
    <InventoryShell
      title="Dashboard"
      action={
        <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
          <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-24 text-sm text-slate-400">Loading dashboard…</div>
      ) : (
        <div className="space-y-3">
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label="Stock Value"   value={formatMoney(totalValue)} sub="across all locations" icon={FaWarehouse}           accent="border-l-[#0B3B2E]" />
            <KpiCard label="SKUs in Stock" value={skuCount}               sub="distinct products"     icon={FaBoxes}               accent="border-l-blue-500" />
            <KpiCard label="Open POs"      value={openPOs}               sub="awaiting receipt"       icon={FaFileInvoice}         accent="border-l-amber-500" />
            <KpiCard label="In-Transit"    value={inTransit}             sub="transfers dispatched"   icon={FaTruck}               accent="border-l-orange-500" />
            <KpiCard label="Low Stock"     value={lowStockCount}         sub="below reorder level"    icon={FaExclamationTriangle} accent="border-l-red-500" />
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {QUICK_LINKS.map(({ label, icon: Icon, path }) => (
              <button
                key={path}
                type="button"
                onClick={() => navigate(path)}
                className="flex items-center gap-2 border border-slate-200 bg-white px-3 py-3 text-left shadow-sm hover:border-[#0B3B2E] hover:bg-[#EDF5F1] transition-colors"
              >
                <Icon className="shrink-0 text-sm text-[#0B3B2E]" />
                <span className="text-xs font-bold text-slate-700">{label}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {/* Recent transfers */}
            <Section title="Recent Transfers">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#0B3B2E]">
                    {["TRF #", "From", "To", "Status", "Date"].map((h) => (
                      <th key={h} className="px-3 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-white">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!recentTransfers.length ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-slate-400">No transfers yet</td></tr>
                  ) : recentTransfers.map((t) => (
                    <tr key={t._id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={() => navigate("/inventory/transfers")}>
                      <td className="px-3 py-1.5 font-mono font-bold text-[#0B3B2E]">{t.transferNumber || "—"}</td>
                      <td className="px-3 py-1.5 text-slate-700">{t.fromLocation?.name || "—"}</td>
                      <td className="px-3 py-1.5 text-slate-700">{t.toLocation?.name || "—"}</td>
                      <td className="px-3 py-1.5"><StatusPill status={t.status} /></td>
                      <td className="px-3 py-1.5 text-slate-400">{t.createdAt ? new Date(t.createdAt).toLocaleDateString("en-KE") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Recent purchase orders */}
            <Section title="Recent Purchase Orders">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#0B3B2E]">
                    {["PO #", "Supplier", "Total", "Status"].map((h) => (
                      <th key={h} className="px-3 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-white">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!recentPOs.length ? (
                    <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-slate-400">No purchase orders yet</td></tr>
                  ) : recentPOs.map((po) => (
                    <tr key={po._id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={() => navigate("/inventory/purchase-orders")}>
                      <td className="px-3 py-1.5 font-mono font-bold text-[#0B3B2E]">{po.poNumber || "—"}</td>
                      <td className="px-3 py-1.5 text-slate-700">{po.supplier?.name || "—"}</td>
                      <td className="px-3 py-1.5 font-bold text-slate-800">{formatMoney(po.totalAmount)}</td>
                      <td className="px-3 py-1.5"><StatusPill status={po.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </div>
        </div>
      )}
    </InventoryShell>
  );
};

export default InventoryDashboard;
