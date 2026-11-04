import React from 'react';
import ClientsShell from './ClientsShell';
import ClientContractsPanel from '../../components/Clients/Billing/ClientContractsPanel';

// Contracts register (Billing → Contracts). The list itself lives in ClientContractsPanel so a
// client's detail page can embed the same table scoped to that client.
const ClientsContracts = () => (
  <ClientsShell>
    <ClientContractsPanel />
  </ClientsShell>
);

export default ClientsContracts;
