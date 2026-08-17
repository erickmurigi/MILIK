import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

type Property = {
  _id:            string;
  propertyName:   string;
  propertyCode?:  string;
  address?:       string;
  townCityState?: string;
  category?:      string;
  status?:        string;
  landlord?:      { name?: string; surname?: string; otherNames?: string };
  totalUnits?:    number;
  occupiedUnits?: number;
  vacantUnits?:   number;
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:   { bg: Colors.successLight, text: Colors.success },
  inactive: { bg: Colors.borderLight,  text: Colors.textMuted },
};

const pct = (occ = 0, total = 0) =>
  total > 0 ? Math.round((occ / total) * 100) : 0;

const landlordName = (l?: Property['landlord']) => {
  if (!l) return '';
  return [l.surname, l.otherNames].filter(Boolean).join(' ') || l.name || '';
};

export default function PropertiesScreen() {
  const [properties,   setProperties]   = useState<Property[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [search,       setSearch]       = useState('');
  const [page,         setPage]         = useState(1);
  const [hasMore,      setHasMore]      = useState(true);

  const LIMIT     = 20;
  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (pg = 1, replace = true) => {
    if (pg === 1) replace ? setLoading(true) : setRefreshing(true);
    else setLoadingMore(true);

    try {
      const params: Record<string, string> = {
        page: String(pg), limit: String(LIMIT),
      };
      if (searchRef.current.trim()) params.search = searchRef.current.trim();

      const { data } = await api.get('/properties', { params });
      const rows: Property[] = data.data ?? [];

      setProperties(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch {
      if (pg === 1) setProperties([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(1), 400);
    return () => clearTimeout(t);
  }, [search]);

  const renderItem = ({ item }: { item: Property }) => {
    const occ   = item.occupiedUnits ?? 0;
    const total = item.totalUnits    ?? 0;
    const vac   = item.vacantUnits   ?? (total - occ);
    const p     = pct(occ, total);
    const sc    = STATUS_COLORS[item.status ?? 'active'] ?? STATUS_COLORS.active;
    const owner = landlordName(item.landlord);
    const loc   = [item.address, item.townCityState].filter(Boolean).join(', ');

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.iconWrap}>
            <Ionicons name="business" size={22} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.propName} numberOfLines={1}>{item.propertyName}</Text>
            {item.propertyCode ? (
              <Text style={styles.propCode}>{item.propertyCode}</Text>
            ) : null}
          </View>
          <View style={[styles.badge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.badgeText, { color: sc.text }]}>
              {(item.status ?? 'ACTIVE').toUpperCase()}
            </Text>
          </View>
        </View>

        {loc ? (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={13} color={Colors.textMuted} />
            <Text style={styles.metaText} numberOfLines={1}>{loc}</Text>
          </View>
        ) : null}

        {owner ? (
          <View style={styles.metaRow}>
            <Ionicons name="person-outline" size={13} color={Colors.textMuted} />
            <Text style={styles.metaText} numberOfLines={1}>{owner}</Text>
          </View>
        ) : null}

        {total > 0 ? (
          <>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{total}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: Colors.success }]}>{occ}</Text>
                <Text style={styles.statLabel}>Occupied</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: vac > 0 ? Colors.warning : Colors.textMuted }]}>{vac}</Text>
                <Text style={styles.statLabel}>Vacant</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: p >= 80 ? Colors.success : p >= 50 ? Colors.warning : Colors.danger }]}>
                  {p}%
                </Text>
                <Text style={styles.statLabel}>Occupancy</Text>
              </View>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${p}%` as any,
                backgroundColor: p >= 80 ? Colors.success : p >= 50 ? Colors.warning : Colors.danger }]} />
            </View>
          </>
        ) : null}
      </View>
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
            placeholder="Search properties..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : loading && !refreshing ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : null}
        </View>
      </View>

      {loading && !refreshing ? (
        <MilikLoader fullscreen />
      ) : (
        <FlatList
          data={properties}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(1, false)} tintColor={Colors.primary} />
          }
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="business-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No properties found</Text>
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
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 },
  emptyText: { fontSize: 15, color: Colors.textMuted },

  searchRow: { paddingHorizontal: 16, paddingVertical: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },

  list: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 4 },

  card: {
    backgroundColor: Colors.white,
    borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
    padding: 16, gap: 10,
  },

  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.primaryFaded,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  propName: { fontSize: 15, fontWeight: '800', color: Colors.text },
  propCode: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  metaRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: Colors.textMuted, flex: 1 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 },
  stat: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 17, fontWeight: '900', color: Colors.text },
  statLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },

  barTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.border, overflow: 'hidden' },
  barFill:  { height: 6, borderRadius: 3 },
});
