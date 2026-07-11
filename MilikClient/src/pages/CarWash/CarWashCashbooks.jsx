import React, { useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { FaExternalLinkAlt, FaRedoAlt, FaSearch } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import PaginationBar from "../../components/PaginationBar";

const PAGE_SIZE = 30;
const defaultFilters = { search: "" };

const isCashbookAccount = (account = {}) =>
  String(account?.subGroup || "").toLowerCase().includes("cashbook") ||
  /cash|bank|m-pesa|mpesa/i.test(`${account?.name || ""} ${account?.code || ""}`);

const CarWashCashbooks = () => {
  const navigate = useNavigate();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const [filters, setFilters] = useTabState("/carwash/cashbooks:filters", defaultFilters);
  const [appliedFilters, setAppliedFilters] = useTabState("/carwash/cashbooks:appliedFilters", defaultFilters);
  const [page, setPage] = useTabState("/carwash/cashbooks:page", 1);

  const { data: rawAccounts, isLoading: loading, error, refetch } = useQuery({
    queryKey: ["cw-cashbooks", currentCompany?._id],
    queryFn: () => carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" }),
    enabled: !!currentCompany?._id,
    select: (rows) => Array.isArray(rows) ? rows.filter(isCashbookAccount) : [],
    staleTime: 2 * 60_000,
  });

  useEffect(() => { if (error) toast.error(error?.response?.data?.message || "Failed to load cashbooks"); }, [error]);

  const accounts = rawAccounts ?? [];

  const filteredAccounts = useMemo(() => {
    const search = appliedFilters.search.trim().toLowerCase();
    if (!search) return accounts;
    return accounts.filter((account) =>
      [account.code, account.name, account.subGroup, account.type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }, [accounts, appliedFilters.search]);

  const pageCount = Math.max(Math.ceil(filteredAccounts.length / PAGE_SIZE), 1);
  const pagedAccounts = filteredAccounts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalBalance = filteredAccounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setPage(1);
  };

  return (
    <CarWashShell
      title="Cashbooks"
      action={
        <>
          <button type="button" onClick={() => refetch()} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button type="button" onClick={() => navigate("/carwash/chart-of-accounts")} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
            <FaExternalLinkAlt />
            Chart
          </button>
        </>
      }
    >
      <form onSubmit={applyFilters} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 md:grid-cols-[1fr_auto_auto]">
        <input className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" placeholder="Cashbook code / name" value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]"><FaSearch />Search</button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]"><FaRedoAlt />Reset</button>
      </form>

      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Cashbooks: <strong className="text-[#0B3B2E]">{filteredAccounts.length}</strong></span>
          <span>Combined Balance: <strong className="text-[#0B3B2E]">{formatMoney(totalBalance)}</strong></span>
          <span>Source: <strong className="text-[#0B3B2E]">Company Chart of Accounts</strong></span>
        </div>
        <table className="w-full min-w-[820px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Code</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Cashbook</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Subgroup</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Posting</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Balance</th>
            </tr>
          </thead>
          <tbody>
            {pagedAccounts.length ? pagedAccounts.map((account) => (
              <tr key={account._id || account.code} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="px-2 py-1 font-extrabold text-slate-900">{account.code}</td>
                <td className="px-2 py-1 font-semibold text-slate-800">{account.name}</td>
                <td className="px-2 py-1 text-slate-600">{account.subGroup || "-"}</td>
                <td className="px-2 py-1 font-bold uppercase text-[#0B3B2E]">{account.isPosting === false ? "No" : "Yes"}</td>
                <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(account.balance)}</td>
              </tr>
            )) : (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No cashbook accounts found.</td></tr>
            )}
          </tbody>
        </table>
        <PaginationBar
          page={page}
          pages={pageCount}
          total={filteredAccounts.length}
          onPageChange={setPage}
        />
      </div>
    </CarWashShell>
  );
};

export default CarWashCashbooks;
