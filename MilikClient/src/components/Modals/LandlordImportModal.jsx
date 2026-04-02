// components/Modals/LandlordImportModal.jsx
import React, { useState } from 'react';
import { FaTimes, FaUpload, FaCheckCircle, FaExclamationTriangle, FaSpinner } from 'react-icons/fa';
import { parseLandlordsExcel } from '../../utils/excelTemplates';
import { toast } from 'react-toastify';

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_ORANGE = "bg-[#FF8C00]";

const LandlordImportModal = ({ isOpen, onClose, onImport }) => {
  const [file, setFile] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    
    if (!selectedFile) return;
    
    // Validate file type
    if (!selectedFile.name.endsWith('.xlsx') && !selectedFile.name.endsWith('.xls')) {
      toast.error('Please upload a valid Excel file (.xlsx or .xls)');
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
        toast.success(`Successfully parsed ${result.validCount} landlords!`);
      }
    } catch (error) {
      toast.error(error.message || 'Failed to parse Excel file');
      setFile(null);
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
      console.log('Calling onImport with records:', parseResult.validCount);
      const result = await onImport(parseResult.valid);
      console.log('Import completed:', result);
      
      // Show detailed success message
      if (result?.data) {
        const { successful = [], failed = [] } = result.data;
        if (successful.length > 0 && failed.length === 0) {
          toast.success(`Successfully imported ${successful.length} landlords!`);
        } else if (successful.length > 0 && failed.length > 0) {
          toast.warning(`Imported ${successful.length} landlords. ${failed.length} failed.`);
        } else {
          toast.error(`Import failed for all ${failed.length} records.`);
        }
      } else {
        toast.success(`Successfully imported ${parseResult.validCount} landlords!`);
      }
      
      handleClose();
    } catch (error) {
      console.error('Import error in modal:', error);
      toast.error(error.message || 'Failed to import landlords. Please check console for details.');
      setIsImporting(false); // Keep modal open on error
    }
  };

  const handleClose = () => {
    setFile(null);
    setParseResult(null);
    setShowErrors(false);
    setIsUploading(false);
    setIsImporting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className={`${MILIK_GREEN} text-white px-6 py-4 flex items-center justify-between`}>
          <h2 className="text-xl font-bold">Import Landlords from Excel</h2>
          <button
            onClick={handleClose}
            className="text-white hover:text-gray-200 transition-colors"
            disabled={isImporting}
          >
            <FaTimes size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* File Upload Section */}
          <div className="mb-6">
            <label className="block text-sm font-bold text-gray-700 mb-2">
              Select Excel File
            </label>
            <div className="flex items-center gap-3">
              <label className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-orange-500 transition-colors ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <FaUpload className="text-gray-400" />
                <span className="text-sm text-gray-600">
                  {file ? file.name : 'Choose Excel file or drag here'}
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={isUploading || isImporting}
                />
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Supported formats: .xlsx, .xls | Maximum 1000 records per file
            </p>
          </div>

          {/* Parsing Progress */}
          {isUploading && (
            <div className="flex items-center justify-center gap-3 p-6 bg-blue-50 rounded-lg">
              <FaSpinner className="animate-spin text-blue-600" size={24} />
              <span className="text-sm font-semibold text-blue-800">Parsing Excel file...</span>
            </div>
          )}

          {/* Parse Results */}
          {parseResult && !isUploading && (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="text-2xl font-bold text-gray-900">{parseResult.total}</div>
                  <div className="text-xs text-gray-600 mt-1">Total Records</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                  <div className="flex items-center gap-2">
                    <FaCheckCircle className="text-green-600" />
                    <div className="text-2xl font-bold text-green-900">{parseResult.validCount}</div>
                  </div>
                  <div className="text-xs text-green-700 mt-1">Valid Records</div>
                </div>
                <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                  <div className="flex items-center gap-2">
                    <FaExclamationTriangle className="text-red-600" />
                    <div className="text-2xl font-bold text-red-900">{parseResult.errorCount}</div>
                  </div>
                  <div className="text-xs text-red-700 mt-1">Errors</div>
                </div>
              </div>

              {/* Valid Records Preview */}
              {parseResult.validCount > 0 && (
                <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                  <h3 className="text-sm font-bold text-green-900 mb-3">
                    Valid Records Preview (First 5)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-green-100">
                          <th className="px-2 py-1 text-left font-semibold">Name</th>
                          <th className="px-2 py-1 text-left font-semibold">Type</th>
                          <th className="px-2 py-1 text-left font-semibold">Reg/ID</th>
                          <th className="px-2 py-1 text-left font-semibold">Email</th>
                          <th className="px-2 py-1 text-left font-semibold">Phone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parseResult.valid.slice(0, 5).map((record, idx) => (
                          <tr key={idx} className="border-t border-green-200">
                            <td className="px-2 py-1">{record.landlordName}</td>
                            <td className="px-2 py-1">{record.landlordType}</td>
                            <td className="px-2 py-1">{record.regId}</td>
                            <td className="px-2 py-1">{record.email}</td>
                            <td className="px-2 py-1">{record.phoneNumber}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parseResult.validCount > 5 && (
                    <p className="text-xs text-green-700 mt-2">
                      + {parseResult.validCount - 5} more records
                    </p>
                  )}
                </div>
              )}

              {/* Errors */}
              {parseResult.errorCount > 0 && (
                <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-red-900">
                      Errors Found ({parseResult.errorCount})
                    </h3>
                    <button
                      onClick={() => setShowErrors(!showErrors)}
                      className="text-xs text-red-700 hover:text-red-900 font-semibold"
                    >
                      {showErrors ? 'Hide Details' : 'Show Details'}
                    </button>
                  </div>
                  
                  {showErrors && (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {parseResult.errors.map((error, idx) => (
                        <div key={idx} className="bg-white rounded p-3 border border-red-200">
                          <div className="flex items-start gap-2">
                            <FaExclamationTriangle className="text-red-600 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                              <div className="text-xs font-bold text-red-900 mb-1">
                                Row {error.row}: {error.data.landlordName || 'Unnamed'}
                              </div>
                              <ul className="text-xs text-red-700 space-y-0.5">
                                {error.errors.map((err, errIdx) => (
                                  <li key={errIdx}>• {err}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <p className="text-xs text-red-700 mt-3">
                    ⚠️ Fix these errors in your Excel file and re-upload to import all records.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex items-center justify-between">
          <div className="text-xs text-gray-600">
            {parseResult && parseResult.validCount > 0 ? (
              <span className="font-semibold text-green-700">
                Ready to import {parseResult.validCount} landlord{parseResult.validCount !== 1 ? 's' : ''}
              </span>
            ) : (
              <span>Upload an Excel file to begin</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={isImporting}
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!parseResult || parseResult.validCount === 0 || isImporting}
              className={`px-6 py-2 text-sm font-bold text-white rounded-lg transition-colors flex items-center gap-2 ${
                !parseResult || parseResult.validCount === 0 || isImporting
                  ? 'bg-gray-400 cursor-not-allowed'
                  : `${MILIK_ORANGE} hover:bg-[#e67e00]`
              }`}
            >
              {isImporting ? (
                <>
                  <FaSpinner className="animate-spin" />
                  <span>Importing...</span>
                </>
              ) : (
                <>
                  <FaUpload />
                  <span>Import {parseResult?.validCount || 0} Landlords</span>
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
