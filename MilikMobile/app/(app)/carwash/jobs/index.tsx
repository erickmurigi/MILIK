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

const CW  = '#1E3A8A';
const CWL = '#EEF2FF';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Job = {
  _id:          string;
  jobNumber?:   string;
  plate:        string;
  vehicleType?: string;
  status:       string;
  totalAmount:  number;
  paymentStatus?: string;
  createdAt:    string;
  customer?:    { name?: string; phone?: string };
  services?:    { name?: string }[];
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  waiting:   { bg: '#FEF3C7', color: '#D97706' },
  washing:   { bg: '#DBEAFE', color: '#1D4ED8' },
  done:      { bg: '#EDE9FE', color: '#7C3AED' },
  paid:      { bg: '#D1FAE5', color: '#065F46' },
  cancelled: { bg: '#F1F5F9', color: '#64748B' },
};

const TABS = [
  { key: '',          label: 'All'       },
  { key: 'waiting',   label: 'Waiting'   },
  { key: 'washing',   label: 'Washing'   },
  { key: 'done',      label: 'Done'      },
  { key: 'paid',      label: 'Paid'      },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtTime = (d: string) =>
  new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

export default function CarWashJobsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();

  const [statusFilter, setStatusFilter] = useState(params.status ?? '');
  const [search,       setSearch]       = useState('');
  const [jobs,         setJobs]         = useState<Job[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [page,         setPage]         = useState(1);
  const [hasMore,      setHasMore]      = useState(true);

  const LIMIT    = 30;
  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (pg = 1, isRefresh = false) => {
    if (pg === 1) isRefresh ? setRefreshing(true) : setLoading(true);
    else setLoadingMore(true);
    try {
      const p: Record<string, string> = { page: String(pg), limit: String(LIMIT) };
      if (statusFilter)            p.status = statusFilter;
      if (searchRef.current.trim()) p.search = searchRef.current.trim();
      const { data } = await api.get('/carwash/jobs', { params: p });
      const raw  = data?.data ?? data;
      const rows: Job[] = Array.isArray(raw) ? raw : (raw?.jobs ?? []);
      setJobs(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch { if (pg === 1) setJobs([]); }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, [statusFilter]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(1), 400);
    return () => clearTimeout(t);
  }, [search]);

  const renderItem = ({ item }: { item: Job }) => {
    const sc      = STATUS_STYLE[item.status] ?? STATUS_STYLE.cancelled;
    const svcText = item.services?.map(s => s.name).filter(Boolean).join(' · ') || item.vehicleType || '';
    const svcCount = item.services?.length ?? 0;
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/carwash/jobs/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={[styles.plateBox, { backgroundColor: CWL }]}>
          <Text style={[styles.plate, { color: CW }]}>{item.plate}</Text>
          {item.jobNumber ? <Text style={styles.jobNum}>#{item.jobNumber}</Text> : null}
        </View>
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={styles.customerName} numberOfLines={1}>
              {item.customer?.name || 'Walk-in'}
            </Text>
            <Text style={styles.amount}>{fmt(item.totalAmount)}</Text>
          </View>
          {svcText ? (
            <Text style={styles.services} numberOfLines={1}>
              {svcCount > 0 ? `${svcCount} service${svcCount > 1 ? 's' : ''} · ` : ''}{svcText}
            </Text>
          ) : null}
          <View style={styles.cardBottom}>
            <Text style={styles.time}>{fmtTime(item.createdAt)}</Text>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeText, { color: sc.color }]}>
                {item.status.toUpperCase()}
              </Text>
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
          placeholder="Plate, customer, job #..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {loading && !refreshing
          ? <ActivityIndicator size="small" color={CW} />
          : search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={18} color="#94A3B8" /></TouchableOpacity>
          : null}
      </View>

      {/* Status filter tabs */}
      <FlatList
        horizontal
        data={TABS as any}
        keyExtractor={t => t.key}
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.tabsRow}
        renderItem={({ item: t }) => (
          <TouchableOpacity
            style={[styles.tab, statusFilter === t.key && styles.tabActive]}
            onPress={() => setStatusFilter(t.key)}
          >
            <Text style={[styles.tabText, statusFilter === t.key && styles.tabTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {loading ? (
        <MilikLoader fullscreen />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={j => j._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={CW} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="car-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyText}>No jobs found</Text>
            </View>
          }
          ListFooterComponent={loadingMore ? (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={CW} />
            </View>
          ) : null}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/carwash/jobs/new' as any)}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8FAFC' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, marginBottom: 10,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0',
    paddingHorizontal: 14, height: 50,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },

  tabsRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  tabActive:     { backgroundColor: CW, borderColor: CW },
  tabText:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTextActive: { color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 100 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyText: { fontSize: 15, color: '#94A3B8' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0',
    borderLeftWidth: 3,
    padding: 12,
  },
  plateBox: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, alignItems: 'center' },
  plate:    { fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  jobNum:   { fontSize: 9, color: '#64748B', marginTop: 2 },

  cardBody:     { flex: 1 },
  cardTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  customerName: { fontSize: 14, fontWeight: '700', color: '#0F172A', flex: 1, marginRight: 8 },
  amount:       { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  services:     { fontSize: 11, color: '#64748B', marginBottom: 4 },
  cardBottom:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time:         { fontSize: 11, color: '#94A3B8' },

  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
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
