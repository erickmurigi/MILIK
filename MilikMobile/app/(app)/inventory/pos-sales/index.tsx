import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const INV = '#92400E';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

function dateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateLabel(d: Date) {
  return d.toLocaleDateString('en-KE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

type PayBreakdown = { method: string; amount: number }[];

type POSSale = {
  _id:              string;
  receiptNumber?:   string;
  customer?:        { name?: string } | string | null;
  cashier?:         { name?: string } | string;
  subtotal:         number;
  totalDiscount:    number;
  totalVat:         number;
  grandTotal:       number;
  paymentBreakdown: PayBreakdown;
  status:           string;
  createdAt:        string;
};

type Summary = { count: number; grandTotal: number; totalVat: number; totalDiscount: number };

const getCust = (c: POSSale['customer']) =>
  typeof c === 'object' ? (c?.name ?? 'Walk-in') : (c ?? 'Walk-in');
const getCashier = (c: POSSale['cashier']) =>
  typeof c === 'object' ? (c?.name ?? '—') : (c ?? '—');

const LIMIT = 30;

export default function POSSalesScreen() {
  const [date,       setDate]       = useState(new Date());
  const [summary,    setSummary]    = useState<Summary>({ count: 0, grandTotal: 0, totalVat: 0, totalDiscount: 0 });
  const [items,      setItems]      = useState<POSSale[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore,setLoadingMore]= useState(false);
  const [page,       setPage]       = useState(1);
  const [hasMore,    setHasMore]    = useState(true);

  const load = useCallback(async (pg = 1, isRefresh = false) => {
    if (pg === 1) isRefresh ? setRefreshing(true) : setLoading(true);
    else setLoadingMore(true);
    const ds = dateStr(date);
    const [salesRes, sumRes] = await Promise.allSettled([
      api.get('/pos/sales', { params: { date: ds, page: String(pg), limit: String(LIMIT) } }),
      pg === 1 ? api.get('/pos/sales/summary', { params: { date: ds } }) : Promise.resolve(null),
    ]);
    if (salesRes.status === 'fulfilled') {
      const rows: POSSale[] = salesRes.value.data?.data ?? (Array.isArray(salesRes.value.data) ? salesRes.value.data : []);
      setItems(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } else if (pg === 1) {
      const e = salesRes.reason;
      const msg = e?.response?.data?.message ?? e?.message ?? 'Failed to load POS sales';
      Alert.alert('Error', msg);
      setItems([]);
    }
    if (sumRes.status === 'fulfilled' && sumRes.value) {
      const d = sumRes.value.data?.data ?? sumRes.value.data;
      setSummary({
        count:         d?.count         ?? 0,
        grandTotal:    d?.grandTotal    ?? 0,
        totalVat:      d?.totalVat      ?? 0,
        totalDiscount: d?.totalDiscount ?? 0,
      });
    }
    setLoading(false); setRefreshing(false); setLoadingMore(false);
  }, [date]);

  useEffect(() => { load(1); }, [load]);

  const changeDate = (delta: number) => {
    setDate(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + delta);
      return d;
    });
  };

  const renderItem = ({ item }: { item: POSSale }) => {
    const methods = item.paymentBreakdown?.map(p =>
      `${p.method.charAt(0).toUpperCase() + p.method.slice(1)} ${fmt(p.amount)}`
    ).join('  ·  ') ?? '';
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.receipt}>{item.receiptNumber ?? '—'}</Text>
            <Text style={styles.customer} numberOfLines={1}>{getCust(item.customer)}</Text>
          </View>
          <Text style={styles.grandTotal}>{fmt(item.grandTotal)}</Text>
        </View>
        <View style={styles.cardMid}>
          {item.cashier ? (
            <View style={styles.metaChip}>
              <Ionicons name="person-outline" size={11} color="#94A3B8" />
              <Text style={styles.metaChipTxt}>{getCashier(item.cashier)}</Text>
            </View>
          ) : null}
          {item.totalDiscount > 0 && (
            <View style={styles.metaChip}>
              <Ionicons name="pricetag-outline" size={11} color="#DC2626" />
              <Text style={[styles.metaChipTxt, { color: '#DC2626' }]}>-{fmt(item.totalDiscount)}</Text>
            </View>
          )}
          {item.totalVat > 0 && (
            <View style={styles.metaChip}>
              <Text style={styles.metaChipTxt}>VAT {fmt(item.totalVat)}</Text>
            </View>
          )}
        </View>
        {methods ? <Text style={styles.methods} numberOfLines={1}>{methods}</Text> : null}
        <Text style={styles.time}>
          {new Date(item.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Date nav */}
      <View style={styles.dateNav}>
        <TouchableOpacity style={styles.dateBtn} onPress={() => changeDate(-1)}>
          <Ionicons name="chevron-back" size={20} color={INV} />
        </TouchableOpacity>
        <Text style={styles.dateLabel}>{dateLabel(date)}</Text>
        <TouchableOpacity
          style={styles.dateBtn}
          onPress={() => changeDate(1)}
          disabled={dateStr(date) >= dateStr(new Date())}
        >
          <Ionicons name="chevron-forward" size={20}
            color={dateStr(date) >= dateStr(new Date()) ? '#CBD5E1' : INV} />
        </TouchableOpacity>
      </View>

      {/* Summary strip */}
      <View style={styles.summaryStrip}>
        {[
          { label: 'Sales',    value: String(summary.count),     mono: false },
          { label: 'Total',    value: fmt(summary.grandTotal),   mono: true  },
          { label: 'VAT',      value: fmt(summary.totalVat),     mono: true  },
          { label: 'Discount', value: fmt(summary.totalDiscount),mono: true  },
        ].map(s => (
          <View key={s.label} style={styles.stat}>
            <Text style={[styles.statVal, s.mono && { fontVariant: ['tabular-nums'] }]}>{s.value}</Text>
            <Text style={styles.statLbl}>{s.label}</Text>
          </View>
        ))}
      </View>

      {loading ? <MilikLoader fullscreen /> : (
        <FlatList
          data={items}
          keyExtractor={s => s._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={INV} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="cart-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>No POS sales on this day</Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={INV} style={{ padding: 20 }} /> : null}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFBEB' },

  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  dateBtn:   { width: 36, height: 36, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  dateLabel: { fontSize: 14, fontWeight: '800', color: '#0F172A' },

  summaryStrip: { flexDirection: 'row', backgroundColor: INV, marginHorizontal: 16, borderRadius: 14, padding: 14, marginBottom: 12 },
  stat:    { flex: 1, alignItems: 'center', gap: 3 },
  statVal: { fontSize: 13, fontWeight: '900', color: '#fff' },
  statLbl: { fontSize: 9, color: 'rgba(255,255,255,0.6)', fontWeight: '600', letterSpacing: 0.5 },

  list:      { paddingHorizontal: 16, paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 6 },
  cardTop:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  receipt:   { fontSize: 11, fontWeight: '800', color: INV, letterSpacing: 0.3, marginBottom: 2, fontVariant: ['tabular-nums'] },
  customer:  { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  grandTotal:{ fontSize: 18, fontWeight: '900', color: '#0F172A', fontVariant: ['tabular-nums'] },

  cardMid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaChip:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F8FAFC', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: '#F1F5F9' },
  metaChipTxt:{ fontSize: 11, color: '#64748B', fontWeight: '600' },

  methods: { fontSize: 11, color: '#94A3B8' },
  time:    { fontSize: 10, color: '#CBD5E1', textAlign: 'right', fontVariant: ['tabular-nums'] },
});
