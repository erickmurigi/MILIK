import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../services/api';
import { ErrorBanner, ErrorState } from '../../../components/ui/PmsStates';
import { useReloadOnFocus } from '../../../hooks/usePmsList';
import { apiError, fmtDate, fmtKES, todayISO } from '../../../utils/pmsFormat';
import {
  INV, INVBG, dayParams, invError, normalizeSummary, payLabel, shiftDay, type SalesSummary,
} from '../../../utils/inventory';

const QUICK_ACTIONS = [
  { label: 'Products',        icon: 'cube-outline',          route: '/inventory/products',        color: INV       },
  { label: 'Purchase Orders', icon: 'document-text-outline', route: '/inventory/purchase-orders', color: '#1D4ED8' },
  { label: 'Stock Movements', icon: 'swap-vertical-outline', route: '/inventory/stock-movements', color: '#065F46' },
  { label: 'POS Sales',       icon: 'cart-outline',          route: '/inventory/pos-sales',       color: '#7C3AED' },
] as const;

type Snapshot = {
  summary:  SalesSummary | null;
  lowStock: number | null;
  products: number | null;
  openPOs:  number | null;
};

const EMPTY: Snapshot = { summary: null, lowStock: null, products: null, openPOs: null };

export default function InventoryDashboardScreen() {
  const router = useRouter();
  const today = todayISO();

  const [day,        setDay]        = useState(today);
  const [snap,       setSnap]       = useState<Snapshot>(EMPTY);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);   // every request failed
  const [partial,    setPartial]    = useState<string | null>(null);   // some failed
  const reqRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    const id = ++reqRef.current;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);

    const results = await Promise.allSettled([
      api.get('/pos/sales/summary', { params: dayParams(day) }),
      api.get('/inventory/stock-movements/low-stock'),
      api.get('/inventory/products', { params: { limit: 1, active: 'true' } }),
      api.get('/inventory/purchase-orders', { params: { limit: 1, status: 'draft' } }),
      api.get('/inventory/purchase-orders', { params: { limit: 1, status: 'sent' } }),
    ]);
    if (id !== reqRef.current) return;

    const [sum, low, prod, draft, sent] = results;
    const next: Snapshot = {
      summary:  sum.status  === 'fulfilled' ? normalizeSummary(sum.value.data?.data) : null,
      lowStock: low.status  === 'fulfilled' ? Number(low.value.data?.total ?? low.value.data?.data?.length ?? 0) : null,
      products: prod.status === 'fulfilled' ? Number(prod.value.data?.total ?? 0) : null,
      openPOs:  draft.status === 'fulfilled' && sent.status === 'fulfilled'
        ? Number(draft.value.data?.total ?? 0) + Number(sent.value.data?.total ?? 0)
        : null,
    };
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];

    if (failed.length === results.length) {
      setError(invError(failed[0].reason, 'Could not load the inventory dashboard.'));
    } else {
      setError(null);
      setSnap(next);
      setPartial(failed.length ? apiError(failed[0].reason, 'Some figures could not be loaded.') : null);
    }
    setLoading(false);
    setRefreshing(false);
  }, [day]);

  useEffect(() => { load('initial'); }, [load]);
  useReloadOnFocus(useCallback(() => { load('silent'); }, [load]));

  const summary = snap.summary;
  const low = snap.lowStock ?? 0;
  const dim = (n: number | null) => (n === null ? '—' : String(n));
  const isToday = day === today;

  const openLow = () => router.push({ pathname: '/inventory/products', params: { low: '1' } } as any);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={INV} size="large" /></View>
      ) : error ? (
        <ErrorState message={error} onRetry={() => load('initial')} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={INV} />}
        >
          {partial ? <ErrorBanner message={partial} onRetry={() => load('initial')} /> : null}

          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.dayNav}>
              <TouchableOpacity style={styles.dayBtn} onPress={() => setDay(d => shiftDay(d, -1))} hitSlop={8}>
                <Ionicons name="chevron-back" size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setDay(today)} disabled={isToday} activeOpacity={0.7}>
                <Text style={styles.heroEyebrow}>
                  {isToday ? "TODAY'S POS SALES" : `POS SALES · ${fmtDate(day + 'T00:00:00')}`.toUpperCase()}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dayBtn, isToday && { opacity: 0.3 }]} disabled={isToday}
                onPress={() => setDay(d => shiftDay(d, 1))} hitSlop={8}>
                <Ionicons name="chevron-forward" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={styles.heroTitle}>{summary ? fmtKES(summary.grandTotal) : '—'}</Text>
            <View style={styles.heroRow}>
              <View style={styles.heroStat}>
                <Text style={styles.heroVal}>{summary ? summary.count : '—'}</Text>
                <Text style={styles.heroLbl}>Sales</Text>
              </View>
              <View style={styles.heroDivider} />
              <View style={styles.heroStat}>
                <Text style={styles.heroVal}>{dim(snap.products)}</Text>
                <Text style={styles.heroLbl}>Products</Text>
              </View>
              <View style={styles.heroDivider} />
              <View style={styles.heroStat}>
                <Text style={[styles.heroVal, low > 0 && { color: '#FCA5A5' }]}>{dim(snap.lowStock)}</Text>
                <Text style={styles.heroLbl}>Low stock</Text>
              </View>
              <View style={styles.heroDivider} />
              <View style={styles.heroStat}>
                <Text style={styles.heroVal}>{dim(snap.openPOs)}</Text>
                <Text style={styles.heroLbl}>Open POs</Text>
              </View>
            </View>
          </View>

          {/* Payment mix for the day */}
          {summary && summary.count > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>PAYMENTS</Text>
              {Object.entries(summary.byPaymentMethod).map(([method, amount]) => (
                <View key={method} style={styles.payRow}>
                  <Text style={styles.payMethod}>{payLabel(method)}</Text>
                  <Text style={styles.payAmt}>{fmtKES(amount)}</Text>
                </View>
              ))}
              {summary.totalVat > 0 || summary.totalDiscount > 0 ? (
                <View style={styles.subRow}>
                  <Text style={styles.subTxt}>VAT {fmtKES(summary.totalVat)}</Text>
                  {summary.totalDiscount > 0 ? <Text style={styles.subTxt}>Discounts {fmtKES(summary.totalDiscount)}</Text> : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Low stock alert */}
          {low > 0 && (
            <TouchableOpacity style={styles.alertCard} onPress={openLow} activeOpacity={0.8}>
              <Ionicons name="warning-outline" size={20} color="#D97706" />
              <Text style={styles.alertTxt}>
                {low} product{low !== 1 ? 's' : ''} at or below reorder level — tap to review
              </Text>
              <Ionicons name="chevron-forward" size={14} color="#D97706" />
            </TouchableOpacity>
          )}

          {/* Quick access */}
          <Text style={styles.sectionLabel}>QUICK ACCESS</Text>
          <View style={styles.actionsGrid}>
            {QUICK_ACTIONS.map(a => (
              <TouchableOpacity
                key={a.label}
                style={styles.actionCard}
                onPress={() => router.push(a.route as any)}
                activeOpacity={0.75}
              >
                <View style={[styles.actionIcon, { backgroundColor: a.color + '12' }]}>
                  <Ionicons name={a.icon} size={24} color={a.color} />
                </View>
                <Text style={styles.actionLabel}>{a.label}</Text>
                <Ionicons name="chevron-forward" size={14} color="#CBD5E1" />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: INVBG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 16, paddingBottom: 40 },

  hero: {
    backgroundColor: INV, borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  dayNav:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayBtn:      { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  heroEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3, color: 'rgba(255,255,255,0.7)' },
  heroTitle:   { fontSize: 30, fontWeight: '900', color: '#fff', marginTop: 8, letterSpacing: -0.5 },
  heroRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  heroDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 10 },
  heroStat:    { flex: 1 },
  heroVal:     { fontSize: 18, fontWeight: '900', color: '#fff' },
  heroLbl:     { fontSize: 9, color: 'rgba(255,255,255,0.6)', marginTop: 2, fontWeight: '500' },

  card:      { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 8 },
  payRow:    { flexDirection: 'row', justifyContent: 'space-between' },
  payMethod: { fontSize: 13, color: '#475569', fontWeight: '600' },
  payAmt:    { fontSize: 13, color: '#0F172A', fontWeight: '800', fontVariant: ['tabular-nums'] },
  subRow:    { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 8 },
  subTxt:    { fontSize: 11, color: '#94A3B8' },

  alertCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFBEB', borderRadius: 14,
    borderWidth: 1, borderColor: '#FDE68A', padding: 14,
  },
  alertTxt: { flex: 1, fontSize: 13, fontWeight: '600', color: '#D97706' },

  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  actionsGrid: { gap: 8 },
  actionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 14,
  },
  actionIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0F172A' },
});
