import { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useDebounced, usePmsList, useReloadOnFocus } from '../../../../hooks/usePmsList';
import { useSaleSettings } from '../../../../hooks/useSaleSettings';
import { fmtKES, fmtNumber } from '../../../../utils/pmsFormat';
import { LISTING_STATUS_STYLE, SBG, SC, humanize, pageOf, refName } from '../../../../utils/sales';

type Listing = {
  _id:            string;
  listingNumber?: string;
  title:          string;
  propertyType?:  string;
  location?:      string;
  town?:          string;
  size?:          number | null;
  sizeUnit?:      string;
  askingPrice:    number;
  negotiable?:    boolean;
  status:         string;
  unitNumber?:    string;
  block?:         string;
  titleDeedAvailable?: boolean;
  project?:       { name?: string } | null;
  effectiveAgent?: { fullName?: string } | null;
};

type Stats = Record<string, { count?: number }>;

const TABS = [
  { key: '',               label: 'All'            },
  { key: 'available',      label: 'Available'      },
  { key: 'reserved',       label: 'Reserved'       },
  { key: 'under_contract', label: 'Under Contract' },
  { key: 'sold',           label: 'Sold'           },
  { key: 'withdrawn',      label: 'Withdrawn'      },
] as const;
const VALID_STATUS = new Set<string>(TABS.map(t => t.key));

const parse = (data: any) => ({ ...pageOf<Listing>(data), extra: (data?.stats ?? {}) as Stats });

export default function ListingsScreen() {
  const router = useRouter();
  const { terms: T } = useSaleSettings();
  const params = useLocalSearchParams<{ status?: string }>();

  const [statusFilter, setStatusFilter] = useState(params.status !== undefined && VALID_STATUS.has(String(params.status)) ? String(params.status) : 'available');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 400);

  const listParams = useMemo(
    () => ({ status: statusFilter || undefined, search: debouncedSearch || undefined }),
    [statusFilter, debouncedSearch],
  );
  const list = usePmsList<Listing, Stats>({ path: '/sale/listings', params: listParams, limit: 30, parse });
  useReloadOnFocus(list.reload);

  const stats = list.extra;
  const totalCount = stats ? Object.values(stats).reduce((a, s) => a + Number(s?.count || 0), 0) : 0;

  const renderItem = ({ item }: { item: Listing }) => {
    const sc = LISTING_STATUS_STYLE[item.status] ?? LISTING_STATUS_STYLE.available;
    const place = [item.location, item.town].filter(Boolean).join(', ');
    const unit  = [item.project?.name, item.unitNumber ? `${T.saleUnit} ${item.unitNumber}` : '', item.block ? `Block ${item.block}` : ''].filter(Boolean).join(' · ');
    const specs = [item.size ? `${fmtNumber(item.size)} ${item.sizeUnit ?? 'sqm'}` : null, item.titleDeedAvailable ? 'Title deed' : null].filter(Boolean).join(' · ');
    const agent = refName(item.effectiveAgent, 'fullName');

    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/sales/listings/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            {item.listingNumber ? <Text style={styles.refTxt}>{item.listingNumber}</Text> : null}
            <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
            {unit ? <Text style={styles.unit} numberOfLines={1}>{unit}</Text> : null}
            {place ? (
              <View style={styles.locRow}>
                <Ionicons name="location-outline" size={12} color="#94A3B8" />
                <Text style={styles.location} numberOfLines={1}>{place}</Text>
              </View>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
            <Text style={styles.price}>{fmtKES(item.askingPrice)}</Text>
            {item.negotiable ? <Text style={styles.negotiable}>Negotiable</Text> : null}
          </View>
        </View>
        {item.propertyType || specs || agent ? (
          <View style={styles.cardBottom}>
            {item.propertyType ? <View style={styles.pill}><Text style={styles.pillTxt}>{humanize(item.propertyType)}</Text></View> : null}
            {specs ? <Text style={styles.specs}>{specs}</Text> : null}
            <View style={{ flex: 1 }} />
            {agent ? <Text style={styles.agent} numberOfLines={1}>{agent}</Text> : null}
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder={`Title, ${T.saleUnit.toLowerCase()}, location, type...`}
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={{ flexGrow: 0 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow} keyboardShouldPersistTaps="handled">
          {TABS.map(t => {
            const active = statusFilter === t.key;
            const count = t.key ? stats?.[t.key]?.count : totalCount;
            return (
              <TouchableOpacity key={t.key || 'all'} style={[styles.tab, active && styles.tabActive]} onPress={() => setStatusFilter(t.key)}>
                <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>
                  {t.label}{stats && Object.keys(stats).length ? ` · ${count ?? 0}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {list.loading ? <MilikLoader fullscreen /> : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : (
        <>
          {list.error ? <ErrorBanner message={list.error} onRetry={list.retry} /> : null}
          <FlatList
            data={list.items}
            keyExtractor={l => l._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={SC} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="home-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTxt}>
                  {debouncedSearch || statusFilter ? `No ${T.saleListings.toLowerCase()} match your filters` : `No ${T.saleListings.toLowerCase()} yet`}
                </Text>
              </View>
            }
            ListFooterComponent={list.loadingMore ? <ActivityIndicator color={SC} style={{ padding: 20 }} /> : null}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: SBG },

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
  emptyTxt:  { fontSize: 15, color: '#94A3B8', textAlign: 'center' },

  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3,
    padding: 14, gap: 10,
  },
  cardTop:    { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  refTxt:     { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 2 },
  title:      { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  unit:       { fontSize: 12, fontWeight: '600', color: SC, marginTop: 2 },
  locRow:     { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  location:   { fontSize: 12, color: '#94A3B8', flexShrink: 1 },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt:   { fontSize: 10, fontWeight: '800' },
  price:      { fontSize: 14, fontWeight: '900', color: '#0F172A' },
  negotiable: { fontSize: 10, color: '#94A3B8', fontWeight: '600' },

  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill:       { backgroundColor: '#F1F5F9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt:    { fontSize: 10, fontWeight: '600', color: '#64748B' },
  specs:      { fontSize: 11, color: '#94A3B8' },
  agent:      { fontSize: 11, color: '#94A3B8', maxWidth: 120 },
});
