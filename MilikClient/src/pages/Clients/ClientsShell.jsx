import React from 'react';
import DashboardLayout from '../../components/Layout/DashboardLayout';

// Thin wrapper: no title strip (house rule — the toolbar is the first thing
// under the tab strip). `title`/`action` are accepted for older callers and
// intentionally not rendered.
// eslint-disable-next-line no-unused-vars
const ClientsShell = ({ title, action, children }) => (
  <DashboardLayout lockContentScroll>
    <div className="flex h-full min-h-0 flex-col bg-white text-slate-900">{children}</div>
  </DashboardLayout>
);

export default ClientsShell;
