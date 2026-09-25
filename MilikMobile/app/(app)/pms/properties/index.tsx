import { useCallback, useState } from 'react';
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
import ListErrorState from '../../../../components/ui/ListErrorState';
import { usePagedList, useDebounced, Page } from '../../../../hooks/usePagedList';

type Property = {
  _id:            string;
  propertyName:   string;
  propertyCode?:  string;
  address?:       string;
  townCityState?: string;
  propertyType?:  string;
  status?:        string;
  landlords?:     {
    isPrimary?:  boolean;
    name?:       string;
    landlordId?: { landlordName?: string; firstName?: string; lastName?: string } | string | null;
  }[];
  totalUnits?:    number;
  occupiedUnits?: number;
  vacantUnits?:   number;
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:      { bg: Colors.successLight, text: Colors.success },
  maintenance: { bg: Colors.warningLight, text: Colors.warning },
  closed:      { bg: Colors.dangerLight,  text: Colors.danger },
  archived:    { bg: Colors.borderLight,  text: Colors.textMuted },
};

// The server only knows active | maintenance | closed | archived (lowercase).
const STATUS_TABS = [
  { key: 'active',      label: 'Active'      },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'closed',      label: 'Closed'      },
  { key: 'archived',    label: 'Archived'    },
  { key: '',            label: 'All'         },
] as const;

const LIMIT = 20;

const pct = (occ = 0, total = 0) =>
  total > 0 ? Math.round((occ / total) * 100) : 0;

// Properties can have several landlords; show the primary one (+ N more).
const landlordName = (list?: Property['landlords']) => {
  if (!list?.length) return '';
  const primary = list.find(l => l.isPrimary) ?? list[0];
  const ref = primary.landlordId && typeof primary.landlordId === 'object' ? primary.landlordId : null;
  const name = primary.name || ref?.landlordName || [ref?.firstName, ref?.lastName].filter(Boolean).join(' ');
  if (!name) return '';
  return list.length > 1 ? `${name} +${list.length - 1} more` : name;
};

export default function PropertiesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('active');
  const q = useDebounced(search.trim(), 400);

  const fetchPage = useCallback(async (page: number): Promise<Page<Property>> => {
    const params: Record<string, string | number> = { page, limit: LIMIT };
    if (q)      params.search = q;
    if (status) params.status = status;
    const { data } = await api.get('/properties', { params });
    const items: Property[] = Array.isArray(data?.data) ? data.data : [];
    return { items, hasMore: page < Number(data?.pagination?.pages ?? 0) };
  }, [q, status]);

  const { items: properties, loading, refreshing, loadingMore, error, refresh, retry, loadMore } =
    usePagedList<Property>(fetchPage, `${q}|${status}`);

  const renderItem = ({ item }: { item: Property }) => {
    const occ   = item.occupiedUnits ?? 0;
    const total = item.totalUnits    ?? 0;
    const vac   = item.vacantUnits   ?? Math.max(0, total - occ);
    const p     = pct(occ, total);
    const sc    = STATUS_COLORS[item.status ?? 'active'] ?? STATUS_COLORS.active;
    const owner = landlordName(item.landlords);
    const loc   = [item.address, item.townCityState].filter(Boolean).join(', ');

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => router.push({ pathname: '/pms/tenants' as any, params: { property: item._id, propertyName: item.propertyName } })}
      >
        <View style={styles.cardHeader}>
          <View style={styles.iconWrap}>
            <Ionicons name="business" size={22} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.propName} numberOfLines={1}>{item.propertyName}</Text>
            {item.propertyCode || item.propertyType ? (
              <Text style={styles.propCode} numberOfLines={1}>
                {[item.propertyCode, item.propertyType].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
          <View style={[styles.badge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.badgeText, { color: sc.text }]}>
              {(item.status ?? 'active').toUpperCase()}
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
            placeholder="Search name, code or LR number..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCorrect={false}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Status filter */}
      <View>
        <FlatList
          horizontal
          data={STATUS_TABS}
          keyExtractor={t => t.key || 'all'}
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.tabsRow}
          renderItem={({ item: t }) => (
            <TouchableOpacity
              style={[styles.tab, status === t.key && styles.tabActive]}
              onPress={() => setStatus(t.key)}
            >
              <Text style={[styles.tabText, status === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {loading ? (
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
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            error ? (
              <ListErrorState message={error} onRetry={retry} />
            ) : (
              <View style={styles.centered}>
                <Ionicons name="business-outline" size={48} color={Colors.border} />
                <Text style={styles.emptyText}>No properties found</Text>
              </View>
            )
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

  tabsRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 7 },
  tab: {
    paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
  },
  tabActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText:       { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.white },

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
