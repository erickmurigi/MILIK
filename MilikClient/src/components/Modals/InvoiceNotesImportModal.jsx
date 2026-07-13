import React, { useMemo, useState } from "react";
import {
  FaUpload,
  FaCheckCircle,
  FaExclamationTriangle,
  FaSpinner,
  FaTimes,
  FaDownload,
} from "react-icons/fa";
import { parseInvoiceNotesExcel, downloadInvoiceNotesTemplate } from "../../utils/excelTemplates";
import { toast } from "react-toastify";

const formatAmount = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const InvoiceNotesImportModal = ({ isOpen, onClose, onImport }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
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
      const result = await parseInvoiceNotesExcel(file);
      setParseResult(result);
      if (result.errorCount > 0) {
        toast.warning(`File parsed with ${result.errorCount} row error(s). Review before importing.`);
      } else {
        toast.success(`Validated ${result.validCount} note record(s).`);
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
      toast.error("No valid note records to import");
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
        toast.success(`Successfully imported ${successful.length} note(s).`);
        handleClose();
        return;
      }
      if (successful.length > 0 && failed.length > 0) {
        toast.warning(`Imported ${successful.length} note(s). ${failed.length} row(s) failed.`);
        return;
      }
      if (failed.length > 0) {
        toast.error(`Import failed for ${failed.length} note row(s).`);
        return;
      }
      toast.success(`Successfully imported ${parseResult.validCount} note(s).`);
      handleClose();
    } catch (error) {
      toast.error(error.message || "Failed to import notes");
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
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
            <FaUpload size={14} />
            Import Credit &amp; Debit Notes from Excel
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

          {/* Template download */}
          <div className="mb-4 flex items-center gap-3 rounded border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex-1 text-xs text-slate-600">
              Download the template to ensure your data is formatted correctly.
            </div>
            <button
              type="button"
              onClick={downloadInvoiceNotesTemplate}
              className="flex shrink-0 items-center gap-1.5 rounded bg-[#0B3B2E] px-3 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0d5442]"
            >
              <FaDownload size={10} />
              Download Template
            </button>
          </div>

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
            {isUploading && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                <FaSpinner className="animate-spin" size={11} /> Parsing file…
              </p>
            )}
            {selectedFile && !isUploading && (
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
                          {["Type", "Tenant", "Category", "Amount (KES)", "Date", "Source Inv.", "Narration"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {previewRows.map((record, index) => (
                          <tr key={index} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5">
                              <span className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${record.noteType === "CREDIT_NOTE" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
                                {record.noteType === "CREDIT_NOTE" ? "Credit" : "Debit"}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 font-semibold text-slate-900">
                              <div>{record.tenantName || record.tenantCode || "—"}</div>
                              {record.tenantCode && record.tenantName && (
                                <div className="text-[10px] text-slate-400">{record.tenantCode}</div>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-slate-600 capitalize">{String(record.category || "").toLowerCase().replace(/_/g, " ")}</td>
                            <td className="px-3 py-1.5 text-right font-semibold text-slate-900">{formatAmount(record.amount)}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.noteDate || "—"}</td>
                            <td className="px-3 py-1.5 text-slate-500">{record.sourceInvoiceNo || "—"}</td>
                            <td className="max-w-[160px] truncate px-3 py-1.5 text-slate-500">{record.narration || "—"}</td>
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
                    <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-red-700">
                      <FaExclamationTriangle size={11} />
                      {parseResult.errorCount} Row{parseResult.errorCount !== 1 ? "s" : ""} with Errors
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowErrors(!showErrors)}
                      className="text-xs font-semibold text-red-700 underline hover:text-red-800"
                    >
                      {showErrors ? "Hide" : "Show"} errors
                    </button>
                  </div>
                  {showErrors && (
                    <div className="space-y-2">
                      {parseResult.errors.map((err, i) => (
                        <div key={i} className="border-l-2 border-red-400 pl-3 text-xs">
                          <span className="font-semibold text-red-800">Row {err.row}:</span>{" "}
                          <span className="text-red-700">{err.errors.join("; ")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Backend failures (after import attempt) */}
              {importFailures.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 p-4">
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-amber-700">
                    {importFailures.length} Row{importFailures.length !== 1 ? "s" : ""} Rejected by Server
                  </p>
                  <div className="space-y-1.5">
                    {importFailures.map((f, i) => (
                      <div key={i} className="border-l-2 border-amber-400 pl-3 text-xs">
                        <span className="font-semibold text-amber-800">Row {f.row}:</span>{" "}
                        <span className="text-amber-700">{f.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isImporting}
            className="rounded border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!parseResult || parseResult.validCount === 0 || isImporting || isUploading}
            className="flex items-center gap-1.5 rounded bg-[#FF8C00] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white hover:bg-[#e67e00] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? (
              <><FaSpinner className="animate-spin" size={11} /> Importing…</>
            ) : (
              <><FaUpload size={10} /> Import {parseResult?.validCount ? `${parseResult.validCount} Note${parseResult.validCount !== 1 ? "s" : ""}` : "Notes"}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceNotesImportModal;
