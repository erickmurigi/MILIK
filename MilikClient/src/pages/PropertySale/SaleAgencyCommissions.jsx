import React, { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaChevronDown, FaFilter, FaRedoAlt } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch, FilterDateRange } from "./SaleFilterBar";
import ListToolbar from "../../components/common/ListToolbar";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import { useTerms } from "../../hooks/useTerm";
import AppSelect from "../../components/common/AppSelect";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import { exportAfterFetch, fetchAllPages, money, printAfterFetch } from "./salePrint";
import { fmtDate } from "../../utils/dates";
import MilikTable from "../../components/common/MilikTable";

// The company's own agency commission for selling on an owner's behalf — structurally parallel to
// Broker Commissions but simpler: no WHT, and no manual approve/pay/reverse action exists, since this
// is the company's own recognized revenue, never disbursed to a third party (SaleOwnerCommission has no
// "paid" status at all). Immediate (non-staged) commissions are auto-recognized in full at deal
// creation; staged ones accrue tier-by-tier automatically as the buyer pays. A later edit to the
// company's agency rate (Settings > Commission Defaults) resyncs every still-open commission here
// automatically — no manual action needed, nothing to do on this page but watch the numbers update.
const STATUS_BADGE = {
  pending:   "border-amber-200 bg-amber-50 text-amber-700",
  approved:  "border-blue-200 bg-blue-50 text-blue-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-600",
};
// There is no manual approval step for an agency commission — "pending"/"approved" here only ever mean
// "still accruing" vs "fully recognized," flipped automatically as the buyer pays (or instantly, for an
// immediate/non-staged one). Displaying the raw enum words would wrongly suggest someone has to click
// something, the way they do on the Broker Commissions page — so this page shows its own wording instead.
const AGENCY_STATUS_LABEL = { pending: "Accruing", approved: "Recognized", cancelled: "Cancelled" };
const PAGE_SIZE = 50;
const fmtLabel = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const AGENCY_STATUS_OPTIONS = ["pending", "approved", "cancelled"].map((s) => ({ value: s, label: AGENCY_STATUS_LABEL[s] }));

const tierProgress = (c) => {
  if (!c.releaseSchedule?.length) return null;
  const totalTiers = c.releaseSchedule.length;
  const releasedCount = c.tierReleases?.length || 0;
  const commissionAmount = Number(c.commissionAmount || 0);
  const releasedAmount = Number(c.releasedAmount || 0);
  const pct = commissionAmount > 0 ? Math.round((releasedAmount / commissionAmount) * 100) : 0;
  return { totalTiers, releasedCount, pct };
};

const agencyCols = (T) => [
  { label: "Comm. No.", width: "11%" },
  { label: T.saleOwner, width: "15%" },
  { label: T.saleDeal, width: "10%" },
  { label: "Property", width: "16%" },
  { label: "Rate", width: "8%" },
  { label: "Amount", align: "right", width: "14%" },
  { label: "Status", width: "18%" },
];

const renderAgencyRow = (c) => (
  <>
    <td className="px-3 py-1.5 font-mono font-black text-[#0B3B2E] border-r border-gray-100">{c.commissionNumber}</td>
    <td className="px-3 py-1.5 font-bold text-slate-800 border-r border-gray-100">{c.owner?.fullName || "—"}</td>
    <td className="px-3 py-1.5 font-mono font-black text-slate-700 border-r border-gray-100">{c.deal?.dealNumber || "—"}</td>
    <td className="max-w-[160px] truncate px-3 py-1.5 text-slate-500 border-r border-gray-100">{c.listing?.title || c.listing?.listingNumber || "—"}</td>
    <td className="px-3 py-1.5 font-black text-[#0B3B2E] border-r border-gray-100">
      {c.commissionRate}{c.commissionType === "percentage" ? "%" : " KES"}
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums text-slate-900">{fmtKES(c.commissionAmount)}</td>
    <td className="px-3 py-1.5">
      <div className="inline-flex flex-nowrap items-center gap-1">
        <span className={`inline-block border px-1.5 py-0.5 text-[9px] font-black uppercase ${STATUS_BADGE[c.status] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
          {AGENCY_STATUS_LABEL[c.status] || c.status}
        </span>
        {(() => {
          const tp = tierProgress(c);
          if (!tp) return null;
          return (
            <span className="inline-block whitespace-nowrap border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-500">
              {tp.releasedCount}/{tp.totalTiers} tiers · {tp.pct}%
            </span>
          );
        })()}
      </div>
    </td>
  </>
);

const renderAgencyExpanded = (c) => {
  if (!c.releaseSchedule?.length) {
    return <div className="text-[10px] text-slate-400">Single release — this commission has no staged tiers.</div>;
  }
  return (
    <table className="w-full max-w-xl text-[10px]">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="pb-1 pr-4 font-black uppercase">Threshold</th>
          <th className="pb-1 pr-4 font-black uppercase">Release %</th>
          <th className="pb-1 pr-4 text-right font-black uppercase">Amount</th>
          <th className="pb-1 pr-4 font-black uppercase">Status</th>
          <th className="pb-1 font-black uppercase">Released</th>
        </tr>
      </thead>
      <tbody>
        {c.releaseSchedule.map((tier, i) => {
          const released = (c.tierReleases || []).find((tr) => tr.thresholdPct === tier.thresholdPct);
          return (
            <tr key={i} className="border-t border-slate-200">
              <td className="py-1 pr-4 font-bold text-slate-700">{tier.thresholdPct}% paid</td>
              <td className="py-1 pr-4 text-slate-600">{tier.releasePct}%</td>
              <td className="py-1 pr-4 text-right font-mono font-bold text-slate-700">{released ? fmtKES(released.amount) : "—"}</td>
              <td className="py-1 pr-4">
                {/* "Status" here is the TIER's own, not the commission's pending/approved/cancelled
                    lifecycle — never the word "pending" again for an unreached tier, to avoid reading
                    as if the commission itself were unapproved. */}
                {released ? (
                  <span className="border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">RELEASED</span>
                ) : (
                  <span className="border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-black text-slate-400">UPCOMING</span>
                )}
              </td>
              <td className="py-1 text-slate-500">{released?.accruedAt ? fmtDate(released.accruedAt) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

const SaleAgencyCommissions = () => {
  const T = useTerms("saleOwner", "saleOwners", "saleDeal", "saleDeals");
  const agencyColumns = useMemo(() => agencyCols(T), [T]);
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [statusFilter, setStatusFilter] = useTabState("/sale/agency-commissions:statusFilter", "");
  const [search,       setSearch]       = useTabState("/sale/agency-commissions:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [ownerFilt,    setOwnerFilt]    = useTabState("/sale/agency-commissions:ownerFilt", "");
  const [dealFilt,     setDealFilt]     = useTabState("/sale/agency-commissions:dealFilt", "");
  const [dateFrom,     setDateFrom]     = useTabState("/sale/agency-commissions:dateFrom", "");
  const [dateTo,       setDateTo]       = useTabState("/sale/agency-commissions:dateTo", "");
  const [page,         setPage]         = useTabState("/sale/agency-commissions:page", 1);
  const [pageSize,     setPageSize]     = useTabState("/sale/agency-commissions:pageSize", PAGE_SIZE);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const statusBtnRef = useRef(null);

  const { data: ownersData } = useQuery({
    queryKey: ["sale-owners-ref", biz, "all"],
    queryFn:  () => saleApi.listOwners({ business: biz, limit: 200 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });
  const { data: dealsData } = useQuery({
    queryKey: ["sale-deals-ref", biz],
    queryFn:  () => saleApi.listDeals({ business: biz, limit: 200 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });
  const ownersRef = useMemo(() => ownersData?.data ?? [], [ownersData]);
  const dealsRef  = useMemo(() => dealsData?.data  ?? [], [dealsData]);

  const { data, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-owner-commissions", biz, statusFilter, debouncedSearch, ownerFilt, dealFilt, dateFrom, dateTo, page, pageSize],
    queryFn:  () => saleApi.listOwnerCommissions({
      business: biz, limit: pageSize, page,
      ...(statusFilter && { status:  statusFilter }),
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(ownerFilt    && { ownerId: ownerFilt }),
      ...(dealFilt     && { dealId:  dealFilt }),
      ...(dateFrom     && { dateFrom }),
      ...(dateTo       && { dateTo }),
    }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  const commissions = useMemo(() => data?.data ?? [], [data]);
  const total       = data?.total  ?? 0;
  const commStats   = data?.stats  ?? null;
  const totalPages  = Math.max(1, Math.ceil(total / pageSize));

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ["sale-owner-commissions", biz] }), [queryClient, biz]);

  const buildReportFilters = () => ({
    business: biz,
    ...(statusFilter && { status: statusFilter }),
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(ownerFilt && { ownerId: ownerFilt }),
    ...(dealFilt && { dealId: dealFilt }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
  });
  const reportColumns = [
    { label: "Comm. No.", value: (c) => c.commissionNumber },
    { label: T.saleOwner, value: (c) => c.owner?.fullName || "—" },
    { label: T.saleDeal, value: (c) => c.deal?.dealNumber || "—" },
    { label: "Property", value: (c) => c.listing?.title || c.listing?.listingNumber || "—" },
    { label: "Rate", value: (c) => `${c.commissionRate}${c.commissionType === "percentage" ? "%" : " KES"}` },
    { label: "Amount (KES)", align: "right", value: (c) => money(c.commissionAmount) },
    { label: "Status", value: (c) => AGENCY_STATUS_LABEL[c.status] || c.status },
  ];

  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    const described = [
      statusFilter && `Status: ${AGENCY_STATUS_LABEL[statusFilter] || fmtLabel(statusFilter)}`,
      ownerFilt && ownerFilterOptions.find((o) => o.value === ownerFilt)?.label,
      dealFilt && dealFilterOptions.find((o) => o.value === dealFilt)?.label,
      (dateFrom || dateTo) && `${dateFrom ? fmtDate(dateFrom) : "…"} – ${dateTo ? fmtDate(dateTo) : "…"}`,
      debouncedSearch && `Search: ${debouncedSearch}`,
    ].filter(Boolean);
    await printAfterFetch(() => fetchAllPages(saleApi.listOwnerCommissions, buildReportFilters()), ({ rows }) => ({
      title: "Agency Commissions",
      subtitle: described.join(" · ") || "All agency commissions",
      company: currentCompany,
      summaryItems: ["pending", "approved", "cancelled"].map((k) => [AGENCY_STATUS_LABEL[k], `${money(commStats?.[k]?.amount)} (${commStats?.[k]?.count ?? 0})`]),
      columns: reportColumns,
      rows,
      totalsRow: ["TOTAL", `${rows.length} commissions`, "", "", "", money(rows.reduce((s, c) => s + Number(c.commissionAmount || 0), 0)), ""],
    }));
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    await exportAfterFetch(() => fetchAllPages(saleApi.listOwnerCommissions, buildReportFilters()), ({ rows }) => ({
      filename: "agency-commissions",
      columns: reportColumns,
      rows,
    }));
    setExporting(false);
  };

  const resetFilters = () => { setSearch(""); setStatusFilter(""); setOwnerFilt(""); setDealFilt(""); setDateFrom(""); setDateTo(""); setPage(1); };
  const activeFilterCount = [search, statusFilter, ownerFilt, dealFilt, dateFrom, dateTo].filter(Boolean).length;

  const ownerFilterOptions = useMemo(() => ownersRef.map((o) => ({ value: o._id, label: `${o.fullName}${o.ownerNumber ? ` (${o.ownerNumber})` : ""}` })), [ownersRef]);
  const dealFilterOptions  = useMemo(() => dealsRef.map((d) => ({ value: d._id, label: `${d.dealNumber}${d.listing?.title ? ` — ${d.listing.title}` : ""}` })), [dealsRef]);


  return (
    <PropertySaleShell>
      <div className="flex h-full flex-col gap-1.5">

        {/* Filter bar */}
        <SaleFilterBar
          onReset={resetFilters}
          activeCount={activeFilterCount}
          trailing={
            <>
              <SalePrintButton onClick={printReport} busy={printing} disabled={loading || total === 0} />
              <SaleExportButton onClick={exportReport} busy={exporting} disabled={loading || total === 0} />
              <ListToolbar.Button variant="outline" onClick={invalidate}>
                <FaRedoAlt size={7} className={isFetching ? "animate-spin" : ""} /> Refresh
              </ListToolbar.Button>
            </>
          }
        >
          <FilterSearch
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={`${T.saleOwner}, ${T.saleDeal.toLowerCase()}, comm. no.`}
          />
          <div className="relative">
            <ListToolbar.Button
              ref={statusBtnRef}
              icon={FaFilter}
              variant={statusFilter ? "dark" : "outline"}
              onClick={() => setShowStatusMenu((o) => !o)}
            >
              {statusFilter ? `${AGENCY_STATUS_LABEL[statusFilter] || fmtLabel(statusFilter)}: ${commStats?.[statusFilter]?.count ?? 0}` : "All Statuses"}
              <FaChevronDown size={7} />
            </ListToolbar.Button>
            <ListToolbar.Menu open={showStatusMenu} onClose={() => setShowStatusMenu(false)} anchorRef={statusBtnRef} width="w-56">
              <ListToolbar.MenuItem onClick={() => { setStatusFilter(""); setPage(1); setShowStatusMenu(false); }} className={!statusFilter ? "bg-[#F1F6F3] font-bold text-[#0B3B2E]" : ""}>
                All Statuses
              </ListToolbar.MenuItem>
              {AGENCY_STATUS_OPTIONS.map(({ value: s, label }) => {
                const stat = commStats?.[s];
                const active = statusFilter === s;
                return (
                  <ListToolbar.MenuItem
                    key={s}
                    onClick={() => { setStatusFilter(s); setPage(1); setShowStatusMenu(false); }}
                    className={`justify-between ${active ? "bg-[#F1F6F3] font-bold text-[#0B3B2E]" : ""}`}
                  >
                    <span>{label}</span>
                    <span className="font-mono text-slate-400">{stat ? `${fmtKES(stat.amount)} (${stat.count})` : "—"}</span>
                  </ListToolbar.MenuItem>
                );
              })}
            </ListToolbar.Menu>
          </div>
          <AppSelect
            value={ownerFilt}
            onChange={(v) => { setOwnerFilt(v ?? ""); setPage(1); }}
            options={ownerFilterOptions}
            placeholder={`All ${T.saleOwners}`} clearable compact searchable
          />
          <AppSelect
            value={dealFilt}
            onChange={(v) => { setDealFilt(v ?? ""); setPage(1); }}
            options={dealFilterOptions}
            placeholder={`All ${T.saleDeals}`} clearable compact searchable
          />
          <FilterDateRange
            from={dateFrom} to={dateTo}
            onFromChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            onToChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          />
        </SaleFilterBar>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
          <MilikTable
            columns={agencyColumns}
            rows={commissions}
            loading={loading}
            empty="No agency commissions found."
            minWidth={760}
            renderRow={renderAgencyRow}
            renderExpanded={renderAgencyExpanded}
          />

          <PaginationBar
            page={page}
            pages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            loading={isFetching}
            label="agency commissions"
          />
        </div>
      </div>
    </PropertySaleShell>
  );
};

export default SaleAgencyCommissions;
