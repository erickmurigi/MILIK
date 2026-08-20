import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

type MaintenanceItem = {
  _id:         string;
  title:       string;
  description: string;
  priority:    string;
  status:      string;
  createdAt:   string;
  tenant?:     { name?: string; phone?: string };
  unit?:       { unitNumber?: string; property?: { propertyName?: string; name?: string } };
};

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  emergency: { bg: '#FFF1F0', text: '#CF1322' },
  high:      { bg: Colors.dangerLight,  text: Colors.danger  },
  medium:    { bg: Colors.warningLight, text: Colors.warning },
  low:       { bg: Colors.borderLight,  text: Colors.textMuted },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:     { bg: Colors.dangerLight,  text: Colors.danger  },
  in_progress: { bg: Colors.warningLight, text: Colors.warning },
  completed:   { bg: Colors.successLight, text: Colors.success },
  cancelled:   { bg: Colors.borderLight,  text: Colors.textMuted },
};

const STATUS_LABELS: Record<string, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  cancelled:   'Cancelled',
};

const FILTER_TABS = ['all', 'pending', 'in_progress', 'completed', 'cancelled'] as const;
type FilterTab = typeof FILTER_TABS[number];

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

export default function MaintenanceScreen() {
  const router = useRouter();
  const [items,       setItems]       = useState<MaintenanceItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [search,      setSearch]      = useState('');
  const [filter,      setFilter]      = useState<FilterTab>('pending');
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const LIMIT = 50;
  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (pg = 1, replace = true) => {
    if (pg === 1) replace ? setLoading(true) : setRefreshing(true);
    else setLoadingMore(true);

    try {
      const params: Record<string, string> = {
        page: String(pg), limit: String(LIMIT),
      };
      if (filter !== 'all')         params.status = filter;
      if (searchRef.current.trim()) params.search  = searchRef.current.trim();

      const { data } = await api.get('/maintenances', { params });
      const rows: MaintenanceItem[] = data.data ?? [];

      setItems(prev => replace || pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch { /* fail silently */ }
    finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [filter]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(1), 400);
    return () => clearTimeout(t);
  }, [search]);

  const renderItem = ({ item }: { item: MaintenanceItem }) => {
    const pc = PRIORITY_COLORS[item.priority] ?? PRIORITY_COLORS.low;
    const sc = STATUS_COLORS[item.status]   ?? STATUS_COLORS.pending;
    const prop = item.unit?.property?.propertyName ?? item.unit?.property?.name ?? '';

    return (
      <TouchableOpacity style={styles.card} onPress={() => router.push(`/pms/maintenance/${item._id}` as any)} activeOpacity={0.75}>
        <View style={styles.cardTop}>
          <View style={[styles.priorityDot, { backgroundColor: pc.text }]} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[item.unit?.unitNumber, prop].filter(Boolean).join(' · ')}
            </Text>
            {item.tenant?.name && (
              <Text style={styles.meta}>{item.tenant.name}</Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeText, { color: sc.text }]}>
                {(STATUS_LABELS[item.status] ?? item.status?.replace('_', ' ') ?? '').toUpperCase()}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: pc.bg }]}>
              <Text style={[styles.badgeText, { color: pc.text }]}>
                {item.priority?.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>
        <Text style={styles.date}>{fmtDate(item.createdAt)}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search maintenance..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={() => load(1)}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Filter tabs */}
      <View style={styles.tabs}>
        {FILTER_TABS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>
              {f === 'all' ? 'All' : (STATUS_LABELS[f] ?? f.charAt(0).toUpperCase() + f.slice(1))}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <MilikLoader fullscreen />
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(1, false)} tintColor={Colors.primary} />
          }
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1, false); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="construct-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No maintenance requests</Text>
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

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/pms/maintenance/new' as any)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={26} color={Colors.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textMuted },
  list:      { paddingBottom: 100 },

  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },

  searchRow: { paddingHorizontal: 16, paddingVertical: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },

  tabs: { flexDirection: 'row', paddingHorizontal: 16, gap: 6, paddingBottom: 10, flexWrap: 'wrap' },
  tab: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.border,
  },
  tabActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText:       { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.white },

  card: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 6,
  },
  cardTop:     { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  cardTitle:   { fontSize: 14, fontWeight: '700', color: Colors.text },
  meta:        { fontSize: 11, color: Colors.textMuted },
  date:        { fontSize: 10, color: Colors.textMuted, alignSelf: 'flex-end' },

  badge:     { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
});
