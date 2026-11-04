import React from 'react';
import ClientsShell from './ClientsShell';
import ClientInvoicesPanel from '../../components/Clients/Billing/ClientInvoicesPanel';

// Client invoices register (Billing → Invoices). The table lives in ClientInvoicesPanel so the
// client detail page and a contract's Invoices tab embed the same list, scoped.
const ClientsInvoices = () => (
  <ClientsShell>
    <ClientInvoicesPanel />
  </ClientsShell>
);

export default ClientsInvoices;
