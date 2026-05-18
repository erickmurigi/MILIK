import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useSearchParams, useNavigate } from "react-router-dom";
import { FaArrowLeft, FaRedoAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getLandlordPayments } from "../../redux/apiCalls";

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : "-");
const money = (value) => `Ksh ${Number(value || 0).toLocaleString()}`;

const LandlordPaymentHistory = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const landlordId = searchParams.get("landlordId");
  const { currentCompany } = useSelector((state) => state.company || {});
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadPayments = async () => {
    if (!currentCompany?._id) return;
    setLoading(true);
    try {
      const rows = await getLandlordPayments(currentCompany._id);
      setPayments(Array.isArray(rows) ? rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?._id]);

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

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="sticky top-0 z-10 shadow-sm">
              <tr className="bg-[#0B3B2E] text-white">
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Landlord</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Method</th>
                <th className="px-3 py-2 text-left">Reference</th>
                <th className="px-3 py-2 text-center">Reversal Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="px-3 py-8 text-center text-slate-500">Loading...</td></tr>
              ) : filteredPayments.length === 0 ? (
                <tr><td colSpan="6" className="px-3 py-8 text-center text-slate-500">No landlord payments found</td></tr>
              ) : (
                filteredPayments.map((payment, index) => (
                  <tr key={payment._id || index} className={`${index % 2 === 0 ? "bg-white" : "bg-slate-50"} border-b border-slate-200 hover:bg-slate-100`}>
                    <td className="px-3 py-2">{formatDate(payment.date || payment.paymentDate || payment.paidDate || payment.createdAt)}</td>
                    <td className="px-3 py-2 font-semibold text-slate-900">{payment?.landlord?.landlordName || payment?.landlordName || "-"}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">{money(payment.amount)}</td>
                    <td className="px-3 py-2 uppercase text-slate-700">{payment.paymentMethod || "-"}</td>
                    <td className="px-3 py-2 text-slate-700">{payment.reference || payment.referenceNumber || "-"}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex rounded px-2 py-1 text-[10px] font-bold ${payment.status === "reversed" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                        {payment.status === "reversed" ? "Reversed" : "Confirmed"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default LandlordPaymentHistory;
