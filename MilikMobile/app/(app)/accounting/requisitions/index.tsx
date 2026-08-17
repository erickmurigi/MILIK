import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const AC = '#064E3B';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Requisition = {
  _id:             string;
  requisitionNo?:  string;
  title:           string;
  amount:          number;
  submittedBy?:    { surname?: string; otherNames?: string };
  date?:           string;
  createdAt:       string;
  status:          string;
  priority?:       string;
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  draft:     { bg: '#F1F5F9', color: '#64748B', label: 'Draft'     },
  submitted: { bg: '#FEF3C7', color: '#D97706', label: 'Submitted' },
  approved:  { bg: '#D1FAE5', color: '#065F46', label: 'Approved'  },
  rejected:  { bg: '#FEE2E2', color: '#DC2626', label: 'Rejected'  },
  converted: { bg: '#EDE9FE', color: '#7C3AED', label: 'Converted' },
  cancelled: { bg: '#F1F5F9', color: '#94A3B8', label: 'Cancelled' },
};

const PRIORITY_CFG: Record<string, { color: string }> = {
  low:    { color: '#64748B' },
  medium: { color: '#D97706' },
  high:   { color: '#DC2626' },
};

const TABS = [
  { key: '',          label: 'All'       },
  { key: 'draft',     label: 'Draft'     },
  { key: 'submitted', label: 'Submitted' },
  { key: 'approved',  label: 'Approved'  },
  { key: 'converted', label: 'Converted' },
] as const;

export default function RequisitionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();

  const [statusFilter, setStatusFilter] = useState(params.status ?? '');
  const [search,       setSearch]       = useState('');
  const [items,        setItems]        = useState<Requisition[]>([]);
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
      const { data } = await api.get('/expense-requisitions', { params: p });
      const raw  = data?.data ?? data;
      const rows: Requisition[] = Array.isArray(raw) ? raw : (raw?.requisitions ?? []);
      setItems(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch { if (pg === 1) setItems([]); }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, [statusFilter]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { const t = setTimeout(() => load(1), 400); return () => clearTimeout(t); }, [search]);

  const quickApprove = (item: Requisition) => {
    Alert.alert('Approve Requisition', `Approve "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          try {
            await api.put(`/expense-requisitions/${item._id}/status`, { status: 'approved' });
            load(1, true);
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.message ?? 'Failed.');
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: Requisition }) => {
    const sc  = STATUS_CFG[item.status] ?? STATUS_CFG.draft;
    const pri = item.priority ? PRIORITY_CFG[item.priority] : null;
    const submitter = item.submittedBy
      ? [item.submittedBy.surname, item.submittedBy.otherNames].filter(Boolean).join(' ')
      : null;
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/accounting/requisitions/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            {item.requisitionNo ? <Text style={styles.numTxt}>{item.requisitionNo}</Text> : null}
            <Text style={styles.purpose} numberOfLines={2}>{item.title}</Text>
            {submitter ? (
              <View style={styles.byRow}>
                <Ionicons name="person-outline" size={11} color="#94A3B8" />
                <Text style={styles.byTxt}>{submitter}</Text>
              </View>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
            <Text style={styles.amount}>{fmt(item.amount)}</Text>
            {pri && item.priority && (
              <Text style={[styles.urgencyTxt, { color: pri.color }]}>{item.priority.toUpperCase()}</Text>
            )}
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.dateTxt}>{fmtDate(item.date ?? item.createdAt)}</Text>
          {item.status === 'submitted' && (
            <TouchableOpacity style={styles.approveBtn} onPress={() => quickApprove(item)}>
              <Ionicons name="checkmark" size={13} color={AC} />
              <Text style={styles.approveBtnTxt}>Approve</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput style={styles.searchInput} placeholder="Purpose, requester..." placeholderTextColor="#94A3B8" value={search} onChangeText={setSearch} />
        {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={18} color="#94A3B8" /></TouchableOpacity> : null}
      </View>

      <FlatList
        horizontal data={TABS as any} keyExtractor={t => t.key}
        showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.tabsRow}
        renderItem={({ item: t }) => (
          <TouchableOpacity style={[styles.tab, statusFilter === t.key && styles.tabActive]} onPress={() => setStatusFilter(t.key)}>
            <Text style={[styles.tabTxt, statusFilter === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        )}
      />

      {loading ? <MilikLoader fullscreen /> : (
        <FlatList
          data={items} keyExtractor={r => r._id} renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={AC} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={<View style={styles.emptyWrap}><Ionicons name="list-circle-outline" size={48} color="#CBD5E1" /><Text style={styles.emptyTxt}>No requisitions</Text></View>}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={AC} style={{ padding: 20 }} /> : null}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/accounting/requisitions/new' as any)}>
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginBottom: 10, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 50 },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },
  tabsRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  tab:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:    { backgroundColor: AC, borderColor: AC },
  tabTxt:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive: { color: '#fff' },
  list:      { paddingHorizontal: 16, paddingBottom: 100 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3, padding: 14, gap: 8 },
  cardTop:  { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  numTxt:   { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 2 },
  purpose:  { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  byRow:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  byTxt:    { fontSize: 11, color: '#94A3B8' },
  badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: 10, fontWeight: '800' },
  amount:   { fontSize: 15, fontWeight: '900', color: '#0F172A' },
  urgencyTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateTxt:    { fontSize: 11, color: '#94A3B8' },
  approveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ECFDF5', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#6EE7B7' },
  approveBtnTxt: { fontSize: 12, fontWeight: '700', color: AC },
  fab: { position: 'absolute', bottom: 28, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: AC, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 8 },
});
