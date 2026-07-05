import React, { useMemo, useState } from "react";
import {
  FaUpload,
  FaCheckCircle,
  FaExclamationTriangle,
  FaSpinner,
  FaTimes,
} from "react-icons/fa";
import { parseTenantsExcel } from "../../utils/excelTemplates";
import { toast } from "react-toastify";

const formatMoney = (value) => {
  const amount = Number(value || 0);
  if (!amount) return "Auto";
  return amount.toLocaleString();
};

const formatUtilities = (utilities = []) => {
  if (!Array.isArray(utilities) || utilities.length === 0) return "Auto";
  return utilities
    .map((item) => {
      const amount = Number(item?.unitCharge || 0);
      const inclusion = item?.isIncluded ? "included" : "charged";
      return `${item?.utilityLabel || item?.utility || "Utility"} (${amount.toLocaleString()} ${inclusion})`;
    })
    .join("; ");
};

const TenantsImportModal = ({ isOpen, onClose, onImport }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [importFailures, setImportFailures] = useState([]);

  const previewRows = useMemo(
    () => (Array.isArray(parseResult?.valid) ? parseResult.valid.slice(0, 5) : []),
    [parseResult]
  );

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setParseResult(null);
    setImportFailures([]);
    setIsUploading(true);

    try {
      const result = await parseTenantsExcel(file);
      setParseResult(result);

      if (result.errorCount > 0) {
        toast.warning(`File parsed with ${result.errorCount} row error(s). Review before importing.`);
      } else {
        toast.success(`Validated ${result.validCount} tenant record(s).`);
      }
    } catch (error) {
      toast.error(error.message || "Failed to parse Excel file");
      setSelectedFile(null);
      setParseResult(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleImport = async () => {
    if (!parseResult || parseResult.validCount === 0) {
      toast.error("No valid tenant records to import");
      return;
    }

    setIsImporting(true);
    setImportFailures([]);

    try {
      const result = await onImport(parseResult.valid);
      const responseData = result?.data || {};
      const successful = Array.isArray(responseData.successful) ? responseData.successful : [];
      const failed = Array.isArray(responseData.failed) ? responseData.failed : [];
      setImportFailures(failed);

      if (successful.length > 0 && failed.length === 0) {
        toast.success(`Successfully imported ${successful.length} tenant(s).`);
        handleClose();
        return;
      }

      if (successful.length > 0 && failed.length > 0) {
        toast.warning(`Imported ${successful.length} tenant(s). ${failed.length} row(s) failed.`);
        return;
      }

      if (failed.length > 0) {
        toast.error(`Import failed for ${failed.length} tenant row(s).`);
        return;
      }

      toast.success(`Successfully imported ${parseResult.validCount} tenant(s).`);
      handleClose();
    } catch (error) {
      console.error("Tenant import failed:", error);
      toast.error(error.message || "Failed to import tenants");
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setParseResult(null);
    setShowErrors(false);
    setIsUploading(false);
    setIsImporting(false);
    setImportFailures([]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
            <FaUpload size={14} />
            Import Tenants from Excel
          </h2>
          <button
            onClick={handleClose}
            className="text-white/70 transition-colors hover:text-white"
            disabled={isUploading || isImporting}
          >
            <FaTimes size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-white px-5 py-4">

          {/* File upload */}
          <div className="mb-5">
            <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
              Select Excel File (.xlsx or .xls)
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={isUploading || isImporting}
              className="block w-full cursor-pointer text-sm text-slate-500 file:mr-4 file:cursor-pointer file:border-0 file:bg-[#0B3B2E] file:px-4 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-wide file:text-white hover:file:bg-[#0d5442] disabled:opacity-50"
            />
            {selectedFile && (
              <p className="mt-1.5 text-xs text-slate-500">
                Loaded: <span className="font-semibold text-slate-700">{selectedFile.name}</span>
              </p>
            )}
          </div>

          {parseResult && (
            <div className="space-y-4">

              {/* Summary strip */}
              <div className="grid grid-cols-3 gap-3">
                <div className="border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Total Rows</div>
                  <div className="mt-0.5 text-xl font-black text-slate-900">{parseResult.total}</div>
                </div>
                <div className="border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                    <FaCheckCircle size={10} /> Valid
                  </div>
                  <div className="mt-0.5 text-xl font-black text-emerald-700">{parseResult.validCount}</div>
                </div>
                <div className="border border-red-200 bg-red-50 p-3">
                  <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-red-700">
                    <FaExclamationTriangle size={10} /> Errors
                  </div>
                  <div className="mt-0.5 text-xl font-black text-red-700">{parseResult.errorCount}</div>
                </div>
              </div>

              {/* Preview table */}
              {previewRows.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                    Preview — first {previewRows.length} valid record{previewRows.length !== 1 ? "s" : ""}
                  </p>
                  <div className="overflow-x-auto border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-[#0B3B2E] text-white">
                        <tr>
                          {["Tenant", "Property / Unit", "Addl. Units", "Rent", "Deposit", "Held By", "Utilities", "Status"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {previewRows.map((record, index) => (
                          <tr key={`${record.tenantName}-${index}`} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-semibold text-slate-900">
                              <div>{record.tenantName}</div>
                              <div className="text-[10px] text-slate-400">{record.phoneNumber || "—"}</div>
                            </td>
                            <td className="px-3 py-1.5 text-slate-700">
                              <div className="font-semibold">{record.propertyCode}</div>
                              <div className="text-[10px] text-slate-400">{record.unitNumber}</div>
                            </td>
                            <td className="px-3 py-1.5 text-slate-600">
                              {Array.isArray(record.additionalUnitNumbers) && record.additionalUnitNumbers.length > 0
                                ? record.additionalUnitNumbers.join(", ")
                                : "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right text-slate-700">{formatMoney(record.rent)}</td>
                            <td className="px-3 py-1.5 text-right text-slate-700">{formatMoney(record.depositAmount)}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.depositHeldBy || "Property Default"}</td>
                            <td className="px-3 py-1.5 text-slate-600">{formatUtilities(record.utilities)}</td>
                            <td className="px-3 py-1.5 capitalize text-slate-600">{record.status || "active"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parseResult.validCount > previewRows.length && (
                    <p className="mt-1.5 text-xs text-slate-400">
                      …and {parseResult.validCount - previewRows.length} more valid record(s)
                    </p>
                  )}
                </div>
              )}

              {/* Validation errors */}
              {parseResult.errorCount > 0 && (
                <div className="border border-red-200 bg-red-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-wide text-red-700">
                      Validation Errors ({parseResult.errorCount})
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowErrors((prev) => !prev)}
                      className="text-[10px] font-bold text-red-700 underline"
                    >
                      {showErrors ? "Hide" : "Show details"}
                    </button>
                  </div>
                  {showErrors && (
                    <div className="max-h-64 space-y-2 overflow-y-auto">
                      {parseResult.errors.map((errorItem, index) => (
                        <div key={`${errorItem.row}-${index}`} className="border border-red-200 bg-white p-3">
                          <div className="text-xs font-bold text-red-700">
                            Row {errorItem.row}{errorItem.tenantName ? ` — ${errorItem.tenantName}` : ""}
                          </div>
                          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-red-600">
                            {(Array.isArray(errorItem.errors) ? errorItem.errors : []).map((message, i) => (
                              <li key={i}>{message}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Backend import failures */}
              {importFailures.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 p-4">
                  <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-amber-800">
                    Backend Import Failures ({importFailures.length})
                  </h4>
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {importFailures.map((failure, index) => (
                      <div key={`${failure.row || "row"}-${index}`} className="border border-amber-200 bg-white p-3">
                        <div className="text-xs font-bold text-amber-800">
                          {failure.row ? `Row ${failure.row}` : "Row"}{failure.tenantName ? ` — ${failure.tenantName}` : ""}
                        </div>
                        <p className="mt-0.5 text-xs text-amber-700">{failure.error || "Import failed"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
          <div className="text-xs text-slate-500">
            {parseResult
              ? `${parseResult.validCount} valid row(s) ready for import`
              : "Upload a tenant import file to validate first"}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              disabled={isUploading || isImporting}
              className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={isUploading || isImporting || !parseResult || parseResult.validCount === 0}
              className="flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition-colors hover:bg-[#0d5442] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUploading || isImporting ? (
                <>
                  <FaSpinner className="animate-spin" size={11} />
                  {isUploading ? "Validating…" : "Importing…"}
                </>
              ) : (
                <>
                  <FaUpload size={11} />
                  Import Valid Rows
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TenantsImportModal;
