import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const SC = '#7C2D12';

type Deal = {
  _id:                  string;
  dealNumber?:          string;
  listing?:             { title?: string; propertyName?: string } | string;
  buyer?:               { fullName?: string } | string;
  agent?:               { name?: string } | string;
  agreedPrice:          number;
  totalPaid?:           number;
  balance?:             number;
  status:               string;
  dealDate?:            string;
  expectedClosingDate?: string;
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  active:    { bg: '#FEF3C7', color: '#92400E', label: 'Active'    },
  closed:    { bg: '#D1FAE5', color: '#065F46', label: 'Closed'    },
  cancelled: { bg: '#F1F5F9', color: '#64748B', label: 'Cancelled' },
};

const TABS = [
  { key: '',          label: 'All'       },
  { key: 'active',    label: 'Active'    },
  { key: 'closed',    label: 'Closed'    },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0 })}`;

const getListingName = (l: Deal['listing']) =>
  typeof l === 'object' ? (l?.title ?? l?.propertyName ?? '—') : (l ?? '—');

const getBuyerName = (b: Deal['buyer']) =>
  typeof b === 'object' ? (b?.fullName ?? '—') : (b ?? '—');

const LIMIT = 30;

export default function DealsScreen() {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState('active');
  const [search,       setSearch]       = useState('');
  const [items,        setItems]        = useState<Deal[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [page,         setPage]         = useState(1);
  const [hasMore,      setHasMore]      = useState(true);

  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (pg = 1, isRefresh = false) => {
    if (pg === 1) isRefresh ? setRefreshing(true) : setLoading(true);
    else setLoadingMore(true);
    try {
      const p: Record<string, string> = { page: String(pg), limit: String(LIMIT) };
      if (statusFilter) p.status = statusFilter;
      if (searchRef.current.trim()) p.search = searchRef.current.trim();
      const { data } = await api.get('/sale/deals', { params: p });
      const rows: Deal[] = data?.data ?? (Array.isArray(data) ? data : []);
      setItems(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch { if (pg === 1) setItems([]); }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, [statusFilter]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(1), 400);
    return () => clearTimeout(t);
  }, [search]);

  const renderItem = ({ item }: { item: Deal }) => {
    const sc      = STATUS_CFG[item.status] ?? STATUS_CFG.active;
    const paid    = item.totalPaid ?? 0;
    const balance = item.balance  ?? (item.agreedPrice - paid);
    const pct     = item.agreedPrice > 0 ? Math.min(100, (paid / item.agreedPrice) * 100) : 0;

    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/sales/deals/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            {item.dealNumber && <Text style={styles.dealNum}>{item.dealNumber}</Text>}
            <Text style={styles.listing} numberOfLines={1}>{getListingName(item.listing)}</Text>
            <Text style={styles.buyer} numberOfLines={1}>{getBuyerName(item.buyer)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
            <Text style={styles.price}>{fmt(item.agreedPrice)}</Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={styles.progressWrap}>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
          </View>
          <Text style={styles.progressTxt}>{pct.toFixed(0)}% collected</Text>
        </View>

        <View style={styles.cardBottom}>
          <Text style={styles.paidTxt}>Paid: <Text style={{ fontWeight: '800', color: '#065F46' }}>{fmt(paid)}</Text></Text>
          <Text style={styles.balTxt}>Balance: <Text style={{ fontWeight: '800', color: balance > 0 ? '#DC2626' : '#065F46' }}>{fmt(balance)}</Text></Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Deal number, property, buyer..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        horizontal data={TABS as any} keyExtractor={t => t.key}
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.tabsRow}
        renderItem={({ item: t }) => (
          <TouchableOpacity
            style={[styles.tab, statusFilter === t.key && styles.tabActive]}
            onPress={() => setStatusFilter(t.key)}
          >
            <Text style={[styles.tabTxt, statusFilter === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        )}
      />

      {loading ? <MilikLoader fullscreen /> : (
        <FlatList
          data={items}
          keyExtractor={d => d._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={SC} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="handshake-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>No deals found</Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={SC} style={{ padding: 20 }} /> : null}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF7ED' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, marginBottom: 10,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 50,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },

  tabsRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  tab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: SC, borderColor: SC },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3,
    padding: 14, gap: 10,
  },
  cardTop:  { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dealNum:  { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 2 },
  listing:  { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  buyer:    { fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: '500' },
  badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: 10, fontWeight: '800' },
  price:    { fontSize: 14, fontWeight: '900', color: '#0F172A' },

  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressBg:   { flex: 1, height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#065F46', borderRadius: 3 },
  progressTxt:  { fontSize: 10, fontWeight: '700', color: '#94A3B8', width: 80, textAlign: 'right' },

  cardBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  paidTxt:    { fontSize: 12, color: '#64748B' },
  balTxt:     { fontSize: 12, color: '#64748B' },
});
