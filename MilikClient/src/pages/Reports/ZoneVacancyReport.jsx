import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTabState } from '../../hooks/useTabState';
import { FaFileDownload, FaPrint, FaSyncAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import ListToolbar from '../../components/common/ListToolbar';
import AppSelect from '../../components/common/AppSelect';
import MilikTable from '../../components/common/MilikTable';
import { adminRequests } from '../../utils/requestMethods';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';
import { fmtDate } from '../../utils/dates';
import { formatMoney } from '../../utils/money';
import printTabularList from '../../utils/printList';

const fmt = (v) => `KES ${Number(v || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
const pct = (v) => `${Number(v || 0).toFixed(1)}%`;

// This report's data isn't in Redux — it's local state, so it'd normally be refetched
// from scratch every time this tab remounts. A module-level cache (outside React, so
// it survives unmount) gives the same "instant on revisit" behavior as useEntityCache.
const STALE_MS = 30_000;
const reportCache = new Map();

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
  const businessId     = currentCompany?._id || '';

  const [report,     setReport]     = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [zoneFilter, setZoneFilter] = useTabState("/reports/zone-vacancy:zoneFilter", '');

  // Cached per business — instant render on tab revisit within the staleness window.
  // `force: true` (Refresh button) always hits the server.
  const loadReport = useCallback(async ({ force = false } = {}) => {
    const cached = reportCache.get(businessId);
    if (!force && cached && Date.now() - cached.loadedAt < STALE_MS) {
      setReport(cached.report);
      return;
    }
    setLoading(true);
    try {
      const res = await adminRequests.get('/zones/reports/vacancy');
      setReport(res.data);
      reportCache.set(businessId, { report: res.data, loadedAt: Date.now() });
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const allRows = report?.rows        || [];
  const summary = report?.zoneSummary || [];

  // Stable option array — avoids busting AppSelect's internal useMemo every render
  const zoneOptions = useMemo(
    () => [...new Set(allRows.map((r) => r.zoneName))].sort().map((z) => ({ value: z, label: z })),
    [allRows]
  );

  const rows = useMemo(
    () => (zoneFilter ? allRows.filter((r) => r.zoneName === zoneFilter) : allRows),
    [allRows, zoneFilter]
  );
  const filteredPotentialRent = useMemo(() => rows.reduce((s, r) => s + r.rent, 0), [rows]);

  const handlePrint = () => {
    const overall = report?.totalUnits > 0 ? pct(report.totalVacant / report.totalUnits * 100) : '0%';
    const printed = printTabularList({
      title: 'Zone Vacancy Report',
      subtitle: `As at ${new Date().toLocaleDateString()}${zoneFilter ? ` · Zone: ${zoneFilter}` : ''}`,
      company: currentCompany,
      columns: [
        { label: 'Unit', value: (r) => r.unitNumber, bold: true },
        { label: 'Property', value: (r) => r.propertyName },
        { label: 'Zone', value: (r) => r.zoneName },
        { label: 'Type', value: (r) => UNIT_TYPE_LABELS[r.unitType] || r.unitType },
        { label: 'Vacant Since', value: (r) => fmtDate(r.vacantSince) },
        { label: 'Days', align: 'right', value: (r) => r.daysVacant, tone: (r) => (r.daysVacant > 60 ? 'neg' : '') },
        { label: 'Rent / Mo. (KES)', align: 'right', value: (r) => formatMoney(r.rent) },
      ],
      rows,
      summaryItems: report ? [
        ['Vacant Units', String(report.totalVacant ?? 0)],
        ['Total Units', String(report.totalUnits ?? 0)],
        ['Overall Vacancy', overall],
        ['Lost Rent / Mo.', fmt(report.totalPotentialRent)],
      ] : [],
      totalsRow: [`${rows.length} vacant unit${rows.length !== 1 ? 's' : ''}`, '', '', '', '', '', formatMoney(filteredPotentialRent)],
      sections: summary.length ? [{
        heading: 'Vacancy by Zone',
        columns: [
          { label: 'Zone', value: (z) => `${z.zoneName}${z.zoneCode ? ` (${z.zoneCode})` : ''}`, bold: true },
          { label: 'Total', align: 'right', value: (z) => z.totalUnits },
          { label: 'Vacant', align: 'right', value: (z) => z.vacantUnits },
          { label: 'Vacancy %', align: 'right', value: (z) => pct(z.vacancyRate), tone: (z) => (z.vacancyRate >= 30 ? 'neg' : '') },
          { label: 'Lost Rent / Mo. (KES)', align: 'right', value: (z) => formatMoney(z.potentialRent) },
        ],
        rows: summary,
      }] : [],
    });
    if (!printed) toast.error('Pop-up blocked — allow pop-ups for this site to print');
  };

  const exportCsv = () => {
    if (rows.length === 0) { toast.info('There are no vacant units to export.'); return; }
    const header = ['Unit', 'Property', 'Zone', 'Type', 'Vacant Since', 'Days', 'Rent / Mo. (KES)'];
    const body = rows.map((r) => [
      r.unitNumber,
      r.propertyName,
      r.zoneName,
      UNIT_TYPE_LABELS[r.unitType] || r.unitType,
      r.vacantSince ? new Date(r.vacantSince).toLocaleDateString() : '',
      r.daysVacant,
      r.rent,
    ]);
    const csv = [header, ...body].map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zone_vacancy_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        <div className="mx-auto flex h-full w-full max-w-none min-h-0 flex-1 flex-col gap-2">
          <ListToolbar>
            <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">{rows.length} vacant unit{rows.length !== 1 ? 's' : ''}</span>
            <ListToolbar.Divider />
            <AppSelect value={zoneFilter || null} onChange={(v) => setZoneFilter(v ?? '')}
              options={zoneOptions} placeholder="All Zones" searchable clearable compact />
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaFileDownload} variant="outline" onClick={exportCsv}>Export</ListToolbar.Button>
            <ListToolbar.Button icon={FaPrint} variant="outline" onClick={handlePrint}>Print</ListToolbar.Button>
            <ListToolbar.Button icon={FaSyncAlt} variant="outline" onClick={() => loadReport({ force: true })}>Refresh</ListToolbar.Button>
            <span className="ml-auto shrink-0 text-[10px] text-slate-400">{companyName} · As at {new Date().toLocaleDateString()}</span>
          </ListToolbar>

          {/* Zone summary */}
          {summary.length > 0 && (
            <div className="flex flex-shrink-0 flex-col overflow-hidden border border-slate-200 bg-white shadow-lg" style={{ maxHeight: '180px' }}>
              <MilikTable
                columns={[
                  { label: "Zone" },
                  { label: "Total", align: "center", width: "80px" },
                  { label: "Vacant", align: "center", width: "80px" },
                  { label: "Vacancy %", align: "center", width: "90px" },
                  { label: "Lost Rent / Mo. (KES)", align: "right" },
                ]}
                rows={summary}
                rowKey={(z) => String(z.zoneId || z.zoneName)}
                loading={loading && summary.length === 0}
                renderRow={(z) => (
                  <>
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
                  </>
                )}
              />
            </div>
          )}

          {/* Vacant units detail — fills remaining height */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-lg">
            <MilikTable
              columns={[
                { label: "Unit" },
                { label: "Property" },
                { label: "Zone", width: "110px" },
                { label: "Type", align: "center", width: "80px" },
                { label: "Vacant Since", align: "center", width: "90px" },
                { label: "Days", align: "center", width: "70px" },
                { label: "Rent / Mo. (KES)", align: "right", width: "110px" },
              ]}
              rows={rows}
              rowKey="unitId"
              loading={loading && rows.length === 0}
              empty="No vacant units"
              renderFooter={rows.length > 0 ? () => (
                <>
                  <td colSpan={6} className="px-3 py-2 font-black text-slate-900">{rows.length} vacant unit{rows.length !== 1 ? 's' : ''}</td>
                  <td className="px-3 py-2 text-right font-black text-red-600 font-mono">{fmt(filteredPotentialRent)}</td>
                </>
              ) : undefined}
              renderRow={(row) => (
                <>
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
                </>
              )}
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
