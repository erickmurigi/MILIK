import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaExternalLinkAlt, FaMoneyBillWave, FaRedoAlt, FaUndo } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar from "./SaleFilterBar";
import ListToolbar from "../../components/common/ListToolbar";
import PaginationBar from "../../components/PaginationBar";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import RecordOwnerPayoutModal from "./SaleOwnerPayoutModal";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import { useTabState } from "../../hooks/useTabState";
import { useTerms } from "../../hooks/useTerm";
import useSaleFormOptions from "../../hooks/useSaleFormOptions";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import { exportAfterFetch, fetchAllPages, money, printAfterFetch, shortDate } from "./salePrint";

const PAGE_SIZE = 50;

const statementCols = [
  { label: "Statement No." }, { label: "Owner" }, { label: "Project" }, { label: "Period" },
  { label: "Gross Proceeds", align: "right" }, { label: "Net Balance", align: "right" }, { label: "Approved" },
];

const renderStatementRow = (s) => (
  <>
    <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-black text-[#0B3B2E]">{s.statementNumber}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-800">{s.owner?.fullName || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 max-w-[160px] truncate text-slate-600">{s.project?.name || "All projects"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 whitespace-nowrap text-slate-600">{shortDate(s.periodStart)} – {shortDate(s.periodEnd)}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono tabular-nums text-slate-700">{fmtKES(s.grossProceeds)}</td>
    <td className={`px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums ${s.netBalance >= 0 ? "text-emerald-700" : "text-rose-600"}`}>{fmtKES(s.netBalance)}</td>
    <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{shortDate(s.approvedAt)}</td>
  </>
);

// All approved owner statements, across every owner — the audit/reconciliation view. The workspace
// page (/sale/owner-statements) is for generating and approving one owner's statement at a time; this
// is for answering "what have we approved, company-wide, for this period" without picking an owner first.
const SaleOwnerStatementsApproved = () => {
  const T = useTerms("saleOwner", "saleOwners", "saleOwnerStatement", "saleProject");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;
  const { ownerFormOptions } = useSaleFormOptions(biz);

  const [ownerFilt, setOwnerFilt] = useTabState("/sale/owner-statements/approved:owner", "");
  const [page,      setPage]      = useTabState("/sale/owner-statements/approved:page", 1);
  const [pageSize,  setPageSize]  = useTabState("/sale/owner-statements/approved:pageSize", PAGE_SIZE);
  const [payFor,    setPayFor]    = useState(null); // the statement row being paid, or null
  const [reversingId, setReversingId] = useState("");

  const { data, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-owner-statements-approved", biz, ownerFilt, page, pageSize],
    queryFn: () => saleApi.listOwnerStatements({ business: biz, status: "approved", owner: ownerFilt || undefined, page, limit: pageSize }),
    enabled: !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });
  const statements = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const totalNet = useMemo(() => statements.reduce((s, r) => s + Number(r.netBalance ?? 0), 0), [statements]);

  const reportColumns = [
    { label: "Statement No.", value: (s) => s.statementNumber },
    { label: T.saleOwner, value: (s) => s.owner?.fullName || "—" },
    { label: T.saleProject, value: (s) => s.project?.name || "All projects" },
    { label: "Period", value: (s) => `${shortDate(s.periodStart)} – ${shortDate(s.periodEnd)}` },
    { label: "Gross Proceeds (KES)", align: "right", value: (s) => money(s.grossProceeds) },
    { label: "Net Balance (KES)", align: "right", value: (s) => money(s.netBalance) },
    { label: "Approved", value: (s) => shortDate(s.approvedAt) },
  ];

  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    const filters = { business: biz, status: "approved", owner: ownerFilt || undefined };
    await printAfterFetch(() => fetchAllPages(saleApi.listOwnerStatements, filters), ({ rows }) => ({
      title: "Approved Owner Statements",
      subtitle: ownerFilt ? ownerFormOptions.find((o) => o.value === ownerFilt)?.label : "All owners",
      company: currentCompany,
      columns: reportColumns,
      rows,
      totalsRow: ["TOTAL", `${rows.length} statements`, "", "", "", money(rows.reduce((s, r) => s + Number(r.netBalance ?? 0), 0)), ""],
    }));
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    const filters = { business: biz, status: "approved", owner: ownerFilt || undefined };
    await exportAfterFetch(() => fetchAllPages(saleApi.listOwnerStatements, filters), ({ rows }) => ({
      filename: "approved-owner-statements",
      columns: reportColumns,
      rows,
    }));
    setExporting(false);
  };

  const openInWorkspace = (s) => navigate("/sale/owner-statements", { state: { openOwnerId: s.owner?._id, openStatementId: s._id } });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sale-owner-statements-approved", biz] });
    queryClient.invalidateQueries({ queryKey: ["sale-owner-outstanding", biz] });
  };

  const handleReverse = async (s) => {
    if (!await confirm({
      title: "Reverse Statement Approval",
      message: `Reverse ${s.statementNumber} back to draft? It can then be edited or regenerated. Approving posts no ledger entries of its own, so this only changes the statement's status — nothing is reversed in the GL.`,
      confirmText: "Reverse",
      isDangerous: true,
    })) return;
    setReversingId(s._id);
    try {
      await saleApi.reverseOwnerStatementApproval(s._id);
      invalidate();
      toast.success("Statement reversed to draft");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to reverse statement");
    } finally {
      setReversingId("");
    }
  };

  return (
    <PropertySaleShell>
      <div className="flex h-full flex-col gap-1.5">
        <SaleFilterBar
          leading={<span className="shrink-0 font-mono text-[9px] font-black text-slate-500">{total} statement{total !== 1 ? "s" : ""} · {fmtKES(totalNet)} net on this page</span>}
          trailing={
            <>
              <SalePrintButton onClick={printReport} busy={printing} disabled={loading || total === 0} />
              <SaleExportButton onClick={exportReport} busy={exporting} disabled={loading || total === 0} />
              <ListToolbar.Button variant="outline" onClick={() => setPage(1)}>
                <FaRedoAlt size={7} className={isFetching ? "animate-spin" : ""} /> Refresh
              </ListToolbar.Button>
            </>
          }
        >
          <AppSelect value={ownerFilt} onChange={(v) => { setOwnerFilt(v ?? ""); setPage(1); }} options={ownerFormOptions} placeholder={`All ${T.saleOwners.toLowerCase()}`} clearable compact searchable />
        </SaleFilterBar>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
          <MilikTable
            columns={statementCols}
            rows={statements}
            rowKey="_id"
            loading={loading}
            empty="No approved statements yet."
            minWidth={880}
            renderRow={renderStatementRow}
            renderActions={(s) => (
              <div className="inline-flex items-center gap-1">
                {s.netBalance > 0 && (
                  <button type="button" onClick={() => setPayFor(s)} className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Pay owner">
                    <FaMoneyBillWave size={12} />
                  </button>
                )}
                <button type="button" onClick={() => handleReverse(s)} disabled={reversingId === s._id} className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40" title="Reverse to draft">
                  <FaUndo size={12} />
                </button>
                <button type="button" onClick={() => openInWorkspace(s)} className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Open in workspace">
                  <FaExternalLinkAlt size={12} />
                </button>
              </div>
            )}
          />
          <PaginationBar page={page} pages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} loading={isFetching} label="statements" />
        </div>
      </div>

      {payFor && (
        <RecordOwnerPayoutModal
          ownerOptions={ownerFormOptions}
          initialOwnerId={payFor.owner?._id}
          initialAmount={payFor.netBalance}
          onClose={() => setPayFor(null)}
          onSaved={() => { setPayFor(null); invalidate(); }}
        />
      )}
    </PropertySaleShell>
  );
};

export default SaleOwnerStatementsApproved;
