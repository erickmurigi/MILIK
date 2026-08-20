import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const INV = '#92400E';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

type PurchaseOrder = {
  _id:           string;
  poNumber:      string;
  supplier?:     { name?: string } | string;
  location?:     { name?: string } | string;
  status:        string;
  totalAmount:   number;
  orderDate?:    string;
  expectedDate?: string;
  lines?:        { qtyOrdered: number; qtyReceived: number }[];
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  draft:              { bg: '#F1F5F9', color: '#64748B', label: 'Draft'             },
  sent:               { bg: '#DBEAFE', color: '#1D4ED8', label: 'Sent'              },
  partially_received: { bg: '#FEF3C7', color: '#D97706', label: 'Partial Receipt'   },
  received:           { bg: '#D1FAE5', color: '#065F46', label: 'Received'          },
  cancelled:          { bg: '#FEE2E2', color: '#DC2626', label: 'Cancelled'         },
};

const TABS = [
  { key: '',                  label: 'All'      },
  { key: 'draft',             label: 'Draft'    },
  { key: 'sent',              label: 'Sent'     },
  { key: 'partially_received',label: 'Partial'  },
  { key: 'received',          label: 'Received' },
] as const;

const getSupplier = (s: PurchaseOrder['supplier']) =>
  typeof s === 'object' ? (s?.name ?? '—') : (s ?? '—');
const getLocation = (l: PurchaseOrder['location']) =>
  typeof l === 'object' ? (l?.name ?? '') : (l ?? '');

const LIMIT = 30;

export default function PurchaseOrdersScreen() {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState('');
  const [search,       setSearch]       = useState('');
  const [items,        setItems]        = useState<PurchaseOrder[]>([]);
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
      if (statusFilter)             p.status = statusFilter;
      if (searchRef.current.trim()) p.search = searchRef.current.trim();
      const { data } = await api.get('/inventory/purchase-orders', { params: p });
      const rows: PurchaseOrder[] = Array.isArray(data) ? data : data?.data ?? data?.items ?? [];
      setItems(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? 'Failed to load purchase orders';
      Alert.alert('Error', msg);
      if (pg === 1) setItems([]);
    }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, [statusFilter]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { const t = setTimeout(() => load(1), 400); return () => clearTimeout(t); }, [search]);

  const renderItem = ({ item }: { item: PurchaseOrder }) => {
    const sc  = STATUS_CFG[item.status] ?? STATUS_CFG.draft;
    const loc = getLocation(item.location);
    const totalQty     = item.lines?.reduce((s, l) => s + l.qtyOrdered, 0) ?? 0;
    const receivedQty  = item.lines?.reduce((s, l) => s + l.qtyReceived, 0) ?? 0;
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/inventory/purchase-orders/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.poNum}>{item.poNumber}</Text>
            <Text style={styles.supplier} numberOfLines={1}>{getSupplier(item.supplier)}</Text>
            {loc ? <Text style={styles.location} numberOfLines={1}>{loc}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
            <Text style={styles.amount}>{fmt(item.totalAmount)}</Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.dateTxt}>
            {item.orderDate ? fmtDate(item.orderDate) : ''}
            {item.expectedDate ? `  ·  Expected ${fmtDate(item.expectedDate)}` : ''}
          </Text>
          {totalQty > 0 && (
            <Text style={styles.qtyTxt}>{receivedQty}/{totalQty} received</Text>
          )}
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
          placeholder="PO number, supplier..."
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
          keyExtractor={po => po._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={INV} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="document-text-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>No purchase orders</Text>
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

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginBottom: 10, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 50 },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },

  tabsRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  tab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: INV, borderColor: INV },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3, padding: 14, gap: 8 },
  cardTop:    { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  poNum:      { fontSize: 12, fontWeight: '800', color: INV, letterSpacing: 0.3, marginBottom: 2, fontVariant: ['tabular-nums'] },
  supplier:   { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  location:   { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt:   { fontSize: 10, fontWeight: '800' },
  amount:     { fontSize: 15, fontWeight: '900', color: '#0F172A' },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateTxt:    { fontSize: 11, color: '#94A3B8' },
  qtyTxt:     { fontSize: 11, fontWeight: '600', color: '#64748B' },
});
