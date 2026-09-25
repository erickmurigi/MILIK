import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { apiError, fmtDate, fmtMoney, todayISO } from '../../../../utils/pmsFormat';

// Same source as the web "Arrears Aged Analysis" report: GET /financial-reports/ar-aging.
// Outstanding amounts come from the server's receipt-allocation engine, so they match the web exactly.
type BucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus';

type AgingRow = {
  invoiceId:     string;
  invoiceNumber?: string;
  tenantId?:     string;
  tenantName?:   string;
  propertyName?: string;
  unitName?:     string;
  dueDate?:      string;
  outstanding:   number;
  daysOverdue:   number;
  bucket:        BucketKey;
};
type Report = { rows: AgingRow[]; totals: Record<BucketKey | 'total', number>; asOf?: string };

type TenantGroup = {
  key:        string;
  tenantId?:  string;
  name:       string;
  unit:       string;
  property:   string;
  invoices:   number;
  maxDays:    number;
  byBucket:   Record<BucketKey, number>;
  total:      number;
};

const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30',   label: '1–30 d' },
  { key: 'd31_60',  label: '31–60 d' },
  { key: 'd61_90',  label: '61–90 d' },
  { key: 'd90plus', label: '90+ d' },
];

type BucketFilter = 'all' | BucketKey;

const emptyBuckets = (): Record<BucketKey, number> => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });

const severityColor = (days: number) =>
  days > 90 ? '#991B1B' : days > 60 ? Colors.danger : days > 30 ? Colors.warning : days > 0 ? '#CA8A04' : Colors.textMuted;

const avatarInitial = (name: string) => name?.trim()?.charAt(0)?.toUpperCase() ?? '?';

export default function DelinquencyScreen() {
  const router = useRouter();
  const [report,     setReport]     = useState<Report | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [search,     setSearch]     = useState('');
  const [bucket,     setBucket]     = useState<BucketFilter>('all');
  const reqRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const id = ++reqRef.current;
    if (mode === 'refresh') setRefreshing(true); else setLoading(true);
    try {
      // Same 2-minute allowance as the web: the report recomputes allocations for every tenant with open invoices.
      const { data } = await api.get('/financial-reports/ar-aging', {
        params: { asOf: todayISO() },
        timeout: 120_000,
      });
      if (id !== reqRef.current) return;
      setReport({
        rows:   Array.isArray(data?.rows) ? data.rows : [],
        totals: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0, ...(data?.totals ?? {}) },
        asOf:   data?.asOf,
      });
      setError(null);
    } catch (err) {
      if (id !== reqRef.current) return;
      setError(apiError(err, 'Could not load the arrears report.'));
    } finally {
      if (id === reqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // One row per tenant, summing every open invoice / debit note.
  const groups = useMemo<TenantGroup[]>(() => {
    const map = new Map<string, TenantGroup>();
    for (const r of report?.rows ?? []) {
      const key = r.tenantId ? String(r.tenantId) : `name:${r.tenantName ?? ''}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key, tenantId: r.tenantId,
          name: r.tenantName && r.tenantName !== '—' ? r.tenantName : 'Unknown tenant',
          unit: r.unitName && r.unitName !== '—' ? r.unitName : '',
          property: r.propertyName && r.propertyName !== '—' ? r.propertyName : '',
          invoices: 0, maxDays: 0, byBucket: emptyBuckets(), total: 0,
        };
        map.set(key, g);
      }
      const amt = Number(r.outstanding || 0);
      g.invoices += 1;
      g.total += amt;
      g.byBucket[r.bucket] = (g.byBucket[r.bucket] ?? 0) + amt;
      g.maxDays = Math.max(g.maxDays, Number(r.daysOverdue || 0));
    }
    return [...map.values()];
  }, [report]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = groups
      .filter(g => (bucket === 'all' ? g.total > 0 : g.byBucket[bucket] > 0))
      .filter(g => !q || g.name.toLowerCase().includes(q) || g.unit.toLowerCase().includes(q) || g.property.toLowerCase().includes(q))
      .map(g => ({ g, shown: bucket === 'all' ? g.total : g.byBucket[bucket] }));
    rows.sort((a, b) => b.shown - a.shown);
    return rows;
  }, [groups, bucket, search]);

  const shownTotal = useMemo(() => visible.reduce((s, r) => s + r.shown, 0), [visible]);

  const renderItem = ({ item }: { item: { g: TenantGroup; shown: number } }) => {
    const { g, shown } = item;
    const unitStr = [g.unit, g.property].filter(Boolean).join(' · ');
    const days = g.maxDays;
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => g.tenantId && router.push(`/pms/tenants/${g.tenantId}` as any)}
        activeOpacity={g.tenantId ? 0.75 : 1}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{avatarInitial(g.name)}</Text>
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name} numberOfLines={1}>{g.name}</Text>
          {unitStr ? <Text style={styles.meta} numberOfLines={1}>{unitStr}</Text> : null}
          <Text style={[styles.meta, { color: severityColor(days), fontWeight: '700' }]}>
            {g.invoices} open {g.invoices === 1 ? 'item' : 'items'} · {days > 0 ? `oldest ${days}d overdue` : 'due today'}
          </Text>
        </View>

        <Text style={styles.balance}>KES {fmtMoney(shown)}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.banner}>
        <View>
          <Text style={styles.bannerLabel}>TOTAL ARREARS</Text>
          <Text style={styles.bannerValue}>KES {fmtMoney(shownTotal)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.bannerLabel}>TENANTS</Text>
          <Text style={styles.bannerValue}>{visible.length}</Text>
        </View>
      </View>
      {report?.asOf ? (
        <Text style={styles.asOf}>As of {fmtDate(report.asOf)}</Text>
      ) : null}

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search tenant, unit or property..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCorrect={false}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {([{ key: 'all', label: 'All' }, ...BUCKETS] as { key: BucketFilter; label: string }[]).map(b => (
            <TouchableOpacity
              key={b.key}
              style={[styles.chip, bucket === b.key && styles.chipActive]}
              onPress={() => setBucket(b.key)}
            >
              <Text style={[styles.chipText, bucket === b.key && styles.chipTextActive]}>{b.label}</Text>
              {report ? (
                <Text style={[styles.chipAmt, bucket === b.key && styles.chipTextActive]}>
                  {fmtMoney(b.key === 'all' ? report.totals.total : report.totals[b.key])}
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <MilikLoader fullscreen />
      ) : error && !report ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={item => item.g.key}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={Colors.primary} />
          }
          ListHeaderComponent={error ? <ErrorBanner message={error} onRetry={() => load('refresh')} /> : null}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="checkmark-circle-outline" size={56} color={Colors.success} />
              <Text style={styles.emptyTitle}>{search || bucket !== 'all' ? 'No matches' : 'All Clear'}</Text>
              <Text style={styles.emptyText}>
                {search || bucket !== 'all' ? 'No tenants match the current filters' : 'No tenants with outstanding balances'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTitle:{ fontSize: 17, fontWeight: '700', color: Colors.text },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
  list:    { paddingBottom: 40 },

  banner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 20, paddingVertical: 16,
  },
  bannerLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: 'rgba(255,255,255,0.6)' },
  bannerValue: { fontSize: 22, fontWeight: '900', color: Colors.white },
  asOf:        { fontSize: 11, color: Colors.textMuted, paddingHorizontal: 20, paddingTop: 8 },

  searchRow: { paddingHorizontal: 16, paddingVertical: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },

  chips: { paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center',
    borderRadius: 14, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.border,
  },
  chipActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:       { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },
  chipTextActive: { color: Colors.white },
  chipAmt:        { fontSize: 10, color: Colors.textMuted, marginTop: 1 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: Colors.dangerLight,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '800', color: Colors.danger },
  name:       { fontSize: 14, fontWeight: '700', color: Colors.text },
  meta:       { fontSize: 11, color: Colors.textMuted },
  balance:    { fontSize: 15, fontWeight: '800', color: Colors.danger },
});
