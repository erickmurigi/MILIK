import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const AC  = '#064E3B';
const ACL = '#ECFDF5';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Journal = {
  _id:            string;
  reference?:     string;
  narration:      string;
  date:           string;
  status:         string;
  approvalStatus: string;
  amount:         number;
  createdBy?:     { surname?: string; otherNames?: string };
};

// JournalEntry.status is the posting state: draft | posted | reversed
// approvalStatus (pending_review / reviewed / approved) is a separate workflow field
const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  draft:    { bg: '#F1F5F9', color: '#64748B', label: 'Draft'    },
  posted:   { bg: '#D1FAE5', color: '#065F46', label: 'Posted'   },
  reversed: { bg: '#FEE2E2', color: '#DC2626', label: 'Reversed' },
};

const TABS = [
  { key: '',         label: 'All'      },
  { key: 'draft',    label: 'Draft'    },
  { key: 'posted',   label: 'Posted'   },
  { key: 'reversed', label: 'Reversed' },
] as const;

type Period = '1M' | '3M' | '6M' | '1Y' | 'All';

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: '1M',  label: '1 Mo'    },
  { key: '3M',  label: '3 Mo'    },
  { key: '6M',  label: '6 Mo'    },
  { key: '1Y',  label: 'This Yr' },
  { key: 'All', label: 'All'     },
];

const getPeriodDates = (p: Period): { startDate?: string; endDate?: string } => {
  if (p === 'All') return {};
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  let from: Date;
  if      (p === '1M') from = new Date(today.getFullYear(), today.getMonth(),     1);
  else if (p === '3M') from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  else if (p === '6M') from = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  else                 from = new Date(today.getFullYear(), 0, 1);
  return { startDate: from.toISOString().slice(0, 10), endDate };
};

export default function JournalsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();

  const [statusFilter, setStatusFilter] = useState(params.status ?? '');
  const [period,       setPeriod]       = useState<Period>('3M');
  const [search,       setSearch]       = useState('');
  const [items,        setItems]        = useState<Journal[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [page,         setPage]         = useState(1);
  const [hasMore,      setHasMore]      = useState(true);

  const LIMIT     = 30;
  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (pg = 1, isRefresh = false) => {
    if (pg === 1) isRefresh ? setRefreshing(true) : setLoading(true);
    else setLoadingMore(true);
    try {
      const p: Record<string, string> = { page: String(pg), limit: String(LIMIT) };
      if (statusFilter) p.status = statusFilter;
      const { startDate, endDate } = getPeriodDates(period);
      if (startDate) p.startDate = startDate;
      if (endDate)   p.endDate   = endDate;
      if (searchRef.current.trim()) p.search = searchRef.current.trim();
      const { data } = await api.get('/journals', { params: p });
      const raw  = data?.data ?? data;
      const rows: Journal[] = Array.isArray(raw) ? raw : (raw?.journals ?? []);
      setItems(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch { if (pg === 1) setItems([]); }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, [statusFilter, period]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(1), 400);
    return () => clearTimeout(t);
  }, [search]);

  const renderItem = ({ item }: { item: Journal }) => {
    const sc = STATUS_CFG[item.status] ?? STATUS_CFG.draft;
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/accounting/journals/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            {item.reference ? <Text style={styles.refTxt}>{item.reference}</Text> : null}
            <Text style={styles.narration} numberOfLines={2}>{item.narration}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
            <Text style={styles.amount}>{fmt(item.amount)}</Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.dateTxt}>{fmtDate(item.date)}</Text>
          {item.createdBy?.surname ? (
            <View style={styles.byRow}>
              <Ionicons name="person-outline" size={11} color="#94A3B8" />
              <Text style={styles.byTxt}>{[item.createdBy.surname, item.createdBy.otherNames].filter(Boolean).join(' ')}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Reference, narration..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
        />
        {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={18} color="#94A3B8" /></TouchableOpacity> : null}
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

      {/* Period filter */}
      <View style={styles.periodRow}>
        <Ionicons name="calendar-outline" size={13} color="#94A3B8" style={{ marginRight: 2 }} />
        {PERIOD_TABS.map(pt => (
          <TouchableOpacity
            key={pt.key}
            style={[styles.periodChip, period === pt.key && styles.periodChipActive]}
            onPress={() => setPeriod(pt.key)}
          >
            <Text style={[styles.periodText, period === pt.key && styles.periodTextActive]}>{pt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <MilikLoader fullscreen /> : (
        <FlatList
          data={items}
          keyExtractor={j => j._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={AC} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="document-text-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>No journal entries</Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={AC} style={{ padding: 20 }} /> : null}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/accounting/journals/new' as any)}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0FDF4' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, marginBottom: 10,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 50,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },

  tabsRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  periodRow:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 16, paddingBottom: 10 },
  periodChip:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  periodChipActive: { backgroundColor: '#ECFDF5', borderColor: AC },
  periodText:       { fontSize: 11, fontWeight: '600', color: '#94A3B8' },
  periodTextActive: { color: AC, fontWeight: '700' },
  tab:      { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:    { backgroundColor: AC, borderColor: AC },
  tabTxt:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive: { color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 100 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3,
    padding: 14, gap: 8,
  },
  cardTop:    { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  refTxt:     { fontSize: 11, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 2 },
  narration:  { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  badgeTxt:   { fontSize: 10, fontWeight: '800' },
  amount:     { fontSize: 14, fontWeight: '900', color: '#0F172A' },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateTxt:    { fontSize: 11, color: '#94A3B8' },
  byRow:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  byTxt:      { fontSize: 11, color: '#94A3B8' },

  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28, backgroundColor: AC,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },
});
