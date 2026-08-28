import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaEdit, FaPlus, FaSyncAlt, FaTimes, FaTrash, FaTools,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import {
  getFixedAssets, createFixedAsset, updateFixedAsset,
  disposeFixedAsset, getChartOfAccounts,
} from "../../redux/apiCalls";

const GRN = "#0B3B2E";

const METHODS = [
  { value: "straight_line",    label: "Straight Line" },
  { value: "reducing_balance", label: "Reducing Balance" },
  { value: "none",             label: "No Depreciation" },
];
const CATEGORIES = ["Furniture", "Equipment", "Vehicles", "Buildings", "Land", "Computers & IT", "Other"];
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c }));

const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const methodLabel = (m) => METHODS.find((x) => x.value === m)?.label || m;

const statusPill = (status) => {
  const map = {
    active:            "bg-emerald-50 text-emerald-700",
    disposed:          "bg-red-50 text-red-600",
    fully_depreciated: "bg-slate-100 text-slate-500",
  };
  const labels = { active: "Active", disposed: "Disposed", fully_depreciated: "Fully Dep." };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${map[status] || "bg-slate-100 text-slate-500"}`}>
      {labels[status] || status}
    </span>
  );
};

const emptyForm = () => ({
  name: "", code: "", category: "", description: "",
  purchaseDate: "", purchaseCost: "", residualValue: "",
  depreciationMethod: "straight_line", usefulLifeYears: "5", depreciationRate: "20",
  assetAccount: "", depreciationExpenseAccount: "", accumulatedDepreciationAccount: "",
});

// ─────────────────────────────────────────────────────────────────────────────
const FixedAssets = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId = currentCompany?._id;

  const [assets, setAssets]               = useState([]);
  const [accounts, setAccounts]           = useState([]);
  const [loading, setLoading]             = useState(false);
  const [filterStatus, setFilterStatus]   = useTabState("/accounts/fixed-assets:filterStatus", "");
  const [filterCategory, setFilterCategory] = useTabState("/accounts/fixed-assets:filterCategory", "");
  const [search, setSearch]               = useTabState("/accounts/fixed-assets:search", "");

  // Add / edit form panel
  const [showForm, setShowForm]           = useState(false);
  const [editingAsset, setEditingAsset]   = useState(null);
  const [form, setForm]                   = useState(emptyForm());
  const [saving, setSaving]               = useState(false);
  const [formError, setFormError]         = useState("");

  // Dispose modal
  const [disposeTarget, setDisposeTarget] = useState(null);
  const [disposeForm, setDisposeForm]     = useState({ disposalDate: "", disposalProceeds: "", disposalNotes: "" });
  const [disposing, setDisposing]         = useState(false);

  const fetchedRef = useRef(false);

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [assetsData, accts] = await Promise.all([
        getFixedAssets({ business: businessId }),
        getChartOfAccounts({ business: businessId }),
      ]);
      setAssets(Array.isArray(assetsData) ? assetsData : []);
      setAccounts(Array.isArray(accts) ? accts.filter((a) => a.isPosting && !a.isHeader) : []);
    } catch {
      toast.error("Failed to load assets");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (!fetchedRef.current && businessId) { fetchedRef.current = true; load(); }
  }, [businessId, load]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (filterStatus && a.status !== filterStatus) return false;
      if (filterCategory && a.category !== filterCategory) return false;
      if (q && !a.name.toLowerCase().includes(q) && !(a.code || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assets, filterStatus, filterCategory, search]);

  const totals = useMemo(() => {
    const active = assets.filter((a) => a.status === "active");
    return {
      count:       active.length,
      cost:        active.reduce((s, a) => s + Number(a.purchaseCost || 0), 0),
      accumulated: active.reduce((s, a) => s + Number(a.accumulatedDepreciation || 0), 0),
      bookValue:   active.reduce((s, a) => s + Number(a.bookValue || 0), 0),
    };
  }, [assets]);

  // ── Form helpers ────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingAsset(null); setForm(emptyForm()); setFormError(""); setShowForm(true);
  };
  const openEdit = (asset) => {
    setEditingAsset(asset);
    setForm({
      name: asset.name || "", code: asset.code || "", category: asset.category || "",
      description: asset.description || "",
      purchaseDate: asset.purchaseDate ? asset.purchaseDate.split("T")[0] : "",
      purchaseCost: String(asset.purchaseCost || ""),
      residualValue: String(asset.residualValue || ""),
      depreciationMethod: asset.depreciationMethod || "straight_line",
      usefulLifeYears: String(asset.usefulLifeYears || "5"),
      depreciationRate: String(asset.depreciationRate || "20"),
      assetAccount: String(asset.assetAccount?._id || asset.assetAccount || ""),
      depreciationExpenseAccount: String(asset.depreciationExpenseAccount?._id || asset.depreciationExpenseAccount || ""),
      accumulatedDepreciationAccount: String(asset.accumulatedDepreciationAccount?._id || asset.accumulatedDepreciationAccount || ""),
    });
    setFormError(""); setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingAsset(null); };
  const fc = (field, value) => setForm((p) => ({ ...p, [field]: value }));

  const handleSave = async () => {
    setFormError("");
    if (!form.name.trim()) return setFormError("Asset name is required.");
    if (!form.purchaseDate) return setFormError("Purchase date is required.");
    if (Number(form.purchaseCost) <= 0) return setFormError("Purchase cost must be greater than zero.");
    if (!form.assetAccount) return setFormError("Asset GL account is required.");
    if (form.depreciationMethod !== "none" && !form.depreciationExpenseAccount)
      return setFormError("Depreciation expense account is required.");
    if (form.depreciationMethod !== "none" && !form.accumulatedDepreciationAccount)
      return setFormError("Accumulated depreciation account is required.");

    setSaving(true);
    try {
      const payload = {
        business: businessId,
        name: form.name.trim(), code: form.code.trim(),
        category: form.category.trim(), description: form.description,
        purchaseDate: form.purchaseDate,
        purchaseCost: Number(form.purchaseCost),
        residualValue: Number(form.residualValue || 0),
        depreciationMethod: form.depreciationMethod,
        usefulLifeYears: Number(form.usefulLifeYears || 5),
        depreciationRate: Number(form.depreciationRate || 0),
        assetAccount: form.assetAccount,
        depreciationExpenseAccount: form.depreciationExpenseAccount || form.assetAccount,
        accumulatedDepreciationAccount: form.accumulatedDepreciationAccount || form.assetAccount,
      };
      if (editingAsset) {
        await updateFixedAsset(editingAsset._id, payload);
        toast.success("Asset updated");
      } else {
        await createFixedAsset(payload);
        toast.success("Asset created");
      }
      closeForm();
      fetchedRef.current = false;
      await load();
    } catch (err) {
      setFormError(err?.response?.data?.message || "Failed to save asset.");
    } finally {
      setSaving(false);
    }
  };

  // ── Disposal ────────────────────────────────────────────────────────────────
  const openDispose = (asset) => {
    setDisposeTarget(asset);
    setDisposeForm({ disposalDate: "", disposalProceeds: "", disposalNotes: "" });
  };
  const handleDispose = async () => {
    if (!disposeTarget) return;
    setDisposing(true);
    try {
      await disposeFixedAsset(disposeTarget._id, {
        business: businessId,
        disposalDate: disposeForm.disposalDate || new Date().toISOString().split("T")[0],
        disposalProceeds: Number(disposeForm.disposalProceeds || 0),
        disposalNotes: disposeForm.disposalNotes,
      });
      toast.success("Asset disposed and GL entries posted");
      setDisposeTarget(null);
      fetchedRef.current = false;
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Disposal failed.");
    } finally {
      setDisposing(false);
    }
  };

  // ── Account options ─────────────────────────────────────────────────────────
  const accountOptions = useMemo(
    () => accounts.map((a) => ({
      value: a._id,
      label: `${a.code ? `${a.code} — ` : ""}${a.name}`,
    })),
    [accounts]
  );

  // ── Monthly dep preview ─────────────────────────────────────────────────────
  const previewMonthly = useMemo(() => {
    if (!form.purchaseCost) return null;
    const cost = Number(form.purchaseCost); const residual = Number(form.residualValue || 0);
    if (form.depreciationMethod === "straight_line") {
      const yrs = Number(form.usefulLifeYears || 0);
      return yrs > 0 ? Math.max(0, (cost - residual) / yrs / 12) : null;
    }
    if (form.depreciationMethod === "reducing_balance") {
      const rate = Number(form.depreciationRate || 0);
      return rate > 0 ? (cost * rate) / 100 / 12 : null;
    }
    return null;
  }, [form.purchaseCost, form.residualValue, form.depreciationMethod, form.usefulLifeYears, form.depreciationRate]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

        {/* ── Toolbar ── */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-gray-50/95 px-4 py-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Asset Register</p>

          <div className="mx-1 h-4 w-px bg-slate-200" />

          {/* Filters */}
          <AppSelect
            size="sm"
            clearable
            placeholder="All Statuses"
            value={filterStatus}
            onChange={(v) => setFilterStatus(v ?? "")}
            options={[
              { value: "active", label: "Active" },
              { value: "fully_depreciated", label: "Fully Depreciated" },
              { value: "disposed", label: "Disposed" },
            ]}
          />

          <AppSelect
            size="sm"
            clearable
            placeholder="All Categories"
            value={filterCategory}
            onChange={(v) => setFilterCategory(v ?? "")}
            options={CATEGORY_OPTIONS}
          />

          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or code…"
            className="h-7 w-44 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
          />

          {/* Summary pills */}
          <div className="mx-1 h-4 w-px bg-slate-200" />
          <span className="text-[10px] font-semibold text-slate-400">
            {totals.count} active · BV KES {fmt(totals.bookValue)}
          </span>

          <div className="flex-1" />

          <button
            onClick={openAdd}
            className="flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white"
            style={{ backgroundColor: GRN }}
          >
            <FaPlus size={9} /> New Asset
          </button>
          <button
            onClick={() => { fetchedRef.current = false; load(); }}
            disabled={loading}
            className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <FaSyncAlt size={10} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* ── Add / Edit form panel ── */}
        {showForm && (
          <div className="shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50 px-4 py-3 max-h-[55vh]">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                {editingAsset ? "Edit Asset" : "New Fixed Asset"}
              </p>
              <button onClick={closeForm} className="text-slate-400 hover:text-slate-600">
                <FaTimes size={12} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
              {/* Row 1 */}
              <div className="col-span-2 sm:col-span-1">
                <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Asset Name *</label>
                <input value={form.name} onChange={(e) => fc("name", e.target.value)} placeholder="e.g. Dell Laptop"
                  className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              </div>
              <div>
                <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Code</label>
                <input value={form.code} onChange={(e) => fc("code", e.target.value)} placeholder="FA-001"
                  className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              </div>
              <div>
                <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Category</label>
                <AppSelect
                  size="sm"
                  clearable
                  placeholder="Select…"
                  value={form.category}
                  onChange={(v) => fc("category", v ?? "")}
                  options={CATEGORY_OPTIONS}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Purchase Date *</label>
                <input type="date" value={form.purchaseDate} onChange={(e) => fc("purchaseDate", e.target.value)}
                  className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              </div>

              {/* Row 2 */}
              <div>
                <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Cost (KES) *</label>
                <input type="number" value={form.purchaseCost} onChange={(e) => fc("purchaseCost", e.target.value)} placeholder="0.00" min="0"
                  className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              </div>
              <div>
                <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Residual (KES)</label>
                <input type="number" value={form.residualValue} onChange={(e) => fc("residualValue", e.target.value)} placeholder="0.00" min="0"
                  className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
              </div>
              <div>
                <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Dep. Method</label>
                <AppSelect
                  size="sm"
                  value={form.depreciationMethod}
                  onChange={(v) => fc("depreciationMethod", v ?? "straight_line")}
                  options={METHODS.map((m) => ({ value: m.value, label: m.label }))}
                />
              </div>

              {form.depreciationMethod === "straight_line" && (
                <div>
                  <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">
                    Useful Life (yrs)
                    {previewMonthly !== null && <span className="ml-1 font-normal text-slate-400 normal-case">· KES {fmt(previewMonthly)}/mo</span>}
                  </label>
                  <input type="number" value={form.usefulLifeYears} onChange={(e) => fc("usefulLifeYears", e.target.value)} min="1"
                    className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                </div>
              )}
              {form.depreciationMethod === "reducing_balance" && (
                <div>
                  <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">
                    Annual Rate (%)
                    {previewMonthly !== null && <span className="ml-1 font-normal text-slate-400 normal-case">· KES {fmt(previewMonthly)}/mo</span>}
                  </label>
                  <input type="number" value={form.depreciationRate} onChange={(e) => fc("depreciationRate", e.target.value)} min="0" max="100"
                    className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                </div>
              )}
            </div>

            {/* GL Accounts */}
            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">GL Account Mapping</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Asset Account *</label>
                  <AppSelect
                    size="sm"
                    searchable
                    placeholder="Select account…"
                    value={form.assetAccount}
                    onChange={(v) => fc("assetAccount", v ?? "")}
                    options={accountOptions}
                  />
                </div>
                {form.depreciationMethod !== "none" && (
                  <>
                    <div>
                      <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Dep. Expense Account *</label>
                      <AppSelect
                        size="sm"
                        searchable
                        placeholder="Select account…"
                        value={form.depreciationExpenseAccount}
                        onChange={(v) => fc("depreciationExpenseAccount", v ?? "")}
                        options={accountOptions}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Accum. Dep. Account *</label>
                      <AppSelect
                        size="sm"
                        searchable
                        placeholder="Select account…"
                        value={form.accumulatedDepreciationAccount}
                        onChange={(v) => fc("accumulatedDepreciationAccount", v ?? "")}
                        options={accountOptions}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {formError && (
              <p className="mt-2 text-xs font-medium text-red-600">{formError}</p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button onClick={handleSave} disabled={saving}
                className="flex h-7 items-center gap-1.5 rounded px-4 text-xs font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: GRN }}>
                {saving ? <FaSyncAlt size={9} className="animate-spin" /> : null}
                {saving ? "Saving…" : editingAsset ? "Update Asset" : "Create Asset"}
              </button>
              <button onClick={closeForm}
                className="flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Table ── */}
        <div className="flex-1 overflow-auto">
          {loading && !assets.length ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-slate-400">
              <FaSyncAlt size={12} className="animate-spin" /> Loading…
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
              <FaTools size={22} className="opacity-25" />
              <p className="text-xs font-semibold">No assets found</p>
              {!filterStatus && !filterCategory && !search && (
                <button onClick={openAdd} className="mt-1 text-xs font-bold hover:underline" style={{ color: GRN }}>
                  + Add your first asset
                </button>
              )}
            </div>
          ) : (
            <table className="min-w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Code</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Asset Name</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Category</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Method</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Cost (KES)</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Acc. Dep. (KES)</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Book Value (KES)</th>
                  <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Last Dep.</th>
                  <th className="px-3 py-1 font-bold" />
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((asset, idx) => (
                  <tr key={asset._id} className={`border-b border-gray-100 ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                    <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-400">{asset.code || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{asset.name}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{asset.category || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{methodLabel(asset.depreciationMethod)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-slate-700">{fmt(asset.purchaseCost)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-mono text-rose-500">{fmt(asset.accumulatedDepreciation)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-semibold" style={{ color: GRN }}>{fmt(asset.bookValue)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-center">{statusPill(asset.status)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-400">
                      {asset.lastDepreciationDate
                        ? new Date(asset.lastDepreciationDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </td>
                    <td className="px-3 py-1">
                      <div className="flex items-center justify-end gap-2">
                        {asset.status !== "disposed" && (
                          <button onClick={() => openEdit(asset)} className="text-slate-300 hover:text-slate-600" title="Edit">
                            <FaEdit size={12} />
                          </button>
                        )}
                        {asset.status === "active" && (
                          <button onClick={() => openDispose(asset)} className="text-slate-300 hover:text-red-500" title="Dispose">
                            <FaTrash size={11} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500">
                  <td colSpan={4} className="px-4 py-2">Filtered total · {filteredAssets.length} rows</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {fmt(filteredAssets.reduce((s, a) => s + Number(a.purchaseCost || 0), 0))}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-rose-500">
                    {fmt(filteredAssets.reduce((s, a) => s + Number(a.accumulatedDepreciation || 0), 0))}
                  </td>
                  <td className="px-4 py-2 text-right font-mono" style={{ color: GRN }}>
                    {fmt(filteredAssets.reduce((s, a) => s + Number(a.bookValue || 0), 0))}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* ── Dispose Modal ─────────────────────────────────────────────────────── */}
      {disposeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <p className="text-sm font-black text-slate-800">Dispose Asset</p>
              <button onClick={() => setDisposeTarget(null)} className="text-slate-400 hover:text-slate-700">
                <FaTimes size={13} />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <div className="rounded-lg bg-red-50 px-4 py-3">
                <p className="text-xs font-bold text-red-700">{disposeTarget.name}</p>
                <p className="mt-0.5 text-[11px] text-red-500">
                  Book value: KES {fmt(disposeTarget.bookValue)} — posts clearing GL entries. Cannot be undone.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Disposal Date</label>
                  <input type="date" value={disposeForm.disposalDate}
                    onChange={(e) => setDisposeForm((p) => ({ ...p, disposalDate: e.target.value }))}
                    className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-red-400" />
                </div>
                <div>
                  <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Proceeds (KES)</label>
                  <input type="number" value={disposeForm.disposalProceeds} min="0" placeholder="0.00"
                    onChange={(e) => setDisposeForm((p) => ({ ...p, disposalProceeds: e.target.value }))}
                    className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-red-400" />
                </div>
              </div>
              <div>
                <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Notes</label>
                <input value={disposeForm.disposalNotes}
                  onChange={(e) => setDisposeForm((p) => ({ ...p, disposalNotes: e.target.value }))}
                  placeholder="Reason for disposal…"
                  className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-red-400" />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button onClick={() => setDisposeTarget(null)}
                  className="flex h-7 items-center rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={handleDispose} disabled={disposing}
                  className="flex h-7 items-center gap-1.5 rounded bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                  {disposing ? <FaSyncAlt size={9} className="animate-spin" /> : null}
                  {disposing ? "Disposing…" : "Confirm Disposal"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default FixedAssets;
