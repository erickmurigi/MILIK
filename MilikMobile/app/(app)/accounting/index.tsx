import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../services/api';
import MilikLoader from '../../../components/ui/MilikLoader';

const AC  = '#064E3B';
const ACL = '#ECFDF5';
const ACA = '#10B981';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtShort = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}KES ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${n < 0 ? '-' : ''}KES ${(abs / 1_000).toFixed(0)}K`;
  return fmt(n);
};

type Period  = { _id: string; name: string; status: string; startDate: string; endDate: string };
type Summary = { totalIncome?: number; totalExpenses?: number; netIncome?: number };

const QUICK_ACTIONS = [
  { label: 'Journals',       icon: 'document-text-outline',  route: '/accounting/journals',     color: '#1D4ED8' },
  { label: 'Vouchers',       icon: 'receipt-outline',         route: '/accounting/vouchers',     color: '#7C3AED' },
  { label: 'Requisitions',   icon: 'list-circle-outline',     route: '/accounting/requisitions', color: '#D97706' },
  { label: 'Petty Cash',     icon: 'wallet-outline',          route: '/accounting/petty-cash',   color: '#DC2626' },
  { label: 'Reports',        icon: 'bar-chart-outline',       route: '/accounting/reports',      color: AC       },
] as const;

export default function AccountingDashboard() {
  const router = useRouter();

  const [period,       setPeriod]       = useState<Period | null>(null);
  const [summary,      setSummary]      = useState<Summary | null>(null);
  const [pendingCounts,setPendingCounts]= useState({ journals: 0, vouchers: 0, requisitions: 0 });
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [perRes, isRes, jRes, vRes, rRes] = await Promise.allSettled([
        api.get('/accounting-periods', { params: { status: 'open', limit: 1 } }),
        api.get('/financial-reports/income-statement', { params: { endDate: today } }),
        api.get('/journals',              { params: { status: 'pending_review', limit: 1 } }),
        api.get('/payment-vouchers',      { params: { status: 'pending',        limit: 1 } }),
        api.get('/expense-requisitions',  { params: { status: 'pending',        limit: 1 } }),
      ]);

      if (perRes.status === 'fulfilled') {
        const raw  = perRes.value.data?.data ?? perRes.value.data;
        const list = Array.isArray(raw) ? raw : (raw?.periods ?? []);
        if (list.length) setPeriod(list[0]);
      }
      if (isRes.status === 'fulfilled') {
        const d = isRes.value.data?.data ?? isRes.value.data;
        setSummary({
          totalIncome:    Number(d?.totalIncome   ?? d?.income   ?? 0),
          totalExpenses:  Number(d?.totalExpenses ?? d?.expenses ?? 0),
          netIncome:      Number(d?.netIncome     ?? d?.net      ?? 0),
        });
      }
      setPendingCounts({
        journals:     extractCount(jRes),
        vouchers:     extractCount(vRes),
        requisitions: extractCount(rRes),
      });
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <MilikLoader fullscreen />;

  const income   = summary?.totalIncome   ?? 0;
  const expenses = summary?.totalExpenses ?? 0;
  const net      = summary?.netIncome     ?? (income - expenses);
  const totalPending = pendingCounts.journals + pendingCounts.vouchers + pendingCounts.requisitions;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={AC} />}
      >
        {/* Period banner */}
        {period && (
          <View style={[styles.periodBanner, { borderLeftColor: period.status === 'open' ? ACA : '#D97706' }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.periodName}>{period.name}</Text>
              <Text style={styles.periodDates}>
                {fmtDate(period.startDate)} – {fmtDate(period.endDate)}
              </Text>
            </View>
            <View style={[styles.periodBadge, { backgroundColor: period.status === 'open' ? '#D1FAE5' : '#FEF3C7' }]}>
              <Text style={[styles.periodBadgeTxt, { color: period.status === 'open' ? '#065F46' : '#D97706' }]}>
                {period.status.toUpperCase()}
              </Text>
            </View>
          </View>
        )}

        {/* P&L hero card */}
        <View style={styles.plCard}>
          <Text style={styles.plLabel}>YEAR-TO-DATE P&L</Text>
          <Text style={[styles.netIncome, { color: net >= 0 ? ACA : '#F87171' }]}>
            {net >= 0 ? '+' : ''}{fmtShort(net)}
          </Text>
          <View style={styles.plRow}>
            <View style={styles.plItem}>
              <View style={[styles.plDot, { backgroundColor: '#4ADE80' }]} />
              <Text style={styles.plItemLabel}>Income</Text>
              <Text style={styles.plItemValue}>{fmtShort(income)}</Text>
            </View>
            <View style={[styles.plItem, styles.plItemBorder]}>
              <View style={[styles.plDot, { backgroundColor: '#F87171' }]} />
              <Text style={styles.plItemLabel}>Expenses</Text>
              <Text style={styles.plItemValue}>{fmtShort(expenses)}</Text>
            </View>
            <View style={styles.plItem}>
              <View style={[styles.plDot, { backgroundColor: net >= 0 ? '#4ADE80' : '#F87171' }]} />
              <Text style={styles.plItemLabel}>Net</Text>
              <Text style={[styles.plItemValue, { color: net >= 0 ? '#4ADE80' : '#F87171' }]}>
                {fmtShort(net)}
              </Text>
            </View>
          </View>
        </View>

        {/* Pending approvals */}
        {totalPending > 0 && (
          <View style={styles.pendingCard}>
            <View style={styles.pendingHeader}>
              <Ionicons name="time-outline" size={16} color="#D97706" />
              <Text style={styles.pendingTitle}>Pending Approvals</Text>
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeTxt}>{totalPending}</Text>
              </View>
            </View>
            <View style={styles.pendingRow}>
              {pendingCounts.journals > 0 && (
                <TouchableOpacity
                  style={styles.pendingItem}
                  onPress={() => router.push('/accounting/journals?status=pending_review' as any)}
                >
                  <Text style={styles.pendingCount}>{pendingCounts.journals}</Text>
                  <Text style={styles.pendingItemLabel}>Journals</Text>
                </TouchableOpacity>
              )}
              {pendingCounts.vouchers > 0 && (
                <TouchableOpacity
                  style={styles.pendingItem}
                  onPress={() => router.push('/accounting/vouchers?status=pending' as any)}
                >
                  <Text style={styles.pendingCount}>{pendingCounts.vouchers}</Text>
                  <Text style={styles.pendingItemLabel}>Vouchers</Text>
                </TouchableOpacity>
              )}
              {pendingCounts.requisitions > 0 && (
                <TouchableOpacity
                  style={styles.pendingItem}
                  onPress={() => router.push('/accounting/requisitions?status=pending' as any)}
                >
                  <Text style={styles.pendingCount}>{pendingCounts.requisitions}</Text>
                  <Text style={styles.pendingItemLabel}>Requisitions</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Quick actions grid */}
        <Text style={styles.sectionLabel}>ACCOUNTING MODULES</Text>
        <View style={styles.actionsGrid}>
          {QUICK_ACTIONS.map(a => (
            <TouchableOpacity
              key={a.label}
              style={styles.actionCard}
              onPress={() => router.push(a.route as any)}
              activeOpacity={0.75}
            >
              <View style={[styles.actionIcon, { backgroundColor: a.color + '15' }]}>
                <Ionicons name={a.icon as any} size={24} color={a.color} />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
              <Ionicons name="chevron-forward" size={14} color="#CBD5E1" style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function extractCount(res: PromiseSettledResult<any>): number {
  if (res.status !== 'fulfilled') return 0;
  const d = res.value.data;
  return Number(d?.totalCount ?? d?.total ?? d?.count ?? 0);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F0FDF4' },
  scroll: { padding: 16, gap: 14, paddingBottom: 48 },

  periodBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 4,
    padding: 14, gap: 10,
  },
  periodName:      { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  periodDates:     { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  periodBadge:     { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  periodBadgeTxt:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  plCard: { backgroundColor: AC, borderRadius: 20, padding: 20, gap: 6 },
  plLabel:   { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: 'rgba(255,255,255,0.6)' },
  netIncome: { fontSize: 36, fontWeight: '900' },
  plRow:     { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 12, marginTop: 6 },
  plItem:    { flex: 1, gap: 3 },
  plItemBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 10 },
  plDot:     { width: 6, height: 6, borderRadius: 3 },
  plItemLabel: { fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: '600' },
  plItemValue: { fontSize: 12, color: '#fff', fontWeight: '800' },

  pendingCard: {
    backgroundColor: '#FFFBEB', borderRadius: 14,
    borderWidth: 1, borderColor: '#FDE68A', padding: 14, gap: 12,
  },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingTitle:  { fontSize: 14, fontWeight: '700', color: '#92400E', flex: 1 },
  pendingBadge:  { backgroundColor: '#D97706', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  pendingBadgeTxt: { fontSize: 11, fontWeight: '800', color: '#fff' },
  pendingRow:    { flexDirection: 'row', gap: 10 },
  pendingItem:   { flex: 1, alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#FDE68A', paddingVertical: 10 },
  pendingCount:  { fontSize: 22, fontWeight: '900', color: '#D97706' },
  pendingItemLabel: { fontSize: 10, fontWeight: '600', color: '#92400E' },

  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  actionsGrid: { gap: 8 },
  actionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 14,
  },
  actionIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
});
