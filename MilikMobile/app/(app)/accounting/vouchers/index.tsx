import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const AC = '#064E3B';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Voucher = {
  _id:              string;
  voucherNo?:       string;
  date?:            string;
  dueDate?:         string;
  createdAt?:       string;
  amount:           number;
  narration?:       string;
  status:           string;
  serviceProvider?: { name?: string };
  landlord?:        { firstName?: string; lastName?: string };
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  draft:    { bg: '#F1F5F9', color: '#64748B', label: 'Draft'    },
  pending:  { bg: '#FEF3C7', color: '#D97706', label: 'Pending'  },
  approved: { bg: '#EDE9FE', color: '#7C3AED', label: 'Approved' },
  rejected: { bg: '#FEE2E2', color: '#DC2626', label: 'Rejected' },
  posted:   { bg: '#D1FAE5', color: '#065F46', label: 'Posted'   },
  paid:     { bg: '#D1FAE5', color: '#065F46', label: 'Paid'     },
  reversed: { bg: '#FEE2E2', color: '#DC2626', label: 'Reversed' },
};

const TABS = [
  { key: '',         label: 'All'      },
  { key: 'draft',    label: 'Draft'    },
  { key: 'pending',  label: 'Pending'  },
  { key: 'approved', label: 'Approved' },
  { key: 'posted',   label: 'Posted'   },
  { key: 'paid',     label: 'Paid'     },
  { key: 'reversed', label: 'Reversed' },
] as const;

export default function VouchersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();

  const [statusFilter, setStatusFilter] = useState(params.status ?? '');
  const [search,       setSearch]       = useState('');
  const [items,        setItems]        = useState<Voucher[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [page,         setPage]         = useState(1);
  const [hasMore,      setHasMore]      = useState(true);

  const LIMIT     = 30;
  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (pg = 1, isRefresh = false) => {
    if (pg === 1) isRefresh ? setRefreshing(true) : setLoading(true);
    else setLoadingMore(true);
    try {
      const p: Record<string, string> = { page: String(pg), limit: String(LIMIT) };
      if (statusFilter)             p.status = statusFilter;
      if (searchRef.current.trim()) p.search = searchRef.current.trim();
      const { data } = await api.get('/payment-vouchers', { params: p });
      const raw  = data?.data ?? data;
      const rows: Voucher[] = Array.isArray(raw) ? raw : (raw?.vouchers ?? []);
      setItems(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch {
      if (pg === 1) {
        setItems([]);
        Alert.alert('Error', 'Failed to load payment vouchers.');
      }
    }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, [statusFilter]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { const t = setTimeout(() => load(1), 400); return () => clearTimeout(t); }, [search]);

  const getPayee = (v: Voucher) => {
    if (v.serviceProvider?.name) return v.serviceProvider.name;
    if (v.landlord?.firstName) return [v.landlord.firstName, v.landlord.lastName].filter(Boolean).join(' ');
    return v.narration ?? 'Unknown';
  };

  const renderItem = ({ item }: { item: Voucher }) => {
    const sc   = STATUS_CFG[item.status] ?? STATUS_CFG.draft;
    const date = item.date ?? item.dueDate ?? item.createdAt ?? '';
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/accounting/vouchers/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            {item.voucherNo ? <Text style={styles.numTxt}>{item.voucherNo}</Text> : null}
            <Text style={styles.payeeTxt} numberOfLines={1}>{getPayee(item)}</Text>
            {item.narration ? <Text style={styles.narration} numberOfLines={1}>{item.narration}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
            <Text style={styles.amount}>{fmt(item.amount)}</Text>
          </View>
        </View>
        {date ? <Text style={styles.dateTxt}>{fmtDate(date)}</Text> : null}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput style={styles.searchInput} placeholder="Payee, narration..." placeholderTextColor="#94A3B8" value={search} onChangeText={setSearch} />
        {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={18} color="#94A3B8" /></TouchableOpacity> : null}
      </View>

      <FlatList
        horizontal data={TABS as any} keyExtractor={t => t.key}
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.tabsRow}
        renderItem={({ item: t }) => (
          <TouchableOpacity style={[styles.tab, statusFilter === t.key && styles.tabActive]} onPress={() => setStatusFilter(t.key)}>
            <Text style={[styles.tabTxt, statusFilter === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        )}
      />

      {loading ? <MilikLoader fullscreen /> : (
        <FlatList
          data={items} keyExtractor={v => v._id} renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={AC} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="receipt-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>No payment vouchers</Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={AC} style={{ padding: 20 }} /> : null}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/accounting/vouchers/new' as any)}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0FDF4' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginBottom: 10, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 50 },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },
  tabsRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  tab:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:    { backgroundColor: AC, borderColor: AC },
  tabTxt:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive: { color: '#fff' },
  list:      { paddingHorizontal: 16, paddingBottom: 100 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  numTxt:   { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 2 },
  payeeTxt: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  narration:{ fontSize: 12, color: '#64748B' },
  badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: 10, fontWeight: '800' },
  amount:   { fontSize: 16, fontWeight: '900', color: '#0F172A' },
  dateTxt:  { fontSize: 11, color: '#94A3B8' },
  fab: { position: 'absolute', bottom: 28, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: AC, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 8 },
});
