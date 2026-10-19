import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaPlus, FaRedoAlt } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar from "./SaleFilterBar";
import ListToolbar from "../../components/common/ListToolbar";
import PaginationBar from "../../components/PaginationBar";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import RecordOwnerPayoutModal from "./SaleOwnerPayoutModal";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import { useTabState } from "../../hooks/useTabState";
import { useTerms } from "../../hooks/useTerm";
import useSaleFormOptions from "../../hooks/useSaleFormOptions";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import { exportAfterFetch, fetchAllPages, money, printAfterFetch, shortDate } from "./salePrint";

const PAGE_SIZE = 50;

const payoutCols = [
  { label: "Payout No." }, { label: "Owner" }, { label: "Date" }, { label: "Source" },
  { label: "Amount", align: "right" }, { label: "CGT Withheld", align: "right" }, { label: "Reference" },
];

const renderPayoutRow = (p) => (
  <>
    <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-black text-[#0B3B2E]">{p.payoutNumber}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-800">{p.owner?.fullName || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{shortDate(p.date)}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{p.source === "advocate_trust" ? `Advocate trust${p.deal?.dealNumber ? ` · ${p.deal.dealNumber}` : ""}` : (p.cashbook?.name || "Cashbook")}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums text-emerald-700">{fmtKES(p.amount)}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono tabular-nums text-slate-500">{p.cgtAmount > 0 ? fmtKES(p.cgtAmount) : "—"}</td>
    <td className="px-3 py-1.5 text-slate-600">{p.reference || "—"}</td>
  </>
);

// All owner payouts, across every owner — the cash-out audit log, mirroring SaleCommissionPayouts.jsx's
// shape. Recording a payout has no other natural home (unlike commissions, which get marked paid from
// the commission record itself), so it lives here as a modal rather than forcing one owner to be
// selected before the page shows anything.
const SaleOwnerPayouts = () => {
  const T = useTerms("saleOwner", "saleOwners");
  const queryClient = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;
  const { ownerFormOptions } = useSaleFormOptions(biz);

  const [ownerFilt, setOwnerFilt] = useTabState("/sale/owner-payouts:owner", "");
  const [page,      setPage]      = useTabState("/sale/owner-payouts:page", 1);
  const [pageSize,  setPageSize]  = useTabState("/sale/owner-payouts:pageSize", PAGE_SIZE);
  const [showRecord, setShowRecord] = useState(false);

  const { data, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-owner-payouts-all", biz, ownerFilt, page, pageSize],
    queryFn: () => saleApi.listOwnerPayouts({ business: biz, owner: ownerFilt || undefined, page, limit: pageSize }),
    enabled: !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 15_000,
  });
  const payouts = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const totalPaid = useMemo(() => payouts.reduce((s, p) => s + Number(p.amount ?? 0), 0), [payouts]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sale-owner-payouts-all", biz] });
    queryClient.invalidateQueries({ queryKey: ["sale-owner-outstanding", biz] });
  };

  const reportColumns = [
    { label: "Payout No.", value: (p) => p.payoutNumber },
    { label: T.saleOwner, value: (p) => p.owner?.fullName || "—" },
    { label: "Date", value: (p) => shortDate(p.date) },
    { label: "Source", value: (p) => (p.source === "advocate_trust" ? `Advocate trust${p.deal?.dealNumber ? ` (${p.deal.dealNumber})` : ""}` : (p.cashbook?.name || "Cashbook")) },
    { label: "Amount (KES)", align: "right", value: (p) => money(p.amount) },
    { label: "CGT Withheld (KES)", align: "right", value: (p) => (p.cgtAmount > 0 ? money(p.cgtAmount) : "—") },
    { label: "Reference", value: (p) => p.reference || "—" },
  ];

  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    const filters = { business: biz, owner: ownerFilt || undefined };
    await printAfterFetch(() => fetchAllPages(saleApi.listOwnerPayouts, filters), ({ rows }) => ({
      title: "Owner Payouts",
      subtitle: ownerFilt ? ownerFormOptions.find((o) => o.value === ownerFilt)?.label : "All owners",
      company: currentCompany,
      columns: reportColumns,
      rows,
      totalsRow: ["TOTAL", `${rows.length} payouts`, "", "", money(rows.reduce((s, p) => s + Number(p.amount ?? 0), 0)), money(rows.reduce((s, p) => s + Number(p.cgtAmount ?? 0), 0)), ""],
    }));
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    const filters = { business: biz, owner: ownerFilt || undefined };
    await exportAfterFetch(() => fetchAllPages(saleApi.listOwnerPayouts, filters), ({ rows }) => ({
      filename: "owner-payouts",
      columns: reportColumns,
      rows,
    }));
    setExporting(false);
  };

  return (
    <PropertySaleShell>
      <div className="flex h-full flex-col gap-1.5">
        <SaleFilterBar
          leading={<span className="shrink-0 font-mono text-[9px] font-black text-emerald-700">{fmtKES(totalPaid)} on this page</span>}
          trailing={
            <>
              <SalePrintButton onClick={printReport} busy={printing} disabled={loading || total === 0} />
              <SaleExportButton onClick={exportReport} busy={exporting} disabled={loading || total === 0} />
              <ListToolbar.Button variant="outline" onClick={invalidate}>
                <FaRedoAlt size={7} className={isFetching ? "animate-spin" : ""} /> Refresh
              </ListToolbar.Button>
              <ListToolbar.Button variant="primary" icon={FaPlus} onClick={() => setShowRecord(true)}>
                Record Payout
              </ListToolbar.Button>
            </>
          }
        >
          <AppSelect value={ownerFilt} onChange={(v) => { setOwnerFilt(v ?? ""); setPage(1); }} options={ownerFormOptions} placeholder={`All ${T.saleOwners.toLowerCase()}`} clearable compact searchable />
        </SaleFilterBar>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
          <MilikTable columns={payoutCols} rows={payouts} rowKey="_id" loading={loading} empty="No payouts recorded yet." minWidth={880} renderRow={renderPayoutRow} />
          <PaginationBar page={page} pages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} loading={isFetching} label="payouts" />
        </div>
      </div>

      {showRecord && (
        <RecordOwnerPayoutModal
          ownerOptions={ownerFormOptions}
          onClose={() => setShowRecord(false)}
          onSaved={() => { setShowRecord(false); invalidate(); }}
        />
      )}
    </PropertySaleShell>
  );
};

export default SaleOwnerPayouts;
