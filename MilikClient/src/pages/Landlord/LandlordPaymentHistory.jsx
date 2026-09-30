import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useSearchParams, useNavigate } from "react-router-dom";
import { FaArrowLeft, FaRedoAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import MilikTable from "../../components/common/MilikTable";
import { getLandlordPayments } from "../../redux/apiCalls";
import { selectCurrentCompany } from "../../redux/selectors";
import { fmtDate } from "../../utils/dates";
const money = (value) => `Ksh ${Number(value || 0).toLocaleString()}`;

const LandlordPaymentHistory = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const landlordId = searchParams.get("landlordId");
  const currentCompany = useSelector(selectCurrentCompany);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadPayments = useCallback(async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const rows = await getLandlordPayments(currentCompany._id);
      setPayments(Array.isArray(rows) ? rows : []);
    } finally {
      setLoading(false);
    }
  }, [currentCompany?._id]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const filteredPayments = useMemo(() => {
    return payments.filter((payment) => {
      if (!landlordId) return true;
      return String(payment?.landlord?._id || payment?.landlord || payment?.landlordId || "") === String(landlordId);
    });
  }, [payments, landlordId]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/95 p-2 shadow-sm backdrop-blur">
          <button onClick={() => navigate(-1)} className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-100">
            <FaArrowLeft /> Back
          </button>
          <button onClick={loadPayments} className="inline-flex h-8 items-center gap-2 rounded-md bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
            <FaRedoAlt /> Refresh
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm flex flex-col">
          <MilikTable
            minWidth="900px"
            columns={[
              { label: "Date" },
              { label: "Landlord" },
              { label: "Amount", align: "right" },
              { label: "Method" },
              { label: "Reference" },
              { label: "Reversal Status", align: "center" },
            ]}
            rows={filteredPayments}
            rowKey="_id"
            loading={loading}
            empty="No landlord payments found"
            renderRow={(payment) => (
              <>
                <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{fmtDate(payment.date || payment.paymentDate || payment.paidDate || payment.createdAt)}</td>
                <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{payment?.landlord?.landlordName || payment?.landlordName || "-"}</td>
                <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-900">{money(payment.amount)}</td>
                <td className="px-3 py-1 border-r border-gray-100 uppercase text-slate-700">{payment.paymentMethod || "-"}</td>
                <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{payment.reference || payment.referenceNumber || "-"}</td>
                <td className="px-3 py-1 text-center">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold border ${payment.status === "reversed" ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                    {payment.status === "reversed" ? "Reversed" : "Confirmed"}
                  </span>
                </td>
              </>
            )}
          />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default LandlordPaymentHistory;
