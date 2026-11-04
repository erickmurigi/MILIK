import React, { useCallback, useState } from 'react';
import { FaPrint, FaFileExcel, FaSyncAlt } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import AppSelect from '../../components/common/AppSelect';
import WhtCertificatesTable from '../../components/Clients/WhtCertificatesTable';
import { Chip } from '../../components/Clients/clientUi';
import { money, useClientLookup, useClientsAccess, printAfterFetch, exportExcel } from '../../components/Clients/clientHelpers';
import { clientsCollectionsApi, unwrap } from '../../services/clientsCollectionsApi';
import { fmtDate } from '../../utils/dates';

const STATUS_TABS = [
  { value: 'expected', label: 'Outstanding' },
  { value: 'received', label: 'Received' },
  { value: 'all', label: 'All' },
];
const TYPE_OPTIONS = [
  { value: 'income_tax', label: 'Income tax' },
  { value: 'vat', label: 'VAT 2%' },
];
const columns = [
  { label: 'Receipt', value: (c) => c.receiptNumber },
  { label: 'Client', value: (c) => c.client?.name || '' },
  { label: 'KRA PIN', value: (c) => c.client?.taxPin || '' },
  { label: 'Type', value: (c) => (c.type === 'vat' ? 'VAT 2%' : 'Income tax') },
  { label: 'Withheld', value: (c) => fmtDate(c.withheldDate) },
  { label: 'Amount', align: 'right', value: (c) => money(c.amount), raw: (c) => c.amount },
  { label: 'Certificate', value: (c) => c.certificateNo || '' },
  { label: 'Days', align: 'right', value: (c) => (c.daysOutstanding != null ? String(c.daysOutstanding) : '') },
  { label: 'Status', value: (c) => c.status },
];

const ClientWhtCertificates = () => {
  const { businessId } = useClientsAccess();
  const { options: clientOptions } = useClientLookup(businessId);
  const [status, setStatus] = useState('expected');
  const [type, setType] = useState('');
  const [clientId, setClientId] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [totals, setTotals] = useState(null);
  const onTotals = useCallback((d) => setTotals(d?.totals || null), []);

  const fetchAll = () => clientsCollectionsApi.report('wht-certificates', { status, type: type || undefined, clientId: clientId || undefined, limit: 200 }).then((r) => unwrap(r)?.rows || []);
  const title = `WHT Certificates — ${STATUS_TABS.find((t) => t.value === status)?.label}`;

  return (
    <ClientsShell>
      <ListToolbar>
        {totals && <Chip>Certificates: {totals.count}</Chip>}
        {totals && <Chip>Income tax: KES {money(totals.incomeTax)}</Chip>}
        {totals && <Chip>VAT: KES {money(totals.vat)}</Chip>}
        <ListToolbar.Divider />
        {STATUS_TABS.map((t) => (
          <ListToolbar.Button key={t.value} variant={status === t.value ? 'primary' : 'outline'} onClick={() => setStatus(t.value)}>{t.label}</ListToolbar.Button>
        ))}
        <ListToolbar.Divider />
        <AppSelect compact clearable placeholder="All types" value={type} onChange={(v) => setType(v || '')} options={TYPE_OPTIONS} />
        <AppSelect compact clearable searchable placeholder="All clients" value={clientId} onChange={(v) => setClientId(v || '')} options={clientOptions} />
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={() => setReloadKey((k) => k + 1)}>Refresh</ListToolbar.Button>
        <ListToolbar.Button variant="outline" icon={FaPrint} onClick={() => printAfterFetch(fetchAll, (rows) => ({ title, columns, rows, summaryItems: totals ? [['Income tax', `KES ${money(totals.incomeTax)}`], ['VAT', `KES ${money(totals.vat)}`]] : [] }))}>Print</ListToolbar.Button>
        <ListToolbar.Button variant="outline" icon={FaFileExcel} onClick={async () => exportExcel(columns, await fetchAll(), 'wht-certificates')}>Export</ListToolbar.Button>
      </ListToolbar>
      <WhtCertificatesTable key={`${status}:${type}:${clientId}`} status={status} type={type} clientId={clientId} reloadKey={reloadKey} onTotals={onTotals} />
    </ClientsShell>
  );
};

export default ClientWhtCertificates;
