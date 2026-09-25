import { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useDebounced, usePmsList, useReloadOnFocus } from '../../../../hooks/usePmsList';
import { useSaleSettings } from '../../../../hooks/useSaleSettings';
import { fmtDate, fmtKES } from '../../../../utils/pmsFormat';
import { DEAL_STATUS_STYLE, SBG, SC, dealBalance, dealPct, pageOf, refName } from '../../../../utils/sales';

type Deal = {
  _id:                  string;
  dealNumber?:          string;
  listing?:             { title?: string; listingNumber?: string };
  buyer?:               { fullName?: string; phone?: string };
  agent?:               { fullName?: string };
  agreedPrice:          number;
  totalPaid?:           number;
  balance?:             number;
  status:               string;
  dealDate?:            string;
  expectedClosingDate?: string;
};

const TABS = [
  { key: '',          label: 'All'       },
  { key: 'active',    label: 'Active'    },
  { key: 'closed',    label: 'Closed'    },
  { key: 'cancelled', label: 'Cancelled' },
] as const;
const VALID_STATUS = new Set<string>(TABS.map(t => t.key));

const parse = (data: any) => pageOf<Deal>(data);

export default function DealsScreen() {
  const router = useRouter();
  const { terms: T } = useSaleSettings();
  const params = useLocalSearchParams<{ status?: string }>();

  // The dashboard hands over a status; otherwise open on the deals still in progress.
  const [statusFilter, setStatusFilter] = useState(params.status !== undefined && VALID_STATUS.has(String(params.status)) ? String(params.status) : 'active');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 400);

  const listParams = useMemo(
    () => ({ status: statusFilter || undefined, search: debouncedSearch || undefined }),
    [statusFilter, debouncedSearch],
  );
  const list = usePmsList<Deal>({ path: '/sale/deals', params: listParams, limit: 30, parse });
  useReloadOnFocus(list.reload);

  const renderItem = ({ item }: { item: Deal }) => {
    const sc      = DEAL_STATUS_STYLE[item.status] ?? DEAL_STATUS_STYLE.active;
    const paid    = Number(item.totalPaid || 0);
    const balance = item.status === 'cancelled' ? 0 : dealBalance(item);
    const pct     = dealPct(item);
    const agent   = refName(item.agent, 'fullName');

    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/sales/deals/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            {item.dealNumber ? <Text style={styles.dealNum}>{item.dealNumber}</Text> : null}
            <Text style={styles.listing} numberOfLines={1}>{refName(item.listing, 'title', 'listingNumber') || '—'}</Text>
            <Text style={styles.buyer} numberOfLines={1}>
              {refName(item.buyer, 'fullName') || '—'}{agent ? `  ·  ${agent}` : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
            <Text style={styles.price}>{fmtKES(item.agreedPrice)}</Text>
          </View>
        </View>

        <View style={styles.progressWrap}>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.progressTxt}>{pct.toFixed(0)}% collected</Text>
        </View>

        <View style={styles.cardBottom}>
          <Text style={styles.paidTxt}>Paid: <Text style={{ fontWeight: '800', color: '#065F46' }}>{fmtKES(paid)}</Text></Text>
          <Text style={styles.balTxt}>Balance: <Text style={{ fontWeight: '800', color: balance > 0 ? '#DC2626' : '#065F46' }}>{fmtKES(balance)}</Text></Text>
        </View>
        {item.status === 'active' && item.expectedClosingDate ? (
          <Text style={styles.closing}>Expected closing {fmtDate(item.expectedClosingDate)}</Text>
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
          placeholder={`${T.saleDeal} no., ${T.saleListing.toLowerCase()}, ${T.saleBuyer.toLowerCase()}, phone...`}
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

      <View style={styles.tabsRow}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, statusFilter === t.key && styles.tabActive]}
            onPress={() => setStatusFilter(t.key)}
          >
            <Text style={[styles.tabTxt, statusFilter === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {list.loading ? <MilikLoader fullscreen /> : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : (
        <>
          {list.error ? <ErrorBanner message={list.error} onRetry={list.retry} /> : null}
          <FlatList
            data={list.items}
            keyExtractor={d => d._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={SC} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={list.total > 0 ? (
              <Text style={styles.count}>{list.total} {(list.total === 1 ? T.saleDeal : T.saleDeals).toLowerCase()}</Text>
            ) : null}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="briefcase-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTxt}>
                  {debouncedSearch || statusFilter ? `No ${T.saleDeals.toLowerCase()} match your filters` : `No ${T.saleDeals.toLowerCase()} yet`}
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

  tabsRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  tab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: SC, borderColor: SC },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 40 },
  count:     { fontSize: 11, fontWeight: '700', color: '#94A3B8', marginBottom: 8 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8', textAlign: 'center' },

  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3,
    padding: 14, gap: 10,
  },
  cardTop:  { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dealNum:  { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 2 },
  listing:  { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  buyer:    { fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: '500' },
  badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: 10, fontWeight: '800' },
  price:    { fontSize: 14, fontWeight: '900', color: '#0F172A' },

  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressBg:   { flex: 1, height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#065F46', borderRadius: 3 },
  progressTxt:  { fontSize: 10, fontWeight: '700', color: '#94A3B8', width: 80, textAlign: 'right' },

  cardBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  paidTxt:    { fontSize: 12, color: '#64748B' },
  balTxt:     { fontSize: 12, color: '#64748B' },
  closing:    { fontSize: 11, color: '#94A3B8', marginTop: -4 },
});
