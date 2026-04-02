import React from "react";
import { useSelector } from "react-redux";
import { hasCompanyPermission } from "../../utils/permissions";
import {
  FaEye,
  FaCheckCircle,
  FaPaperPlane,
  FaDownload,
  FaEdit,
  FaTrash,
  FaFileAlt,
} from "react-icons/fa";

const MILIK_GREEN = "#0B3B2E";

const getStatusBadge = (status) => {
  const statusConfig = {
    draft: {
      bg: "#FFF4DB",
      text: "#8A5418",
      label: "Draft",
    },
    reviewed: {
      bg: "#E8F0FE",
      text: "#2856A6",
      label: "Reviewed",
    },
    approved: {
      bg: "#EAF7EE",
      text: "#1C6B38",
      label: "Approved",
    },
    sent: {
      bg: "#EFEAFE",
      text: "#5C34B0",
      label: "Sent",
    },
    revised: {
      bg: "#FDECF2",
      text: "#A93E6C",
      label: "Revised",
    },
  };

  return statusConfig[status] || statusConfig.draft;
};

const StatementStatusBadge = ({ status }) => {
  const config = getStatusBadge(status);
  return (
    <span
      style={{
        backgroundColor: config.bg,
        color: config.text,
      }}
      className="inline-flex items-center justify-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]"
    >
      {config.label}
    </span>
  );
};

const StatementsTable = ({
  statements = [],
  loading = false,
  onViewStatement,
  onApproveStatement,
  onSendStatement,
  onReviseStatement,
  onDeleteStatement,
  onDownloadPdf,
}) => {
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const allowApprove = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "approve", "propertyManagement");
  const allowSend = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "send", "propertyManagement");
  const allowRevise = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "update", "propertyManagement");
  const allowDelete = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "delete", "propertyManagement");
  const allowExport = hasCompanyPermission(currentUser || {}, currentCompany, "statements", "export", "propertyManagement");
  const formatCurrency = (value) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
    }).format(Number(value || 0));
  };

  const formatDate = (date) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleDateString("en-GB");
  };

  const getLandlordName = (statement) => {
    const firstName = statement?.landlord?.firstName || "";
    const lastName = statement?.landlord?.lastName || "";
    const fullName = `${firstName} ${lastName}`.trim();
    return fullName || statement?.landlord?.landlordName || statement?.landlord?.name || "N/A";
  };

  const getPropertyName = (statement) => {
    return statement?.property?.propertyName || statement?.property?.name || "N/A";
  };

  const canApprove = (status) => status === "draft" || status === "reviewed";
  const canSend = (status) => status === "approved";
  const canRevise = (status) => status === "approved" || status === "sent";
  const canDelete = (status) => status === "draft";
  const canDownloadPdf = (status) => status === "approved" || status === "sent";

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#D7E0DB] border-t-[#0B3B2E]" />
        <p className="mt-3 text-sm font-medium text-gray-600">Loading landlord statements...</p>
      </div>
    );
  }

  if (!statements || statements.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-4 rounded-2xl bg-[#F4F7F5] p-5 text-[#0B3B2E]">
          <FaFileAlt className="text-3xl" />
        </div>
        <h3 className="text-lg font-bold text-gray-900">No statements found</h3>
        <p className="mt-2 max-w-md text-sm text-gray-500">
          Generate a new landlord statement or adjust your filters to see matching records.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse">
        <thead>
          <tr className="border-b border-[#E8EEEA] bg-[#F7FAF8]">
            <th className="px-5 py-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[#486255]">Statement</th>
            <th className="px-5 py-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[#486255]">Property / Landlord</th>
            <th className="px-5 py-4 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[#486255]">Period</th>
            <th className="px-5 py-4 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[#486255]">Version</th>
            <th className="px-5 py-4 text-right text-[11px] font-bold uppercase tracking-[0.14em] text-[#486255]">Opening</th>
            <th className="px-5 py-4 text-right text-[11px] font-bold uppercase tracking-[0.14em] text-[#486255]">Closing</th>
            <th className="px-5 py-4 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[#486255]">Status</th>
            <th className="px-5 py-4 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[#486255]">Actions</th>
          </tr>
        </thead>
        <tbody>
          {statements.map((statement) => (
            <tr key={statement._id} className="border-b border-[#EEF2EF] align-top transition hover:bg-[#FBFCFB]">
              <td className="px-5 py-4">
                <div className="font-semibold text-gray-900">{statement.statementNumber || "N/A"}</div>
                <div className="mt-1 text-xs text-gray-500">Refreshed statement snapshot</div>
              </td>

              <td className="px-5 py-4">
                <div className="font-medium text-gray-900">{getPropertyName(statement)}</div>
                <div className="mt-1 text-sm text-gray-500">{getLandlordName(statement)}</div>
              </td>

              <td className="px-5 py-4 text-sm text-gray-700">
                {formatDate(statement.periodStart)} - {formatDate(statement.periodEnd)}
              </td>

              <td className="px-5 py-4 text-center">
                <span className="inline-flex min-w-[48px] items-center justify-center rounded-full bg-[#F2F5F3] px-3 py-1 text-xs font-semibold text-[#355247]">
                  v{statement.version || 1}
                </span>
              </td>

              <td className="px-5 py-4 text-right text-sm font-semibold text-gray-800">
                {formatCurrency(statement.openingBalance)}
              </td>

              <td className="px-5 py-4 text-right text-sm font-semibold text-gray-900">
                {formatCurrency(statement.closingBalance)}
              </td>

              <td className="px-5 py-4 text-center">
                <StatementStatusBadge status={statement.status} />
              </td>

              <td className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={() => onViewStatement(statement)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#DCE5E0] bg-white text-[#2856A6] transition hover:bg-[#EEF4FF]"
                    title="View"
                  >
                    <FaEye />
                  </button>

                  {allowApprove && canApprove(statement.status) && (
                    <button
                      onClick={() => onApproveStatement(statement)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#DCE5E0] bg-white text-[#1C6B38] transition hover:bg-[#ECF8F0]"
                      title="Approve"
                    >
                      <FaCheckCircle />
                    </button>
                  )}

                  {allowExport && canDownloadPdf(statement.status) && (
                    <button
                      onClick={() => onDownloadPdf(statement)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#DCE5E0] bg-white text-[#C96E12] transition hover:bg-[#FFF5E9]"
                      title="Download PDF"
                    >
                      <FaDownload />
                    </button>
                  )}

                  {allowSend && canSend(statement.status) && (
                    <button
                      onClick={() => onSendStatement(statement)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#DCE5E0] bg-white text-[#6D3CC2] transition hover:bg-[#F3EEFF]"
                      title="Send"
                    >
                      <FaPaperPlane />
                    </button>
                  )}

                  {allowRevise && canRevise(statement.status) && (
                    <button
                      onClick={() => onReviseStatement(statement)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#DCE5E0] bg-white text-[#A97017] transition hover:bg-[#FFF8E8]"
                      title="Create Revision"
                    >
                      <FaEdit />
                    </button>
                  )}

                  {allowDelete && canDelete(statement.status) && (
                    <button
                      onClick={() => onDeleteStatement(statement)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#DCE5E0] bg-white text-[#B93838] transition hover:bg-[#FFF0F0]"
                      title="Delete"
                    >
                      <FaTrash />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default StatementsTable;
