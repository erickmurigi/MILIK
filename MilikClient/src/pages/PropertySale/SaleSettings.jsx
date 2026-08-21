import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  FaCog, FaFilter, FaHandshake, FaHome, FaMoneyBillWave,
  FaPlus, FaSave, FaTimes,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { adminRequests } from "../../utils/requestMethods";
import PropertySaleShell from "./PropertySaleShell";
import Modal from "../../components/common/Modal";
import Spinner from "../../components/common/Spinner";
import { inputClass, labelClass } from "../../utils/formStyles";
import AppSelect from "../../components/common/AppSelect";

const GRN = "#0B3B2E";

const SIDEBAR_GROUPS = [
  {
    label: "Pipeline & CRM",
    items: [
      { key: "pipelineStages", label: "Pipeline Stages",  icon: FaHandshake, endpoint: "pipeline-stages" },
      { key: "leadSources",    label: "Lead Sources",      icon: FaFilter,     endpoint: "lead-sources"    },
    ],
  },
  {
    label: "Listings",
    items: [
      { key: "propertyTypes",  label: "Property Types",    icon: FaHome,       endpoint: "property-types"  },
    ],
  },
  {
    label: "Commissions",
    items: [
      { key: "commissionDefaults", label: "Commission Defaults", icon: FaMoneyBillWave, endpoint: null },
    ],
  },
];

const ALL_TABS = SIDEBAR_GROUPS.flatMap((g) => g.items);
const COLLECTION_TABS = ALL_TABS.filter((t) => t.endpoint);

const COLUMNS = {
  pipelineStages: ["#", "Stage Name", "Status", "Actions"],
  leadSources:    ["Stage Name", "Status", "Actions"],
  propertyTypes:  ["Type Name", "Status", "Actions"],
};

const emptyForms = {
  pipelineStages: { name: "" },
  leadSources:    { name: "" },
  propertyTypes:  { name: "" },
};

export default function SaleSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "pipelineStages";
  const setTab = (key) => setSearchParams({ tab: key });

  const [settings, setSettings]       = useState(null);
  const [loading, setLoading]         = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  const [showModal, setShowModal]   = useState(false);
  const [editingId, setEditingId]   = useState(null);
  const [modalTab, setModalTab]     = useState("pipelineStages");
  const [formData, setFormData]     = useState({ name: "" });
  const [saving, setSaving]         = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);

  const [commDefaults, setCommDefaults] = useState({ rate: 3, commissionType: "percentage", whtRate: 5 });
  const [savingComm, setSavingComm] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const res = await adminRequests.get("/sale/settings");
      const s = res?.data?.settings;
      setSettings(s);
      if (s?.commissionDefaults) {
        setCommDefaults({
          rate:           s.commissionDefaults.rate           ?? 3,
          commissionType: s.commissionDefaults.commissionType ?? "percentage",
          whtRate:        s.commissionDefaults.whtRate        ?? 5,
        });
      }
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const collectionData = (key) => settings?.[key] || [];
  const visibleItems = (key) => {
    const items = collectionData(key);
    const sorted = key === "pipelineStages" ? [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : items;
    return showInactive ? sorted : sorted.filter((i) => i?.isActive !== false);
  };

  const openCreate = (key) => { setModalTab(key); setEditingId(null); setFormData({ ...emptyForms[key] }); setShowModal(true); };
  const openEdit   = (key, item) => {
    setModalTab(key);
    setEditingId(item._id);
    setFormData({ name: item.name || "" });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingId(null); };

  const saveItem = async () => {
    const tab = ALL_TABS.find((t) => t.key === modalTab);
    if (!tab?.endpoint) return;
    if (!String(formData.name || "").trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (editingId) {
        await adminRequests.put(`/sale/settings/${tab.endpoint}/${editingId}`, formData);
      } else {
        await adminRequests.post(`/sale/settings/${tab.endpoint}`, formData);
      }
      toast.success(editingId ? "Updated" : "Added");
      closeModal();
      await loadSettings();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (key, item) => {
    const tab = ALL_TABS.find((t) => t.key === key);
    if (!tab?.endpoint) return;
    try {
      await adminRequests.put(`/sale/settings/${tab.endpoint}/${item._id}`, { isActive: !item.isActive });
      await loadSettings();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update");
    }
  };

  const archiveItem = async (key, item) => {
    const tab = ALL_TABS.find((t) => t.key === key);
    if (!tab?.endpoint) return;
    try {
      await adminRequests.delete(`/sale/settings/${tab.endpoint}/${item._id}`);
      toast.success("Archived");
      await loadSettings();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to archive");
    }
  };

  const handleLoadDefaults = async (key) => {
    const tab = ALL_TABS.find((t) => t.key === key);
    if (!tab?.endpoint || loadingDefaults) return;
    setLoadingDefaults(true);
    try {
      await adminRequests.post(`/sale/settings/load-defaults/${tab.endpoint}`);
      toast.success("Defaults loaded");
      await loadSettings();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load defaults");
    } finally {
      setLoadingDefaults(false);
    }
  };

  const saveCommDefaults = async () => {
    setSavingComm(true);
    try {
      await adminRequests.put("/sale/settings/commission-defaults", commDefaults);
      toast.success("Commission defaults saved");
      await loadSettings();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save");
    } finally {
      setSavingComm(false);
    }
  };

  const tabCfg = ALL_TABS.find((t) => t.key === activeTab);

  const renderCollectionTab = (key) => {
    const items = visibleItems(key);
    const all   = collectionData(key);
    const active   = all.filter((i) => i?.isActive !== false).length;
    const archived = all.length - active;
    const cols = COLUMNS[key] || [];
    const isEmpty = all.length === 0;

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* toolbar */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">{active} active · {archived} archived</span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-3.5 w-3.5" />
              Show archived
            </label>
          </div>
          <div className="flex items-center gap-2">
            {isEmpty && (
              <button
                onClick={() => handleLoadDefaults(key)}
                disabled={loadingDefaults}
                className="inline-flex items-center gap-1.5 border border-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#EDF5F1] disabled:opacity-50"
              >
                {loadingDefaults ? <Spinner size="sm" /> : null} Load Defaults
              </button>
            )}
            <button onClick={() => openCreate(key)} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127]">
              <FaPlus className="text-[10px]" /> Add
            </button>
          </div>
        </div>

        {/* table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {items.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">
              {isEmpty ? "No items yet. Click Load Defaults or Add." : "No active items."}
            </div>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  {cols.map((h, i, arr) => (
                    <th key={h} className={`px-3 py-1.5 text-left font-bold ${i < arr.length - 1 ? "border-r border-white/10" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const isActive = item?.isActive !== false;
                  return (
                    <tr key={item._id} className={`border-b border-gray-100 uppercase ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                      {key === "pipelineStages" && <td className="w-8 px-3 py-1 border-r border-gray-100 text-center text-slate-400 font-bold">{(item.order ?? idx) + 1}</td>}
                      <td className="px-3 py-1 border-r border-gray-100 font-medium text-slate-900">{item.name}</td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${isActive ? "border-emerald-200 bg-emerald-100 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                          {isActive ? "Active" : "Archived"}
                        </span>
                      </td>
                      <td className="px-3 py-1">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(key, item)} className="rounded px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100">Edit</button>
                          <button
                            onClick={() => toggleStatus(key, item)}
                            className={`rounded px-2 py-1 text-[10px] font-bold ${isActive ? "text-amber-600 hover:bg-amber-50" : "text-emerald-600 hover:bg-emerald-50"}`}
                          >
                            {isActive ? "Disable" : "Reactivate"}
                          </button>
                          {isActive && (
                            <button onClick={() => archiveItem(key, item)} className="rounded px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-50">Archive</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderCommissionTab = () => (
    <div className="flex-1 overflow-auto px-4 py-6">
      <div className="max-w-md space-y-5">
        <div>
          <p className="mb-4 text-[11px] text-slate-500">
            These defaults pre-fill when creating a new agent. Each agent can be overridden individually.
          </p>
        </div>
        <div>
          <label className={labelClass}>Default Commission Rate (%)</label>
          <input
            type="number" min="0" step="0.01"
            className={inputClass}
            value={commDefaults.rate}
            onChange={(e) => setCommDefaults((p) => ({ ...p, rate: e.target.value }))}
          />
        </div>
        <AppSelect
          label="Default Commission Type"
          value={commDefaults.commissionType}
          onChange={(v) => setCommDefaults((p) => ({ ...p, commissionType: v ?? "percentage" }))}
          options={[
            { value: "percentage", label: "Percentage of sale price" },
            { value: "flat",       label: "Flat amount" },
          ]}
          size="md"
        />
        <div>
          <label className={labelClass}>Default WHT Rate (%)</label>
          <input
            type="number" min="0" max="100" step="0.01"
            className={inputClass}
            value={commDefaults.whtRate}
            onChange={(e) => setCommDefaults((p) => ({ ...p, whtRate: e.target.value }))}
          />
          <p className="mt-1 text-[10px] text-slate-400">Withholding tax deducted from commission payouts (Kenya statutory rate: 5%).</p>
        </div>
        <div>
          <button onClick={saveCommDefaults} disabled={savingComm} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
            {savingComm ? <Spinner size="sm" /> : <FaSave />} Save Defaults
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <PropertySaleShell title="Operational Settings">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">

        {/* Dark header */}
        <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <FaCog className="text-sm text-[#B7C9C0]" />
            <div>
              <h1 className="text-[12px] font-bold uppercase tracking-wide text-white">Property Sales — Operational Settings</h1>
              <p className="mt-0.5 text-[10px] text-[#B7C9C0]">Reusable defaults — changes do not affect existing deals or posted financials.</p>
            </div>
          </div>
        </div>

        {/* Sidebar + content */}
        <div className="flex min-h-0 flex-1 overflow-hidden">

          {/* Sidebar */}
          <div className="w-48 flex-shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50">
            {SIDEBAR_GROUPS.map((group) => (
              <div key={group.label} className="py-2">
                <p className="px-3 pb-1 pt-0.5 text-[9px] font-black uppercase tracking-widest text-slate-400">{group.label}</p>
                {group.items.map(({ key, label, icon: Icon }) => {
                  const isActive = key === activeTab;
                  const count = key !== "commissionDefaults"
                    ? collectionData(key).filter((i) => i?.isActive !== false).length
                    : null;
                  return (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-bold transition ${
                        isActive ? "bg-[#0B3B2E] text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                      }`}
                    >
                      <Icon size={10} className="shrink-0" />
                      <span className="flex-1 truncate">{label}</span>
                      {count != null && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${isActive ? "bg-white/20 text-white" : "bg-slate-200 text-slate-500"}`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {loading ? (
              <div className="flex h-40 items-center justify-center gap-2 text-sm text-slate-500">
                <Spinner size="sm" /> Loading…
              </div>
            ) : activeTab === "commissionDefaults" ? (
              renderCommissionTab()
            ) : (
              renderCollectionTab(activeTab)
            )}
          </div>

        </div>
      </div>

      {/* Add/Edit modal */}
      {showModal && (
        <Modal
          onClose={closeModal}
          title={editingId ? `Edit ${tabCfg?.label}` : `Add ${tabCfg?.label}`}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={closeModal} className="inline-flex items-center gap-1.5 border border-slate-300 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                <FaTimes /> Cancel
              </button>
              <button onClick={saveItem} disabled={saving} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
                {saving ? <Spinner size="sm" /> : <FaSave />}
                {saving ? "Saving…" : editingId ? "Update" : "Save"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Name *</label>
              <input
                className={inputClass}
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                autoFocus
              />
            </div>
          </div>
        </Modal>
      )}
    </PropertySaleShell>
  );
}
