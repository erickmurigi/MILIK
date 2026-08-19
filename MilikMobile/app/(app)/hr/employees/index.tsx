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

const HC = '#4C1D95';

type Employee = {
  _id:          string;
  employeeId?:  string;
  surname:      string;
  otherNames:   string;
  phone?:       string;
  email?:       string;
  department?:  string | { name?: string };
  designation?: string | { name?: string };
  employmentType?: string;
  status:       string;
  joinDate?:    string;
};

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Active:     { bg: '#D1FAE5', color: '#065F46' },
  Probation:  { bg: '#FEF3C7', color: '#D97706' },
  Suspended:  { bg: '#FFEDD5', color: '#EA580C' },
  Terminated: { bg: '#FEE2E2', color: '#DC2626' },
};

const TYPE_COLOR: Record<string, string> = {
  Permanent: '#065F46',
  Contract:  '#1D4ED8',
  Casual:    '#D97706',
  Intern:    '#7C3AED',
};

const TABS = [
  { key: '',           label: 'All'        },
  { key: 'Active',     label: 'Active'     },
  { key: 'Probation',  label: 'Probation'  },
  { key: 'Terminated', label: 'Terminated' },
] as const;

const initials = (s = '', o = '') => `${s.charAt(0)}${o.charAt(0)}`.toUpperCase() || '?';

const getName = (e: Employee) => `${e.surname} ${e.otherNames}`.trim();
const getDept = (d: Employee['department']) =>
  typeof d === 'object' ? (d?.name ?? '') : (d ?? '');
const getDesig = (d: Employee['designation']) =>
  typeof d === 'object' ? (d?.name ?? '') : (d ?? '');

const LIMIT = 30;

export default function EmployeesScreen() {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState('Active');
  const [search,       setSearch]       = useState('');
  const [items,        setItems]        = useState<Employee[]>([]);
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
      const { data } = await api.get('/hr/employees', { params: p });
      const rows: Employee[] = data?.data ?? data?.employees ?? (Array.isArray(data) ? data : []);
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

  const renderItem = ({ item }: { item: Employee }) => {
    const sc    = STATUS_CFG[item.status] ?? STATUS_CFG.Active;
    const dept  = getDept(item.department);
    const desig = getDesig(item.designation);
    const tc    = item.employmentType ? TYPE_COLOR[item.employmentType] : '#64748B';

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/hr/employees/${item._id}` as any)}
        activeOpacity={0.75}
      >
        <View style={[styles.avatar, { backgroundColor: HC + '20' }]}>
          <Text style={[styles.avatarTxt, { color: HC }]}>
            {initials(item.surname, item.otherNames)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{getName(item)}</Text>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{item.status}</Text>
            </View>
          </View>
          {desig ? <Text style={styles.desig} numberOfLines={1}>{desig}</Text> : null}
          <View style={styles.metaRow}>
            {dept ? (
              <View style={styles.pill}>
                <Text style={styles.pillTxt}>{dept}</Text>
              </View>
            ) : null}
            {item.employmentType ? (
              <View style={[styles.pill, { backgroundColor: tc + '15' }]}>
                <Text style={[styles.pillTxt, { color: tc }]}>{item.employmentType}</Text>
              </View>
            ) : null}
            {item.employeeId ? (
              <Text style={styles.empId}>{item.employeeId}</Text>
            ) : null}
          </View>
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
          placeholder="Name, ID, department..."
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
          keyExtractor={e => e._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#F1F5F9', marginLeft: 72 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={HC} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="people-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>No employees found</Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={HC} style={{ padding: 20 }} /> : null}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F3FF' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, marginBottom: 10,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 50,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },

  tabsRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  tab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: HC, borderColor: HC },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },

  list:      { paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarTxt: { fontSize: 15, fontWeight: '900' },

  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name:    { flex: 1, fontSize: 14, fontWeight: '800', color: '#0F172A' },
  badge:   { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  badgeTxt:{ fontSize: 10, fontWeight: '700' },
  desig:   { fontSize: 12, color: '#64748B', marginTop: 1 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' },
  pill:    { backgroundColor: '#F1F5F9', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  pillTxt: { fontSize: 10, fontWeight: '600', color: '#64748B' },
  empId:   { fontSize: 10, color: '#94A3B8', fontWeight: '500' },
});
