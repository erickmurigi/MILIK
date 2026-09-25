import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useDebounced, usePmsList, useReloadOnFocus } from '../../../../hooks/usePmsList';
import { fmtKES } from '../../../../utils/pmsFormat';
import { pageOf } from '../../../../utils/sales';
import {
  INV, INVBG, fmtQty, invError, isLowStock, nameOf,
  type LowStockRow, type Product,
} from '../../../../utils/inventory';

type ActiveFilter = 'active' | 'inactive' | 'all';
const ACTIVE_CHIPS: { key: ActiveFilter; label: string }[] = [
  { key: 'active',   label: 'Active'   },
  { key: 'inactive', label: 'Inactive' },
  { key: 'all',      label: 'All'      },
];

const parse = (data: any) => pageOf<Product>(data);

function ProductCard({ item, onPress }: { item: Product; onPress: () => void }) {
  const cat = nameOf(item.category);
  const low = isLowStock(item);
  const out = !!item.trackStock && Number(item.stockBalance ?? 0) <= 0;
  return (
    <TouchableOpacity style={[styles.card, low && styles.cardLow]} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.iconBox, { backgroundColor: INV + '15' }]}>
        <Ionicons name="cube-outline" size={20} color={INV} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          {low ? (
            <View style={[styles.lowBadge, out && { backgroundColor: '#FEE2E2' }]}>
              <Ionicons name="warning" size={10} color={out ? '#DC2626' : '#D97706'} />
              <Text style={[styles.lowTxt, out && { color: '#DC2626' }]}>{out ? 'Out' : 'Low'}</Text>
            </View>
          ) : null}
          {item.active === false ? (
            <View style={styles.inactiveBadge}><Text style={styles.inactiveTxt}>Inactive</Text></View>
          ) : null}
        </View>
        <View style={styles.metaRow}>
          {item.sku ? <Text style={styles.sku}>{item.sku}</Text> : null}
          {cat ? <Text style={styles.cat}>{cat}</Text> : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={styles.price}>{fmtKES(item.sellingPrice)}</Text>
        {item.trackStock ? (
          <Text style={[styles.stock, low && { color: out ? '#DC2626' : '#D97706', fontWeight: '700' }]}>
            {item.stockBalance === undefined ? '—' : fmtQty(item.stockBalance)} {item.unitOfMeasure || 'pcs'}
          </Text>
        ) : (
          <Text style={styles.stock}>Not tracked</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const Separator = () => <View style={{ height: 1, backgroundColor: '#F1F5F9' }} />;

/** Every product, paged, filtered by the search box and the Active / Inactive chips. */
function AllProducts({ search, active, onOpen }: { search: string; active: ActiveFilter; onOpen: (id: string) => void }) {
  const params = useMemo(() => ({
    search: search || undefined,
    active: active === 'all' ? undefined : active === 'active' ? 'true' : 'false',
    withStock: 'true',
  }), [search, active]);

  const list = usePmsList<Product>({ path: '/inventory/products', params, limit: 40, parse });
  useReloadOnFocus(useCallback(() => { list.reload(); }, [list.reload]));

  if (list.loading) return <MilikLoader fullscreen />;
  if (list.error && list.items.length === 0) return <ErrorState message={list.error} onRetry={list.retry} />;
  return (
    <>
      {list.error ? <ErrorBanner message={list.error} onRetry={list.retry} /> : null}
      <FlatList
        data={list.items}
        keyExtractor={p => p._id}
        renderItem={({ item }) => <ProductCard item={item} onPress={() => onOpen(item._id)} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={INV} />}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={list.items.length ? <Text style={styles.count}>{list.total} product{list.total !== 1 ? 's' : ''}</Text> : null}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="cube-outline" size={48} color="#CBD5E1" />
            <Text style={styles.emptyTxt}>{search || active !== 'active' ? 'No products match' : 'No products yet'}</Text>
          </View>
        }
        ListFooterComponent={list.loadingMore ? <ActivityIndicator color={INV} style={{ padding: 20 }} /> : null}
      />
    </>
  );
}

/** The server's low-stock report (on hand across all locations <= reorder level), lowest first. */
function LowStockProducts({ search, onOpen }: { search: string; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    const id = ++reqRef.current;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const { data } = await api.get('/inventory/stock-movements/low-stock');
      if (id !== reqRef.current) return;
      const list: LowStockRow[] = Array.isArray(data?.data) ? data.data : [];
      setRows(list.filter(r => r?.product).map(r => ({ ...r.product, stockBalance: r.balance })));
      setError(null);
    } catch (e) {
      if (id !== reqRef.current) return;
      setError(invError(e, 'Could not load the low-stock report.'));
    } finally {
      if (id === reqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => { load('initial'); }, [load]);
  useReloadOnFocus(useCallback(() => { load('silent'); }, [load]));

  // the report has no search; it is short (only products at or below their reorder level) so filter here, every word must match
  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter(p => {
      const hay = `${p.name} ${p.sku ?? ''} ${p.barcode ?? ''} ${nameOf(p.category)}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }, [rows, search]);

  if (loading) return <MilikLoader fullscreen />;
  if (error && rows.length === 0) return <ErrorState message={error} onRetry={() => load('initial')} />;
  return (
    <>
      {error ? <ErrorBanner message={error} onRetry={() => load('initial')} /> : null}
      <FlatList
        data={shown}
        keyExtractor={p => p._id}
        renderItem={({ item }) => <ProductCard item={item} onPress={() => onOpen(item._id)} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={INV} />}
        ListHeaderComponent={shown.length ? <Text style={styles.count}>{shown.length} at or below reorder level</Text> : null}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="checkmark-circle-outline" size={48} color="#86EFAC" />
            <Text style={styles.emptyTxt}>{search ? 'No low-stock products match' : 'No products are low on stock'}</Text>
          </View>
        }
      />
    </>
  );
}

export default function ProductsScreen() {
  const router = useRouter();
  const { low } = useLocalSearchParams<{ low?: string }>();

  const [search,   setSearch]   = useState('');
  const [active,   setActive]   = useState<ActiveFilter>('active');
  const [lowOnly,  setLowOnly]  = useState(low === '1');
  const debounced = useDebounced(search.trim(), 400);

  const open = useCallback((id: string) => router.push(`/inventory/products/${id}` as any), [router]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Name, SKU, barcode..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={{ flexGrow: 0 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} keyboardShouldPersistTaps="handled">
          <TouchableOpacity
            style={[styles.chip, styles.chipLow, lowOnly && styles.chipLowActive]}
            onPress={() => setLowOnly(v => !v)}
          >
            <Ionicons name="warning-outline" size={12} color={lowOnly ? '#fff' : '#D97706'} />
            <Text style={[styles.chipTxt, { color: lowOnly ? '#fff' : '#D97706' }]}>Low stock</Text>
          </TouchableOpacity>
          {!lowOnly && ACTIVE_CHIPS.map(c => (
            <TouchableOpacity key={c.key} style={[styles.chip, active === c.key && styles.chipActive]} onPress={() => setActive(c.key)}>
              <Text style={[styles.chipTxt, active === c.key && { color: '#fff' }]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {lowOnly
        ? <LowStockProducts search={debounced} onOpen={open} />
        : <AllProducts search={debounced} active={active} onOpen={open} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: INVBG },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, marginBottom: 8,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 50,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },

  filterRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#fff', borderRadius: 20,
    borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 6,
  },
  chipActive:    { backgroundColor: INV, borderColor: INV },
  chipLow:       { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  chipLowActive: { backgroundColor: '#D97706', borderColor: '#D97706' },
  chipTxt:       { fontSize: 12, fontWeight: '600', color: '#64748B' },

  list:      { paddingBottom: 40 },
  count:     { fontSize: 11, color: '#94A3B8', fontWeight: '600', paddingHorizontal: 16, paddingBottom: 6 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12,
  },
  cardLow: { backgroundColor: '#FFFBEB' },
  iconBox: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name:    { fontSize: 14, fontWeight: '700', color: '#0F172A', flexShrink: 1 },

  lowBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FEF3C7', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  lowTxt:   { fontSize: 9, fontWeight: '800', color: '#D97706' },
  inactiveBadge: { backgroundColor: '#F1F5F9', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  inactiveTxt:   { fontSize: 9, fontWeight: '800', color: '#64748B' },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  sku:     { fontSize: 10, fontWeight: '700', color: '#94A3B8', fontVariant: ['tabular-nums'] },
  cat:     { fontSize: 10, color: '#64748B', backgroundColor: '#F1F5F9', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },

  price: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  stock: { fontSize: 11, color: '#94A3B8' },
});
