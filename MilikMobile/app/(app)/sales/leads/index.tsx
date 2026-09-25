import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useDebounced, usePmsList, useReloadOnFocus } from '../../../../hooks/usePmsList';
import { useSaleSettings } from '../../../../hooks/useSaleSettings';
import { fmtDate, fmtMoney } from '../../../../utils/pmsFormat';
import { SBG, SC, followUpOverdue, humanize, leadStatusStyle, pageOf, refName } from '../../../../utils/sales';

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
  assignedAgent?:    { fullName?: string };
};

const budgetText = (min?: number, max?: number) => {
  if (!min && !max) return null;
  if (min && max) return `KES ${fmtMoney(min)} – ${fmtMoney(max)}`;
  return max ? `Up to KES ${fmtMoney(max)}` : `From KES ${fmtMoney(min)}`;
};

const parse = (data: any) => pageOf<Lead>(data);

export default function LeadsScreen() {
  const router = useRouter();
  const { stages, sources, terms: T } = useSaleSettings();
  const params = useLocalSearchParams<{ overdue?: string }>();

  const [statusFilter, setStatusFilter] = useState('');
  const [overdueOnly,  setOverdueOnly]  = useState(params.overdue === '1');
  const [search,       setSearch]       = useState('');
  const debouncedSearch = useDebounced(search.trim(), 400);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const listParams = useMemo(() => ({
    status:      statusFilter || undefined,
    overdueOnly: overdueOnly ? '1' : undefined,
    search:      debouncedSearch || undefined,
  }), [statusFilter, overdueOnly, debouncedSearch]);

  const list = usePmsList<Lead>({ path: '/sale/leads', params: listParams, limit: 30, parse });

  // Lead counts per pipeline stage (tab badges). Purely informational: a failure just hides the numbers.
  const loadCounts = useCallback(async () => {
    try {
      const { data } = await api.get('/sale/leads/pipeline');
      const next: Record<string, number> = {};
      (Array.isArray(data?.pipeline) ? data.pipeline : []).forEach((p: { _id: string; count: number }) => { next[p._id] = p.count; });
      setCounts(next);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useReloadOnFocus(useCallback(() => { list.reload(); loadCounts(); }, [list.reload, loadCounts]));

  const sourceLabel = useMemo(() => {
    const map = new Map(sources.map(s => [s.value, s.label]));
    return (v?: string) => (v ? map.get(v) ?? humanize(v) : '');
  }, [sources]);
  const statusLabel = useMemo(() => {
    const map = new Map(stages.map(s => [s.value, s.label]));
    return (v: string) => map.get(v) ?? humanize(v);
  }, [stages]);

  const tabs = useMemo(() => [{ value: '', label: 'All' }, ...stages], [stages]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const renderItem = ({ item }: { item: Lead }) => {
    const sc      = leadStatusStyle(item.status);
    const budget  = budgetText(item.budgetMin, item.budgetMax);
    const overdue = followUpOverdue(item.nextFollowUpDate, item.status);
    const agent   = refName(item.assignedAgent, 'fullName');

    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: sc.color }]}
        onPress={() => router.push(`/sales/leads/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            {item.leadNumber ? <Text style={styles.leadNum}>{item.leadNumber}</Text> : null}
            <Text style={styles.name} numberOfLines={1}>{item.fullName}</Text>
            {item.phone ? (
              <View style={styles.contactRow}>
                <Ionicons name="call-outline" size={11} color="#94A3B8" />
                <Text style={styles.contact}>{item.phone}</Text>
              </View>
            ) : null}
          </View>
          <View style={[styles.badge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.badgeTxt, { color: sc.color }]}>{statusLabel(item.status)}</Text>
          </View>
        </View>
        {budget ? <Text style={styles.budget}>{budget}</Text> : null}
        <View style={styles.cardBottom}>
          {item.source ? (
            <View style={styles.pill}><Text style={styles.pillTxt}>{sourceLabel(item.source)}</Text></View>
          ) : null}
          {agent ? <Text style={styles.agent} numberOfLines={1}>{agent}</Text> : null}
          <View style={{ flex: 1 }} />
          {item.nextFollowUpDate ? (
            <View style={styles.followUp}>
              <Ionicons name="calendar-outline" size={11} color={overdue ? '#DC2626' : '#94A3B8'} />
              <Text style={[styles.followUpTxt, overdue && { color: '#DC2626', fontWeight: '800' }]}>
                {fmtDate(item.nextFollowUpDate)}{overdue ? ' · overdue' : ''}
              </Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const filtered = !!(statusFilter || overdueOnly || debouncedSearch);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Name, phone, email, number..."
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
          <TouchableOpacity
            style={[styles.tab, styles.tabDue, overdueOnly && styles.tabDueActive]}
            onPress={() => setOverdueOnly(v => !v)}
          >
            <Ionicons name="alarm-outline" size={13} color={overdueOnly ? '#fff' : '#DC2626'} />
            <Text style={[styles.tabTxt, { color: overdueOnly ? '#fff' : '#DC2626' }]}>Follow-up due</Text>
          </TouchableOpacity>
          {tabs.map(t => {
            const active = statusFilter === t.value;
            const count = t.value ? counts[t.value] : total;
            return (
              <TouchableOpacity key={t.value || 'all'} style={[styles.tab, active && styles.tabActive]} onPress={() => setStatusFilter(t.value)}>
                <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>
                  {t.label}{Object.keys(counts).length ? ` · ${count ?? 0}` : ''}
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
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => { list.refresh(); loadCounts(); }} tintColor={SC} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="people-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTxt}>
                  {filtered ? `No ${T.saleLeads.toLowerCase()} match your filters` : `No ${T.saleLeads.toLowerCase()} yet. Tap + to add one.`}
                </Text>
              </View>
            }
            ListFooterComponent={list.loadingMore ? <ActivityIndicator color={SC} style={{ padding: 20 }} /> : null}
          />
        </>
      )}

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/sales/leads/new' as any)} activeOpacity={0.85}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>
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

  tabsRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 8, alignItems: 'center' },
  tab:         { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: SC, borderColor: SC },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },
  tabDue:      { borderColor: '#FECACA' },
  tabDueActive:{ backgroundColor: '#DC2626', borderColor: '#DC2626' },

  list:      { paddingHorizontal: 16, paddingBottom: 100 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60, paddingHorizontal: 24 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8', textAlign: 'center' },

  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3,
    padding: 14, gap: 8,
  },
  cardTop:    { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  leadNum:    { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 2 },
  name:       { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  contact:    { fontSize: 12, color: '#94A3B8' },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, maxWidth: 130 },
  badgeTxt:   { fontSize: 10, fontWeight: '800' },
  budget:     { fontSize: 11, fontWeight: '700', color: '#475569' },

  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill:       { backgroundColor: '#F1F5F9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt:    { fontSize: 10, fontWeight: '600', color: '#64748B' },
  agent:      { fontSize: 11, color: '#94A3B8', flexShrink: 1 },
  followUp:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  followUpTxt:{ fontSize: 11, color: '#94A3B8' },

  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28, backgroundColor: SC,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },
});
