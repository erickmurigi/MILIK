import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";
import useDebounce from "../../hooks/useDebounce";
import Modal from "../../components/common/Modal";
import AppSelect from "../../components/common/AppSelect";
import Spinner from "../../components/common/Spinner";
import StatusBadge from "../../components/common/StatusBadge";
import { inputClass, labelClass } from "../../utils/formStyles";
import { LISTING_STATUS_MAP, UNIT_STATUSES, STATUS_LABEL, errorMessage } from "./SaleProjectShared";

const STATUS_OPTIONS = UNIT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }));
const CANDIDATE_LIMIT = 200;

// Moves existing standalone listings into a project, giving each one a unit number
export default function SaleAssignListingsModal({ project, biz, onDone, onClose }) {
  const T = useTerms("saleUnit", "saleUnits", "saleListing", "saleListings", "saleProject");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("available");
  const [picked, setPicked] = useState([]); // [{ row, unitNumber }] in the order they were picked
  const [errors, setErrors] = useState({}); // { [listingId]: message } from the last submit
  const [prefix, setPrefix] = useState("");
  const [startNo, setStartNo] = useState("1");
  const [block, setBlock] = useState("");
  const [saving, setSaving] = useState(false);
  const debouncedSearch = useDebounce(search, 400);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["sale-listings-ref", biz, "standalone", debouncedSearch, status],
    queryFn: () => saleApi.listListings({ project: "none", status, search: debouncedSearch, limit: CANDIDATE_LIMIT }),
    enabled: !!biz,
    staleTime: 30_000,
  });
  const candidates = useMemo(() => data?.data ?? [], [data?.data]);
  const pickedById = useMemo(() => new Map(picked.map((p) => [p.row._id, p])), [picked]);

  const toggle = (row) => setPicked((prev) => (
    prev.some((p) => p.row._id === row._id) ? prev.filter((p) => p.row._id !== row._id) : [...prev, { row, unitNumber: "" }]
  ));
  const setUnitNumber = (id, unitNumber) => setPicked((prev) => prev.map((p) => (p.row._id === id ? { ...p, unitNumber } : p)));
  const pickAllShown = () => setPicked((prev) => {
    const have = new Set(prev.map((p) => p.row._id));
    return [...prev, ...candidates.filter((r) => !have.has(r._id)).map((row) => ({ row, unitNumber: "" }))];
  });

  const autoFill = () => {
    const start = Number(startNo);
    if (!Number.isInteger(start) || start < 0) return toast.warning("Enter a whole starting number");
    setPicked((prev) => prev.map((p, i) => ({ ...p, unitNumber: `${prefix.trim()}${start + i}` })));
  };

  const handleSave = async () => {
    if (!picked.length) return toast.warning(`Choose at least one ${T.saleListing.toLowerCase()}`);
    if (picked.some((p) => !p.unitNumber.trim())) return toast.warning(`Give every chosen ${T.saleListing.toLowerCase()} a ${T.saleUnit.toLowerCase()} number`);
    setSaving(true);
    try {
      const res = await saleApi.assignProjectUnits(
        project._id,
        picked.map((p) => ({ listingId: p.row._id, unitNumber: p.unitNumber.trim(), block: block.trim() })),
      );
      await onDone?.();
      const failed = res?.failed ?? [];
      if (!failed.length) {
        toast.success(`${res?.assigned ?? 0} ${T.saleListings.toLowerCase()} added to ${project.name}`);
        onClose();
        return;
      }
      const failedIds = new Set(failed.map((f) => String(f.listingId)));
      setErrors(Object.fromEntries(failed.map((f) => [String(f.listingId), f.error])));
      setPicked((prev) => prev.filter((p) => failedIds.has(p.row._id)));
      toast.warning(`${res?.assigned ?? 0} added, ${failed.length} could not be added — see the list`);
    } catch (err) {
      toast.error(errorMessage(err, `Failed to add ${T.saleListings.toLowerCase()}`));
    } finally {
      setSaving(false);
    }
  };

  const failedRows = picked.filter((p) => errors[p.row._id]);

  return (
    <Modal
      title={`Add Existing ${T.saleListings}`}
      size="extraWide"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-[11px] font-semibold text-slate-500">{picked.length} chosen</span>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Close</button>
          <button type="button" onClick={handleSave} disabled={saving || !picked.length} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
            {saving ? "Adding…" : `Add to ${T.saleProject}`}
          </button>
        </>
      }
    >
      <p className="mb-3 text-[11px] text-slate-500">
        Pick {T.saleListings.toLowerCase()} that are not yet part of a {T.saleProject.toLowerCase()} and give each one a {T.saleUnit.toLowerCase()} number.
      </p>

      <div className="mb-2 flex flex-wrap items-end gap-2">
        <div className="w-48">
          <label className={labelClass}>Search</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} placeholder="Title or number…" />
        </div>
        <div className="w-40">
          <AppSelect label="Status" value={status} onChange={(v) => setStatus(v ?? "")} options={STATUS_OPTIONS} placeholder="Any status" size="md" clearable />
        </div>
        <button type="button" onClick={pickAllShown} disabled={!candidates.length} className="h-8 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50">
          Choose all shown
        </button>
        {isFetching && !isLoading && <Spinner size="sm" />}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2 border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="w-28">
          <label className={labelClass}>Number prefix</label>
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} className={inputClass} placeholder="e.g. A-" />
        </div>
        <div className="w-24">
          <label className={labelClass}>Start at</label>
          <input type="number" min="0" value={startNo} onChange={(e) => setStartNo(e.target.value)} className={inputClass} />
        </div>
        <button type="button" onClick={autoFill} disabled={!picked.length} className="h-8 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50">
          Fill numbers
        </button>
        <div className="ml-auto w-36">
          <label className={labelClass}>Block (all chosen)</label>
          <input value={block} onChange={(e) => setBlock(e.target.value)} className={inputClass} placeholder="Optional" />
        </div>
      </div>

      {failedRows.length > 0 && (
        <div className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          <div className="mb-1 font-bold">Could not be added</div>
          <ul className="list-disc space-y-0.5 pl-4">
            {failedRows.map((p) => <li key={p.row._id}><span className="font-mono font-bold">{p.row.listingNumber}</span> {p.row.title}: {errors[p.row._id]}</li>)}
          </ul>
        </div>
      )}

      <div className="max-h-[38vh] overflow-y-auto border border-slate-200">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-1.5" />
              <th className="px-2 py-1.5 text-left text-[10px] font-black uppercase tracking-widest">{T.saleListing} No.</th>
              <th className="px-2 py-1.5 text-left text-[10px] font-black uppercase tracking-widest">Title</th>
              <th className="px-2 py-1.5 text-right text-[10px] font-black uppercase tracking-widest">Asking Price</th>
              <th className="px-2 py-1.5 text-left text-[10px] font-black uppercase tracking-widest">Status</th>
              <th className="w-36 px-2 py-1.5 text-left text-[10px] font-black uppercase tracking-widest">{T.saleUnit} No.</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center"><Spinner size="sm" /></td></tr>
            ) : candidates.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs font-semibold text-slate-400">No {T.saleListings.toLowerCase()} outside a {T.saleProject.toLowerCase()} match these filters.</td></tr>
            ) : candidates.map((row) => {
              const p = pickedById.get(row._id);
              return (
                <tr key={row._id} className={`border-b border-gray-100 ${p ? "bg-[#EBF5EF]" : "hover:bg-slate-50"}`}>
                  <td className="px-2 py-1 text-center">
                    <input type="checkbox" checked={!!p} onChange={() => toggle(row)} className="cursor-pointer accent-[#0B3B2E]" />
                  </td>
                  <td className="px-2 py-1 font-mono font-bold text-[#0B3B2E]">{row.listingNumber}</td>
                  <td className="max-w-[260px] truncate px-2 py-1 font-semibold text-slate-800">{row.title}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtKES(row.askingPrice)}</td>
                  <td className="px-2 py-1"><StatusBadge status={row.status} map={LISTING_STATUS_MAP} /></td>
                  <td className="px-2 py-1">
                    {p && (
                      <input
                        value={p.unitNumber}
                        onChange={(e) => setUnitNumber(row._id, e.target.value)}
                        className={`h-6 w-full border px-2 text-xs focus:outline-none ${errors[row._id] ? "border-red-300 bg-red-50" : "border-slate-200 bg-white focus:border-[#0B3B2E]"}`}
                        placeholder="e.g. A-12"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {candidates.length >= CANDIDATE_LIMIT && (
        <p className="mt-1 text-[10px] text-slate-400">Showing the first {CANDIDATE_LIMIT}. Use search to narrow the list.</p>
      )}
    </Modal>
  );
}
