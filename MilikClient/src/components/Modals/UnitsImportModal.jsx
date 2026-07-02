import React, { useState } from 'react';
import { FaUpload, FaCheckCircle, FaExclamationTriangle, FaSpinner, FaTimes } from 'react-icons/fa';
import { parseUnitsExcel } from '../../utils/excelTemplates';
import { toast } from 'react-toastify';

const MILIK_GREEN = 'bg-[#0B3B2E]';

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
          toast.error(`Import failed: all ${failed.length} record${failed.length !== 1 ? 's' : ''} could not be saved. See errors below.`);
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className={`${MILIK_GREEN} text-white px-6 py-4 flex items-center justify-between`}>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FaUpload />
            Import Units from Excel
          </h2>
          <button
            onClick={handleClose}
            className="text-white hover:text-gray-300 transition-colors"
          >
            <FaTimes size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 bg-white">
          {/* File Upload */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Select Excel File (.xlsx or .xls)
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={isUploading || isImporting}
              className="block w-full text-sm text-gray-500
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-semibold
                file:bg-[#0B3B2E] file:text-white
                hover:file:bg-[#0d5442]
                file:cursor-pointer
                cursor-pointer
                disabled:opacity-50"
            />
          </div>

          {/* Parse Results Summary */}
          {parseResult && (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="text-sm text-gray-600 mb-1 font-semibold">Total Records</div>
                  <div className="text-2xl font-bold text-gray-900">{parseResult.total}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                  <div className="text-sm text-green-700 mb-1 flex items-center gap-1 font-semibold">
                    <FaCheckCircle /> Valid
                  </div>
                  <div className="text-2xl font-bold text-green-700">{parseResult.validCount}</div>
                </div>
                <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                  <div className="text-sm text-red-700 mb-1 flex items-center gap-1 font-semibold">
                    <FaExclamationTriangle /> Errors
                  </div>
                  <div className="text-2xl font-bold text-red-700">{parseResult.errorCount}</div>
                </div>
              </div>

              {/* Preview of Valid Records */}
              {parseResult.validCount > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">
                    Preview (First 5 Valid Records)
                  </h4>
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase">
                            Unit Number
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase">
                            Property Code
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase">
                            Type
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 uppercase">
                            Rent (KES)
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 uppercase">
                            Deposit (KES)
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase">
                            Billing
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 uppercase">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {parseResult.valid.slice(0, 5).map((record, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-sm text-gray-900 font-semibold">{record.unitNumber}</td>
                            <td className="px-3 py-2 text-sm text-gray-700">{record.propertyCode}</td>
                            <td className="px-3 py-2 text-sm text-gray-700">{record.unitType}</td>
                            <td className="px-3 py-2 text-sm text-gray-700 text-right">{Number(record.rent || 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-sm text-gray-700 text-right">{Number(record.deposit || 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-sm text-gray-700">{record.billingFrequency || 'monthly'}</td>
                            <td className="px-3 py-2 text-sm text-gray-700 capitalize">{record.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parseResult.validCount > 5 && (
                    <p className="text-sm text-gray-500 mt-2">
                      ...and {parseResult.validCount - 5} more valid records
                    </p>
                  )}
                </div>
              )}

              {/* Errors Section */}
              {parseResult.errorCount > 0 && (
                <div>
                  <button
                    onClick={() => setShowErrors(!showErrors)}
                    className="flex items-center gap-2 text-sm font-bold text-red-600 hover:text-red-700 mb-2"
                  >
                    <FaExclamationTriangle />
                    {showErrors ? 'Hide' : 'Show'} Errors ({parseResult.errorCount})
                  </button>

                  {showErrors && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-h-64 overflow-y-auto">
                      <div className="space-y-3">
                        {parseResult.errors.map((error, index) => (
                          <div key={index} className="text-sm">
                            <div className="font-bold text-red-800">
                              Row {error.row}: {error.data.unitNumber || 'Unnamed Unit'}
                            </div>
                            <ul className="list-disc list-inside text-red-700 ml-2">
                              {error.errors.map((err, i) => (
                                <li key={i}>{err}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {importFailures.length > 0 && (
            <div className="mt-4 bg-red-50 rounded-lg p-4 border border-red-200">
              <div className="flex items-center gap-2 mb-3">
                <FaExclamationTriangle className="text-red-600" />
                <h3 className="text-sm font-bold text-red-900">
                  Import Failures ({importFailures.length} record{importFailures.length !== 1 ? 's' : ''})
                </h3>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {importFailures.map((failure, idx) => (
                  <div key={idx} className="bg-white rounded p-3 border border-red-200">
                    <div className="flex items-start gap-2">
                      <FaExclamationTriangle className="text-red-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-xs font-bold text-red-900 mb-0.5">
                          {failure.unitNumber || 'Unknown unit'}
                        </div>
                        <div className="text-xs text-red-700">{failure.error}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-red-600 mt-3">
                Correct the issues above in your Excel file and re-import those specific rows.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
            disabled={isImporting}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!parseResult || parseResult.validCount === 0 || isImporting}
            className="px-4 py-2 bg-[#0B3B2E] text-white rounded-lg text-sm font-semibold hover:bg-[#0d5442] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isImporting ? (
              <>
                <FaSpinner className="animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <FaUpload />
                Import {parseResult?.validCount || 0} Units
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UnitsImportModal;
