import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaFileDownload, FaFileInvoice, FaFilePdf, FaFilter, FaSyncAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getIncomeStatementReport } from "../../redux/apiCalls";

const MILIK_GREEN = "#0B3B2E";
const MILIK_GREEN_BG = "bg-[#0B3B2E]";
const MILIK_ORANGE = "#FF8C00";
const MILIK_RED = "#DC2626";

const formatMoney = (value) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const firstDayOfMonth = () => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split("T")[0];
};

const todayString = () => new Date().toISOString().split("T")[0];

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const IncomeStatementReport = () => {
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
  const [report, setReport] = useState({
    income: { sections: [], total: 0, count: 0 },
    expenses: { sections: [], total: 0, count: 0 },
    summary: { totalIncome: 0, totalExpenses: 0, netProfit: 0, resultLabel: "Net Profit" },
    exclusions: [],
    reportBasis: "",
    startDate: new Date(),
    endDate: new Date(),
  });
  const [filters, setFilters] = useState({
    startDate: firstDayOfMonth(),
    endDate: todayString(),
  });

  const loadReport = useCallback(async () => {
    if (!businessId) {
      setReport((prev) => ({
        ...prev,
        rows: [],
        count: 0,
        totals: { debit: 0, credit: 0, difference: 0, balanced: true },
      }));
      return;
    }

    setLoading(true);
    try {
      const data = await getIncomeStatementReport({
        business: businessId,
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
      setReport(data);
    } catch (error) {
      console.error("Failed to load income statement", error);
      toast.error(error?.response?.data?.error || error?.message || "Failed to load income statement");
    } finally {
      setLoading(false);
    }
  }, [businessId, filters.startDate, filters.endDate]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleExportCSV = () => {
    const lines = [
      ["INCOME STATEMENT"].join(","),
      [`Period`, `${filters.startDate} to ${filters.endDate}`].join(","),
      [""].join(","),
      ["INCOME"].join(","),
    ];

    report.income.sections.forEach((section) => {
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

    lines.push(["", "Total Income", Number(report.summary?.totalIncome || 0).toFixed(2)].join(","));
    lines.push([""].join(","));
    lines.push(["EXPENSES"].join(","));

    report.expenses.sections.forEach((section) => {
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

    lines.push(["", "Total Expenses", Number(report.summary?.totalExpenses || 0).toFixed(2)].join(","));
    lines.push(["", report.summary?.resultLabel || "Net Profit", Number(report.summary?.netProfit || 0).toFixed(2)].join(","));

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `income_statement_${filters.startDate}_to_${filters.endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Income statement exported successfully");
  };

  const buildPrintableSection = (title, sections = [], total = 0, totalColor = "#111827") => {
    const content = sections.length
      ? sections
          .map(
            (section) => `
              <div class="print-section-block">
                <div class="section-heading-row">
                  <div class="section-heading">${escapeHtml(section.label)}</div>
                  <div class="section-heading amount">KES ${escapeHtml(formatMoney(section.total))}</div>
                </div>
                ${(section.rows || [])
                  .map(
                    (row) => `
                      <div class="item-row">
                        <div class="item-name">
                          <span class="item-code">${escapeHtml(row.code)}</span>
                          ${escapeHtml(row.name)}
                        </div>
                        <div class="item-amount">KES ${escapeHtml(formatMoney(row.amount))}</div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
          )
          .join("")
      : `<div class="empty-note">No accounts found for this period.</div>`;

    return `
      <div class="print-card">
        <div class="card-header">${escapeHtml(title)}</div>
        <div class="card-body">
          ${content}
          <div class="total-row" style="color:${totalColor}">
            <div>Total ${escapeHtml(title)}</div>
            <div>KES ${escapeHtml(formatMoney(total))}</div>
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
          <title>Income Statement - ${escapeHtml(filters.startDate)} to ${escapeHtml(filters.endDate)}</title>
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
              grid-template-columns: repeat(3, 1fr);
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
              font-size: 20px;
              font-weight: 800;
              color: #111827;
            }
            .two-col {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 18px;
              align-items: start;
              margin-bottom: 20px;
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
            }
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
            .profit-row {
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
              <h1 class="report-title">Income Statement</h1>
              <p class="report-subtitle">Property manager income and operating expenses only.</p>
            </div>

            <div class="meta-grid">
              <div class="meta-box">
                <div class="meta-label">Business</div>
                <div class="meta-value">${escapeHtml(businessName)}</div>
              </div>
              <div class="meta-box">
                <div class="meta-label">Period</div>
                <div class="meta-value">${escapeHtml(filters.startDate)} to ${escapeHtml(filters.endDate)}</div>
              </div>
              <div class="meta-box">
                <div class="meta-label">Basis</div>
                <div class="meta-value">${escapeHtml(
                  report.reportBasis || "Property manager income and operating expenses only"
                )}</div>
              </div>
            </div>

            <div class="summary-grid">
              <div class="summary-card">
                <div class="summary-label">Total Income</div>
                <div class="summary-value" style="color:#15803d;">KES ${escapeHtml(
                  formatMoney(report.summary?.totalIncome)
                )}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">Total Expenses</div>
                <div class="summary-value" style="color:${MILIK_RED};">KES ${escapeHtml(
                  formatMoney(report.summary?.totalExpenses)
                )}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">${escapeHtml(report.summary?.resultLabel || "Net Profit")}</div>
                <div class="summary-value" style="color:${Number(report.summary?.netProfit || 0) >= 0 ? MILIK_GREEN : MILIK_RED};">
                  KES ${escapeHtml(formatMoney(report.summary?.netProfit))}
                </div>
              </div>
            </div>

            <div class="two-col">
              ${buildPrintableSection(
                "Income",
                report.income?.sections || [],
                report.summary?.totalIncome || 0,
                "#15803d"
              )}
              ${buildPrintableSection(
                "Expenses",
                report.expenses?.sections || [],
                report.summary?.totalExpenses || 0,
                MILIK_RED
              )}
            </div>

            <div class="summary-card-wide">
              <div class="card-header">Summary</div>
              <div class="body">
                <div class="summary-row">
                  <div class="label">Total Income</div>
                  <div class="value" style="color:#15803d;">KES ${escapeHtml(
                    formatMoney(report.summary?.totalIncome)
                  )}</div>
                </div>
                <div class="summary-row">
                  <div class="label">Total Expenses</div>
                  <div class="value" style="color:${MILIK_RED};">KES ${escapeHtml(
                    formatMoney(report.summary?.totalExpenses)
                  )}</div>
                </div>
                <div class="summary-row profit-row">
                  <div class="label">${escapeHtml(report.summary?.resultLabel || "Net Profit")}</div>
                  <div class="value" style="color:${Number(report.summary?.netProfit || 0) >= 0 ? MILIK_GREEN : MILIK_RED};">
                    KES ${escapeHtml(formatMoney(report.summary?.netProfit))}
                  </div>
                </div>
              </div>
            </div>

            <div class="summary-card-wide" style="margin-top:20px;">
              <div class="card-header">Excluded From This Report</div>
              <div class="body">
                <ul style="margin:0; padding-left:18px; color:#374151; font-size:13px; font-weight:600; line-height:1.7;">
                  ${(report.exclusions || [])
                    .map((item) => `<li>${escapeHtml(item)}</li>`)
                    .join("")}
                </ul>
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

  const renderSection = (title, sections, total, accentClass = "text-gray-900") => (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className={`${MILIK_GREEN_BG} text-white px-6 py-4`}>
        <h3 className="text-lg font-extrabold tracking-wide">{title}</h3>
      </div>
      <div className="p-6 space-y-6">
        {sections.length ? (
          sections.map((section) => (
            <div key={section.label}>
              <div className="flex items-center justify-between border-b pb-2 mb-3">
                <h4 className="text-base font-extrabold text-gray-900">{section.label}</h4>
                <span className="text-sm font-bold text-gray-700">KES {formatMoney(section.total)}</span>
              </div>
              <div className="space-y-2">
                {section.rows.map((row) => (
                  <div key={row._id || `${row.code}-${row.name}`} className="flex items-center justify-between text-sm">
                    <div className="text-gray-800 font-semibold">
                      <span className="font-bold mr-2">{row.code}</span>
                      {row.name}
                    </div>
                    <div className="font-bold text-gray-900">KES {formatMoney(row.amount)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="text-sm font-medium text-gray-600">No accounts found for this period.</div>
        )}
        <div className="border-t pt-4 flex items-center justify-between">
          <span className={`text-lg font-extrabold ${accentClass}`}>Total {title}</span>
          <span className={`text-lg font-extrabold ${accentClass}`}>KES {formatMoney(total)}</span>
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
                  <FaFileInvoice style={{ color: MILIK_GREEN }} />
                  Income Statement
                </h1>
                <p className="text-gray-700 mt-1 font-medium">
                  Property manager income and operating expenses only.
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
                  className={`flex items-center gap-2 px-4 py-2 ${MILIK_GREEN_BG} hover:bg-[#0A3127] text-white rounded-lg font-bold transition`}
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
                <label className="block text-sm font-bold text-gray-800 mb-2">Start Date</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent font-semibold text-gray-800"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-2">End Date</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent font-semibold text-gray-800"
                />
              </div>
              <div className="text-sm text-gray-700 font-medium">
                <div>
                  <span className="font-bold">Business:</span>{" "}
                  {businessName}
                </div>
                <div>
                  <span className="font-bold">Basis:</span>{" "}
                  {report.reportBasis || "Property manager income and operating expenses only"}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-bold text-gray-700 mb-1">Total Income</div>
              <div className="text-4xl font-extrabold tracking-tight text-green-700">
                KES {formatMoney(report.summary?.totalIncome)}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-bold text-gray-700 mb-1">Total Expenses</div>
              <div className="text-4xl font-extrabold tracking-tight text-red-600">
                KES {formatMoney(report.summary?.totalExpenses)}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-bold text-gray-700 mb-1">
                {report.summary?.resultLabel || "Net Profit"}
              </div>
              <div
                className="text-4xl font-extrabold tracking-tight"
                style={{ color: Number(report.summary?.netProfit || 0) >= 0 ? MILIK_GREEN : MILIK_RED }}
              >
                KES {formatMoney(report.summary?.netProfit)}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="bg-white rounded-lg shadow p-10 text-center text-gray-600 font-medium">
              Loading income statement...
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {renderSection("Income", report.income?.sections || [], report.summary?.totalIncome || 0, "text-green-700")}
              {renderSection("Expenses", report.expenses?.sections || [], report.summary?.totalExpenses || 0, "text-red-600")}
            </div>
          )}

          <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
            <div className={`${MILIK_GREEN_BG} text-white px-6 py-4`}>
              <h3 className="text-lg font-extrabold tracking-wide">Summary</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between text-base">
                <span className="font-bold text-gray-800">Total Income</span>
                <span className="font-extrabold text-green-700">KES {formatMoney(report.summary?.totalIncome)}</span>
              </div>
              <div className="flex items-center justify-between text-base">
                <span className="font-bold text-gray-800">Total Expenses</span>
                <span className="font-extrabold text-red-600">KES {formatMoney(report.summary?.totalExpenses)}</span>
              </div>
              <div className="border-t pt-4 flex items-center justify-between text-lg">
                <span className="font-extrabold text-gray-900">
                  {report.summary?.resultLabel || "Net Profit"}
                </span>
                <span
                  className="font-extrabold"
                  style={{ color: Number(report.summary?.netProfit || 0) >= 0 ? MILIK_GREEN : MILIK_RED }}
                >
                  KES {formatMoney(report.summary?.netProfit)}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className={`${MILIK_GREEN_BG} text-white px-6 py-4`}>
              <h3 className="text-lg font-extrabold tracking-wide">Excluded From This Report</h3>
            </div>
            <div className="p-6">
              <ul className="space-y-2 text-sm font-medium text-gray-800 list-disc pl-5">
                {(report.exclusions || []).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default IncomeStatementReport;