import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const SC = '#7C2D12';

type Listing = {
  _id:          string;
  listingRef?:  string;
  title:        string;
  propertyType?:string;
  location?:    string;
  price:        number;
  status:       string;
  bedrooms?:    number;
  bathrooms?:   number;
  size?:        number;
  sizeUnit?:    string;
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  available: { bg: '#D1FAE5', color: '#065F46', label: 'Available' },
  reserved:  { bg: '#FEF3C7', color: '#D97706', label: 'Reserved'  },
  sold:      { bg: '#F1F5F9', color: '#64748B', label: 'Sold'      },
  withdrawn: { bg: '#FEE2E2', color: '#DC2626', label: 'Withdrawn' },
};

const TABS = [
  { key: '',          label: 'All'       },
  { key: 'available', label: 'Available' },
  { key: 'reserved',  label: 'Reserved'  },
  { key: 'sold',      label: 'Sold'      },
] as const;

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0 })}`;

const LIMIT = 30;

export default function ListingsScreen() {
  const [statusFilter, setStatusFilter] = useState('available');
  const [search,       setSearch]       = useState('');
  const [items,        setItems]        = useState<Listing[]>([]);
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
      const { data } = await api.get('/sale/listings', { params: p });
      const rows: Listing[] = data?.data ?? (Array.isArray(data) ? data : []);
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

  const renderItem = ({ item }: { item: Listing }) => {
    const sc = STATUS_CFG[item.status] ?? STATUS_CFG.available;
    const specs = [
      item.bedrooms  ? `${item.bedrooms} bd`   : null,
      item.bathrooms ? `${item.bathrooms} ba`   : null,
      item.size      ? `${item.size} ${item.sizeUnit ?? 'sqm'}` : null,
    ].filter(Boolean).join(' · ');

    return (
      <View style={[styles.card, { borderLeftColor: sc.color }]}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            {item.listingRef && <Text style={styles.refTxt}>{item.listingRef}</Text>}
            <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
            {item.location && (
              <View style={styles.locRow}>
                <Ionicons name="location-outline" size={12} color="#94A3B8" />
                <Text style={styles.location}>{item.location}</Text>
              </View>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
            <Text style={styles.price}>{fmt(item.price)}</Text>
          </View>
        </View>
        {(item.propertyType || specs) && (
          <View style={styles.cardBottom}>
            {item.propertyType && <View style={styles.pill}><Text style={styles.pillTxt}>{item.propertyType}</Text></View>}
            {specs ? <Text style={styles.specs}>{specs}</Text> : null}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Title, location, type..."
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
          keyExtractor={l => l._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={SC} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="home-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>No listings found</Text>
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
    padding: 14, gap: 8,
  },
  cardTop:   { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  refTxt:    { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 2 },
  title:     { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  locRow:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  location:  { fontSize: 12, color: '#94A3B8' },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt:  { fontSize: 10, fontWeight: '800' },
  price:     { fontSize: 14, fontWeight: '900', color: '#0F172A' },

  cardBottom:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill:      { backgroundColor: '#F1F5F9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt:   { fontSize: 10, fontWeight: '600', color: '#64748B' },
  specs:     { fontSize: 11, color: '#94A3B8', fontWeight: '500' },
});
