import React, { useMemo, useState } from "react";
import { FaUpload, FaCheckCircle, FaExclamationTriangle, FaSpinner, FaTimes, FaDownload } from "react-icons/fa";
import { toast } from "react-toastify";

const SaleImportModal = ({
  isOpen,
  onClose,
  title,
  entityName,
  parseFile,
  onImport,
  previewCols,
  downloadTemplate,
}) => {
  const [selectedFile,   setSelectedFile]   = useState(null);
  const [parseResult,    setParseResult]    = useState(null);
  const [showErrors,     setShowErrors]     = useState(false);
  const [isParsing,      setIsParsing]      = useState(false);
  const [isImporting,    setIsImporting]    = useState(false);
  const [importFailures, setImportFailures] = useState([]);

  const previewRows = useMemo(
    () => (Array.isArray(parseResult?.valid) ? parseResult.valid.slice(0, 5) : []),
    [parseResult],
  );

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setParseResult(null);
    setImportFailures([]);
    setIsParsing(true);
    try {
      const result = await parseFile(file);
      setParseResult(result);
      if (result.errorCount > 0) {
        toast.warning(`Parsed with ${result.errorCount} row error(s) — review before importing`);
      } else {
        toast.success(`${result.validCount} ${entityName}(s) validated`);
      }
    } catch (err) {
      toast.error(err.message || "Failed to parse file");
      setSelectedFile(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleImport = async () => {
    if (!parseResult?.validCount) return;
    setIsImporting(true);
    setImportFailures([]);
    try {
      const res = await onImport(parseResult.valid);
      const successful = Array.isArray(res?.successful) ? res.successful : [];
      const failed     = Array.isArray(res?.failed)     ? res.failed     : [];
      setImportFailures(failed);

      if (successful.length && !failed.length) {
        toast.success(`Imported ${successful.length} ${entityName}(s) successfully`);
        handleClose();
      } else if (successful.length && failed.length) {
        toast.warning(`Imported ${successful.length} — ${failed.length} failed`);
      } else {
        toast.error(`All ${failed.length} row(s) failed — check errors below`);
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
    setIsParsing(false);
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
            <FaUpload size={13} />
            {title}
          </h2>
          <div className="flex items-center gap-2">
            {downloadTemplate && (
              <button
                type="button"
                onClick={downloadTemplate}
                className="flex items-center gap-1.5 border border-white/30 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white/80 hover:bg-white/10"
              >
                <FaDownload size={9} /> Download Template
              </button>
            )}
            <button onClick={handleClose} disabled={isParsing || isImporting} className="text-white/70 hover:text-white">
              <FaTimes size={17} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* File picker */}
          <div className="mb-5">
            <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
              Select Excel File (.xlsx or .xls)
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={isParsing || isImporting}
              className="block w-full cursor-pointer text-sm text-slate-500 file:mr-4 file:cursor-pointer file:border-0 file:bg-[#0B3B2E] file:px-4 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-wide file:text-white hover:file:bg-[#0d5442] disabled:opacity-50"
            />
            {selectedFile && (
              <p className="mt-1 text-xs text-slate-500">
                Loaded: <span className="font-semibold text-slate-700">{selectedFile.name}</span>
              </p>
            )}
          </div>

          {parseResult && (
            <div className="space-y-4">

              {/* Counts */}
              <div className="grid grid-cols-3 gap-3">
                <div className="border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Total Rows</div>
                  <div className="mt-0.5 text-xl font-black text-slate-900">{parseResult.total}</div>
                </div>
                <div className="border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                    <FaCheckCircle size={9} /> Valid
                  </div>
                  <div className="mt-0.5 text-xl font-black text-emerald-700">{parseResult.validCount}</div>
                </div>
                <div className="border border-red-200 bg-red-50 p-3">
                  <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-red-700">
                    <FaExclamationTriangle size={9} /> Errors
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
                          {previewCols.map((c) => (
                            <th key={c.header} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-wide">
                              {c.header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {previewRows.map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            {previewCols.map((c) => (
                              <td key={c.header} className="px-3 py-1.5 text-slate-700">
                                {c.render(row)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parseResult.validCount > previewRows.length && (
                    <p className="mt-1 text-xs text-slate-400">
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
                    <button type="button" onClick={() => setShowErrors((p) => !p)}
                      className="text-[10px] font-bold text-red-700 underline">
                      {showErrors ? "Hide" : "Show details"}
                    </button>
                  </div>
                  {showErrors && (
                    <div className="max-h-56 space-y-2 overflow-y-auto">
                      {parseResult.errors.map((e, idx) => (
                        <div key={idx} className="border border-red-200 bg-white p-3">
                          <div className="text-xs font-bold text-red-700">
                            Row {e.row}{e.title || e.fullName ? ` — ${e.title || e.fullName}` : ""}
                          </div>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-red-600">
                            {e.errors.map((m, j) => <li key={j}>{m}</li>)}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Backend failures */}
              {importFailures.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 p-4">
                  <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-amber-800">
                    Import Failures ({importFailures.length})
                  </h4>
                  <div className="max-h-56 space-y-2 overflow-y-auto">
                    {importFailures.map((f, idx) => (
                      <div key={idx} className="border border-amber-200 bg-white p-3">
                        <div className="text-xs font-bold text-amber-800">
                          Row {f.row}{f.title || f.fullName ? ` — ${f.title || f.fullName}` : ""}
                        </div>
                        <p className="mt-0.5 text-xs text-amber-700">{f.error || "Import failed"}</p>
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
          <p className="text-xs text-slate-500">
            {parseResult
              ? `${parseResult.validCount} valid row(s) ready to import`
              : "Upload a file to validate first"}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={handleClose} disabled={isParsing || isImporting}
              className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={handleImport}
              disabled={isParsing || isImporting || !parseResult?.validCount}
              className="flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0d5442] disabled:cursor-not-allowed disabled:opacity-50">
              {isParsing || isImporting ? (
                <><FaSpinner className="animate-spin" size={10} />{isParsing ? "Validating…" : "Importing…"}</>
              ) : (
                <><FaUpload size={10} />Import {parseResult?.validCount ? `${parseResult.validCount} Row(s)` : "Valid Rows"}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaleImportModal;
