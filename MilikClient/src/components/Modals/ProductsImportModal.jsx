import React, { useMemo, useState } from "react";
import { FaUpload, FaCheckCircle, FaExclamationTriangle, FaSpinner, FaTimes, FaDownload } from "react-icons/fa";
import { parseProductsExcel, downloadProductsTemplate } from "../../utils/excelTemplates";
import { toast } from "react-toastify";

const ProductsImportModal = ({ isOpen, onClose, onImport }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [importErrors, setImportErrors] = useState([]);

  const previewRows = useMemo(
    () => (Array.isArray(parseResult?.valid) ? parseResult.valid.slice(0, 5) : []),
    [parseResult]
  );

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setParseResult(null);
    setImportErrors([]);
    setIsUploading(true);
    try {
      const result = await parseProductsExcel(file);
      setParseResult(result);
      if (result.errorCount > 0) {
        toast.warning(`File parsed with ${result.errorCount} row error(s). Review before importing.`);
      } else {
        toast.success(`Validated ${result.validCount} product(s) — ready to import.`);
      }
    } catch (err) {
      toast.error(err.message || "Failed to parse file");
      setSelectedFile(null);
      setParseResult(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleImport = async () => {
    if (!parseResult || parseResult.validCount === 0) {
      toast.error("No valid products to import");
      return;
    }
    setIsImporting(true);
    setImportErrors([]);
    try {
      const result = await onImport(parseResult.valid);
      const created = result?.created ?? 0;
      const skipped = result?.skipped ?? 0;
      const errs = Array.isArray(result?.errors) ? result.errors : [];
      setImportErrors(errs);
      if (created > 0 && skipped === 0) {
        toast.success(`${created} product(s) imported successfully.`);
        handleClose();
      } else if (created > 0) {
        toast.warning(`${created} imported, ${skipped} skipped. See details below.`);
      } else {
        toast.error(`Import failed — ${skipped} row(s) skipped.`);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || "Import failed");
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
    setImportErrors([]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
            <FaUpload size={13} /> Import Products from Excel / CSV
          </h2>
          <button onClick={handleClose} disabled={isUploading || isImporting} className="text-white/70 hover:text-white">
            <FaTimes size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">

          {/* Download template + file picker */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1">
              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                Select Excel or CSV file
              </label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                disabled={isUploading || isImporting}
                className="block w-full cursor-pointer text-sm text-slate-500 file:mr-4 file:cursor-pointer file:border-0 file:bg-[#0B3B2E] file:px-4 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-wide file:text-white hover:file:bg-[#0d5442] disabled:opacity-50"
              />
              {selectedFile && (
                <p className="mt-1 text-xs text-slate-500">
                  Loaded: <span className="font-semibold text-slate-700">{selectedFile.name}</span>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={downloadProductsTemplate}
              className="inline-flex shrink-0 items-center gap-2 border border-[#0B3B2E] bg-white px-3 py-2 text-xs font-bold text-[#0B3B2E] hover:bg-[#EDF5F1]"
            >
              <FaDownload size={11} /> Download Template
            </button>
          </div>

          {parseResult && (
            <>
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
                    <table className="min-w-full text-xs">
                      <thead className="bg-[#0B3B2E] text-white">
                        <tr>
                          {["Name", "SKU", "Category", "Selling Price", "Cost", "VAT", "Track Stock", "Serialized"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-wide whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {previewRows.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-semibold text-slate-900">{r.name}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-500">{r.sku || "—"}</td>
                            <td className="px-3 py-1.5 text-slate-600">{r.category || "—"}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{Number(r.sellingPrice).toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{Number(r.costPrice).toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-slate-500">{r.vatRate}%</td>
                            <td className="px-3 py-1.5">
                              <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${r.trackStock ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                                {r.trackStock ? "Yes" : "No"}
                              </span>
                            </td>
                            <td className="px-3 py-1.5">
                              {r.serialized && (
                                <span className="inline-flex border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-violet-700">Serial</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parseResult.validCount > previewRows.length && (
                    <p className="mt-1 text-xs text-slate-400">…and {parseResult.validCount - previewRows.length} more valid record(s)</p>
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
                    <button type="button" onClick={() => setShowErrors((p) => !p)} className="text-[10px] font-bold text-red-700 underline">
                      {showErrors ? "Hide" : "Show details"}
                    </button>
                  </div>
                  {showErrors && (
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {parseResult.errors.map((e, i) => (
                        <div key={i} className="border border-red-200 bg-white p-2">
                          <div className="text-xs font-bold text-red-700">Row {e.row}{e.name ? ` — ${e.name}` : ""}</div>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-red-600">
                            {(Array.isArray(e.errors) ? e.errors : [e.errors]).map((msg, j) => <li key={j}>{msg}</li>)}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Backend import failures */}
              {importErrors.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 p-4">
                  <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-amber-800">
                    Import Failures ({importErrors.length})
                  </h4>
                  <div className="max-h-48 space-y-1.5 overflow-y-auto">
                    {importErrors.map((e, i) => (
                      <div key={i} className="border border-amber-200 bg-white p-2 text-xs">
                        <span className="font-bold text-amber-800">Row {e.row}{e.name ? ` — ${e.name}` : ""}: </span>
                        <span className="text-amber-700">{e.reason || "Import failed"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
          <p className="text-xs text-slate-500">
            {parseResult
              ? `${parseResult.validCount} valid row(s) ready to import`
              : "Upload a file to validate first · Use the template for best results"}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={handleClose} disabled={isUploading || isImporting}
              className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={handleImport}
              disabled={isUploading || isImporting || !parseResult || parseResult.validCount === 0}
              className="flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0d5442] disabled:opacity-50">
              {isUploading || isImporting ? (
                <><FaSpinner className="animate-spin" size={11} />{isUploading ? "Validating…" : "Importing…"}</>
              ) : (
                <><FaUpload size={11} /> Import {parseResult?.validCount ? `${parseResult.validCount} Products` : "Products"}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductsImportModal;
