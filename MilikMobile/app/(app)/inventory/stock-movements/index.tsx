import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, ScrollView,
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

type StockMovement = {
  _id:         string;
  product?:    { name?: string; sku?: string; unitOfMeasure?: string } | string;
  location?:   { name?: string } | string;
  type:        string;
  quantity:    number;
  costPrice?:  number;
  reference?:  string;
  notes?:      string;
  createdAt:   string;
  createdBy?:  { name?: string };
};

const TYPE_CFG: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  purchase:    { bg: '#D1FAE5', color: '#065F46', label: 'Purchase',    icon: 'arrow-down-circle-outline'   },
  sale:        { bg: '#DBEAFE', color: '#1D4ED8', label: 'Sale',        icon: 'arrow-up-circle-outline'     },
  adjustment:  { bg: '#EDE9FE', color: '#7C3AED', label: 'Adjustment',  icon: 'swap-horizontal-outline'     },
  transfer:    { bg: '#FEF3C7', color: '#D97706', label: 'Transfer',    icon: 'git-compare-outline'         },
  return:      { bg: '#FEE2E2', color: '#DC2626', label: 'Return',      icon: 'refresh-outline'             },
  writeoff:    { bg: '#F1F5F9', color: '#64748B', label: 'Write-off',   icon: 'trash-outline'               },
  opening:     { bg: '#FEF3C7', color: '#D97706', label: 'Opening',     icon: 'albums-outline'              },
};

const TYPES = [
  { key: '',           label: 'All'        },
  { key: 'purchase',   label: 'Purchase'   },
  { key: 'sale',       label: 'Sale'       },
  { key: 'adjustment', label: 'Adjustment' },
  { key: 'transfer',   label: 'Transfer'   },
  { key: 'return',     label: 'Return'     },
  { key: 'writeoff',   label: 'Write-off'  },
  { key: 'opening',    label: 'Opening'    },
] as const;

const getProd = (p: StockMovement['product']) =>
  typeof p === 'object' ? { name: p?.name ?? '—', sku: p?.sku ?? '', uom: p?.unitOfMeasure ?? '' } : { name: p ?? '—', sku: '', uom: '' };
const getLoc = (l: StockMovement['location']) =>
  typeof l === 'object' ? (l?.name ?? '—') : (l ?? '—');

const LIMIT = 30;

export default function StockMovementsScreen() {
  const [typeFilter, setTypeFilter] = useState('');
  const [search,     setSearch]     = useState('');
  const [items,      setItems]      = useState<StockMovement[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore,setLoadingMore]= useState(false);
  const [page,       setPage]       = useState(1);
  const [hasMore,    setHasMore]    = useState(true);

  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (pg = 1, isRefresh = false) => {
    if (pg === 1) isRefresh ? setRefreshing(true) : setLoading(true);
    else setLoadingMore(true);
    try {
      const p: Record<string, string> = { page: String(pg), limit: String(LIMIT) };
      if (typeFilter)             p.type   = typeFilter;
      if (searchRef.current.trim()) p.search = searchRef.current.trim();
      const { data } = await api.get('/inventory/stock-movements', { params: p });
      const rows: StockMovement[] = data?.data ?? (Array.isArray(data) ? data : []);
      setItems(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch { if (pg === 1) setItems([]); }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, [typeFilter]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { const t = setTimeout(() => load(1), 400); return () => clearTimeout(t); }, [search]);

  const renderItem = ({ item }: { item: StockMovement }) => {
    const tc   = TYPE_CFG[item.type] ?? TYPE_CFG.adjustment;
    const prod = getProd(item.product);
    const loc  = getLoc(item.location);
    const isIn = item.type === 'purchase' || item.type === 'return' || item.type === 'opening';
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={[styles.typeIcon, { backgroundColor: tc.bg }]}>
            <Ionicons name={tc.icon as any} size={18} color={tc.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.prodName} numberOfLines={1}>{prod.name}</Text>
            <View style={styles.metaRow}>
              {prod.sku ? <Text style={styles.sku}>{prod.sku}</Text> : null}
              <Text style={styles.loc}>{loc}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 5 }}>
            <View style={[styles.badge, { backgroundColor: tc.bg }]}>
              <Text style={[styles.badgeTxt, { color: tc.color }]}>{tc.label}</Text>
            </View>
            <Text style={[styles.qty, { color: isIn ? '#065F46' : '#DC2626' }]}>
              {isIn ? '+' : '−'}{Math.abs(item.quantity)} {prod.uom || 'units'}
            </Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.dateTxt}>{fmtDate(item.createdAt)}</Text>
          {item.reference ? <Text style={styles.ref}>Ref: {item.reference}</Text> : null}
          {item.costPrice ? <Text style={styles.costTxt}>{fmt(item.costPrice)} / unit</Text> : null}
        </View>
        {item.notes ? <Text style={styles.notes} numberOfLines={1}>{item.notes}</Text> : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Product, reference..."
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
        style={{ flexGrow: 0 }}
      >
        {TYPES.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, typeFilter === t.key && styles.tabActive]}
            onPress={() => setTypeFilter(t.key)}
          >
            <Text style={[styles.tabTxt, typeFilter === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? <MilikLoader fullscreen /> : (
        <FlatList
          data={items}
          keyExtractor={m => m._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={INV} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="swap-vertical-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>No stock movements</Text>
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

  tabsRow:     { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  tab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: INV, borderColor: INV },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 8 },
  cardTop:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  typeIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  prodName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  metaRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' },
  sku:      { fontSize: 10, fontWeight: '700', color: '#94A3B8', fontVariant: ['tabular-nums'] },
  loc:      { fontSize: 10, color: '#64748B', backgroundColor: '#F1F5F9', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: 10, fontWeight: '800' },
  qty:      { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },

  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateTxt:    { fontSize: 11, color: '#94A3B8' },
  ref:        { fontSize: 11, fontWeight: '600', color: '#64748B', fontVariant: ['tabular-nums'] },
  costTxt:    { fontSize: 11, color: '#94A3B8', marginLeft: 'auto' },

  notes: { fontSize: 12, color: '#94A3B8', fontStyle: 'italic' },
});
