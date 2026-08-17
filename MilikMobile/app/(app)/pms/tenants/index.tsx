import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, FlatList,
  TouchableOpacity, ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

type Tenant = {
  _id:         string;
  name:        string;
  phone?:      string;
  tenantCode?: string;
  status?:     string;
  balance?:    number;
  unit?:       { unitNumber?: string; property?: { propertyName?: string } };
};

type Property = { _id: string; propertyName: string };

const STATUS_COLOR: Record<string, string> = {
  active:     Colors.success,
  overdue:    Colors.danger,
  terminated: Colors.textMuted,
  moved_out:  Colors.textMuted,
};

const FILTER_TABS = [
  { key: 'all',        label: 'All'     },
  { key: 'active',     label: 'Active'  },
  { key: 'overdue',    label: 'Overdue' },
  { key: 'terminated', label: 'Past'    },
] as const;
type FilterKey = typeof FILTER_TABS[number]['key'];

export default function TenantSearchScreen() {
  const router = useRouter();

  const [query,          setQuery]          = useState('');
  const [results,        setResults]        = useState<Tenant[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [loadingMore,    setLoadingMore]    = useState(false);
  const [page,           setPage]           = useState(1);
  const [hasMore,        setHasMore]        = useState(true);
  const [statusFilter,   setStatusFilter]   = useState<FilterKey>('active');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [properties,     setProperties]     = useState<Property[]>([]);

  const LIMIT    = 30;
  const queryRef = useRef(query);
  queryRef.current = query;

  // Load properties once for the filter chips
  useEffect(() => {
    api.get('/properties', { params: { limit: 100 } })
      .then(({ data }) => setProperties(data.data ?? []))
      .catch(() => {});
  }, []);

  const load = useCallback(async (pg = 1, isRefresh = false) => {
    if (pg === 1) isRefresh ? setRefreshing(true) : setLoading(true);
    else setLoadingMore(true);

    try {
      const params: Record<string, string> = {
        page: String(pg), limit: String(LIMIT),
      };
      if (queryRef.current.trim()) params.search   = queryRef.current.trim();
      if (statusFilter !== 'all')  params.status   = statusFilter;
      if (propertyFilter)          params.property = propertyFilter;

      const { data } = await api.get('/tenants', { params });
      const rows: Tenant[] = data.data ?? [];

      setResults(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch {
      if (pg === 1) setResults([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [statusFilter, propertyFilter]);

  useEffect(() => { load(1); }, [load]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => load(1), 400);
    return () => clearTimeout(t);
  }, [query]);

  const selectedProperty = properties.find(p => p._id === propertyFilter);

  const renderItem = ({ item }: { item: Tenant }) => {
    const unit        = item.unit?.unitNumber || '—';
    const property    = item.unit?.property?.propertyName || '';
    const bal         = Number(item.balance || 0);
    const statusColor = STATUS_COLOR[item.status || ''] || Colors.textMuted;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/pms/tenants/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={[styles.avatar, { backgroundColor: bal > 0 ? Colors.dangerLight : Colors.primaryFaded }]}>
          <Text style={[styles.avatarText, { color: bal > 0 ? Colors.danger : Colors.primary }]}>
            {item.name?.charAt(0)?.toUpperCase() || 'T'}
          </Text>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={styles.tenantName} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.balance, { color: bal > 0 ? Colors.danger : Colors.success }]}>
              {bal > 0 ? `KES ${bal.toLocaleString()}` : 'Settled'}
            </Text>
          </View>
          <View style={styles.cardMeta}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={styles.metaText} numberOfLines={1}>
              {unit}{property ? ` · ${property}` : ''}
            </Text>
          </View>
          {item.phone ? <Text style={styles.phone}>{item.phone}</Text> : null}
        </View>

        <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Tenants' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>

        {/* Search bar */}
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Name, phone, unit or ID..."
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {loading && !refreshing ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : query ? (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Status filter tabs */}
        <View style={styles.tabsRow}>
          {FILTER_TABS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.tab, statusFilter === f.key && styles.tabActive]}
              onPress={() => setStatusFilter(f.key)}
            >
              <Text style={[styles.tabText, statusFilter === f.key && styles.tabTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Property filter chips */}
        {properties.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.propChipsScroll}
            contentContainerStyle={styles.propChips}
          >
            <TouchableOpacity
              style={[styles.propChip, !propertyFilter && styles.propChipActive]}
              onPress={() => setPropertyFilter('')}
            >
              <Ionicons
                name="business-outline"
                size={12}
                color={!propertyFilter ? Colors.white : Colors.textSecondary}
              />
              <Text style={[styles.propChipText, !propertyFilter && styles.propChipTextActive]}>
                All Properties
              </Text>
            </TouchableOpacity>

            {properties.map(p => (
              <TouchableOpacity
                key={p._id}
                style={[styles.propChip, propertyFilter === p._id && styles.propChipActive]}
                onPress={() => setPropertyFilter(p._id)}
              >
                <Text style={[styles.propChipText, propertyFilter === p._id && styles.propChipTextActive]}>
                  {p.propertyName}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Active property label */}
        {selectedProperty ? (
          <View style={styles.activePropBar}>
            <Ionicons name="business" size={13} color={Colors.primary} />
            <Text style={styles.activePropText} numberOfLines={1}>{selectedProperty.propertyName}</Text>
            <TouchableOpacity onPress={() => setPropertyFilter('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={15} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}

        {loading && !refreshing ? (
          <MilikLoader fullscreen />
        ) : (
          <FlatList
            data={results}
            keyExtractor={t => t._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={Colors.primary} />
            }
            onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              <View style={styles.centered}>
                <Ionicons name="people-outline" size={48} color={Colors.border} />
                <Text style={styles.emptyText}>No tenants found</Text>
              </View>
            }
            ListFooterComponent={
              loadingMore ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                </View>
              ) : null
            }
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textMuted },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, marginBottom: 10,
    backgroundColor: Colors.white,
    borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, height: 50,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },

  tabsRow: { flexDirection: 'row', flexGrow: 0, paddingHorizontal: 16, gap: 8, marginBottom: 10 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.border,
  },
  tabActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText:       { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.white },

  // Property chips
  propChipsScroll: { flexGrow: 0, flexShrink: 0 },
  propChips: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 10, gap: 8,
  },
  propChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, height: 32,
    borderRadius: 16, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.border,
    alignSelf: 'center',
  },
  propChipActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  propChipText:       { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  propChipTextActive: { color: Colors.white },

  // Active property indicator
  activePropBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: Colors.primaryFaded,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  activePropText: { flex: 1, fontSize: 12, fontWeight: '600', color: Colors.primary },

  list: { paddingHorizontal: 16, paddingBottom: 32 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
    padding: 14,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '800' },

  cardBody: { flex: 1 },
  cardTop: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 3,
  },
  tenantName: { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1, marginRight: 8 },
  balance:    { fontSize: 13, fontWeight: '800' },

  cardMeta:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  metaText:  { fontSize: 12, color: Colors.textMuted, flex: 1 },
  phone:     { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
});
