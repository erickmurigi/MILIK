import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { FaDoorOpen, FaPrint, FaRedoAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import AppSelect from '../../components/common/AppSelect';
import { adminRequests } from '../../utils/requestMethods';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';
import { fmtDate } from '../../utils/dates';

const fmt = (v) => `KES ${Number(v || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
const pct = (v) => `${Number(v || 0).toFixed(1)}%`;

const vacancyColor = (rate) => {
  if (rate >= 30) return 'text-red-600 font-bold';
  if (rate >= 15) return 'text-amber-600 font-bold';
  return 'text-emerald-600 font-bold';
};

const UNIT_TYPE_LABELS = {
  studio: 'Studio', '1bed': '1 Bed', '2bed': '2 Bed',
  '3bed': '3 Bed', '4bed': '4 Bed', commercial: 'Commercial',
};

export default function ZoneVacancyReport() {
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser    = useSelector(selectCurrentUser);
  const companyName    = currentCompany?.companyName || currentCompany?.name || currentUser?.company?.companyName || 'Company';

  const [report,     setReport]     = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [zoneFilter, setZoneFilter] = useState('');
  const printRef = useRef();

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequests.get('/zones/reports/vacancy');
      setReport(res.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReport(); }, [loadReport]);

  const allRows    = report?.rows        || [];
  const summary    = report?.zoneSummary || [];

  const zoneOptions = [...new Set(allRows.map((r) => r.zoneName))]
    .sort().map((z) => ({ value: z, label: z }));

  const rows = zoneFilter ? allRows.filter((r) => r.zoneName === zoneFilter) : allRows;
  const filteredPotentialRent = rows.reduce((s, r) => s + r.rent, 0);

  const handlePrint = () => {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Zone Vacancy Report</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11px; color: #1e293b; margin: 20px; }
        h2 { font-size: 15px; margin: 0 0 2px; } p { margin: 0 0 12px; color: #64748b; font-size: 10px; }
        table { width: 100%; border-collapse: collapse; } th { background: #0B3B2E; color: white; padding: 6px 8px; text-align: left; font-size: 10px; }
        td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; font-size: 10px; }
        tr:nth-child(even) td { background: #f8fafc; }
        .right { text-align: right; } .total td { font-weight: bold; background: #f1f5f9 !important; border-top: 2px solid #0B3B2E; }
      </style></head><body>
      ${printRef.current.innerHTML}
    </body></html>`);
    w.document.close();
    w.print();
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex flex-col h-full min-h-0 bg-white overflow-hidden">

        {/* Filter bar */}
        <div className="flex-none border-b border-gray-200 bg-white shadow-sm">
          <div className="filter-bar flex items-center gap-2 overflow-x-auto px-2 py-1.5">
            <FaDoorOpen className="text-amber-500 shrink-0" size={13} />
            <span className="text-xs font-black text-slate-700 shrink-0">Zone Vacancy</span>
            <div className="h-4 w-px bg-slate-200 shrink-0" />
            <AppSelect value={zoneFilter} onChange={(v) => setZoneFilter(v ?? '')}
              options={zoneOptions} placeholder="All Zones" clearable size="sm" />
            <button onClick={loadReport} disabled={loading}
              className="h-7 shrink-0 flex items-center gap-1 rounded bg-[#0B3B2E] px-2.5 text-xs font-semibold text-white hover:bg-[#0A3127] disabled:opacity-60">
              <FaRedoAlt size={9} /> {loading ? 'Loading…' : 'Refresh'}
            </button>
            <div className="h-4 w-px bg-slate-200 shrink-0" />
            <button onClick={handlePrint}
              className="h-7 shrink-0 flex items-center gap-1 rounded bg-slate-700 px-2.5 text-xs font-semibold text-white hover:bg-slate-800">
              <FaPrint size={9} /> Print
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-3">
          <div ref={printRef}>
            <h2 className="text-sm font-black text-slate-900">Zone Vacancy Report</h2>
            <p className="text-[10px] text-slate-500 mb-3">{companyName} · As at {new Date().toLocaleDateString()}</p>

            {/* Summary cards */}
            {report && (
              <div className="grid grid-cols-4 gap-2 mb-3">
                {[
                  { label: 'Vacant Units',     value: report.totalVacant,     cls: 'text-amber-600' },
                  { label: 'Total Units',      value: report.totalUnits,      cls: 'text-slate-700' },
                  { label: 'Overall Vacancy',  value: report.totalUnits > 0 ? pct(report.totalVacant / report.totalUnits * 100) : '0%', cls: report.totalVacant / report.totalUnits > 0.3 ? 'text-red-600' : 'text-amber-600' },
                  { label: 'Lost Rent / Mo.',  value: fmt(report.totalPotentialRent), cls: 'text-red-600' },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="border border-slate-200 rounded-lg p-3 bg-white">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
                    <p className={`text-sm font-black mt-0.5 ${cls}`}>{value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Zone summary */}
            {summary.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden mb-3">
                <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-600">Vacancy by Zone</div>
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-[#0B3B2E] text-white">
                      <th className="px-3 py-2 text-left font-bold border-r border-white/10">Zone</th>
                      <th className="px-3 py-2 text-center font-bold border-r border-white/10" style={{ width: '80px' }}>Total</th>
                      <th className="px-3 py-2 text-center font-bold border-r border-white/10" style={{ width: '80px' }}>Vacant</th>
                      <th className="px-3 py-2 text-center font-bold border-r border-white/10" style={{ width: '90px' }}>Vacancy %</th>
                      <th className="px-3 py-2 text-right font-bold">Lost Rent / Mo. (KES)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((z) => (
                      <tr key={String(z.zoneId || z.zoneName)} className="border-b border-gray-100 odd:bg-white even:bg-slate-50/50">
                        <td className="px-3 py-1.5 border-r border-gray-100">
                          <div className="flex items-center gap-2">
                            <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: z.zoneColor || '#0B3B2E' }} />
                            <span className="font-semibold text-slate-900">{z.zoneName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{z.zoneCode}</span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-center border-r border-gray-100 text-slate-600">{z.totalUnits}</td>
                        <td className="px-3 py-1.5 text-center border-r border-gray-100 font-semibold text-amber-600">{z.vacantUnits}</td>
                        <td className={`px-3 py-1.5 text-center border-r border-gray-100 ${vacancyColor(z.vacancyRate)}`}>{pct(z.vacancyRate)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-red-600 font-semibold">{fmt(z.potentialRent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Vacant units detail */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="bg-[#0B3B2E] text-white">
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Unit</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10">Property</th>
                    <th className="px-3 py-2 text-left font-bold border-r border-white/10" style={{ width: '110px' }}>Zone</th>
                    <th className="px-3 py-2 text-center font-bold border-r border-white/10" style={{ width: '80px' }}>Type</th>
                    <th className="px-3 py-2 text-center font-bold border-r border-white/10" style={{ width: '90px' }}>Vacant Since</th>
                    <th className="px-3 py-2 text-center font-bold border-r border-white/10" style={{ width: '70px' }}>Days</th>
                    <th className="px-3 py-2 text-right font-bold" style={{ width: '110px' }}>Rent / Mo. (KES)</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-400">Loading…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-400">No vacant units</td></tr>
                  ) : (
                    <>
                      {rows.map((row) => (
                        <tr key={String(row.unitId)} className="border-b border-gray-100 odd:bg-white even:bg-slate-50/50 hover:bg-[#EDF5F1]/70">
                          <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-semibold text-slate-700">{row.unitNumber}</td>
                          <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">{row.propertyName}</td>
                          <td className="px-3 py-1.5 border-r border-gray-100">
                            <div className="flex items-center gap-1.5">
                              <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: row.zoneColor }} />
                              <span className="text-slate-600">{row.zoneName}</span>
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-center border-r border-gray-100 text-slate-600">
                            {UNIT_TYPE_LABELS[row.unitType] || row.unitType}
                          </td>
                          <td className="px-3 py-1.5 text-center border-r border-gray-100 text-slate-500">{fmtDate(row.vacantSince)}</td>
                          <td className={`px-3 py-1.5 text-center border-r border-gray-100 font-bold ${row.daysVacant > 60 ? 'text-red-600' : row.daysVacant > 30 ? 'text-amber-600' : 'text-slate-600'}`}>
                            {row.daysVacant}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-slate-700">{fmt(row.rent)}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-100 border-t-2 border-[#0B3B2E]">
                        <td colSpan={6} className="px-3 py-2 font-black text-slate-900">{rows.length} vacant unit{rows.length !== 1 ? 's' : ''}</td>
                        <td className="px-3 py-2 text-right font-black text-red-600 font-mono">{fmt(filteredPotentialRent)}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
