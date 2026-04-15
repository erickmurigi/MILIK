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

const MILIK_GREEN = "bg-[#0B3B2E]";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className={`${MILIK_GREEN} flex items-center justify-between px-6 py-4 text-white`}>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <FaUpload />
            Import Tenants from Excel
          </h2>
          <button
            onClick={handleClose}
            className="transition-colors hover:text-gray-300"
            disabled={isUploading || isImporting}
          >
            <FaTimes size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white px-6 py-4">
          <div className="mb-6">
            <label className="mb-3 block text-sm font-semibold text-gray-700">
              Select Excel File (.xlsx or .xls)
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={isUploading || isImporting}
              className="block w-full cursor-pointer text-sm text-gray-500 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-[#0B3B2E] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[#0d5442] disabled:opacity-50"
            />
            {selectedFile && (
              <p className="mt-2 text-xs text-slate-500">
                Loaded file: <span className="font-semibold text-slate-700">{selectedFile.name}</span>
              </p>
            )}
          </div>

          {parseResult && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-1 text-sm font-semibold text-gray-600">Total Rows</div>
                  <div className="text-2xl font-bold text-gray-900">{parseResult.total}</div>
                </div>
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <div className="mb-1 flex items-center gap-1 text-sm font-semibold text-green-700">
                    <FaCheckCircle />
                    Valid Rows
                  </div>
                  <div className="text-2xl font-bold text-green-700">{parseResult.validCount}</div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <div className="mb-1 flex items-center gap-1 text-sm font-semibold text-red-700">
                    <FaExclamationTriangle />
                    Rows with Errors
                  </div>
                  <div className="text-2xl font-bold text-red-700">{parseResult.errorCount}</div>
                </div>
              </div>

              {previewRows.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-700">
                    Preview (First {previewRows.length} Valid Record{previewRows.length === 1 ? "" : "s"})
                  </h4>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-bold uppercase text-gray-700">Tenant</th>
                          <th className="px-3 py-2 text-left text-xs font-bold uppercase text-gray-700">Property / Unit</th>
                          <th className="px-3 py-2 text-left text-xs font-bold uppercase text-gray-700">Additional Units</th>
                          <th className="px-3 py-2 text-right text-xs font-bold uppercase text-gray-700">Rent</th>
                          <th className="px-3 py-2 text-right text-xs font-bold uppercase text-gray-700">Deposit</th>
                          <th className="px-3 py-2 text-left text-xs font-bold uppercase text-gray-700">Held By</th>
                          <th className="px-3 py-2 text-left text-xs font-bold uppercase text-gray-700">Utilities</th>
                          <th className="px-3 py-2 text-left text-xs font-bold uppercase text-gray-700">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {previewRows.map((record, index) => (
                          <tr key={`${record.tenantName}-${index}`} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-sm text-gray-900">
                              <div className="font-semibold">{record.tenantName}</div>
                              <div className="text-xs text-gray-500">{record.phoneNumber || "-"}</div>
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-700">
                              <div className="font-semibold">{record.propertyCode}</div>
                              <div className="text-xs text-gray-500">{record.unitNumber}</div>
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-700">
                              {Array.isArray(record.additionalUnitNumbers) && record.additionalUnitNumbers.length > 0
                                ? record.additionalUnitNumbers.join(", ")
                                : "-"}
                            </td>
                            <td className="px-3 py-2 text-right text-sm text-gray-700">{formatMoney(record.rent)}</td>
                            <td className="px-3 py-2 text-right text-sm text-gray-700">{formatMoney(record.depositAmount)}</td>
                            <td className="px-3 py-2 text-sm text-gray-700">{record.depositHeldBy || "Property Default"}</td>
                            <td className="px-3 py-2 text-sm text-gray-700">{formatUtilities(record.utilities)}</td>
                            <td className="px-3 py-2 text-sm capitalize text-gray-700">{record.status || "active"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parseResult.validCount > previewRows.length && (
                    <p className="mt-2 text-sm text-gray-500">
                      ...and {parseResult.validCount - previewRows.length} more valid record(s)
                    </p>
                  )}
                </div>
              )}

              {parseResult.errorCount > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-red-700">
                      Validation Errors ({parseResult.errorCount})
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowErrors((prev) => !prev)}
                      className="text-xs font-semibold text-red-700 underline"
                    >
                      {showErrors ? "Hide details" : "Show details"}
                    </button>
                  </div>

                  {showErrors && (
                    <div className="max-h-72 space-y-3 overflow-y-auto">
                      {parseResult.errors.map((errorItem, index) => (
                        <div key={`${errorItem.row}-${index}`} className="rounded-md border border-red-200 bg-white p-3">
                          <div className="text-sm font-semibold text-red-700">
                            Row {errorItem.row} {errorItem.tenantName ? `- ${errorItem.tenantName}` : ""}
                          </div>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-600">
                            {(Array.isArray(errorItem.errors) ? errorItem.errors : []).map((message, messageIndex) => (
                              <li key={messageIndex}>{message}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {importFailures.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <h4 className="mb-3 text-sm font-semibold text-amber-800">
                    Backend Import Failures ({importFailures.length})
                  </h4>
                  <div className="max-h-72 space-y-3 overflow-y-auto">
                    {importFailures.map((failure, index) => (
                      <div key={`${failure.row || "row"}-${index}`} className="rounded-md border border-amber-200 bg-white p-3">
                        <div className="text-sm font-semibold text-amber-800">
                          {failure.row ? `Row ${failure.row}` : "Row"} {failure.tenantName ? `- ${failure.tenantName}` : ""}
                        </div>
                        <p className="mt-1 text-sm text-amber-700">{failure.error || "Import failed"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4">
          <div className="text-sm text-gray-600">
            {parseResult
              ? `${parseResult.validCount} valid row(s) ready for import`
              : "Upload a tenant import file to validate first"}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              disabled={isUploading || isImporting}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={isUploading || isImporting || !parseResult || parseResult.validCount === 0}
              className={`${MILIK_GREEN} flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0d5442] disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {isUploading || isImporting ? (
                <>
                  <FaSpinner className="animate-spin" />
                  {isUploading ? "Validating..." : "Importing..."}
                </>
              ) : (
                <>
                  <FaUpload />
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
