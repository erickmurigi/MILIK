import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ClientsShell from './ClientsShell';
import { TabStrip } from '../../components/Clients/clientUi';
import {
  DunningPreviewPanel, DunningLogPanel, PromisesPanel, DisputesPanel, LateInterestPanel,
} from '../../components/Clients/CollectionsPanels';

const TABS = [
  { key: 'today', label: "Today's reminders" },
  { key: 'promises', label: 'Promises to pay' },
  { key: 'disputes', label: 'Disputes' },
  { key: 'log', label: 'Reminder log' },
  { key: 'interest', label: 'Late interest' },
];

const ClientCollections = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'today';
  const setTab = (key) => setSearchParams({ tab: key }, { replace: true });

  return (
    <ClientsShell>
      <TabStrip tabs={TABS} active={tab} onChange={setTab} />
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'today' && <DunningPreviewPanel />}
        {tab === 'promises' && <PromisesPanel />}
        {tab === 'disputes' && <DisputesPanel />}
        {tab === 'log' && <DunningLogPanel />}
        {tab === 'interest' && <LateInterestPanel />}
      </div>
    </ClientsShell>
  );
};

export default ClientCollections;
