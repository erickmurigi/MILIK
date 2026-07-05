import React, { useState } from 'react';
import { FaUpload, FaCheckCircle, FaExclamationTriangle, FaSpinner, FaTimes } from 'react-icons/fa';
import { parseUnitsExcel } from '../../utils/excelTemplates';
import { toast } from 'react-toastify';

const UnitsImportModal = ({ isOpen, onClose, onImport }) => {
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
      const result = await parseUnitsExcel(file);
      setParseResult(result);
      if (result.errorCount > 0) {
        toast.warning(`File parsed with ${result.errorCount} errors. Review before importing.`);
      } else {
        toast.success(`Successfully validated ${result.validCount} units!`);
      }
    } catch (error) {
      toast.error(error.message || 'Failed to parse Excel file');
      setSelectedFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleImport = async () => {
    if (!parseResult || parseResult.validCount === 0) {
      toast.error('No valid records to import');
      return;
    }

    setIsImporting(true);

    try {
      const result = await onImport(parseResult.valid);

      if (result?.data) {
        const { successful = [], failed = [] } = result.data;
        if (successful.length > 0 && failed.length === 0) {
          toast.success(`Successfully imported ${successful.length} unit${successful.length !== 1 ? 's' : ''}!`);
          handleClose();
        } else if (successful.length > 0 && failed.length > 0) {
          toast.warning(`Imported ${successful.length} unit${successful.length !== 1 ? 's' : ''}. ${failed.length} failed — see details below.`);
          setImportFailures(failed);
          setIsImporting(false);
        } else {
          toast.error(`Import failed: all ${failed.length} record${failed.length !== 1 ? 's' : ''} could not be saved.`);
          setImportFailures(failed);
          setIsImporting(false);
        }
      } else if (result?.success === false) {
        toast.error(result?.message || 'Import failed. Please check your file and try again.');
        setIsImporting(false);
      } else {
        toast.success(`Successfully imported ${parseResult.validCount} unit${parseResult.validCount !== 1 ? 's' : ''}!`);
        handleClose();
      }
    } catch (error) {
      toast.error(error.message || 'Failed to import units.');
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
            Import Units from Excel
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
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-[#0B3B2E] text-white">
                        <tr>
                          {["Unit Number", "Property Code", "Type", "Rent (KES)", "Deposit (KES)", "Billing", "Status"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {parseResult.valid.slice(0, 5).map((record, index) => (
                          <tr key={index} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-semibold text-slate-900">{record.unitNumber}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.propertyCode}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.unitType}</td>
                            <td className="px-3 py-1.5 text-right text-slate-600">{Number(record.rent || 0).toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-right text-slate-600">{Number(record.deposit || 0).toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-slate-600">{record.billingFrequency || 'monthly'}</td>
                            <td className="px-3 py-1.5 capitalize text-slate-600">{record.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parseResult.validCount > 5 && (
                    <p className="mt-1.5 text-xs text-slate-400">
                      + {parseResult.validCount - 5} more valid records
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
                      {showErrors ? 'Hide Details' : 'Show Details'}
                    </button>
                  </div>
                  {showErrors && (
                    <div className="max-h-60 space-y-2 overflow-y-auto">
                      {parseResult.errors.map((error, index) => (
                        <div key={index} className="border border-red-200 bg-white p-3">
                          <div className="text-xs font-bold text-red-900">
                            Row {error.row}: {error.data.unitNumber || 'Unnamed Unit'}
                          </div>
                          <ul className="mt-1 space-y-0.5 text-xs text-red-700">
                            {error.errors.map((err, i) => (
                              <li key={i}>• {err}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Backend import failures */}
          {importFailures.length > 0 && (
            <div className="mt-4 border border-red-200 bg-red-50 p-4">
              <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-red-900">
                Import Failures ({importFailures.length} record{importFailures.length !== 1 ? 's' : ''})
              </h3>
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {importFailures.map((failure, idx) => (
                  <div key={idx} className="border border-red-200 bg-white p-3">
                    <div className="text-xs font-bold text-red-900">{failure.unitNumber || 'Unknown unit'}</div>
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
                Ready to import {parseResult.validCount} unit{parseResult.validCount !== 1 ? 's' : ''}
              </span>
            ) : (
              'Upload an Excel file to begin'
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
                  Import {parseResult?.validCount || 0} Units
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnitsImportModal;
