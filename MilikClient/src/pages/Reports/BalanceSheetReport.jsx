import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaBalanceScale, FaFileDownload, FaFilePdf, FaFilter, FaSyncAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getBalanceSheetReport } from "../../redux/apiCalls";

const MILIK_GREEN = "#0B3B2E";
const MILIK_ORANGE = "#FF8C00";
const MILIK_RED = "#DC2626";

const formatMoney = (value) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatSignedMoney = (value) => {
  const amount = Number(value || 0);
  const formatted = formatMoney(Math.abs(amount));
  return amount < 0 ? `(${formatted})` : formatted;
};

const todayString = () => new Date().toISOString().split("T")[0];

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const BalanceSheetReport = () => {
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);

  const businessId = useMemo(() => {
    const activeCompanyId = localStorage.getItem("milik_active_company_id");
    const storedUser = (() => {
      try {
        return JSON.parse(localStorage.getItem("milik_user") || "null");
      } catch {
        return null;
      }
    })();

    return (
      currentCompany?._id ||
      currentUser?.company?._id ||
      currentUser?.company ||
      currentUser?.businessId ||
      activeCompanyId ||
      storedUser?.company?._id ||
      storedUser?.company ||
      storedUser?.businessId ||
      ""
    );
  }, [currentCompany?._id, currentUser?.company, currentUser?.businessId]);

  const businessName =
    currentCompany?.companyName || currentUser?.company?.companyName || "Active company";

  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    asOfDate: todayString(),
    includeZeroBalances: false,
  });
  const [report, setReport] = useState({
    assets: { sections: [], total: 0, count: 0 },
    liabilities: { sections: [], total: 0, count: 0 },
    equity: { sections: [], total: 0, count: 0, currentPeriodEarnings: 0 },
    summary: {
      totalAssets: 0,
      totalLiabilities: 0,
      totalEquity: 0,
      totalLiabilitiesAndEquity: 0,
      difference: 0,
      balanced: true,
    },
    asOfDate: new Date().toISOString(),
    reportBasis: "",
  });

  const loadReport = useCallback(async () => {
    if (!businessId) {
      setReport((prev) => ({
        ...prev,
        assets: { sections: [], total: 0, count: 0 },
        liabilities: { sections: [], total: 0, count: 0 },
        equity: { sections: [], total: 0, count: 0, currentPeriodEarnings: 0 },
        summary: {
          totalAssets: 0,
          totalLiabilities: 0,
          totalEquity: 0,
          totalLiabilitiesAndEquity: 0,
          difference: 0,
          balanced: true,
        },
      }));
      return;
    }

    setLoading(true);
    try {
      const data = await getBalanceSheetReport({
        business: businessId,
        asOfDate: filters.asOfDate,
        includeZeroBalances: filters.includeZeroBalances,
      });
      setReport(data);
    } catch (error) {
      console.error("Failed to load balance sheet", error);
      toast.error(error?.response?.data?.error || error?.message || "Failed to load balance sheet");
    } finally {
      setLoading(false);
    }
  }, [businessId, filters.asOfDate, filters.includeZeroBalances]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleExportCSV = () => {
    const lines = [
      ["BALANCE SHEET"].join(","),
      ["As At", filters.asOfDate].join(","),
      [""].join(","),
      ["ASSETS"].join(","),
    ];

    const appendSections = (sections = []) => {
      sections.forEach((section) => {
        lines.push([section.label].join(","));
        section.rows.forEach((row) => {
          lines.push([
            row.code,
            `"${String(row.name || "").replaceAll('"', '""')}"`,
            Number(row.amount || 0).toFixed(2),
          ].join(","));
        });
        lines.push(["", `Subtotal ${section.label}`, Number(section.total || 0).toFixed(2)].join(","));
      });
    };

    appendSections(report.assets?.sections || []);
    lines.push(["", "Total Assets", Number(report.summary?.totalAssets || 0).toFixed(2)].join(","));
    lines.push([""].join(","));
    lines.push(["LIABILITIES"].join(","));
    appendSections(report.liabilities?.sections || []);
    lines.push(["", "Total Liabilities", Number(report.summary?.totalLiabilities || 0).toFixed(2)].join(","));
    lines.push([""].join(","));
    lines.push(["EQUITY"].join(","));
    appendSections(report.equity?.sections || []);
    lines.push(["", "Total Equity", Number(report.summary?.totalEquity || 0).toFixed(2)].join(","));
    lines.push(["", "Total Liabilities and Equity", Number(report.summary?.totalLiabilitiesAndEquity || 0).toFixed(2)].join(","));
    lines.push(["", "Difference", Number(report.summary?.difference || 0).toFixed(2)].join(","));

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `balance_sheet_${filters.asOfDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Balance sheet exported successfully");
  };

  const buildPrintableSection = (title, sections = [], total = 0, totalClassName = "") => {
    const content = sections.length
      ? sections
          .map(
            (section) => `
              <div class="print-section-block">
                <div class="section-heading-row">
                  <div class="section-heading">${escapeHtml(section.label)}</div>
                  <div class="section-heading amount">KES ${escapeHtml(formatSignedMoney(section.total))}</div>
                </div>
                ${(section.rows || [])
                  .map(
                    (row) => `
                      <div class="item-row">
                        <div class="item-name">
                          <span class="item-code">${escapeHtml(row.code)}</span>
                          ${escapeHtml(row.name)}
                        </div>
                        <div class="item-amount">KES ${escapeHtml(formatSignedMoney(row.amount))}</div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
          )
          .join("")
      : `<div class="empty-note">No balances found for this section.</div>`;

    return `
      <div class="print-card">
        <div class="card-header">${escapeHtml(title)}</div>
        <div class="card-body">
          ${content}
          <div class="total-row ${totalClassName}">
            <div>Total ${escapeHtml(title)}</div>
            <div>KES ${escapeHtml(formatSignedMoney(total))}</div>
          </div>
        </div>
      </div>
    `;
  };

  const handlePrintPDF = () => {
    if (loading) {
      toast.info("Please wait for the report to finish loading.");
      return;
    }

    const printWindow = window.open("", "_blank", "width=1200,height=900");
    if (!printWindow) {
      toast.error("Popup blocked. Please allow popups to print the report.");
      return;
    }

    const printableHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Balance Sheet - ${escapeHtml(filters.asOfDate)}</title>
          <meta charset="utf-8" />
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: Arial, Helvetica, sans-serif;
              margin: 0;
              padding: 24px;
              color: #111827;
              background: #ffffff;
            }
            .report-wrap {
              width: 100%;
              max-width: 1100px;
              margin: 0 auto;
            }
            .report-header {
              margin-bottom: 20px;
              border-bottom: 2px solid ${MILIK_GREEN};
              padding-bottom: 12px;
            }
            .report-title {
              font-size: 30px;
              font-weight: 800;
              color: ${MILIK_GREEN};
              margin: 0 0 6px 0;
            }
            .report-subtitle {
              font-size: 14px;
              font-weight: 600;
              color: #4b5563;
              margin: 0;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 12px;
              margin: 18px 0 20px 0;
            }
            .meta-box {
              border: 1px solid #d1d5db;
              border-radius: 8px;
              padding: 12px 14px;
              background: #f9fafb;
            }
            .meta-label {
              font-size: 12px;
              font-weight: 700;
              color: #4b5563;
              margin-bottom: 4px;
              text-transform: uppercase;
            }
            .meta-value {
              font-size: 16px;
              font-weight: 800;
              color: #111827;
            }
            .summary-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 12px;
              margin-bottom: 20px;
            }
            .summary-card {
              border: 1px solid #d1d5db;
              border-radius: 8px;
              padding: 12px 14px;
              background: #ffffff;
            }
            .summary-label {
              font-size: 12px;
              font-weight: 700;
              color: #4b5563;
              margin-bottom: 4px;
              text-transform: uppercase;
            }
            .summary-value {
              font-size: 18px;
              font-weight: 800;
              color: #111827;
            }
            .summary-status-ok { color: ${MILIK_GREEN}; }
            .summary-status-bad { color: ${MILIK_RED}; }

            .two-col {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 18px;
              align-items: start;
              margin-bottom: 20px;
            }
            .stack {
              display: grid;
              gap: 18px;
            }
            .print-card {
              border: 1px solid #d1d5db;
              border-radius: 8px;
              overflow: hidden;
              background: #ffffff;
            }
            .card-header {
              background: ${MILIK_GREEN};
              color: #ffffff;
              padding: 12px 14px;
              font-size: 16px;
              font-weight: 800;
            }
            .card-body {
              padding: 14px;
            }
            .print-section-block + .print-section-block {
              margin-top: 18px;
            }
            .section-heading-row,
            .item-row,
            .total-row,
            .summary-row {
              display: flex;
              justify-content: space-between;
              gap: 12px;
            }
            .section-heading-row {
              border-bottom: 1px solid #d1d5db;
              padding-bottom: 6px;
              margin-bottom: 8px;
            }
            .section-heading {
              font-size: 14px;
              font-weight: 800;
              color: #111827;
            }
            .item-row {
              padding: 4px 0;
              font-size: 13px;
            }
            .item-name {
              font-weight: 600;
              color: #374151;
            }
            .item-code {
              font-weight: 800;
              margin-right: 8px;
            }
            .item-amount,
            .amount {
              font-weight: 800;
              white-space: nowrap;
            }
            .empty-note {
              font-size: 13px;
              color: #6b7280;
              font-weight: 600;
            }
            .total-row {
              border-top: 2px solid #d1d5db;
              margin-top: 14px;
              padding-top: 10px;
              font-size: 15px;
              font-weight: 800;
              color: #111827;
            }
            .total-liabilities { color: ${MILIK_RED}; }
            .total-equity { color: ${MILIK_GREEN}; }

            .summary-card-wide {
              border: 1px solid #d1d5db;
              border-radius: 8px;
              overflow: hidden;
              background: #ffffff;
            }
            .summary-card-wide .body {
              padding: 14px;
            }
            .summary-row {
              padding: 6px 0;
              font-size: 14px;
            }
            .summary-row .label {
              font-weight: 700;
              color: #374151;
            }
            .summary-row .value {
              font-weight: 800;
            }
            .difference-row {
              border-top: 2px solid #d1d5db;
              margin-top: 12px;
              padding-top: 10px;
              font-size: 16px;
              font-weight: 800;
            }

            @media print {
              body {
                padding: 0;
              }
              .report-wrap {
                max-width: none;
              }
              @page {
                size: A4 portrait;
                margin: 12mm;
              }
            }
          </style>
        </head>
        <body>
          <div class="report-wrap">
            <div class="report-header">
              <h1 class="report-title">Balance Sheet</h1>
              <p class="report-subtitle">Statement of financial position as at the selected date.</p>
            </div>

            <div class="meta-grid">
              <div class="meta-box">
                <div class="meta-label">Business</div>
                <div class="meta-value">${escapeHtml(businessName)}</div>
              </div>
              <div class="meta-box">
                <div class="meta-label">As At Date</div>
                <div class="meta-value">${escapeHtml(filters.asOfDate)}</div>
              </div>
              <div class="meta-box">
                <div class="meta-label">Basis</div>
                <div class="meta-value">${escapeHtml(
                  report.reportBasis || "Statement of financial position"
                )}</div>
              </div>
            </div>

            <div class="summary-grid">
              <div class="summary-card">
                <div class="summary-label">Total Assets</div>
                <div class="summary-value">KES ${escapeHtml(formatSignedMoney(report.summary?.totalAssets))}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">Total Liabilities</div>
                <div class="summary-value">KES ${escapeHtml(formatSignedMoney(report.summary?.totalLiabilities))}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">Total Equity</div>
                <div class="summary-value">KES ${escapeHtml(formatSignedMoney(report.summary?.totalEquity))}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">Status</div>
                <div class="summary-value ${report.summary?.balanced ? "summary-status-ok" : "summary-status-bad"}">
                  ${escapeHtml(report.summary?.balanced ? "Balanced" : "Out of Balance")}
                </div>
              </div>
            </div>

            <div class="two-col">
              ${buildPrintableSection(
                "Assets",
                report.assets?.sections || [],
                report.summary?.totalAssets || 0
              )}
              <div class="stack">
                ${buildPrintableSection(
                  "Liabilities",
                  report.liabilities?.sections || [],
                  report.summary?.totalLiabilities || 0,
                  "total-liabilities"
                )}
                ${buildPrintableSection(
                  "Equity",
                  report.equity?.sections || [],
                  report.summary?.totalEquity || 0,
                  "total-equity"
                )}
              </div>
            </div>

            <div class="summary-card-wide">
              <div class="card-header">Statement Summary</div>
              <div class="body">
                <div class="summary-row">
                  <div class="label">Total Assets</div>
                  <div class="value">KES ${escapeHtml(formatSignedMoney(report.summary?.totalAssets))}</div>
                </div>
                <div class="summary-row">
                  <div class="label">Total Liabilities</div>
                  <div class="value" style="color:${MILIK_RED};">KES ${escapeHtml(
                    formatSignedMoney(report.summary?.totalLiabilities)
                  )}</div>
                </div>
                <div class="summary-row">
                  <div class="label">Total Equity</div>
                  <div class="value" style="color:${MILIK_GREEN};">KES ${escapeHtml(
                    formatSignedMoney(report.summary?.totalEquity)
                  )}</div>
                </div>
                <div class="summary-row">
                  <div class="label">Liabilities + Equity</div>
                  <div class="value">KES ${escapeHtml(
                    formatSignedMoney(report.summary?.totalLiabilitiesAndEquity)
                  )}</div>
                </div>
                <div class="summary-row difference-row">
                  <div class="label">Difference</div>
                  <div class="value" style="color:${report.summary?.balanced ? MILIK_GREEN : MILIK_RED};">
                    KES ${escapeHtml(formatSignedMoney(report.summary?.difference))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(printableHtml);
    printWindow.document.close();
    printWindow.focus();

    const triggerPrint = () => {
      printWindow.print();
    };

    if (printWindow.document.readyState === "complete") {
      setTimeout(triggerPrint, 300);
    } else {
      printWindow.onload = () => setTimeout(triggerPrint, 300);
    }
  };

  const renderSectionCard = (title, sections, total, accentClass = "text-gray-900") => (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="bg-[#0B3B2E] text-white px-6 py-4">
        <h3 className="text-lg font-extrabold tracking-wide">{title}</h3>
      </div>
      <div className="p-6 space-y-6">
        {sections.length ? (
          sections.map((section) => (
            <div key={section.label}>
              <div className="flex items-center justify-between border-b pb-2 mb-3">
                <h4 className="text-base font-extrabold text-gray-900">{section.label}</h4>
                <span className="text-sm font-bold text-gray-700">
                  KES {formatSignedMoney(section.total)}
                </span>
              </div>
              <div className="space-y-2">
                {section.rows.map((row) => (
                  <div key={row._id || `${row.code}-${row.name}`} className="flex items-center justify-between gap-4 text-sm">
                    <div className="text-gray-800 font-semibold">
                      <span className="font-bold mr-2">{row.code}</span>
                      {row.name}
                    </div>
                    <div className="font-bold text-gray-900 whitespace-nowrap">
                      KES {formatSignedMoney(row.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="text-sm font-medium text-gray-600">No balances found for this section.</div>
        )}
        <div className="border-t pt-4 flex items-center justify-between">
          <span className={`text-lg font-extrabold ${accentClass}`}>Total {title}</span>
          <span className={`text-lg font-extrabold ${accentClass}`}>KES {formatSignedMoney(total)}</span>
        </div>
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900 flex items-center gap-3">
                  <FaBalanceScale style={{ color: MILIK_GREEN }} />
                  Balance Sheet
                </h1>
                <p className="text-gray-700 mt-1 font-medium">
                  Statement of financial position as at the selected date.
                </p>
              </div>
              <div className="flex gap-3 print:hidden flex-wrap">
                <button
                  onClick={loadReport}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition"
                >
                  <FaSyncAlt /> Refresh
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold transition"
                >
                  <FaFileDownload /> Export CSV
                </button>
                <button
                  onClick={handlePrintPDF}
                  className="flex items-center gap-2 px-4 py-2 bg-[#0B3B2E] hover:bg-[#0A3127] text-white rounded-lg font-bold transition"
                >
                  <FaFilePdf /> Print PDF
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6 mb-6 print:hidden">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <FaFilter style={{ color: MILIK_ORANGE }} />
              Filters
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-2">As At Date</label>
                <input
                  type="date"
                  value={filters.asOfDate}
                  onChange={(e) => setFilters((prev) => ({ ...prev, asOfDate: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent font-semibold text-gray-800"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-2">Options</label>
                <label className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg bg-white">
                  <input
                    type="checkbox"
                    checked={filters.includeZeroBalances}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, includeZeroBalances: e.target.checked }))
                    }
                  />
                  <span className="text-sm font-semibold text-gray-800">Include zero balance accounts</span>
                </label>
              </div>
              <div className="text-sm text-gray-700 font-medium">
                <div>
                  <span className="font-bold">Business:</span> {businessName}
                </div>
                <div>
                  <span className="font-bold">Basis:</span>{" "}
                  {report.reportBasis || "Statement of financial position"}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-bold text-gray-700 mb-1">Total Assets</div>
              <div className="text-4xl font-extrabold tracking-tight text-gray-900">
                KES {formatSignedMoney(report.summary?.totalAssets)}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-bold text-gray-700 mb-1">Total Liabilities</div>
              <div className="text-4xl font-extrabold tracking-tight text-gray-900">
                KES {formatSignedMoney(report.summary?.totalLiabilities)}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-bold text-gray-700 mb-1">Total Equity</div>
              <div className="text-4xl font-extrabold tracking-tight text-gray-900">
                KES {formatSignedMoney(report.summary?.totalEquity)}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-bold text-gray-700 mb-1">Status</div>
              <div
                className="text-3xl font-extrabold tracking-tight"
                style={{ color: report.summary?.balanced ? MILIK_GREEN : MILIK_RED }}
              >
                {report.summary?.balanced ? "Balanced" : "Out of Balance"}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="bg-white rounded-lg shadow p-10 text-center text-gray-600 font-medium">
              Loading balance sheet...
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
              {renderSectionCard(
                "Assets",
                report.assets?.sections || [],
                report.summary?.totalAssets || 0,
                "text-gray-900"
              )}
              <div className="space-y-6">
                {renderSectionCard(
                  "Liabilities",
                  report.liabilities?.sections || [],
                  report.summary?.totalLiabilities || 0,
                  "text-red-700"
                )}
                {renderSectionCard(
                  "Equity",
                  report.equity?.sections || [],
                  report.summary?.totalEquity || 0,
                  "text-green-700"
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
            <div className="bg-[#0B3B2E] text-white px-6 py-4">
              <h3 className="text-lg font-extrabold tracking-wide">Statement Summary</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between text-base">
                <span className="font-bold text-gray-800">Total Assets</span>
                <span className="font-extrabold text-gray-900">
                  KES {formatSignedMoney(report.summary?.totalAssets)}
                </span>
              </div>
              <div className="flex items-center justify-between text-base">
                <span className="font-bold text-gray-800">Total Liabilities</span>
                <span className="font-extrabold text-red-700">
                  KES {formatSignedMoney(report.summary?.totalLiabilities)}
                </span>
              </div>
              <div className="flex items-center justify-between text-base">
                <span className="font-bold text-gray-800">Total Equity</span>
                <span className="font-extrabold text-green-700">
                  KES {formatSignedMoney(report.summary?.totalEquity)}
                </span>
              </div>
              <div className="flex items-center justify-between text-base">
                <span className="font-bold text-gray-800">Liabilities + Equity</span>
                <span className="font-extrabold text-gray-900">
                  KES {formatSignedMoney(report.summary?.totalLiabilitiesAndEquity)}
                </span>
              </div>
              <div className="border-t pt-4 flex items-center justify-between text-lg">
                <span className="font-extrabold text-gray-900">Difference</span>
                <span
                  className="font-extrabold"
                  style={{ color: report.summary?.balanced ? MILIK_GREEN : MILIK_RED }}
                >
                  KES {formatSignedMoney(report.summary?.difference)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default BalanceSheetReport;