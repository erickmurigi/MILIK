import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaEdit, FaPlus, FaSyncAlt, FaTimes, FaTrash,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import ListToolbar from "../../components/common/ListToolbar";
import MilikTable from "../../components/common/MilikTable";
import StatusBadge from "../../components/common/StatusBadge";
import CurrencyInput from "../../components/common/CurrencyInput";
import {
  getFixedAssets, createFixedAsset, updateFixedAsset,
  disposeFixedAsset,
} from "../../redux/apiCalls";
import { getCachedChartOfAccounts } from "../../utils/chartOfAccountsCache";

const GRN = "#0B3B2E";
const labelCls = "mb-1 block text-xs font-bold text-slate-900";
const inputCls = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition border-slate-300 focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

const METHODS = [
  { value: "straight_line",    label: "Straight Line" },
  { value: "reducing_balance", label: "Reducing Balance" },
  { value: "none",             label: "No Depreciation" },
];
const CATEGORIES = ["Furniture", "Equipment", "Vehicles", "Buildings", "Land", "Computers & IT", "Other"];
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c }));

const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ASSET_STATUS_MAP = {
  active:            "border-emerald-200 bg-emerald-50 text-emerald-700",
  disposed:          "border-red-200 bg-red-50 text-red-600",
  fully_depreciated: "border-slate-200 bg-slate-100 text-slate-500",
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
        getCachedChartOfAccounts(businessId),
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
        <ListToolbar>
          <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
            Active: {totals.count}
          </span>
          <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
            Book Value: KES {fmt(totals.bookValue)}
          </span>

          <ListToolbar.Divider />

          {/* Filters */}
          <AppSelect
            compact
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
            compact
            clearable
            placeholder="All Categories"
            value={filterCategory}
            onChange={(v) => setFilterCategory(v ?? "")}
            options={CATEGORY_OPTIONS}
          />

          <ListToolbar.Input
            width="w-44"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or code…"
          />

          <div className="flex-1" />

          <ListToolbar.Button icon={FaPlus} onClick={openAdd}>
            New Asset
          </ListToolbar.Button>
          <ListToolbar.Button
            variant="outline"
            disabled={loading}
            onClick={() => { fetchedRef.current = false; load(); }}
          >
            <FaSyncAlt size={7} className={loading ? "animate-spin" : ""} />
          </ListToolbar.Button>
        </ListToolbar>

        {/* ── Table + side form panel ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <MilikTable
              columns={[
                { label: "Code" },
                { label: "Asset Name" },
                { label: "Category" },
                { label: "Purchase Date" },
                { label: "Cost (KES)", align: "right" },
                { label: "Acc. Dep. (KES)", align: "right" },
                { label: "Book Value (KES)", align: "right" },
                { label: "Status", align: "center" },
                { label: "Last Dep." },
              ]}
              rows={filteredAssets}
              rowKey="_id"
              loading={loading && !assets.length}
              empty="No assets found"
              renderFooter={filteredAssets.length > 0 ? () => (
                <>
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
                  <td colSpan={2} />
                </>
              ) : undefined}
              renderActions={(asset) => (
                <div className="flex items-center justify-end gap-2">
                  {asset.status !== "disposed" && (
                    <button onClick={() => openEdit(asset)} className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Edit">
                      <FaEdit size={12} />
                    </button>
                  )}
                  {asset.status === "active" && (
                    <button onClick={() => openDispose(asset)} className="p-1 text-red-600 hover:bg-red-50 hover:text-red-800" title="Dispose">
                      <FaTrash size={11} />
                    </button>
                  )}
                </div>
              )}
              renderRow={(asset) => (
                <>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-bold text-[#0B3B2E]">{asset.code || "—"}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-800">{asset.name}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">{asset.category || "—"}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">
                    {asset.purchaseDate
                      ? new Date(asset.purchaseDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono text-slate-700">{fmt(asset.purchaseCost)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono text-rose-500">{fmt(asset.accumulatedDepreciation)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-semibold" style={{ color: GRN }}>{fmt(asset.bookValue)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-center"><StatusBadge status={asset.status} map={ASSET_STATUS_MAP} /></td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-slate-400">
                    {asset.lastDepreciationDate
                      ? new Date(asset.lastDepreciationDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                </>
              )}
            />
          </div>

          {/* ── Add / Edit form side panel ── */}
          {showForm && (
            <div className="w-96 shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden shadow-lg">
              {/* Panel header */}
              <div className="bg-[#0B3B2E] px-4 py-3 shrink-0 flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                    {editingAsset ? "Edit Asset" : "New Asset"}
                  </p>
                  <p className="text-sm font-bold text-white mt-0.5 truncate max-w-[280px]">
                    {editingAsset ? (form.name || "…") : "Fixed Asset Register"}
                  </p>
                </div>
                <button onClick={closeForm} className="text-white/50 hover:text-white mt-0.5">
                  <FaTimes size={14} />
                </button>
              </div>

              {/* Form body */}
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <div className="flex-1 overflow-auto p-4 space-y-4">

                  <div>
                    <label className={labelCls}>Asset Name <span className="text-red-500">*</span></label>
                    <input value={form.name} onChange={(e) => fc("name", e.target.value)} placeholder="e.g. Dell Laptop" autoFocus className={inputCls} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Code</label>
                      <input value={form.code} onChange={(e) => fc("code", e.target.value)} placeholder="FA-001" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Category</label>
                      <AppSelect size="sm" clearable placeholder="Select…" value={form.category} onChange={(v) => fc("category", v ?? "")} options={CATEGORY_OPTIONS} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Purchase Date <span className="text-red-500">*</span></label>
                      <input type="date" value={form.purchaseDate} onChange={(e) => fc("purchaseDate", e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Cost <span className="text-red-500">*</span></label>
                      <CurrencyInput value={form.purchaseCost} onChange={(e) => fc("purchaseCost", e.target.value)} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Residual Value</label>
                      <CurrencyInput value={form.residualValue} onChange={(e) => fc("residualValue", e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Dep. Method</label>
                      <AppSelect size="sm" value={form.depreciationMethod} onChange={(v) => fc("depreciationMethod", v ?? "straight_line")} options={METHODS} />
                    </div>
                  </div>

                  {form.depreciationMethod === "straight_line" && (
                    <div>
                      <label className={labelCls}>
                        Useful Life (yrs)
                        {previewMonthly !== null && <span className="ml-1 font-normal normal-case text-slate-400">· KES {fmt(previewMonthly)}/mo</span>}
                      </label>
                      <input type="number" value={form.usefulLifeYears} onChange={(e) => fc("usefulLifeYears", e.target.value)} min="1" className={inputCls} />
                    </div>
                  )}
                  {form.depreciationMethod === "reducing_balance" && (
                    <div>
                      <label className={labelCls}>
                        Annual Rate (%)
                        {previewMonthly !== null && <span className="ml-1 font-normal normal-case text-slate-400">· KES {fmt(previewMonthly)}/mo</span>}
                      </label>
                      <input type="number" value={form.depreciationRate} onChange={(e) => fc("depreciationRate", e.target.value)} min="0" max="100" className={inputCls} />
                    </div>
                  )}

                  {/* Divider */}
                  <div className="border-t border-slate-100" />

                  {/* GL Accounts */}
                  <div>
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">GL Account Mapping</p>
                    <div className="space-y-3">
                      <div>
                        <label className={labelCls}>Asset Account <span className="text-red-500">*</span></label>
                        <AppSelect size="sm" searchable placeholder="Select account…" value={form.assetAccount} onChange={(v) => fc("assetAccount", v ?? "")} options={accountOptions} />
                      </div>
                      {form.depreciationMethod !== "none" && (
                        <>
                          <div>
                            <label className={labelCls}>Dep. Expense Account <span className="text-red-500">*</span></label>
                            <AppSelect size="sm" searchable placeholder="Select account…" value={form.depreciationExpenseAccount} onChange={(v) => fc("depreciationExpenseAccount", v ?? "")} options={accountOptions} />
                          </div>
                          <div>
                            <label className={labelCls}>Accum. Dep. Account <span className="text-red-500">*</span></label>
                            <AppSelect size="sm" searchable placeholder="Select account…" value={form.accumulatedDepreciationAccount} onChange={(v) => fc("accumulatedDepreciationAccount", v ?? "")} options={accountOptions} />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {formError && (
                    <p className="text-xs font-medium text-red-600">{formError}</p>
                  )}
                </div>

                {/* Form footer */}
                <div className="shrink-0 border-t border-slate-200 px-4 py-3 flex gap-2 bg-slate-50">
                  <button
                    type="button"
                    onClick={closeForm}
                    className="flex-1 h-8 border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 h-8 bg-[#0B3B2E] hover:bg-[#0A3127] text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? "Saving…" : editingAsset ? "Save Changes" : "Create Asset"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Dispose Modal ─────────────────────────────────────────────────────── */}
      {disposeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <p className="text-sm font-black text-slate-800">Dispose Asset</p>
              <button onClick={() => setDisposeTarget(null)} className="text-slate-400 hover:text-slate-700">
                <FaTimes size={13} />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <div className="bg-red-50 px-4 py-3">
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
                    className="h-7 w-full border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-red-400" />
                </div>
                <div>
                  <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Proceeds</label>
                  <CurrencyInput value={disposeForm.disposalProceeds}
                    onChange={(e) => setDisposeForm((p) => ({ ...p, disposalProceeds: e.target.value }))}
                    inputClassName="h-7 w-full border border-slate-200 bg-white pl-9 pr-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-red-400" />
                </div>
              </div>
              <div>
                <label className="mb-0.5 block text-[9px] font-semibold uppercase text-slate-400">Notes</label>
                <input value={disposeForm.disposalNotes}
                  onChange={(e) => setDisposeForm((p) => ({ ...p, disposalNotes: e.target.value }))}
                  placeholder="Reason for disposal…"
                  className="h-7 w-full border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-red-400" />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button onClick={() => setDisposeTarget(null)}
                  className="flex h-7 items-center border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={handleDispose} disabled={disposing}
                  className="flex h-7 items-center gap-1.5 bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
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
