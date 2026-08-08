import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';

type MeterReading = {
  _id:             string;
  utilityType:     string;
  billingPeriod:   string;
  status:          string;
  readingDate:     string;
  previousReading: number;
  currentReading:  number;
  consumption:     number;
  ratePerUnit:     number;
  amount:          number;
  tenant?:         { name?: string };
  unit?:           { unitNumber?: string };
  property?:       { propertyName?: string; name?: string };
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft:  { bg: Colors.warningLight, text: Colors.warning },
  billed: { bg: Colors.successLight, text: Colors.success },
};

const UTILITY_ICONS: Record<string, string> = {
  water:       'water-outline',
  electricity: 'flash-outline',
  gas:         'flame-outline',
};

const fmt2 = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

const FILTER_TABS = ['all', 'draft', 'billed'] as const;
type FilterTab = typeof FILTER_TABS[number];

export default function MetersScreen() {
  const router = useRouter();
  const [items,       setItems]       = useState<MeterReading[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [filter,      setFilter]      = useState<FilterTab>('all');
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const LIMIT = 50;

  const load = useCallback(async (pg = 1, replace = true) => {
    if (pg === 1) replace ? setLoading(true) : setRefreshing(true);
    else setLoadingMore(true);

    try {
      const params: Record<string, string> = {
        page: String(pg), limit: String(LIMIT),
      };
      if (filter !== 'all') params.status = filter;

      const { data } = await api.get('/meter-readings', { params });
      const rows: MeterReading[] = data.data ?? [];

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

  const renderItem = ({ item }: { item: MeterReading }) => {
    const sc = STATUS_COLORS[item.status] ?? STATUS_COLORS.draft;
    const iconName = UTILITY_ICONS[item.utilityType?.toLowerCase()] ?? 'speedometer-outline';
    const propName = item.property?.propertyName ?? item.property?.name ?? '';

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.utilIcon}>
            <Ionicons name={iconName as any} size={20} color={Colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.cardTitle}>
              {item.utilityType ?? 'Utility'} · {item.billingPeriod ?? ''}
            </Text>
            <Text style={styles.tenantName} numberOfLines={1}>
              {item.tenant?.name ?? 'Unknown Tenant'}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[item.unit?.unitNumber, propName].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeText, { color: sc.text }]}>
                {item.status?.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.amount}>KES {fmt2(item.amount)}</Text>
          </View>
        </View>

        {/* Reading details */}
        <View style={styles.readingRow}>
          <View style={styles.readingCell}>
            <Text style={styles.readingLabel}>PREV</Text>
            <Text style={styles.readingValue}>{item.previousReading ?? 0}</Text>
          </View>
          <Ionicons name="arrow-forward" size={14} color={Colors.textMuted} />
          <View style={styles.readingCell}>
            <Text style={styles.readingLabel}>CURR</Text>
            <Text style={styles.readingValue}>{item.currentReading ?? 0}</Text>
          </View>
          <View style={[styles.readingCell, { marginLeft: 'auto' }]}>
            <Text style={styles.readingLabel}>USAGE</Text>
            <Text style={[styles.readingValue, { color: Colors.primary }]}>
              {item.consumption ?? 0} units
            </Text>
          </View>
          <View style={styles.readingCell}>
            <Text style={styles.readingLabel}>RATE</Text>
            <Text style={styles.readingValue}>{fmt2(item.ratePerUnit)}</Text>
          </View>
        </View>

        <Text style={styles.date}>{fmtDate(item.readingDate)}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Filter tabs */}
      <View style={styles.tabs}>
        {FILTER_TABS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(1)} tintColor={Colors.primary} />
          }
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1, false); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="speedometer-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No meter readings</Text>
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

      {/* FAB — New Reading */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/pms/meters/new' as any)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={Colors.white} />
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

  tabs: { flexDirection: 'row', padding: 16, gap: 8, paddingBottom: 8 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.border,
  },
  tabActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText:       { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.white },

  card: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 10,
  },
  cardTop:    { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  utilIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: Colors.primaryFaded,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle:  { fontSize: 14, fontWeight: '700', color: Colors.text },
  tenantName: { fontSize: 12, fontWeight: '600', color: Colors.text },
  meta:       { fontSize: 11, color: Colors.textMuted },
  amount:     { fontSize: 13, fontWeight: '800', color: Colors.text },

  readingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  readingCell:  { alignItems: 'center', gap: 2 },
  readingLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: Colors.textMuted },
  readingValue: { fontSize: 13, fontWeight: '700', color: Colors.text },

  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  date: { fontSize: 10, color: Colors.textMuted, alignSelf: 'flex-end' },
});
