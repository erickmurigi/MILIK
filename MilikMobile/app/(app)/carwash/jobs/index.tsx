import { useCallback, useMemo, useState } from 'react';
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
import { fmtDate, fmtKES, todayISO } from '../../../../utils/pmsFormat';
import {
  CW, CWL, JOB_STATUS_STYLE, PAY_STATUS_STYLE, RANGE_CHIPS, cwMessage, fmtTime, jobNet, jobStatusLabel, listOf, paginationOf,
  rangeParams, type Range,
} from '../../../../utils/carwash';

type Job = {
  _id:          string;
  jobNumber?:   string;
  jobType?:     string;
  plateNumber?: string;
  itemDescription?: string;
  vehicleType?: string;
  serviceName?: string;
  status:       string;
  price:        number;
  discountAmount?: number;
  paymentStatus?: string;
  createdAt:    string;
  customerName?: string;
  phone?:       string;
  serviceLines?: { serviceName?: string }[];
  assignedStaff?: { name?: string }[];
};

const STATUS_TABS = [
  { key: '',          label: 'All'       },
  { key: 'waiting',   label: 'Waiting'   },
  { key: 'washing',   label: 'Washing'   },
  { key: 'drying',    label: 'Drying'    },
  { key: 'ready',     label: 'Ready'     },
  { key: 'done',      label: 'Done'      },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

const PAY_TABS = [
  { key: '',        label: 'Any payment' },
  { key: 'unpaid',  label: 'Unpaid'      },
  { key: 'partial', label: 'Partial'     },
  { key: 'paid',    label: 'Paid'        },
] as const;

const VALID_STATUS = new Set(STATUS_TABS.map(t => t.key));

const parse = (data: any) => {
  const p = paginationOf(data);
  return { rows: listOf<Job>(data, 'jobs'), pages: p.pages, total: p.total };
};

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function CarWashJobsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; date?: string }>();

  // The dashboard hands over a stage and the day it was looking at.
  const dayFromDashboard = /^\d{4}-\d{2}-\d{2}$/.test(String(params.date || '')) && params.date !== todayISO() ? String(params.date) : '';
  const [statusFilter, setStatusFilter] = useState(VALID_STATUS.has(params.status as any) ? String(params.status) : '');
  const [payFilter,    setPayFilter]    = useState('');
  const [range,        setRange]        = useState<Range | 'day'>(dayFromDashboard ? 'day' : 'today');
  const [search,       setSearch]       = useState('');
  const debouncedSearch = useDebounced(search.trim(), 400);

  const dateParams = range === 'day' ? { date: dayFromDashboard } : rangeParams(range);
  const listParams = useMemo(() => ({
    status:        statusFilter || undefined,
    paymentStatus: payFilter    || undefined,
    search:        debouncedSearch || undefined,
    ...dateParams,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [statusFilter, payFilter, debouncedSearch, range, dayFromDashboard]);

  const list = usePmsList<Job>({ path: '/carwash/jobs', params: listParams, limit: 30, parse });
  useReloadOnFocus(list.reload);

  const clearFilters = useCallback(() => {
    setStatusFilter(''); setPayFilter(''); setSearch(''); setRange('all');
  }, []);
  const filtered = !!(statusFilter || payFilter || debouncedSearch || range !== 'all');

  const renderItem = ({ item }: { item: Job }) => {
    const sc       = JOB_STATUS_STYLE[item.status] ?? JOB_STATUS_STYLE.cancelled;
    const ps       = PAY_STATUS_STYLE[item.paymentStatus ?? 'unpaid'] ?? PAY_STATUS_STYLE.unpaid;
    const isCarpet = item.jobType === 'carpet';
    const svcNames = (item.serviceLines ?? []).map(s => s.serviceName).filter(Boolean);
    const svcText  = svcNames.length ? svcNames.join(' · ') : (item.serviceName || item.vehicleType || '');
    const net      = jobNet(item);
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/carwash/jobs/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={[styles.plateBox, { backgroundColor: CWL }]}>
          <Text style={[styles.plate, { color: CW }]} numberOfLines={1}>{isCarpet ? 'CARPET' : (item.plateNumber || '—')}</Text>
          {item.jobNumber ? <Text style={styles.jobNum} numberOfLines={1}>#{item.jobNumber.replace(/^CW-/, '')}</Text> : null}
        </View>
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={styles.customerName} numberOfLines={1}>
              {(isCarpet ? item.itemDescription : '') || item.customerName || 'Walk-in'}
            </Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.amount}>{fmtKES(net)}</Text>
              {Number(item.discountAmount) > 0 ? <Text style={styles.strike}>{fmtKES(item.price)}</Text> : null}
            </View>
          </View>
          {svcText ? (
            <Text style={styles.services} numberOfLines={1}>
              {svcNames.length > 1 ? `${svcNames.length} services · ` : ''}{svcText}
            </Text>
          ) : null}
          <View style={styles.cardBottom}>
            <Text style={styles.time}>{fmtDate(item.createdAt)}, {fmtTime(item.createdAt)}</Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <View style={[styles.badge, { backgroundColor: sc.bg }]}>
                <Text style={[styles.badgeText, { color: sc.color }]}>{jobStatusLabel(item.status, item.jobType).toUpperCase()}</Text>
              </View>
              {item.status !== 'cancelled' ? (
                <View style={[styles.badge, { backgroundColor: ps.bg }]}>
                  <Text style={[styles.badgeText, { color: ps.color }]}>{ps.label.toUpperCase()}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Plate, customer, phone or job #"
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="characters"
        />
        {list.loading && !list.refreshing
          ? <ActivityIndicator size="small" color={CW} />
          : search ? <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color="#94A3B8" /></TouchableOpacity>
          : null}
      </View>

      {/* Filters */}
      <View style={styles.filters}>
        <FlatList
          horizontal
          data={dayFromDashboard ? [{ key: 'day', label: fmtDate(dayFromDashboard) }, ...RANGE_CHIPS] : RANGE_CHIPS}
          keyExtractor={c => c.key}
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.chipsRow}
          renderItem={({ item: c }) => <Chip label={c.label} active={range === c.key} onPress={() => setRange(c.key as Range | 'day')} />}
        />
        <FlatList
          horizontal
          data={STATUS_TABS as unknown as { key: string; label: string }[]}
          keyExtractor={t => t.key || 'all'}
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.chipsRow}
          renderItem={({ item: t }) => <Chip label={t.label} active={statusFilter === t.key} onPress={() => setStatusFilter(t.key)} />}
        />
        <FlatList
          horizontal
          data={PAY_TABS as unknown as { key: string; label: string }[]}
          keyExtractor={t => t.key || 'any'}
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.chipsRow}
          renderItem={({ item: t }) => <Chip label={t.label} active={payFilter === t.key} onPress={() => setPayFilter(t.key)} />}
        />
      </View>

      {list.loading ? (
        <MilikLoader fullscreen />
      ) : list.error && list.items.length === 0 ? (
        <ErrorState message={cwMessage(list.error)} onRetry={list.retry} />
      ) : (
        <FlatList
          data={list.items}
          keyExtractor={j => j._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={CW} />}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            <>
              {list.error ? <ErrorBanner message={cwMessage(list.error)} onRetry={list.refresh} /> : null}
              {list.items.length > 0 ? (
                <Text style={styles.count}>{list.total} job{list.total === 1 ? '' : 's'}</Text>
              ) : null}
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="car-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyText}>{filtered ? 'No jobs match these filters' : 'No jobs found'}</Text>
              {filtered ? (
                <TouchableOpacity onPress={clearFilters}><Text style={styles.clear}>Show all jobs</Text></TouchableOpacity>
              ) : null}
            </View>
          }
          ListFooterComponent={list.loadingMore ? (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={CW} />
            </View>
          ) : null}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/carwash/jobs/new' as any)} accessibilityLabel="New job">
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8FAFC' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, marginBottom: 8,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0',
    paddingHorizontal: 14, height: 48,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },

  filters:  { gap: 6, paddingBottom: 6 },
  chipsRow: { paddingHorizontal: 16, gap: 8 },
  chip: {
    paddingHorizontal: 13, paddingVertical: 6,
    borderRadius: 20, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  chipActive:     { backgroundColor: CW, borderColor: CW },
  chipText:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipTextActive: { color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 100 },
  count:     { fontSize: 11, fontWeight: '700', color: '#64748B', marginBottom: 8, marginTop: 2 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyText: { fontSize: 15, color: '#94A3B8' },
  clear:     { fontSize: 13, fontWeight: '700', color: CW },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0',
    borderLeftWidth: 3,
    padding: 12,
  },
  plateBox: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, alignItems: 'center', maxWidth: 92 },
  plate:    { fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  jobNum:   { fontSize: 9, color: '#64748B', marginTop: 2 },

  cardBody:     { flex: 1 },
  cardTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 },
  customerName: { fontSize: 14, fontWeight: '700', color: '#0F172A', flex: 1, marginRight: 8 },
  amount:       { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  strike:       { fontSize: 10, color: '#94A3B8', textDecorationLine: 'line-through' },
  services:     { fontSize: 11, color: '#64748B', marginBottom: 4 },
  cardBottom:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time:         { fontSize: 11, color: '#94A3B8' },

  badge:     { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },

  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: CW,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },
});
