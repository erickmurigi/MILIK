import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const SC = '#7C2D12';

type Lead = {
  _id:               string;
  leadNumber?:       string;
  fullName:          string;
  phone?:            string;
  email?:            string;
  source?:           string;
  status:            string;
  budgetMin?:        number;
  budgetMax?:        number;
  nextFollowUpDate?: string;
  assignedAgent?:    { name?: string };
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  new:           { bg: '#DBEAFE', color: '#1D4ED8', label: 'New'           },
  contacted:     { bg: '#E0F2FE', color: '#0369A1', label: 'Contacted'     },
  qualified:     { bg: '#EDE9FE', color: '#7C3AED', label: 'Qualified'     },
  site_visited:  { bg: '#E0E7FF', color: '#4338CA', label: 'Site Visited'  },
  proposal_sent: { bg: '#FEF3C7', color: '#D97706', label: 'Proposal Sent' },
  negotiating:   { bg: '#FFEDD5', color: '#EA580C', label: 'Negotiating'   },
  converted:     { bg: '#D1FAE5', color: '#065F46', label: 'Converted'     },
  lost:          { bg: '#FEE2E2', color: '#DC2626', label: 'Lost'          },
};

const TABS = [
  { key: '',             label: 'All'       },
  { key: 'new',          label: 'New'       },
  { key: 'contacted',    label: 'Contacted' },
  { key: 'qualified',    label: 'Qualified' },
  { key: 'converted',    label: 'Converted' },
  { key: 'lost',         label: 'Lost'      },
] as const;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' });

const fmtBudget = (min?: number, max?: number) => {
  if (!min && !max) return null;
  const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : String(n);
  if (min && max) return `KES ${fmt(min)} – ${fmt(max)}`;
  if (max) return `Up to KES ${fmt(max)}`;
  return `KES ${fmt(min!)}+`;
};

const LIMIT = 30;

export default function LeadsScreen() {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState('');
  const [search,       setSearch]       = useState('');
  const [items,        setItems]        = useState<Lead[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [page,         setPage]         = useState(1);
  const [hasMore,      setHasMore]      = useState(true);

  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (pg = 1, isRefresh = false) => {
    if (pg === 1) isRefresh ? setRefreshing(true) : setLoading(true);
    else setLoadingMore(true);
    try {
      const p: Record<string, string> = { page: String(pg), limit: String(LIMIT) };
      if (statusFilter) p.status = statusFilter;
      if (searchRef.current.trim()) p.search = searchRef.current.trim();
      const { data } = await api.get('/sale/leads', { params: p });
      const rows: Lead[] = data?.data ?? (Array.isArray(data) ? data : []);
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

  const renderItem = ({ item }: { item: Lead }) => {
    const sc = STATUS_CFG[item.status] ?? STATUS_CFG.new;
    const budget = fmtBudget(item.budgetMin, item.budgetMax);
    const isOverdue = item.nextFollowUpDate && new Date(item.nextFollowUpDate) < new Date()
      && !['converted', 'lost'].includes(item.status);

    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/sales/leads/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            {item.leadNumber && <Text style={styles.leadNum}>{item.leadNumber}</Text>}
            <Text style={styles.name}>{item.fullName}</Text>
            {item.phone && (
              <Text style={styles.contact}>
                <Ionicons name="call-outline" size={11} color="#94A3B8" /> {item.phone}
              </Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
            {budget && <Text style={styles.budget}>{budget}</Text>}
          </View>
        </View>
        <View style={styles.cardBottom}>
          <View style={styles.pill}>
            <Text style={styles.pillTxt}>{(item.source ?? 'unknown').replace(/_/g, ' ')}</Text>
          </View>
          {item.nextFollowUpDate && (
            <View style={[styles.followUp, isOverdue && styles.followUpOverdue]}>
              <Ionicons name="calendar-outline" size={11} color={isOverdue ? '#DC2626' : '#94A3B8'} />
              <Text style={[styles.followUpTxt, isOverdue && { color: '#DC2626' }]}>
                {fmtDate(item.nextFollowUpDate)}
              </Text>
            </View>
          )}
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
          placeholder="Name, phone, email..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        ) : null}
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
          keyExtractor={l => l._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={SC} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="people-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>No leads found</Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={SC} style={{ padding: 20 }} /> : null}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/sales/leads/new' as any)}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF7ED' },

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

  list:      { paddingHorizontal: 16, paddingBottom: 100 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3,
    padding: 14, gap: 10,
  },
  cardTop:    { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  leadNum:    { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 2 },
  name:       { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  contact:    { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt:   { fontSize: 10, fontWeight: '800' },
  budget:     { fontSize: 11, fontWeight: '700', color: '#475569' },

  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill:       { backgroundColor: '#F1F5F9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt:    { fontSize: 10, fontWeight: '600', color: '#64748B', textTransform: 'capitalize' },
  followUp:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  followUpOverdue: {},
  followUpTxt:{ fontSize: 11, color: '#94A3B8' },

  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28, backgroundColor: SC,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },
});
