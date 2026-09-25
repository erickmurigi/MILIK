import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import api from '../services/api';
import type { RootState } from '../redux/store';
import {
  DEFAULT_LEAD_SOURCES, DEFAULT_LEAD_STAGES, humanize, nameToValue, resolveTerms, type SaleTerms,
} from '../utils/sales';

export type Choice = { value: string; label: string };

export type SaleSettingsData = {
  /** Pipeline stages in order (includes "converted" / "lost"). Falls back to the built-in pipeline. */
  stages:  Choice[];
  /** Lead sources the admin configured (Sale Settings), or the built-in list. */
  sources: Choice[];
  /** Company wording for Deal / Buyer / Listing ... */
  terms:   SaleTerms;
};

const FALLBACK: SaleSettingsData = {
  stages:  DEFAULT_LEAD_STAGES.map(v => ({ value: v, label: humanize(v) })),
  sources: DEFAULT_LEAD_SOURCES.map(v => ({ value: v, label: humanize(v) })),
  terms:   resolveTerms(null),
};

const TTL = 5 * 60_000;
const cache    = new Map<string, { at: number; data: SaleSettingsData }>();
const inflight = new Map<string, Promise<SaleSettingsData>>();

type Named = { name?: string; order?: number; isActive?: boolean };
const activeChoices = (rows: Named[] | undefined, sort: boolean): Choice[] => {
  const list = (rows ?? []).filter(r => r?.name && r.isActive !== false);
  if (sort) list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return list.map(r => ({ value: nameToValue(r.name!), label: String(r.name) }));
};

async function fetchSettings(companyId: string): Promise<{ data: SaleSettingsData; ok: boolean }> {
  // Each request fails on its own (a user without company-settings access still gets the pipeline / sources)
  const [sale, company] = await Promise.allSettled([
    api.get('/sale/settings'),
    companyId ? api.get(`/company-settings/${companyId}`) : Promise.reject(new Error('no company')),
  ]);
  const s = sale.status === 'fulfilled' ? sale.value.data?.settings : null;
  const stages  = activeChoices(s?.pipelineStages, true);
  const sources = activeChoices(s?.leadSources, false);
  return {
    ok: sale.status === 'fulfilled',
    data: {
      stages:  stages.length  ? stages  : FALLBACK.stages,
      sources: sources.length ? sources : FALLBACK.sources,
      terms:   resolveTerms(company.status === 'fulfilled' ? company.value.data?.terminology : null),
    },
  };
}

/** Load (or reuse for 5 minutes) the company's sale settings. Never rejects: failures fall back to the defaults. */
export function loadSaleSettings(companyId: string): Promise<SaleSettingsData> {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);
  const pending = inflight.get(companyId);
  if (pending) return pending;
  const p = fetchSettings(companyId)
    .catch(() => ({ data: FALLBACK, ok: false }))
    .then(({ data, ok }) => {
      // a failed load is retried soon instead of sticking for the full TTL
      if (ok) cache.set(companyId, { at: Date.now(), data });
      return data;
    })
    .finally(() => { inflight.delete(companyId); });
  inflight.set(companyId, p);
  return p;
}

/** Pipeline stages, lead sources and terminology for the Sales screens (defaults until the settings arrive). */
export function useSaleSettings(): SaleSettingsData {
  const company   = useSelector((s: RootState) => s.auth.company);
  const companyId = String(company?._id ?? company?.id ?? '');
  const [data, setData] = useState<SaleSettingsData>(() => cache.get(companyId)?.data ?? FALLBACK);

  useEffect(() => {
    let alive = true;
    loadSaleSettings(companyId).then(d => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [companyId]);

  return data;
}
