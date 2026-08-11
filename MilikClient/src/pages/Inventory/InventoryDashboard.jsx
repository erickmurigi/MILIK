import React, { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FaBoxes, FaCashRegister, FaChartBar, FaCheckCircle, FaClock,
  FaExchangeAlt, FaExclamationTriangle, FaFileInvoice,
  FaLayerGroup, FaMapMarkerAlt, FaMoneyBillWave, FaPhone,
  FaPlus, FaReceipt, FaRedoAlt, FaShoppingCart,
  FaTags, FaTruck, FaWarehouse,
} from "react-icons/fa";
import InventoryShell from "./InventoryShell";
import { inventoryApi, formatMoney, todayISO } from "../../services/inventoryApi";
import { fmtDate } from "../../utils/dates";
import DashboardCard, { DashboardStatCard } from "../../components/Dashboard/DashboardCard";

const StatCard = DashboardStatCard;
const Card     = DashboardCard;

const DASH_DATE_KEY = "inv_dash_date";

const paymentColors = {
  cash:   { bar: "bg-[#0B3B2E]",  text: "text-[#0B3B2E]" },
  mpesa:  { bar: "bg-[#E65F1A]",  text: "text-[#E65F1A]" },
  card:   { bar: "bg-violet-600", text: "text-violet-600" },
  credit: { bar: "bg-blue-600",   text: "text-blue-600" },
};

const paymentLabels = { cash: "Cash", mpesa: "M-Pesa", card: "Card", credit: "Credit" };

const SALE_STATUS_BADGE = {
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  voided:    "border-red-200 bg-red-50 text-red-700",
};

const pipelineStages = [
  { key: "sessions",  label: "Active Sessions", icon: FaCashRegister, ring: "border-amber-400",   num: "text-amber-600",   bg: "bg-amber-50",   hover: "hover:bg-amber-50",   link: "/pos/sessions" },
  { key: "sales",     label: "Today Sales",      icon: FaShoppingCart, ring: "border-emerald-500", num: "text-emerald-700", bg: "bg-emerald-50", hover: "hover:bg-emerald-50", link: "/pos/sales" },
  { key: "openPOs",   label: "Open POs",         icon: FaFileInvoice,  ring: "border-blue-400",    num: "text-blue-600",    bg: "bg-blue-50",    hover: "hover:bg-blue-50",    link: "/inventory/purchase-orders" },
  { key: "transit",   label: "In Transit",       icon: FaTruck,        ring: "border-orange-400",  num: "text-orange-600",  bg: "bg-orange-50",  hover: "hover:bg-orange-50",  link: "/inventory/transfers" },
  { key: "lowStock",  label: "Low Stock",        icon: FaExclamationTriangle, ring: "border-rose-400", num: "text-rose-600", bg: "bg-rose-50", hover: "hover:bg-rose-50",  link: "/inventory/low-stock" },
];

const QUICK_LINKS = [
  { label: "Products",        Icon: FaBoxes,        to: "/inventory/products" },
  { label: "Categories",      Icon: FaTags,         to: "/inventory/categories" },
  { label: "Locations",       Icon: FaMapMarkerAlt, to: "/inventory/locations" },
  { label: "Purchase Orders", Icon: FaFileInvoice,  to: "/inventory/purchase-orders" },
  { label: "Transfers",       Icon: FaExchangeAlt,  to: "/inventory/transfers" },
  { label: "Stock Movements", Icon: FaLayerGroup,   to: "/inventory/stock-movements" },
  { label: "Stock Valuation", Icon: FaChartBar,     to: "/inventory/valuation" },
  { label: "Low Stock",       Icon: FaExclamationTriangle, to: "/inventory/low-stock" },
  { label: "POS Terminal",    Icon: FaCashRegister, to: "/pos/terminal" },
  { label: "Sales History",   Icon: FaReceipt,      to: "/pos/sales" },
];

const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "—";

const normalise = (raw) => (Array.isArray(raw) ? raw : raw?.data ?? []);

const InventoryDashboard = () => {
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();
  const dateInputRef = useRef(null);

  const today = useMemo(() => todayISO(), []);
  const [date, setDate] = useState(() => sessionStorage.getItem(DASH_DATE_KEY) || today);

  const changeDate = useCallback((val) => {
    sessionStorage.setItem(DASH_DATE_KEY, val);
    setDate(val);
  }, []);

  const stepDay = useCallback((n) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + n);
    changeDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }, [date, changeDate]);

  const resetToday = useCallback(() => {
    sessionStorage.removeItem(DASH_DATE_KEY);
    setDate(today);
  }, [today]);

  const { data, isFetching: loading } = useQuery({
    queryKey: ["inv-dashboard", date],
    queryFn: async () => {
      const [summaryRes, salesRes, sessionsRes, posRes, transfersRes, lowStockRes] = await Promise.allSettled([
        inventoryApi.getSalesSummary({ date }),
        inventoryApi.listSales({ date, limit: 20 }),
        inventoryApi.listSessions({ status: "open", limit: 100 }),
        inventoryApi.listPurchaseOrders({ limit: 100 }),
        inventoryApi.listTransfers({ limit: 100 }),
        inventoryApi.getLowStock(),
      ]);
      return {
        summary:   summaryRes.status   === "fulfilled" ? summaryRes.value   : null,
        sales:     salesRes.status     === "fulfilled" ? salesRes.value     : null,
        sessions:  sessionsRes.status  === "fulfilled" ? sessionsRes.value  : null,
        pos:       posRes.status       === "fulfilled" ? posRes.value       : null,
        transfers: transfersRes.status === "fulfilled" ? transfersRes.value : null,
        lowStock:  lowStockRes.status  === "fulfilled" ? lowStockRes.value  : null,
      };
    },
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const summary       = data?.summary ?? null;
  const salesList     = useMemo(() => normalise(data?.sales),     [data?.sales]);
  const sessionsList  = useMemo(() => normalise(data?.sessions),  [data?.sessions]);
  const posList       = useMemo(() => normalise(data?.pos),       [data?.pos]);
  const transfersList = useMemo(() => normalise(data?.transfers), [data?.transfers]);
  const lowStockList  = useMemo(() => normalise(data?.lowStock),  [data?.lowStock]);

  const grandTotal   = summary?.grandTotal ?? 0;
  const salesCount   = summary?.count ?? 0;
  const byMethod     = summary?.byPaymentMethod ?? {};
  const cashTotal    = byMethod.cash   ?? 0;
  const mpesaTotal   = byMethod.mpesa  ?? 0;
  const cardTotal    = byMethod.card   ?? 0;
  const creditTotal  = byMethod.credit ?? 0;

  const openSessions = sessionsList.length;
  const openPOs      = posList.filter((p) => p.status === "draft" || p.status === "sent").length;
  const inTransit    = transfersList.filter((t) => t.status === "in_transit").length;
  const lowCount     = lowStockList.length;

  const pipelineCounts = { sessions: openSessions, sales: salesCount, openPOs, transit: inTransit, lowStock: lowCount };

  const paymentRows = useMemo(() =>
    Object.keys(paymentLabels).map((m) => ({ method: m, label: paymentLabels[m], amount: byMethod[m] ?? 0 })),
    [byMethod]
  );

  const dateLabel = useMemo(
    () => new Date(date + "T00:00:00").toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }),
    [date]
  );
  const cardHeaderDate = useMemo(
    () => new Date(date + "T00:00:00").toLocaleDateString("en-KE", { weekday: "long", day: "2-digit", month: "short", year: "numeric" }),
    [date]
  );

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["inv-dashboard", date] });
  }, [queryClient, date]);

  return (
    <InventoryShell
      title="Daily Operations"
      action={
        <>
          {/* Date stepper */}
          <div className="flex h-7 items-center divide-x divide-slate-300 border border-slate-300 bg-white">
            <button type="button" onClick={() => stepDay(-1)}
              className="flex h-full w-6 items-center justify-center text-slate-500 hover:bg-slate-100">‹</button>
            <button type="button" onClick={() => dateInputRef.current?.showPicker()}
              className="relative flex h-full items-center px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              {dateLabel}
              <input ref={dateInputRef} type="date" value={date}
                onChange={(e) => changeDate(e.target.value)}
                className="pointer-events-none absolute inset-0 h-0 w-0 opacity-0" tabIndex={-1} />
            </button>
            <button type="button" onClick={() => stepDay(1)}
              className="flex h-full w-6 items-center justify-center text-slate-500 hover:bg-slate-100">›</button>
          </div>
          {date !== today && (
            <button type="button" onClick={resetToday}
              className="h-7 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
              Today
            </button>
          )}
          <button type="button" onClick={refresh}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={() => navigate("/pos/terminal")}
            className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
            <FaPlus size={9} /> New Sale
          </button>
        </>
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">

        {/* ── Stat cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard label={date === today ? "Today Revenue" : "Revenue"} value={formatMoney(grandTotal)} icon={FaMoneyBillWave} tone="green"  sub={`${salesCount} sale${salesCount !== 1 ? "s" : ""}`} />
          <StatCard label="Cash"    value={formatMoney(cashTotal)}  icon={FaMoneyBillWave} tone="orange" sub="cash payments" />
          <StatCard label="M-Pesa"  value={formatMoney(mpesaTotal)} icon={FaPhone}         tone="green"  sub="mobile money" />
          <StatCard label="Card"    value={formatMoney(cardTotal)}  icon={FaCashRegister}  tone="orange" sub="card / bank" />
          <StatCard label="Low-Stock Items" value={lowCount} icon={FaExclamationTriangle}  tone={lowCount > 0 ? "orange" : "green"} sub="below reorder level" />
        </div>

        {/* ── Pipeline strip ─────────────────────────────────────────────── */}
        <Card title="Inventory & POS Snapshot" right={
          <span className="text-[10px] font-bold text-slate-400">{cardHeaderDate}</span>
        }>
          <div className="grid grid-cols-5 divide-x divide-slate-100">
            {pipelineStages.map(({ key, label, icon: Icon, ring, num, bg, hover, link }) => (
              <button key={key} type="button" onClick={() => navigate(link)}
                className={`group flex flex-col items-center justify-between gap-1 px-2 py-3 transition ${hover} sm:flex-row sm:gap-2 sm:px-3`}>
                <div className="flex flex-col items-center gap-1 sm:flex-row sm:gap-2">
                  <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${ring} ${bg}`}>
                    <Icon className={`h-3 w-3 ${num}`} />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
                </div>
                <span className={`text-xl font-black leading-none tabular-nums ${num}`}>
                  {loading ? "…" : pipelineCounts[key]}
                </span>
              </button>
            ))}
          </div>
        </Card>

        {/* ── Main two-column area ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 items-start gap-1.5 xl:grid-cols-[1fr_280px]">

          {/* Left: Recent Sales */}
          <Card
            title={date === today ? "Today's Sales" : `Sales — ${dateLabel}`}
            right={
              <button type="button" onClick={() => navigate("/pos/sales")}
                className="text-[10px] font-extrabold uppercase tracking-wide text-[#0B3B2E] hover:text-[#FF8C00]">
                View All →
              </button>
            }
          >
            {/* Mobile cards */}
            <div className="divide-y divide-slate-100 xl:hidden">
              {salesList.length ? salesList.slice(0, 10).map((s) => (
                <div key={s._id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-mono font-bold text-[#0B3B2E]">{s.receiptNumber || "—"}</span>
                      <span className="truncate text-slate-500">{s.customerName || s.customerPhone || "Walk-in"}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {s.location?.name || "—"} · {fmtTime(s.createdAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${SALE_STATUS_BADGE[s.status] || "border-slate-200 bg-slate-50 text-slate-500"}`}>
                      {s.status}
                    </span>
                    <span className="text-xs font-extrabold text-slate-900">{formatMoney(s.grandTotal)}</span>
                  </div>
                </div>
              )) : (
                <p className="px-3 py-8 text-center text-xs font-semibold text-slate-400">
                  No sales recorded for this date.
                </p>
              )}
            </div>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full min-w-[700px] text-xs">
                <thead>
                  <tr className="bg-[#0B3B2E]">
                    {["Time", "Receipt #", "Location", "Customer", "Payment", "Status", "Cashier", "Total"].map((h) => (
                      <th key={h} className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white ${h === "Total" ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {salesList.length ? salesList.map((s) => (
                    <tr key={s._id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                      onClick={() => navigate("/pos/sales")}>
                      <td className="px-3 py-2 text-slate-400">{fmtTime(s.createdAt)}</td>
                      <td className="px-3 py-2 font-mono font-bold text-[#0B3B2E]">{s.receiptNumber || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{s.location?.name || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{s.customerName || s.customerPhone || <span className="text-slate-400 italic">Walk-in</span>}</td>
                      <td className="px-3 py-2 capitalize text-slate-500">
                        {s.payments?.map((p) => p.method).join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${SALE_STATUS_BADGE[s.status] || "border-slate-200 bg-slate-50 text-slate-500"}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{s.cashier?.name || "—"}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900">{formatMoney(s.grandTotal)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-xs font-semibold text-slate-400">
                        No sales recorded for this date.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Right sidebar */}
          <div className="flex flex-col gap-1.5">

            {/* Daily Summary */}
            <Card title="Daily Summary">
              <div className="divide-y divide-slate-100">
                {[
                  { label: "Sales",       value: salesCount,             note: "completed transactions", bold: true },
                  { label: "Subtotal",    value: formatMoney(summary?.subtotal ?? 0),    note: "before VAT & discount", money: true },
                  { label: "Discounts",   value: formatMoney(summary?.totalDiscount ?? 0), note: "total deducted",       warn: (summary?.totalDiscount ?? 0) > 0 },
                  { label: "VAT",         value: formatMoney(summary?.totalVat ?? 0),    note: "tax collected",         money: true },
                  { label: "Grand Total", value: formatMoney(grandTotal),                 note: "revenue collected",     big: true },
                  { label: "Open Sessions", value: openSessions, note: "POS registers active", warn: openSessions > 0 },
                ].map(({ label, value, note, bold, warn, money, big }) => (
                  <div key={label} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div>
                      <p className="text-xs font-bold text-slate-700">{label}</p>
                      <p className="text-[10px] text-slate-400">{note}</p>
                    </div>
                    <span className={`text-right font-extrabold tabular-nums ${
                      big  ? "text-[#0B3B2E] text-base" :
                      bold ? "text-emerald-700 text-base" :
                      warn ? "text-orange-600" :
                      money ? "text-sm text-slate-800" :
                      "text-slate-900"
                    }`}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Payment Mix */}
            <Card title="Payment Mix">
              <div className="space-y-1 px-3 py-2">
                {paymentRows.map(({ method, label, amount }) => {
                  const pct = grandTotal > 0 ? Math.round((amount / grandTotal) * 100) : 0;
                  const { bar, text } = paymentColors[method] || { bar: "bg-slate-400", text: "text-slate-500" };
                  return (
                    <div key={method}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-600">{label}</span>
                        <span className={`font-extrabold tabular-nums ${amount > 0 ? text : "text-slate-300"}`}>
                          {formatMoney(amount)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-7 text-right text-[10px] font-bold text-slate-400">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
                {grandTotal === 0 && (
                  <p className="py-2 text-center text-[10px] text-slate-400">No revenue recorded yet.</p>
                )}
              </div>
            </Card>

            {/* Quick Access */}
            <Card title="Quick Access">
              <div className="grid grid-cols-2 gap-px bg-slate-100">
                {QUICK_LINKS.map(({ label, Icon, to }) => (
                  <button key={to} type="button" onClick={() => navigate(to)}
                    className="flex items-center gap-2 bg-white px-3 py-2.5 text-left hover:bg-[#F1F6F3]">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-[#0B3B2E]/10 text-xs text-[#0B3B2E]">
                      <Icon />
                    </span>
                    <span className="text-xs font-bold leading-tight text-slate-800">{label}</span>
                  </button>
                ))}
              </div>
            </Card>

          </div>
        </div>
      </div>
    </InventoryShell>
  );
};

export default InventoryDashboard;
