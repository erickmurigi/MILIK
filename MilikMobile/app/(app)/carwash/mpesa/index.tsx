import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, Alert, FlatList as FL, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const CW  = '#1E3A8A';
const ACC = '#C8511A';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDT = (d: string) =>
  new Date(d).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

type Notification = {
  _id:               string;
  transactionCode:   string;
  transactionDate:   string;
  amount:            number;
  payerName:         string;
  msisdn:            string;
  billRefNumber?:    string;
  isAllocated:       boolean;
  isReversed?:       boolean;
  allocatedJob?:     { jobNumber?: string; plate?: string };
};

type UnpaidJob = { _id: string; jobNumber?: string; plate: string; totalAmount: number; customer?: { name?: string } };

const TABS = [
  { key: 'unallocated', label: 'Unallocated' },
  { key: 'allocated',   label: 'Allocated'   },
  { key: 'all',         label: 'All'         },
] as const;
type Tab = typeof TABS[number]['key'];

export default function CarWashMpesaScreen() {
  const [tab,          setTab]          = useState<Tab>('unallocated');
  const [items,        setItems]        = useState<Notification[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [page,         setPage]         = useState(1);
  const [hasMore,      setHasMore]      = useState(true);

  // Allocate modal
  const [target,       setTarget]       = useState<Notification | null>(null);
  const [unpaidJobs,   setUnpaidJobs]   = useState<UnpaidJob[]>([]);
  const [jobsLoading,  setJobsLoading]  = useState(false);
  const [allocating,   setAllocating]   = useState(false);

  const LIMIT = 30;

  const load = useCallback(async (pg = 1, isRefresh = false) => {
    if (pg === 1) isRefresh ? setRefreshing(true) : setLoading(true);
    else setLoadingMore(true);
    try {
      const params: Record<string, string | number> = { page: pg, limit: LIMIT };
      if (tab === 'unallocated') params.allocated = 'false';
      if (tab === 'allocated')   params.allocated = 'true';
      const { data } = await api.get('/carwash/mpesa/notifications', { params });
      const raw  = data?.data ?? data;
      const rows: Notification[] = Array.isArray(raw) ? raw : (raw?.notifications ?? []);
      setItems(prev => pg === 1 ? rows : [...prev, ...rows]);
      setHasMore(rows.length === LIMIT);
      setPage(pg);
    } catch { if (pg === 1) setItems([]); }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, [tab]);

  useEffect(() => { load(1); }, [load]);

  const openAllocate = async (notif: Notification) => {
    setTarget(notif);
    setJobsLoading(true);
    try {
      const { data } = await api.get('/carwash/mpesa/unpaid-jobs');
      const raw = data?.data ?? data;
      setUnpaidJobs(Array.isArray(raw) ? raw : (raw?.jobs ?? []));
    } catch { setUnpaidJobs([]); }
    finally { setJobsLoading(false); }
  };

  const allocate = async (jobId: string) => {
    if (!target) return;
    setAllocating(true);
    try {
      await api.post(`/carwash/mpesa/notifications/${target._id}/allocate`, { jobId });
      setTarget(null);
      load(1, true);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Allocation failed.');
    } finally { setAllocating(false); }
  };

  const renderItem = ({ item }: { item: Notification }) => {
    const allocated = item.isAllocated || !!item.allocatedJob;
    return (
      <View style={[styles.card, { borderLeftColor: allocated ? '#059669' : '#D97706' }]}>
        {/* Amount + status */}
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.amount}>{fmt(item.amount)}</Text>
            <Text style={styles.payerName} numberOfLines={1}>{item.payerName}</Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: allocated ? '#D1FAE5' : '#FEF3C7' }]}>
            <Ionicons name={allocated ? 'checkmark-circle' : 'time-outline'} size={16} color={allocated ? '#059669' : '#D97706'} />
          </View>
        </View>

        {/* Tx code + date */}
        <View style={styles.cardRow}>
          <Text style={styles.txCode}>{item.transactionCode}</Text>
          <Text style={styles.txDate}>{fmtDT(item.transactionDate)}</Text>
        </View>

        {/* Phone */}
        <Text style={styles.meta}>{item.msisdn}</Text>

        {/* Action */}
        {item.allocatedJob ? (
          <View style={styles.allocatedBadge}>
            <Ionicons name="car-outline" size={11} color="#059669" />
            <Text style={styles.allocatedText}>
              {item.allocatedJob.plate}{item.allocatedJob.jobNumber ? `  ·  #${item.allocatedJob.jobNumber}` : ''}
            </Text>
          </View>
        ) : !item.isReversed ? (
          <TouchableOpacity style={styles.allocateBtn} onPress={() => openAllocate(item)}>
            <Ionicons name="link-outline" size={13} color={ACC} />
            <Text style={styles.allocateBtnText}>Allocate to Job</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.allocatedBadge, { backgroundColor: '#F1F5F9' }]}>
            <Ionicons name="close-circle-outline" size={11} color="#64748B" />
            <Text style={[styles.allocatedText, { color: '#64748B' }]}>Reversed</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'M-Pesa Notifications' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        {/* Tabs */}
        <View style={styles.tabsRow}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabActive]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <MilikLoader fullscreen />
        ) : (
          <FlatList
            data={items}
            keyExtractor={n => n._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} tintColor={CW} />}
            onEndReached={() => { if (!loadingMore && hasMore) load(page + 1); }}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="phone-portrait-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyText}>No {tab} notifications</Text>
              </View>
            }
            ListFooterComponent={loadingMore ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={CW} />
              </View>
            ) : null}
          />
        )}

        {/* Allocate modal */}
        <Modal visible={!!target} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTarget(null)}>
          <SafeAreaView style={styles.modal} edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Allocate to Job</Text>
                {target && <Text style={styles.modalSub}>{target.transactionCode} · {fmt(target.amount)}</Text>}
              </View>
              <TouchableOpacity onPress={() => setTarget(null)}>
                <Ionicons name="close" size={24} color="#475569" />
              </TouchableOpacity>
            </View>

            {jobsLoading ? (
              <View style={styles.centered}><MilikLoader size="small" /></View>
            ) : allocating ? (
              <View style={styles.centered}>
                <MilikLoader size="small" />
                <Text style={{ color: '#94A3B8', marginTop: 12 }}>Allocating...</Text>
              </View>
            ) : (
              <FL
                data={unpaidJobs}
                keyExtractor={j => j._id}
                contentContainerStyle={{ padding: 16, gap: 8 }}
                ListEmptyComponent={
                  <View style={styles.centered}>
                    <Text style={styles.emptyText}>No unpaid jobs found</Text>
                  </View>
                }
                renderItem={({ item: job }) => (
                  <TouchableOpacity style={styles.jobRow} onPress={() => allocate(job._id)}>
                    <View style={[styles.platePill, { backgroundColor: '#EEF2FF' }]}>
                      <Text style={{ fontSize: 14, fontWeight: '900', color: CW }}>{job.plate}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.jobRowName}>{job.customer?.name || 'Walk-in'}</Text>
                      {job.jobNumber ? <Text style={styles.jobRowSub}>Job #{job.jobNumber}</Text> : null}
                    </View>
                    <Text style={styles.jobRowAmt}>{fmt(job.totalAmount)}</Text>
                    <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
                  </TouchableOpacity>
                )}
              />
            )}
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: '#F8FAFC' },
  modal: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },

  tabsRow: { flexDirection: 'row', flexGrow: 0, paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    borderRadius: 10, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  tabActive:     { backgroundColor: CW, borderColor: CW },
  tabText:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTextActive: { color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 40 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyText: { fontSize: 15, color: '#94A3B8' },

  card: {
    backgroundColor: '#fff', borderRadius: 14, gap: 6,
    borderWidth: 1, borderColor: '#E2E8F0',
    borderLeftWidth: 3, padding: 14,
  },
  cardHeader:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  statusDot:   { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  txCode:      { fontSize: 12, fontWeight: '800', color: '#475569', letterSpacing: 0.8, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  txDate:      { fontSize: 11, color: '#94A3B8' },
  amount:      { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  payerName:   { fontSize: 13, fontWeight: '600', color: '#475569', marginTop: 1 },
  meta:        { fontSize: 11, color: '#94A3B8' },

  allocatedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', marginTop: 4,
    backgroundColor: '#D1FAE5', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  allocatedText: { fontSize: 11, fontWeight: '700', color: '#065F46' },

  allocateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 6, alignSelf: 'flex-start',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, borderColor: '#FED7AA',
  },
  allocateBtnText: { fontSize: 12, fontWeight: '700', color: ACC },
  reversedText:    { fontSize: 11, color: '#94A3B8', marginTop: 4 },

  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  modalSub:   { fontSize: 13, color: '#94A3B8', marginTop: 2 },

  jobRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 14,
  },
  platePill:  { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  jobRowName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  jobRowSub:  { fontSize: 11, color: '#94A3B8' },
  jobRowAmt:  { fontSize: 14, fontWeight: '800', color: '#0F172A' },
});
