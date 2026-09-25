import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../services/api';
import MilikLoader from '../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../components/ui/PmsStates';
import { useReloadOnFocus } from '../../../hooks/usePmsList';
import { useSaleSettings } from '../../../hooks/useSaleSettings';
import { fmtDate, fmtKES } from '../../../utils/pmsFormat';
import { DEAL_STATUS_STYLE, SBG, SC, humanize, refName, saleError } from '../../../utils/sales';

type Icon = React.ComponentProps<typeof Ionicons>['name'];

type RecentDeal = {
  _id: string; dealNumber?: string; status: string; agreedPrice?: number;
  listing?: { title?: string; listingNumber?: string }; buyer?: { fullName?: string };
};
type RecentListing = {
  _id: string; listingNumber?: string; title?: string; status?: string; askingPrice?: number; propertyType?: string;
};
type Dash = {
  listings?:    { available?: number; reserved?: number; underContract?: number; sold?: number; total?: number };
  deals?:       { active?: number; closed?: number; cancelled?: number; activeValue?: number; closedValue?: number };
  payments?:    { totalCollected?: number; count?: number };
  commissions?: { pending?: number; approved?: number; paid?: number };
  leads?:       { active?: number; overdue?: number; total?: number; converted?: number };
  recentDeals?:    RecentDeal[];
  recentListings?: RecentListing[];
};
type Overdue = {
  _id: string; dealId?: string; dealNumber?: string; buyerName?: string; unit?: string;
  dueDate?: string; daysLate?: number; amount?: number;
};

const n = (v: unknown) => Number(v || 0);

export default function SalesDashboardScreen() {
  const router = useRouter();
  const { terms: T } = useSaleSettings();

  const [dash,       setDash]       = useState<Dash | null>(null);
  const [receivable, setReceivable] = useState<{ balance: number; overdue: number; deals: number } | null>(null);
  const [overdue,    setOverdue]    = useState<{ count: number; amount: number; rows: Overdue[] } | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    const id = ++reqRef.current;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    // The dashboard is the page; receivables / overdue need the "reports" permission, so they may be refused on their own.
    const [d, r, o] = await Promise.allSettled([
      api.get('/sale/reports/dashboard'),
      api.get('/sale/reports/receivables', { params: { limit: 1 } }),
      api.get('/sale/reports/overdue-installments', { params: { limit: 5 } }),
    ]);
    if (id !== reqRef.current) return;

    if (d.status === 'fulfilled') {
      setDash(d.value.data ?? {});
      setError(null);
    } else {
      setError(saleError(d.reason, 'Could not load the sales dashboard.'));
    }
    setReceivable(r.status === 'fulfilled' && r.value.data?.totals
      ? { balance: n(r.value.data.totals.balance), overdue: n(r.value.data.totals.overdue), deals: n(r.value.data.totals.deals) }
      : null);
    setOverdue(o.status === 'fulfilled' && o.value.data?.totals
      ? { count: n(o.value.data.totals.count), amount: n(o.value.data.totals.amount), rows: Array.isArray(o.value.data.data) ? o.value.data.data : [] }
      : null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load('initial'); }, [load]);
  useReloadOnFocus(useCallback(() => { load('silent'); }, [load]));

  const go = (path: string) => router.push(path as any);

  if (loading && !dash) {
    return <SafeAreaView style={styles.safe} edges={['bottom']}><MilikLoader fullscreen /></SafeAreaView>;
  }
  if (!dash) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ErrorState message={error || 'Could not load the sales dashboard.'} onRetry={() => load('initial')} />
      </SafeAreaView>
    );
  }

  const listings = dash.listings ?? {};
  const deals    = dash.deals ?? {};
  const leads    = dash.leads ?? {};
  const commissionsDue = n(dash.commissions?.pending) + n(dash.commissions?.approved);

  const stats: { label: string; value: string; sub?: string; icon: Icon; color: string; to?: string }[] = [
    { label: `Available ${T.saleListings}`, value: String(n(listings.available)), sub: 'Ready to sell',
      icon: 'home-outline', color: '#065F46', to: '/sales/listings?status=available' },
    { label: `Active ${T.saleDeals}`, value: String(n(deals.active)), sub: fmtKES(deals.activeValue),
      icon: 'briefcase-outline', color: SC, to: '/sales/deals?status=active' },
    { label: `Active ${T.saleLeads}`, value: String(n(leads.active)), sub: `${n(leads.total)} in total`,
      icon: 'people-outline', color: '#1D4ED8', to: '/sales/leads' },
    { label: 'Follow-ups overdue', value: String(n(leads.overdue)), sub: `${T.saleLeads} to call back`,
      icon: 'alarm-outline', color: '#DC2626', to: '/sales/leads?overdue=1' },
    { label: 'Overdue instalments', value: overdue ? String(overdue.count) : '—', sub: overdue ? fmtKES(overdue.amount) : 'Not available',
      icon: 'alert-circle-outline', color: '#B91C1C' },
    { label: 'Commissions due', value: fmtKES(commissionsDue), sub: 'Pending payout',
      icon: 'ribbon-outline', color: '#7C3AED' },
  ];

  const portfolio: { label: string; value: number; to: string }[] = [
    { label: 'Available',                  value: n(listings.available),     to: '/sales/listings?status=available' },
    { label: 'Reserved',                   value: n(listings.reserved),      to: '/sales/listings?status=reserved' },
    { label: 'Under contract',             value: n(listings.underContract), to: '/sales/listings?status=under_contract' },
    { label: 'Sold',                       value: n(listings.sold),          to: '/sales/listings?status=sold' },
    { label: `${T.saleDeals} closed`,      value: n(deals.closed),           to: '/sales/deals?status=closed' },
  ];

  const recentDeals    = dash.recentDeals ?? [];
  const recentListings = dash.recentListings ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={SC} />}
      >
        {error ? <ErrorBanner message={error} onRetry={() => load('initial')} /> : null}

        {/* Hero banner */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>MILIK {T.saleModule.toUpperCase()}</Text>
          <Text style={styles.heroTitle}>Sales Pipeline</Text>
          <View style={styles.heroRow}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatVal} numberOfLines={1} adjustsFontSizeToFit>{fmtKES(dash.payments?.totalCollected)}</Text>
              <Text style={styles.heroStatLbl}>Total collected · {n(dash.payments?.count)} payments</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatVal} numberOfLines={1} adjustsFontSizeToFit>{receivable ? fmtKES(receivable.balance) : '—'}</Text>
              <Text style={styles.heroStatLbl}>
                {receivable ? `Still owed · ${fmtKES(receivable.overdue)} overdue` : 'Still owed'}
              </Text>
            </View>
          </View>
        </View>

        {/* Stat cards */}
        <View style={styles.statsGrid}>
          {stats.map(s => (
            <TouchableOpacity
              key={s.label}
              style={styles.statCard}
              activeOpacity={s.to ? 0.75 : 1}
              onPress={s.to ? () => go(s.to!) : undefined}
            >
              <View style={[styles.statIcon, { backgroundColor: s.color + '15' }]}>
                <Ionicons name={s.icon} size={20} color={s.color} />
              </View>
              <Text style={styles.statVal} numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
              <Text style={styles.statLbl}>{s.label}</Text>
              {s.sub ? <Text style={styles.statSub} numberOfLines={1}>{s.sub}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>

        {/* Portfolio */}
        <Text style={styles.sectionLabel}>PORTFOLIO</Text>
        <View style={styles.card}>
          {portfolio.map((p, i) => (
            <TouchableOpacity key={p.label} style={[styles.rowItem, i > 0 && styles.rowBorder]} onPress={() => go(p.to)} activeOpacity={0.7}>
              <Text style={styles.rowLabel}>{p.label}</Text>
              <Text style={styles.rowValue}>{p.value}</Text>
              <Ionicons name="chevron-forward" size={14} color="#CBD5E1" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Overdue instalments */}
        {overdue && overdue.count > 0 ? (
          <>
            <Text style={styles.sectionLabel}>OVERDUE INSTALMENTS ({overdue.count})</Text>
            <View style={[styles.card, { borderColor: '#FECACA' }]}>
              {overdue.rows.map((o, i) => (
                <TouchableOpacity
                  key={o._id}
                  style={[styles.rowItem, i > 0 && styles.rowBorder]}
                  activeOpacity={o.dealId ? 0.7 : 1}
                  onPress={o.dealId ? () => go(`/sales/deals/${o.dealId}`) : undefined}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{o.dealNumber || '—'} · {o.buyerName || '—'}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      Due {fmtDate(o.dueDate)} · {n(o.daysLate)} day{n(o.daysLate) === 1 ? '' : 's'} late
                    </Text>
                  </View>
                  <Text style={[styles.rowValue, { color: '#DC2626' }]}>{fmtKES(o.amount)}</Text>
                </TouchableOpacity>
              ))}
              {overdue.count > overdue.rows.length ? (
                <TouchableOpacity style={[styles.rowItem, styles.rowBorder]} onPress={() => go('/sales/deals?status=active')}>
                  <Text style={[styles.rowSub, { flex: 1 }]}>…and {overdue.count - overdue.rows.length} more. View {T.saleDeals.toLowerCase()}</Text>
                  <Ionicons name="chevron-forward" size={14} color="#CBD5E1" />
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        ) : null}

        {/* Recent deals */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>RECENT {T.saleDeals.toUpperCase()}</Text>
          <TouchableOpacity onPress={() => go('/sales/deals')}><Text style={styles.link}>View all</Text></TouchableOpacity>
        </View>
        <View style={styles.card}>
          {recentDeals.length === 0 ? (
            <Text style={styles.emptyTxt}>No {T.saleDeals.toLowerCase()} yet.</Text>
          ) : recentDeals.map((d, i) => {
            const sc = DEAL_STATUS_STYLE[d.status] ?? DEAL_STATUS_STYLE.active;
            return (
              <TouchableOpacity key={d._id} style={[styles.rowItem, i > 0 && styles.rowBorder]} onPress={() => go(`/sales/deals/${d._id}`)} activeOpacity={0.7}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {d.dealNumber ? `${d.dealNumber} · ` : ''}{refName(d.listing, 'title', 'listingNumber') || '—'}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {refName(d.buyer, 'fullName') || '—'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.rowValue}>{fmtKES(d.agreedPrice)}</Text>
                  <View style={[styles.badge, { backgroundColor: sc.bg }]}>
                    <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* New listings */}
        {recentListings.length > 0 ? (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>NEW {T.saleListings.toUpperCase()}</Text>
              <TouchableOpacity onPress={() => go('/sales/listings')}><Text style={styles.link}>View all</Text></TouchableOpacity>
            </View>
            <View style={styles.card}>
              {recentListings.map((l, i) => (
                <TouchableOpacity key={l._id} style={[styles.rowItem, i > 0 && styles.rowBorder]} onPress={() => go(`/sales/listings/${l._id}`)} activeOpacity={0.7}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{l.title || l.listingNumber || '—'}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {[l.listingNumber, humanize(l.propertyType)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.rowValue}>{fmtKES(l.askingPrice)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        {/* Quick actions */}
        <Text style={styles.sectionLabel}>QUICK ACCESS</Text>
        <View style={{ gap: 8 }}>
          {([
            { label: T.saleLeads,    icon: 'people-outline',    route: '/sales/leads',    color: '#1D4ED8' },
            { label: T.saleDeals,    icon: 'briefcase-outline', route: '/sales/deals',    color: SC        },
            { label: T.saleListings, icon: 'home-outline',      route: '/sales/listings', color: '#065F46' },
          ] as { label: string; icon: Icon; route: string; color: string }[]).map(a => (
            <TouchableOpacity key={a.route} style={styles.actionCard} onPress={() => go(a.route)} activeOpacity={0.75}>
              <View style={[styles.actionIcon, { backgroundColor: a.color + '12' }]}>
                <Ionicons name={a.icon} size={24} color={a.color} />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
              <Ionicons name="chevron-forward" size={14} color="#CBD5E1" />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: SBG },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },

  hero: {
    backgroundColor: SC, borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  heroEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5, color: 'rgba(255,255,255,0.55)' },
  heroTitle:   { fontSize: 24, fontWeight: '900', color: '#fff', marginTop: 4 },
  heroRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  heroDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 16 },
  heroStat:    { flex: 1 },
  heroStatVal: { fontSize: 15, fontWeight: '900', color: '#fff' },
  heroStatLbl: { fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 2, fontWeight: '500' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    flexGrow: 1, flexBasis: '46%', backgroundColor: '#fff',
    borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0',
    padding: 14, gap: 4,
  },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statVal:  { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  statLbl:  { fontSize: 11, color: '#475569', fontWeight: '700' },
  statSub:  { fontSize: 10, color: '#94A3B8', fontWeight: '500' },

  sectionHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8', marginTop: 4 },
  link:         { fontSize: 12, fontWeight: '700', color: SC },

  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  rowItem:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  rowLabel:  { flex: 1, fontSize: 13, fontWeight: '700', color: '#0F172A' },
  rowSub:    { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  rowValue:  { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  emptyTxt:  { fontSize: 13, color: '#94A3B8', textAlign: 'center', padding: 16 },

  badge:    { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeTxt: { fontSize: 10, fontWeight: '800' },

  actionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 14,
  },
  actionIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0F172A' },
});
