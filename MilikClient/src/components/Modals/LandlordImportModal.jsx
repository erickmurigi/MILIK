import React, { useState } from "react";
import {
  FaTimes,
  FaUpload,
  FaCheckCircle,
  FaExclamationTriangle,
  FaSpinner,
} from "react-icons/fa";
import { parseLandlordsExcel } from "../../utils/excelTemplates";
import { toast } from "react-toastify";
import { useTerms } from "../../hooks/useTerm";

const LandlordImportModal = ({ isOpen, onClose, onImport }) => {
  const { landlord: termLandlord, landlords: termLandlords } = useTerms("landlord", "landlords");
  const [file, setFile] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [importFailures, setImportFailures] = useState([]);

  if (!isOpen) return null;

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];

    if (!selectedFile) return;

    if (!selectedFile.name.endsWith(".xlsx") && !selectedFile.name.endsWith(".xls")) {
      toast.error("Please upload a valid Excel file (.xlsx or .xls)");
      return;
    }

    setFile(selectedFile);
    setIsUploading(true);
    setParseResult(null);

    try {
      const result = await parseLandlordsExcel(selectedFile);
      setParseResult(result);

      if (result.errorCount > 0) {
        toast.warning(`File parsed with ${result.errorCount} errors. Please review before importing.`);
      } else {
        toast.success(`Successfully parsed ${result.validCount} ${termLandlords.toLowerCase()}.`);
      }
    } catch (error) {
      toast.error(error.message || "Failed to parse Excel file");
      setFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleImport = async () => {
    if (!parseResult || parseResult.validCount === 0) {
      toast.error("No valid records to import");
      return;
    }

    setIsImporting(true);

    try {
      const result = await onImport(parseResult.valid);

      if (result?.data) {
        const { successful = [], failed = [] } = result.data;
        if (successful.length > 0 && failed.length === 0) {
          toast.success(`Successfully imported ${successful.length} ${termLandlord.toLowerCase()}${successful.length !== 1 ? "s" : ""}.`);
          handleClose();
        } else if (successful.length > 0 && failed.length > 0) {
          toast.warning(`Imported ${successful.length} ${termLandlord.toLowerCase()}${successful.length !== 1 ? "s" : ""}. ${failed.length} row${failed.length !== 1 ? "s" : ""} failed — see details below.`);
          setImportFailures(failed);
          setIsImporting(false);
        } else {
          toast.error(`Import failed: all ${failed.length} row${failed.length !== 1 ? "s" : ""} could not be saved.`);
          setImportFailures(failed);
          setIsImporting(false);
        }
      } else if (result?.success === false) {
        toast.error(result?.message || "Import failed. Please check your file and try again.");
        setIsImporting(false);
      } else {
        toast.success(`Successfully imported ${parseResult.validCount} ${termLandlord.toLowerCase()}${parseResult.validCount !== 1 ? "s" : ""}.`);
        handleClose();
      }
    } catch (error) {
      console.error("Import error in modal:", error);
      toast.error(error.message || `Failed to import ${termLandlords.toLowerCase()}.`);
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setParseResult(null);
    setShowErrors(false);
    setIsUploading(false);
    setIsImporting(false);
    setImportFailures([]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
            <FaUpload size={14} />
            Import {termLandlords} from Excel
          </h2>
          <button
            onClick={handleClose}
            className="text-white/70 transition-colors hover:text-white"
            disabled={isImporting}
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
            <label className={`flex cursor-pointer items-center gap-2 border-2 border-dashed border-slate-300 px-4 py-3 transition-colors hover:border-[#0B3B2E] ${isUploading ? "cursor-not-allowed opacity-50" : ""}`}>
              <FaUpload className="text-slate-400" size={14} />
              <span className="text-sm text-slate-500">
                {file ? file.name : "Choose Excel file or drag here"}
              </span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
                disabled={isUploading || isImporting}
              />
            </label>
            <p className="mt-1.5 text-xs text-slate-400">
              Supported: .xlsx, .xls — max 1,000 records per file
            </p>
          </div>

          {/* Parsing spinner */}
          {isUploading && (
            <div className="flex items-center justify-center gap-3 border border-blue-200 bg-blue-50 p-6">
              <FaSpinner className="animate-spin text-blue-600" size={20} />
              <span className="text-sm font-semibold text-blue-800">Parsing Excel file…</span>
            </div>
          )}

          {/* Parse results */}
          {parseResult && !isUploading && (
            <div className="space-y-4">

              {/* Summary strip */}
              <div className="grid grid-cols-3 gap-3">
                <div className="border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Total Records</div>
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
              {parseResult.validCount > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                    Preview — first 5 valid records
                  </p>
                  <div className="overflow-x-auto border border-slate-200">
                    <table className="w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-[#0B3B2E] text-white">
                        <tr>
                          {["Name", "Type", "Reg / ID", "Email", "Phone"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {parseResult.valid.slice(0, 5).map((record, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-semibold text-slate-900">{record.landlordName}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.landlordType}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.regId}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.email}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.phoneNumber}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parseResult.validCount > 5 && (
                    <p className="mt-1.5 text-xs text-slate-400">
                      + {parseResult.validCount - 5} more records
                    </p>
                  )}
                </div>
              )}

              {/* Validation errors */}
              {parseResult.errorCount > 0 && (
                <div className="border border-red-200 bg-red-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wide text-red-900">
                      Errors Found ({parseResult.errorCount})
                    </h3>
                    <button
                      onClick={() => setShowErrors(!showErrors)}
                      className="text-[10px] font-bold text-red-700 underline"
                    >
                      {showErrors ? "Hide Details" : "Show Details"}
                    </button>
                  </div>
                  {showErrors && (
                    <div className="max-h-60 space-y-2 overflow-y-auto">
                      {parseResult.errors.map((error, idx) => (
                        <div key={idx} className="border border-red-200 bg-white p-3">
                          <div className="text-xs font-bold text-red-900">
                            Row {error.row}: {error.data.landlordName || "Unnamed"}
                          </div>
                          <ul className="mt-1 space-y-0.5 text-xs text-red-700">
                            {error.errors.map((err, errIdx) => (
                              <li key={errIdx}>• {err}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-red-700">
                    Fix these errors in your Excel file and re-upload to import all records.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Backend import failures */}
          {importFailures.length > 0 && (
            <div className="mt-4 border border-red-200 bg-red-50 p-4">
              <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-red-900">
                Import Failures ({importFailures.length} row{importFailures.length !== 1 ? "s" : ""})
              </h3>
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {importFailures.map((failure, idx) => (
                  <div key={idx} className="border border-red-200 bg-white p-3">
                    <div className="text-xs font-bold text-red-900">{failure.landlord || "Unknown record"}</div>
                    <div className="mt-0.5 text-xs text-red-700">{failure.error}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-red-600">
                Correct the issues above in your Excel file and re-import those specific rows.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
          <div className="text-xs text-slate-500">
            {parseResult && parseResult.validCount > 0 ? (
              <span className="font-semibold text-emerald-700">
                Ready to import {parseResult.validCount} {termLandlord.toLowerCase()}{parseResult.validCount !== 1 ? "s" : ""}
              </span>
            ) : (
              "Upload an Excel file to begin"
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
              disabled={isImporting}
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!parseResult || parseResult.validCount === 0 || isImporting}
              className="flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition-colors hover:bg-[#0d5442] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isImporting ? (
                <>
                  <FaSpinner className="animate-spin" size={11} />
                  Importing…
                </>
              ) : (
                <>
                  <FaUpload size={11} />
                  Import {parseResult?.validCount || 0} {termLandlords}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandlordImportModal;
