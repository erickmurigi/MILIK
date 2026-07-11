import React, { useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { toast } from "react-toastify";
import { FaEdit, FaPlus, FaRedoAlt, FaSave, FaSearch, FaTrash, FaTimes } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { updateCompany } from "../../redux/apiCalls";
import { useConfirm } from "../../context/ConfirmContext";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";

const DEFAULT_UNIT_TYPES = ["studio", "1bed", "2bed", "3bed", "4bed", "commercial"];

const formatUnitTypeLabel = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const lower = raw.toLowerCase();
  const legacyLabels = {
    studio: "Studio",
    "1bed": "1 Bedroom",
    "2bed": "2 Bedrooms",
    "3bed": "3 Bedrooms",
    "4bed": "4 Bedrooms",
    commercial: "Commercial",
    residential: "Residential",
    utility: "Utility",
    "mixed use": "Mixed Use",
    mixed_use: "Mixed Use",
  };

  if (legacyLabels[lower]) return legacyLabels[lower];

  return raw
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

const sanitizeUnitTypes = (value = []) => {
  const items = Array.isArray(value) ? value : [value];
  const normalized = Array.from(
    new Set(
      items
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .map((item) => item.slice(0, 80))
    )
  );

  return normalized.length ? normalized : [...DEFAULT_UNIT_TYPES];
};

const UnitTypesPage = () => {
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const currentCompany = useSelector(selectCurrentCompany);
  const isSavingCompany = useSelector((state) => state.company?.isFetching);

  const [search, setSearch] = useTabState("/units/space-types:search", "");
  const [draftValue, setDraftValue] = useState("");
  const [editingValue, setEditingValue] = useState("");
  const [formError, setFormError] = useState("");

  const unitTypes = useMemo(
    () => sanitizeUnitTypes(currentCompany?.unitTypes),
    [currentCompany?.unitTypes]
  );

  const filteredTypes = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    if (!query) return unitTypes;
    return unitTypes.filter((item) => {
      const raw = String(item || "").toLowerCase();
      const label = formatUnitTypeLabel(item).toLowerCase();
      return raw.includes(query) || label.includes(query);
    });
  }, [search, unitTypes]);


  const persistTypes = async (nextTypes, successMessage) => {
    if (!currentCompany?._id) {
      toast.error("No active company selected.");
      return false;
    }

    try {
      await dispatch(updateCompany(currentCompany._id, { unitTypes: nextTypes }));
      toast.success(successMessage);
      return true;
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          error?.message ||
          "Failed to update unit types."
      );
      return false;
    }
  };

  const resetForm = () => {
    setDraftValue("");
    setEditingValue("");
    setFormError("");
  };

  const handleSave = async () => {
    const normalized = String(draftValue || "").trim();
    if (!normalized) {
      setFormError("Unit type is required.");
      return;
    }

    const duplicateExists = unitTypes.some(
      (item) =>
        item.toLowerCase() === normalized.toLowerCase() &&
        item.toLowerCase() !== String(editingValue || "").trim().toLowerCase()
    );

    if (duplicateExists) {
      setFormError("That unit type already exists for this company.");
      return;
    }

    const nextTypes = editingValue
      ? unitTypes.map((item) =>
          item.toLowerCase() === editingValue.toLowerCase() ? normalized : item
        )
      : [...unitTypes, normalized];

    const saved = await persistTypes(sanitizeUnitTypes(nextTypes), editingValue ? "Unit type updated successfully." : "Unit type added successfully.");
    if (saved) resetForm();
  };

  const handleEdit = (value) => {
    setEditingValue(value);
    setDraftValue(value);
    setFormError("");
  };

  const handleDelete = async (value) => {
    if (unitTypes.length <= 1) {
      toast.error("At least one unit type must remain configured.");
      return;
    }

    const confirmed = await confirm({ title: "Remove Unit Type", message: `Remove ${formatUnitTypeLabel(value)} from this company?`, confirmText: "Remove", isDangerous: true });
    if (!confirmed) return;

    const nextTypes = unitTypes.filter((item) => item !== value);
    const saved = await persistTypes(nextTypes, "Unit type removed successfully.");
    if (saved && String(editingValue || "").toLowerCase() === String(value || "").toLowerCase()) {
      resetForm();
    }
  };

  const handleRestoreDefaults = async () => {
    const confirmed = await confirm({ title: "Restore Defaults", message: "Restore the default MILIK unit types for this company? Your current types will be replaced.", confirmText: "Restore" });
    if (!confirmed) return;
    const saved = await persistTypes([...DEFAULT_UNIT_TYPES], "Default unit types restored.");
    if (saved) resetForm();
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50 p-0">
        <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
          <div className="filter-bar flex items-center gap-1.5 overflow-x-auto px-2 py-1.5">
            <div className="h-7 shrink-0 flex items-center gap-2 rounded border border-slate-200 bg-white px-2 text-xs text-gray-800">
              <FaSearch size={10} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search unit type" className="w-36 bg-transparent text-xs outline-none" />
            </div>
            <button onClick={() => setSearch("")} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs text-white shadow-sm ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaRedoAlt size={10} /> Reset</button>
            <button onClick={handleRestoreDefaults} className={`h-7 shrink-0 flex items-center gap-1 rounded px-2.5 text-xs text-white shadow-sm ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}><FaRedoAlt size={10} /> Restore Defaults</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          <div className="grid min-h-full grid-cols-1 gap-3 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h1 className="text-xl font-black tracking-tight text-gray-900">Unit Types</h1>
                    <p className="mt-1 text-sm text-gray-600">
                      Manage the list of unit types this company uses. These values feed the <span className="font-semibold text-[#0B3B2E]">Unit Type</span> dropdown when adding or editing units.
                    </p>
                  </div>
                  <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                    {unitTypes.length} configured
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-[11px] border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Saved Value</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Display Name</th>
                      <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                      <th className="px-3 py-1 text-right font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTypes.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500">
                          No unit types match your search.
                        </td>
                      </tr>
                    ) : (
                      filteredTypes.map((item, idx) => {
                        const isEditing = String(editingValue || "").toLowerCase() === String(item || "").toLowerCase();
                        return (
                          <tr key={item} className={`border-b border-gray-100 ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                            <td className="px-3 py-1 border-r border-gray-100 font-semibold text-gray-900">{item}</td>
                            <td className="px-3 py-1 border-r border-gray-100 text-gray-700">{formatUnitTypeLabel(item)}</td>
                            <td className="px-3 py-1 border-r border-gray-100">
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                Active
                              </span>
                            </td>
                            <td className="px-3 py-1">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleEdit(item)}
                                  className="inline-flex items-center gap-2 rounded-md border border-[#0B3B2E]/15 bg-[#0B3B2E]/5 px-3 py-1.5 text-xs font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E]/10"
                                  title="Edit unit type"
                                >
                                  <FaEdit />
                                  {isEditing ? "Editing" : "Edit"}
                                </button>
                                <button
                                  onClick={() => handleDelete(item)}
                                  className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-100"
                                  title="Delete unit type"
                                >
                                  <FaTrash /> Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 px-4 py-3">
                <h2 className="text-base font-black tracking-tight text-gray-900">
                  {editingValue ? "Edit Unit Type" : "Add Unit Type"}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Keep the wording simple and consistent so property managers pick the right type quickly.
                </p>
              </div>

              <div className="space-y-4 p-4">
                <div>
                  <label className="mb-0.5 block text-xs font-semibold text-slate-700">Unit type value <span className="text-red-500">*</span></label>
                  <input
                    value={draftValue}
                    onChange={(e) => { setDraftValue(e.target.value); if (formError) setFormError(""); }}
                    placeholder="e.g. Studio, 1bed, Shop, Office"
                    className={`w-full rounded border px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 ${formError ? "border-red-400" : "border-slate-200"}`}
                  />
                  {formError ? <p className="mt-1 text-xs font-semibold text-red-600">{formError}</p> : null}
                  <p className="mt-2 text-xs text-gray-500">
                    Saved value: <span className="font-semibold text-gray-700">{draftValue.trim() || "—"}</span>
                    {draftValue.trim() ? (
                      <>
                        {" "}• Display label: <span className="font-semibold text-gray-700">{formatUnitTypeLabel(draftValue)}</span>
                      </>
                    ) : null}
                  </p>
                </div>

                <div className="rounded-lg border border-orange-100 bg-orange-50 p-3 text-xs leading-5 text-orange-900">
                  These company-specific unit types are used in the unit creation form. They do not change rent, receipts, accounting, or existing posted transactions.
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={handleSave}
                    disabled={isSavingCompany}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60 ${MILIK_GREEN}`}
                  >
                    {editingValue ? <FaSave /> : <FaPlus />}
                    {editingValue ? "Update Unit Type" : "Add Unit Type"}
                  </button>
                  <button
                    onClick={resetForm}
                    disabled={isSavingCompany}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <FaTimes /> Clear
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default UnitTypesPage;
