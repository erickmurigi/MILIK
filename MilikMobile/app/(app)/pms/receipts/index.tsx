import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import ListErrorState from '../../../../components/ui/ListErrorState';
import { usePagedList, useDebounced, Page } from '../../../../hooks/usePagedList';
import { fmtMoney, fmtDate } from '../../../../utils/pmsFormat';
import { Period, periodRange, PAYMENT_METHOD_LABEL, rowsOf } from '../../../../utils/pmsBilling';

type Receipt = {
  _id:              string;
  receiptNumber?:   string;
  referenceNumber?: string;
  paymentDate?:     string;
  amount:           number;
  paymentType?:     string;
  paymentMethod?:   string;
  isConfirmed?:     boolean;
  isReversed?:      boolean;
  isCancelled?:     boolean;
  postingStatus?:   string;
  tenant?:          { _id?: string; name?: string } | null;
  unit?:            { unitNumber?: string; property?: { propertyName?: string; name?: string } | null } | null;
  allocationSummary?: { unapplied?: number };
};

// Server statuses: active (default) | confirmed | pending | failed | reversed
type StatusFilter = 'active' | 'confirmed' | 'pending' | 'reversed';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'active',    label: 'All'       },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'pending',   label: 'Pending'   },
  { key: 'reversed',  label: 'Reversed'  },
];

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: '1M',  label: '1 Mo'    },
  { key: '3M',  label: '3 Mo'    },
  { key: '6M',  label: '6 Mo'    },
  { key: '1Y',  label: 'This Yr' },
  { key: 'All', label: 'All'     },
];

const TYPE_LABEL: Record<string, string> = {
  rent: 'Rent', deposit: 'Deposit', utility: 'Utility', late_fee: 'Late Penalty', other: 'Other',
};

const resolveStatus = (r: Receipt) => {
  if (r.isReversed || r.isCancelled)   return { label: 'REVERSED',  bg: '#F1F5F9',           text: '#64748B'       };
  if (r.postingStatus === 'failed')    return { label: 'FAILED',    bg: Colors.dangerLight,  text: Colors.danger   };
  if (r.isConfirmed)                   return { label: 'CONFIRMED', bg: Colors.successLight, text: Colors.success  };
  return                                      { label: 'PENDING',   bg: Colors.warningLight, text: Colors.warning  };
};

const LIMIT = 30;

export default function ReceiptsScreen() {
  const router = useRouter();
  const { tenant: tenantParam, tenantName: tenantNameParam } =
    useLocalSearchParams<{ tenant?: string; tenantName?: string }>();

  const [tenantId, setTenantId] = useState(tenantParam ?? '');
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState<StatusFilter>('active');
  const [period,   setPeriod]   = useState<Period>('3M');
  const q = useDebounced(search.trim(), 400);

  const fetchPage = useCallback(async (page: number): Promise<Page<Receipt>> => {
    const params: Record<string, string | number> = { page, limit: LIMIT, status: filter };
    if (tenantId) params.tenant = tenantId;
    const { from, to } = periodRange(period);   // receipts API takes from / to
    if (from) params.from = from;
    if (to)   params.to   = to;
    if (q)    params.search = q;                 // receipt no., reference, description, tenant (name, code, phone) or unit

    const { data } = await api.get('/rent-payments', { params });
    const items = rowsOf<Receipt>(data);
    const totalPages = Number(data?.pagination?.totalPages ?? 1);
    return { items, hasMore: page < totalPages };
  }, [filter, period, q, tenantId]);

  const { items: receipts, loading, refreshing, loadingMore, error, refresh, retry, loadMore } =
    usePagedList<Receipt>(fetchPage, `${filter}|${period}|${q}|${tenantId}`);

  const renderItem = ({ item }: { item: Receipt }) => {
    const sc         = resolveStatus(item);
    const unapplied  = Number(item.allocationSummary?.unapplied ?? 0);
    const propName   = item.unit?.property?.propertyName ?? item.unit?.property?.name ?? '';
    const isReversed = !!(item.isReversed || item.isCancelled);
    const method     = PAYMENT_METHOD_LABEL[item.paymentMethod ?? ''];
    const typeLabel  = TYPE_LABEL[item.paymentType ?? ''] ?? '';

    return (
      <TouchableOpacity
        style={[styles.card, isReversed && styles.cardReversed]}
        onPress={() => router.push(`/pms/receipts/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.receiptNum, isReversed && styles.textMuted]}>
              {item.receiptNumber || item.referenceNumber || '—'}
            </Text>
            <Text style={[styles.tenantName, isReversed && styles.textMuted]} numberOfLines={1}>
              {item.tenant?.name ?? 'Unknown Tenant'}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[item.unit?.unitNumber, propName].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeText, { color: sc.text }]}>{sc.label}</Text>
            </View>
            <Text style={[styles.amount, isReversed && styles.textMuted]}>KES {fmtMoney(item.amount)}</Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          {typeLabel ? <Text style={styles.meta}>{typeLabel}</Text> : null}
          {method ? <Text style={styles.meta}>{method}</Text> : null}
          <Text style={styles.meta}>{fmtDate(item.paymentDate)}</Text>
          {!isReversed && unapplied > 0.009 && (
            <Text style={[styles.meta, { color: Colors.warning, fontWeight: '700' }]}>
              Unallocated: {fmtMoney(unapplied)}
            </Text>
          )}
        </View>
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
            placeholder="Receipt no., reference, tenant or unit..."
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

      {/* Single-tenant scope (coming from a tenant profile) */}
      {tenantId ? (
        <View style={styles.scopeBar}>
          <Ionicons name="person" size={13} color={Colors.primary} />
          <Text style={styles.scopeText} numberOfLines={1}>{tenantNameParam || 'Selected tenant'}</Text>
          <TouchableOpacity onPress={() => setTenantId('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={15} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Status tabs */}
      <FlatList
        horizontal
        data={STATUS_TABS}
        keyExtractor={t => t.key}
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.tabsRow}
        renderItem={({ item: t }) => (
          <TouchableOpacity
            style={[styles.tab, filter === t.key && styles.tabActive,
              t.key === 'reversed' && filter !== 'reversed' && styles.tabReversed]}
            onPress={() => setFilter(t.key)}
          >
            <Text style={[styles.tabText, filter === t.key && styles.tabTextActive,
              t.key === 'reversed' && filter !== 'reversed' && styles.tabReversedText]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Period filter */}
      <View style={styles.periodRow}>
        <Ionicons name="calendar-outline" size={13} color={Colors.textMuted} style={{ marginRight: 2 }} />
        {PERIOD_TABS.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodChip, period === p.key && styles.periodChipActive]}
            onPress={() => setPeriod(p.key)}
          >
            <Text style={[styles.periodText, period === p.key && styles.periodTextActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <MilikLoader fullscreen />
      ) : (
        <FlatList
          data={receipts}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
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
                <Ionicons name="cash-outline" size={48} color={Colors.border} />
                <Text style={styles.emptyText}>No receipts found</Text>
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

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push(
          (tenantId
            ? `/pms/receipts/new?tenant=${tenantId}&tenantName=${encodeURIComponent(tenantNameParam ?? '')}`
            : '/pms/receipts/new') as any
        )}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={Colors.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyText:{ fontSize: 15, color: Colors.textMuted },
  list:     { paddingBottom: 100 },
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

  scopeBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: Colors.primaryFaded,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  scopeText: { flex: 1, fontSize: 12, fontWeight: '600', color: Colors.primary },

  tabsRow:         { paddingHorizontal: 16, paddingBottom: 8, gap: 7 },
  tab:             { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border },
  tabActive:       { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabReversed:     { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
  tabText:         { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive:   { color: Colors.white },
  tabReversedText: { color: '#94A3B8' },

  periodRow:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 16, paddingBottom: 10 },
  periodChip:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border },
  periodChipActive: { backgroundColor: Colors.primaryFaded, borderColor: Colors.primary },
  periodText:       { fontSize: 11, fontWeight: '600', color: Colors.textMuted },
  periodTextActive: { color: Colors.primary, fontWeight: '700' },

  card:         { marginHorizontal: 16, marginBottom: 10, backgroundColor: Colors.white, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14 },
  cardReversed: { opacity: 0.65, borderStyle: 'dashed' },
  cardTop:      { flexDirection: 'row', gap: 10, marginBottom: 8 },
  cardBottom:   { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },

  receiptNum: { fontSize: 14, fontWeight: '800', color: Colors.text },
  tenantName: { fontSize: 13, fontWeight: '600', color: Colors.text },
  textMuted:  { color: Colors.textMuted },
  meta:       { fontSize: 11, color: Colors.textMuted },
  amount:     { fontSize: 14, fontWeight: '800', color: Colors.success },

  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
});
