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
  _id: string;
  reference?: string;
  narration: string;
  date: string;
  status: string;
  totalDebit: number;
  totalCredit: number;
  createdBy?: { name?: string };
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  draft:           { bg: '#F1F5F9', color: '#64748B', label: 'Draft'     },
  pending_review:  { bg: '#FEF3C7', color: '#D97706', label: 'Pending'   },
  reviewed:        { bg: '#DBEAFE', color: '#1D4ED8', label: 'Reviewed'  },
  approved:        { bg: '#EDE9FE', color: '#7C3AED', label: 'Approved'  },
  posted:          { bg: '#D1FAE5', color: '#065F46', label: 'Posted'    },
  reversed:        { bg: '#FEE2E2', color: '#DC2626', label: 'Reversed'  },
};

const TABS = [
  { key: '',               label: 'All'      },
  { key: 'draft',          label: 'Draft'    },
  { key: 'pending_review', label: 'Pending'  },
  { key: 'approved',       label: 'Approved' },
  { key: 'posted',         label: 'Posted'   },
] as const;

export default function JournalsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();

  const [statusFilter, setStatusFilter] = useState(params.status ?? '');
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
      if (statusFilter)             p.status = statusFilter;
      if (searchRef.current.trim()) p.search = searchRef.current.trim();
      const { data } = await api.get('/journals', { params: p });
      const raw  = data?.data ?? data;
      const rows: Journal[] = Array.isArray(raw) ? raw : (raw?.journals ?? []);
      setItems(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch { if (pg === 1) setItems([]); }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, [statusFilter]);

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
            <Text style={styles.amount}>{fmt(item.totalDebit)}</Text>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.dateTxt}>{fmtDate(item.date)}</Text>
          {item.createdBy?.name ? (
            <View style={styles.byRow}>
              <Ionicons name="person-outline" size={11} color="#94A3B8" />
              <Text style={styles.byTxt}>{item.createdBy.name}</Text>
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

  tabsRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
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
