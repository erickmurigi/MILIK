import React, { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FaBoxes, FaChartBar, FaExchangeAlt, FaExclamationTriangle,
  FaFileInvoice, FaMapMarkerAlt, FaRedoAlt, FaShoppingCart,
  FaTags, FaTruck, FaWarehouse, FaCashRegister, FaLayerGroup,
  FaClipboardList, FaMoneyBillWave,
} from "react-icons/fa";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney } from "../../services/inventoryApi";

const todayISO = () => new Date().toISOString().slice(0, 10);

/* ─── Shared UI components (same pattern as CarWash / PropertySale) ── */

const StatCard = ({ label, value, sub, icon: Icon, tone = "green" }) => {
  const bg = {
    green:  "bg-[#0B3B2E] border-[#0B3B2E]",
    orange: "bg-[#C8511A] border-[#C8511A]",
    slate:  "bg-slate-700 border-slate-700",
    red:    "bg-rose-700 border-rose-700",
    blue:   "bg-blue-700 border-blue-700",
    amber:  "bg-amber-600 border-amber-600",
  }[tone] || "bg-[#0B3B2E] border-[#0B3B2E]";
  return (
    <div className={`relative overflow-hidden border ${bg} px-4 py-3 shadow-sm`}>
      {Icon && <Icon className="absolute right-3 top-2.5 h-10 w-10 text-white/10" />}
      <p className="text-[9px] font-extrabold uppercase tracking-widest text-white/60">{label}</p>
      <p className="mt-1.5 text-2xl font-black leading-none text-white">{value}</p>
      {sub && <p className="mt-1 text-[10px] text-white/50">{sub}</p>}
    </div>
  );
};

const Card = ({ title, right, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white shadow-sm ${className}`}>
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">{title}</h2>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
    {children}
  </div>
);

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

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short" }) : "—";

/* ─── Quick links ── */
const QUICK_LINKS = [
  { label: "Products",        icon: FaBoxes,              path: "/inventory/products" },
  { label: "Categories",      icon: FaTags,               path: "/inventory/categories" },
  { label: "Locations",       icon: FaMapMarkerAlt,       path: "/inventory/locations" },
  { label: "Purchase Orders", icon: FaFileInvoice,        path: "/inventory/purchase-orders" },
  { label: "Transfers",       icon: FaExchangeAlt,        path: "/inventory/transfers" },
  { label: "Stock Movements", icon: FaLayerGroup,         path: "/inventory/stock-movements" },
  { label: "Low Stock",       icon: FaExclamationTriangle,path: "/inventory/low-stock" },
  { label: "Valuation",       icon: FaChartBar,           path: "/inventory/valuation" },
  { label: "POS Terminal",    icon: FaCashRegister,       path: "/pos/terminal" },
  { label: "POS Sales",       icon: FaShoppingCart,       path: "/pos/sales" },
];

/* ─── Dashboard ── */
const InventoryDashboard = () => {
  const navigate      = useNavigate();
  const queryClient   = useQueryClient();
  const today         = useMemo(() => todayISO(), []);

  const { data, isFetching: loading } = useQuery({
    queryKey: ["inv-dashboard", today],
    queryFn: async () => {
      const [val, transfers, pos, lowStock, todaySales] = await Promise.allSettled([
        inventoryApi.getValuation(),
        inventoryApi.listTransfers({ limit: 8 }),
        inventoryApi.listPurchaseOrders({ limit: 8 }),
        inventoryApi.getLowStock(),
        inventoryApi.getSalesSummary({ date: today }),
      ]);
      return {
        valuation:  val.status         === "fulfilled" ? val.value         : null,
        transfers:  transfers.status   === "fulfilled" ? transfers.value   : null,
        pos:        pos.status         === "fulfilled" ? pos.value         : null,
        lowStock:   lowStock.status    === "fulfilled" ? lowStock.value    : null,
        todaySales: todaySales.status  === "fulfilled" ? todaySales.value  : null,
      };
    },
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["inv-dashboard"] });
  }, [queryClient]);

  const valuation     = data?.valuation ?? null;
  const transfers     = useMemo(() => {
    const d = data?.transfers;
    return Array.isArray(d) ? d : (d?.data ?? []);
  }, [data?.transfers]);
  const purchaseOrders = useMemo(() => {
    const d = data?.pos;
    return Array.isArray(d) ? d : (d?.data ?? []);
  }, [data?.pos]);
  const lowStockList  = useMemo(() => {
    const d = data?.lowStock;
    return Array.isArray(d) ? d : (d?.data ?? []);
  }, [data?.lowStock]);
  const sales         = data?.todaySales ?? null;

  const totalValue    = valuation?.grandTotal ?? 0;
  const skuCount      = Array.isArray(valuation?.data) ? valuation.data.length : 0;
  const openPOs       = purchaseOrders.filter((p) => p.status === "draft" || p.status === "sent").length;
  const inTransit     = transfers.filter((t) => t.status === "in_transit").length;

  const todayRevenue  = sales?.totalSales ?? 0;
  const todayCount    = sales?.salesCount ?? 0;
  const todayMpesa    = sales?.totalMpesa ?? 0;
  const todayCash     = sales?.totalCash  ?? 0;

  return (
    <InventoryShell
      title="Dashboard"
      action={
        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
        >
          <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      }
    >
      <div className="space-y-3">
        {/* ── Today's POS Sales row ── */}
        <div>
          <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            Today's Sales — {new Date(today + "T00:00:00").toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Today's Revenue" value={formatMoney(todayRevenue)} sub={`${todayCount} sale${todayCount !== 1 ? "s" : ""}`} icon={FaMoneyBillWave} tone="green" />
            <StatCard label="Cash Sales"      value={formatMoney(todayCash)}    sub="cash payments"    icon={FaCashRegister}  tone="slate" />
            <StatCard label="M-Pesa Sales"    value={formatMoney(todayMpesa)}   sub="mobile money"     icon={FaShoppingCart}  tone="orange" />
            <StatCard label="Low-Stock Items" value={lowStockList.length}        sub="below reorder"    icon={FaExclamationTriangle} tone={lowStockList.length > 0 ? "red" : "slate"} />
          </div>
        </div>

        {/* ── Inventory KPIs row ── */}
        <div>
          <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Inventory</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Stock Value"   value={formatMoney(totalValue)} sub="across all locations" icon={FaWarehouse}    tone="green" />
            <StatCard label="SKUs in Stock" value={skuCount}                sub="distinct products"    icon={FaBoxes}        tone="blue" />
            <StatCard label="Open POs"      value={openPOs}                 sub="awaiting receipt"     icon={FaFileInvoice}  tone="amber" />
            <StatCard label="In-Transit"    value={inTransit}               sub="transfers dispatched" icon={FaTruck}        tone="slate" />
          </div>
        </div>

        {/* ── Quick links ── */}
        <Card title="Quick Access">
          <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4 lg:grid-cols-5">
            {QUICK_LINKS.map(({ label, icon: Icon, path }) => (
              <button
                key={path}
                type="button"
                onClick={() => navigate(path)}
                className="flex items-center gap-2 bg-white px-3 py-3 text-left hover:bg-[#EDF5F1] transition-colors"
              >
                <Icon className="shrink-0 text-sm text-[#0B3B2E]" />
                <span className="text-xs font-bold text-slate-700">{label}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* ── Tables ── */}
        <div className="grid gap-3 lg:grid-cols-2">
          {/* Recent transfers */}
          <Card title="Recent Stock Transfers">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {["TRF #", "From → To", "Status", "Date"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!transfers.length ? (
                    <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">No transfers yet</td></tr>
                  ) : transfers.map((t) => (
                    <tr
                      key={t._id}
                      className="cursor-pointer border-b border-slate-50 hover:bg-[#EDF5F1] transition-colors"
                      onClick={() => navigate("/inventory/transfers")}
                    >
                      <td className="px-3 py-2 font-mono text-[11px] font-bold text-[#0B3B2E]">{t.transferNumber || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {t.fromLocation?.name || "—"} <span className="text-slate-400">→</span> {t.toLocation?.name || "—"}
                      </td>
                      <td className="px-3 py-2"><StatusPill status={t.status} /></td>
                      <td className="px-3 py-2 text-slate-400">{fmtDate(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Recent purchase orders */}
          <Card title="Recent Purchase Orders">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {["PO #", "Supplier", "Total", "Status"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!purchaseOrders.length ? (
                    <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">No purchase orders yet</td></tr>
                  ) : purchaseOrders.map((po) => (
                    <tr
                      key={po._id}
                      className="cursor-pointer border-b border-slate-50 hover:bg-[#EDF5F1] transition-colors"
                      onClick={() => navigate("/inventory/purchase-orders")}
                    >
                      <td className="px-3 py-2 font-mono text-[11px] font-bold text-[#0B3B2E]">{po.poNumber || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{po.supplier?.name || "—"}</td>
                      <td className="px-3 py-2 font-bold text-slate-800">{formatMoney(po.totalAmount)}</td>
                      <td className="px-3 py-2"><StatusPill status={po.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* ── Low-stock alert ── */}
        {lowStockList.length > 0 && (
          <Card
            title={`Low-Stock Alert — ${lowStockList.length} product${lowStockList.length !== 1 ? "s" : ""}`}
            right={
              <button
                type="button"
                onClick={() => navigate("/inventory/low-stock")}
                className="text-[10px] font-bold text-[#0B3B2E] hover:underline"
              >
                View all →
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {["Product", "SKU", "Balance", "Reorder At", "Deficit"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lowStockList.slice(0, 8).map((item) => (
                    <tr key={item._id} className="border-b border-slate-50">
                      <td className="px-3 py-2 font-semibold text-slate-800">{item.name}</td>
                      <td className="px-3 py-2 font-mono text-slate-400">{item.sku || "—"}</td>
                      <td className="px-3 py-2 font-bold text-red-600">{item.balance ?? 0}</td>
                      <td className="px-3 py-2 text-slate-500">{item.reorderLevel ?? 0}</td>
                      <td className="px-3 py-2 font-bold text-red-700">{Math.max(0, (item.reorderLevel ?? 0) - (item.balance ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </InventoryShell>
  );
};

export default InventoryDashboard;
