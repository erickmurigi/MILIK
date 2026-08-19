import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const HC = '#4C1D95';

type LeaveApp = {
  _id:          string;
  employee?:    { surname?: string; otherNames?: string; employeeId?: string } | string;
  leaveType?:   { name?: string } | string;
  startDate:    string;
  endDate:      string;
  days:         number;
  reason?:      string;
  status:       string;
  appliedDate?: string;
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  Pending:  { bg: '#FEF3C7', color: '#D97706', label: 'Pending'  },
  Approved: { bg: '#D1FAE5', color: '#065F46', label: 'Approved' },
  Rejected: { bg: '#FEE2E2', color: '#DC2626', label: 'Rejected' },
  Cancelled:{ bg: '#F1F5F9', color: '#64748B', label: 'Cancelled'},
};

const TABS = [
  { key: 'Pending',  label: 'Pending'  },
  { key: 'Approved', label: 'Approved' },
  { key: 'Rejected', label: 'Rejected' },
  { key: '',         label: 'All'      },
] as const;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

const getEmpName = (e: LeaveApp['employee']) =>
  typeof e === 'object'
    ? `${e?.surname ?? ''} ${e?.otherNames ?? ''}`.trim()
    : (e ?? '—');

const getLeaveType = (t: LeaveApp['leaveType']) =>
  typeof t === 'object' ? (t?.name ?? '—') : (t ?? '—');

const LIMIT = 30;

export default function LeaveScreen() {
  const [statusFilter, setStatusFilter] = useState('Pending');
  const [items,        setItems]        = useState<LeaveApp[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [page,         setPage]         = useState(1);
  const [hasMore,      setHasMore]      = useState(true);
  const [acting,       setActing]       = useState<string | null>(null);

  const load = useCallback(async (pg = 1, isRefresh = false) => {
    if (pg === 1) isRefresh ? setRefreshing(true) : setLoading(true);
    else setLoadingMore(true);
    try {
      const p: Record<string, string> = { page: String(pg), limit: String(LIMIT) };
      if (statusFilter) p.status = statusFilter;
      const { data } = await api.get('/hr/leave-applications', { params: p });
      const rows: LeaveApp[] = data?.data ?? data?.leaveApplications ?? (Array.isArray(data) ? data : []);
      setItems(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch { if (pg === 1) setItems([]); }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, [statusFilter]);

  useEffect(() => { load(1); }, [load]);

  const updateStatus = (id: string, status: 'Approved' | 'Rejected', label: string) => {
    Alert.alert(label, `${label} this leave application?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: label,
        style: status === 'Rejected' ? 'destructive' : 'default',
        onPress: async () => {
          setActing(id);
          try {
            await api.put(`/hr/leave-applications/${id}`, { status });
            setItems(prev => prev.filter(i => i._id !== id));
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.message ?? `Failed to ${label.toLowerCase()}.`);
          } finally { setActing(null); }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: LeaveApp }) => {
    const sc   = STATUS_CFG[item.status] ?? STATUS_CFG.Pending;
    const name = getEmpName(item.employee);
    const type = getLeaveType(item.leaveType);
    const isActing = acting === item._id;

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.empName} numberOfLines={1}>{name}</Text>
            <Text style={styles.leaveType}>{type}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
            <View style={styles.daysBadge}>
              <Text style={styles.daysTxt}>{item.days} day{item.days !== 1 ? 's' : ''}</Text>
            </View>
          </View>
        </View>

        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={12} color="#94A3B8" />
          <Text style={styles.dateTxt}>{fmtDate(item.startDate)} → {fmtDate(item.endDate)}</Text>
        </View>

        {item.reason && <Text style={styles.reason} numberOfLines={2}>{item.reason}</Text>}

        {item.status === 'Pending' && (
          <View style={styles.actions}>
            {isActing ? (
              <ActivityIndicator color={HC} />
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#FEE2E2', flex: 1 }]}
                  onPress={() => updateStatus(item._id, 'Rejected', 'Reject')}
                >
                  <Ionicons name="close-outline" size={15} color="#DC2626" />
                  <Text style={[styles.actionTxt, { color: '#DC2626' }]}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#D1FAE5', flex: 1 }]}
                  onPress={() => updateStatus(item._id, 'Approved', 'Approve')}
                >
                  <Ionicons name="checkmark-outline" size={15} color="#065F46" />
                  <Text style={[styles.actionTxt, { color: '#065F46' }]}>Approve</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        horizontal data={TABS as any} keyExtractor={t => t.key}
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, marginTop: 12 }}
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
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={HC} />}
          onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="calendar-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyTxt}>
                {statusFilter === 'Pending' ? 'No pending leave requests' : 'No leave applications'}
              </Text>
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

  tabsRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  tab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: HC, borderColor: HC },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8', textAlign: 'center' },

  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0',
    padding: 14, gap: 8,
  },
  cardTop:   { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  empName:   { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  leaveType: { fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: '500' },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt:  { fontSize: 10, fontWeight: '800' },
  daysBadge: { backgroundColor: HC + '15', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  daysTxt:   { fontSize: 11, fontWeight: '700', color: HC },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateTxt: { fontSize: 12, color: '#64748B' },
  reason:  { fontSize: 12, color: '#475569', lineHeight: 18 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, borderRadius: 10, paddingVertical: 9,
  },
  actionTxt: { fontSize: 13, fontWeight: '700' },
});
