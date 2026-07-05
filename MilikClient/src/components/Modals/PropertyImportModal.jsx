import React, { useState } from "react";
import {
  FaUpload,
  FaCheckCircle,
  FaExclamationTriangle,
  FaSpinner,
  FaTimes,
} from "react-icons/fa";
import { parsePropertiesExcel } from "../../utils/excelTemplates";
import { toast } from "react-toastify";

const PropertyImportModal = ({ isOpen, onClose, onImport }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [importFailures, setImportFailures] = useState([]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setParseResult(null);
    setIsUploading(true);

    try {
      const result = await parsePropertiesExcel(file);
      setParseResult(result);

      if (result.errorCount > 0) {
        toast.warning(`File parsed with ${result.errorCount} errors. Review before importing.`);
      } else {
        toast.success(`Successfully validated ${result.validCount} properties.`);
      }
    } catch (error) {
      toast.error(error.message || "Failed to parse Excel file");
      setSelectedFile(null);
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
          toast.success(`Successfully imported ${successful.length} propert${successful.length !== 1 ? "ies" : "y"}.`);
          handleClose();
        } else if (successful.length > 0 && failed.length > 0) {
          toast.warning(`Imported ${successful.length} propert${successful.length !== 1 ? "ies" : "y"}. ${failed.length} failed — see details below.`);
          setImportFailures(failed);
          setIsImporting(false);
        } else {
          toast.error(`Import failed: all ${failed.length} record${failed.length !== 1 ? "s" : ""} could not be saved.`);
          setImportFailures(failed);
          setIsImporting(false);
        }
      } else if (result?.success === false) {
        toast.error(result?.message || "Import failed. Please check your file and try again.");
        setIsImporting(false);
      } else {
        toast.success(`Successfully imported ${parseResult.validCount} propert${parseResult.validCount !== 1 ? "ies" : "y"}.`);
        handleClose();
      }
    } catch (error) {
      toast.error(error.message || "Failed to import properties.");
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
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
            <FaUpload size={14} />
            Import Properties from Excel
          </h2>
          <button
            onClick={handleClose}
            className="text-white/70 transition-colors hover:text-white"
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
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-[#0B3B2E] text-white">
                        <tr>
                          {["Property Name", "Type", "LR Number", "Location", "Landlord", "Units"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {parseResult.valid.slice(0, 5).map((record, index) => (
                          <tr key={index} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-semibold text-slate-900">{record.propertyName}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.propertyType}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.lrNumber}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.townCityState}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.landlordName}</td>
                            <td className="px-3 py-1.5 text-center text-slate-600">{record.totalUnits}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parseResult.validCount > 5 && (
                    <p className="mt-1.5 text-xs text-slate-400">
                      …and {parseResult.validCount - 5} more valid records
                    </p>
                  )}
                </div>
              )}

              {/* Validation errors */}
              {parseResult.errorCount > 0 && (
                <div className="border border-red-200 bg-red-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-wide text-red-700">
                      Errors ({parseResult.errorCount})
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowErrors(!showErrors)}
                      className="text-[10px] font-bold text-red-700 underline"
                    >
                      {showErrors ? "Hide" : "Show details"}
                    </button>
                  </div>
                  {showErrors && (
                    <div className="max-h-64 space-y-2 overflow-y-auto">
                      {parseResult.errors.map((error, index) => (
                        <div key={index} className="border border-red-200 bg-white p-3">
                          <div className="text-xs font-bold text-red-800">
                            Row {error.row}: {error.data.propertyName || "Unnamed Property"}
                          </div>
                          <ul className="mt-1 list-disc pl-5 text-xs text-red-700 space-y-0.5">
                            {error.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Backend failures */}
              {importFailures.length > 0 && (
                <div className="border border-red-200 bg-red-50 p-4">
                  <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-red-800">
                    Import Failures ({importFailures.length})
                  </h4>
                  <div className="max-h-60 space-y-2 overflow-y-auto">
                    {importFailures.map((failure, idx) => (
                      <div key={idx} className="border border-red-200 bg-white p-3">
                        <div className="text-xs font-bold text-red-900">{failure.propertyName || "Unknown property"}</div>
                        <div className="mt-0.5 text-xs text-red-700">{failure.error}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-red-600">
                    Correct these issues in your Excel file and re-import those rows.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
          <div className="text-xs text-slate-500">
            {parseResult
              ? `${parseResult.validCount} valid record(s) ready to import`
              : "Upload a properties Excel file to validate first"}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              disabled={isImporting}
              className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
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
                  Import {parseResult?.validCount || 0} Properties
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PropertyImportModal;
