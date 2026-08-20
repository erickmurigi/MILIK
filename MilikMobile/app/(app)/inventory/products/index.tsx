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

type Product = {
  _id:           string;
  name:          string;
  sku?:          string;
  barcode?:      string;
  category?:     { name?: string } | string;
  unitOfMeasure?: string;
  sellingPrice:  number;
  costPrice:     number;
  reorderLevel:  number;
  stockBalance?: number;
  trackStock:    boolean;
  active:        boolean;
};

const LIMIT = 40;

const getCat = (c: Product['category']) =>
  typeof c === 'object' ? (c?.name ?? '') : (c ?? '');

export default function ProductsScreen() {
  const router = useRouter();

  const [search,      setSearch]      = useState('');
  const [items,       setItems]       = useState<Product[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(true);
  const [showLowOnly, setShowLowOnly] = useState(false);

  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (pg = 1, isRefresh = false) => {
    if (pg === 1) isRefresh ? setRefreshing(true) : setLoading(true);
    else setLoadingMore(true);
    try {
      const p: Record<string, string> = { page: String(pg), limit: String(LIMIT), active: 'true' };
      if (searchRef.current.trim()) p.search = searchRef.current.trim();
      const { data } = await api.get('/inventory/products', { params: p });
      const rows: Product[] = Array.isArray(data) ? data : data?.data ?? data?.items ?? data?.products ?? [];
      setItems(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? 'Failed to load products';
      Alert.alert('Error', msg);
      if (pg === 1) setItems([]);
    }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, []);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { const t = setTimeout(() => load(1), 400); return () => clearTimeout(t); }, [search]);

  const displayItems = showLowOnly
    ? items.filter(p => p.trackStock && p.reorderLevel > 0 && (p.stockBalance ?? 0) <= p.reorderLevel)
    : items;

  const renderItem = ({ item }: { item: Product }) => {
    const cat = getCat(item.category);
    const isLow = item.trackStock && item.reorderLevel > 0 && (item.stockBalance ?? 0) <= item.reorderLevel;
    return (
      <TouchableOpacity
        style={[styles.card, isLow && styles.cardLow]}
        onPress={() => router.push(`/inventory/products/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={[styles.iconBox, { backgroundColor: INV + '15' }]}>
          <Ionicons name="cube-outline" size={20} color={INV} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            {isLow && (
              <View style={styles.lowBadge}>
                <Ionicons name="warning" size={10} color="#D97706" />
                <Text style={styles.lowTxt}>Low</Text>
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            {item.sku ? <Text style={styles.sku}>{item.sku}</Text> : null}
            {cat ? <Text style={styles.cat}>{cat}</Text> : null}
            {item.unitOfMeasure ? <Text style={styles.uom}>{item.unitOfMeasure}</Text> : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={styles.price}>{fmt(item.sellingPrice)}</Text>
          {item.trackStock && (
            <Text style={[styles.stock, isLow && { color: '#D97706', fontWeight: '700' }]}>
              {item.stockBalance ?? '—'} {item.unitOfMeasure ?? 'units'}
            </Text>
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
          placeholder="Name, SKU, barcode..."
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

      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, showLowOnly && styles.filterChipActive]}
          onPress={() => setShowLowOnly(v => !v)}
        >
          <Ionicons name="warning-outline" size={12} color={showLowOnly ? '#fff' : '#D97706'} />
          <Text style={[styles.filterChipTxt, showLowOnly && { color: '#fff' }]}>Low Stock Only</Text>
        </TouchableOpacity>
      </View>

      {loading ? <MilikLoader fullscreen /> : (
        <FlatList
          data={displayItems}
          keyExtractor={p => p._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#F1F5F9' }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={INV} />}
          onEndReached={() => { if (!loadingMore && hasMore && !showLowOnly) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="cube-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>
                {showLowOnly ? 'No low-stock products' : 'No products found'}
              </Text>
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

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, marginBottom: 8,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 50,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },

  filterRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#FEF3C7', borderRadius: 20,
    borderWidth: 1, borderColor: '#FDE68A', paddingHorizontal: 12, paddingVertical: 6,
  },
  filterChipActive:  { backgroundColor: '#D97706', borderColor: '#D97706' },
  filterChipTxt:     { fontSize: 12, fontWeight: '600', color: '#D97706' },

  list:      { paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12,
  },
  cardLow: { backgroundColor: '#FFFBEB' },
  iconBox:  { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name:    { fontSize: 14, fontWeight: '700', color: '#0F172A', flex: 1 },

  lowBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FEF3C7', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  lowTxt:   { fontSize: 9, fontWeight: '800', color: '#D97706' },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  sku:     { fontSize: 10, fontWeight: '700', color: '#94A3B8', fontVariant: ['tabular-nums'] },
  cat:     { fontSize: 10, color: '#64748B', backgroundColor: '#F1F5F9', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  uom:     { fontSize: 10, color: '#94A3B8' },

  price:   { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  stock:   { fontSize: 11, color: '#94A3B8' },
});
