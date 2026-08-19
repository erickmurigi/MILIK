import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../services/api';
import MilikLoader from '../../../components/ui/MilikLoader';

const CW  = '#1E3A8A';
const CWL = '#EEF2FF';
const ACC = '#C8511A';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const stepDate = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtDateLabel = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-KE', { weekday: 'short', day: '2-digit', month: 'short' });

const fmtTime = (d: string) =>
  new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

type Summary = {
  totalRevenue: number;
  cashTotal:    number;
  mpesaTotal:   number;
  statusCounts: Record<string, number>;
  revenueByMethod?: Record<string, number>;
};

type Job = {
  _id:          string;
  jobNumber?:   string;
  plateNumber:  string;
  vehicleType?: string;
  serviceName?: string;
  status:       string;
  price:        number;
  discountAmount?: number;
  paymentStatus?: string;
  createdAt:    string;
  customerName?: string;
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  waiting:   { bg: '#FEF3C7', color: '#D97706' },
  washing:   { bg: '#DBEAFE', color: '#1D4ED8' },
  done:      { bg: '#EDE9FE', color: '#7C3AED' },
  paid:      { bg: '#D1FAE5', color: '#065F46' },
  cancelled: { bg: '#F1F5F9', color: '#64748B' },
};

const QUEUE_ITEMS = [
  { key: 'waiting', label: 'Waiting', icon: 'time-outline',             borderColor: '#D97706' },
  { key: 'washing', label: 'Washing', icon: 'water-outline',            borderColor: '#1D4ED8' },
  { key: 'done',    label: 'Done',    icon: 'checkmark-circle-outline', borderColor: '#7C3AED' },
  { key: 'paid',    label: 'Paid',    icon: 'cash-outline',             borderColor: '#065F46' },
] as const;

export default function CarWashDashboard() {
  const router = useRouter();
  const [date,             setDate]             = useState(todayISO());
  const [summary,          setSummary]          = useState<Summary | null>(null);
  const [jobs,             setJobs]             = useState<Job[]>([]);
  const [mpesaUnallocated, setMpesaUnallocated] = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [refreshing,       setRefreshing]       = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    const [sumRes, jobsRes, mpesaRes] = await Promise.allSettled([
      api.get('/carwash/reports/daily-summary', { params: { date } }),
      api.get('/carwash/jobs', { params: { date, limit: 20 } }),
      api.get('/carwash/mpesa/notifications', { params: { allocated: 'false', limit: 1 } }),
    ]);
    if (sumRes.status === 'fulfilled') setSummary(sumRes.value.data?.data ?? sumRes.value.data ?? null);
    if (jobsRes.status === 'fulfilled') {
      const raw = jobsRes.value.data?.data ?? jobsRes.value.data;
      setJobs(Array.isArray(raw) ? raw : (raw?.jobs ?? []));
    }
    if (mpesaRes.status === 'fulfilled') {
      const d = mpesaRes.value.data;
      setMpesaUnallocated(d?.total ?? d?.data?.total ?? 0);
    }
    setLoading(false); setRefreshing(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const counts      = summary?.statusCounts ?? {};
  const revenue     = Number(summary?.totalRevenue ?? 0);
  const cashTotal   = Number(summary?.cashTotal    ?? 0);
  const mpesaTotal  = Number(summary?.mpesaTotal   ?? 0);
  const isToday     = date === todayISO();

  if (loading) return <MilikLoader fullscreen />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={CW} />}
      >
        {/* Date stepper */}
        <View style={styles.dateStepper}>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setDate(d => stepDate(d, -1))}>
            <Ionicons name="chevron-back" size={18} color={CW} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.dateLabel} onPress={() => setDate(todayISO())}>
            <Text style={styles.dateLabelText}>{fmtDateLabel(date)}</Text>
            {!isToday && <Text style={styles.dateLabelSub}>tap to go to today</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setDate(d => stepDate(d, 1))}>
            <Ionicons name="chevron-forward" size={18} color={CW} />
          </TouchableOpacity>
        </View>

        {/* Revenue hero */}
        <View style={styles.revenueCard}>
          <Text style={styles.revenueLabel}>{isToday ? "TODAY'S REVENUE" : fmtDateLabel(date).toUpperCase() + ' REVENUE'}</Text>
          <Text style={styles.revenueAmount}>{fmt(revenue)}</Text>
          <View style={styles.revenueBreakdown}>
            <View style={styles.revItem}>
              <View style={[styles.revDot, { backgroundColor: '#4ADE80' }]} />
              <Text style={styles.revItemLabel}>Cash</Text>
              <Text style={styles.revItemVal}>{fmt(cashTotal)}</Text>
            </View>
            <View style={[styles.revItem, styles.revItemBorder]}>
              <View style={[styles.revDot, { backgroundColor: '#FCD34D' }]} />
              <Text style={styles.revItemLabel}>M-Pesa</Text>
              <Text style={styles.revItemVal}>{fmt(mpesaTotal)}</Text>
            </View>
            <View style={styles.revItem}>
              <View style={[styles.revDot, { backgroundColor: '#93C5FD' }]} />
              <Text style={styles.revItemLabel}>Other</Text>
              <Text style={styles.revItemVal}>{fmt(Math.max(0, revenue - cashTotal - mpesaTotal))}</Text>
            </View>
          </View>
        </View>

        {/* Queue status row */}
        <View style={styles.queueRow}>
          {QUEUE_ITEMS.map(q => {
            const sc    = STATUS_STYLE[q.key];
            const count = counts[q.key] ?? 0;
            return (
              <TouchableOpacity
                key={q.key}
                style={[styles.queueCard, { borderLeftColor: q.borderColor }]}
                onPress={() => router.push(`/carwash/jobs?status=${q.key}` as any)}
                activeOpacity={0.75}
              >
                <Ionicons name={q.icon} size={18} color={sc.color} />
                <Text style={[styles.queueCount, { color: count > 0 ? sc.color : '#CBD5E1' }]}>
                  {count}
                </Text>
                <Text style={styles.queueLabel}>{q.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* M-Pesa alert */}
        {mpesaUnallocated > 0 && (
          <TouchableOpacity
            style={styles.mpesaAlert}
            onPress={() => router.push('/carwash/mpesa' as any)}
            activeOpacity={0.75}
          >
            <Ionicons name="phone-portrait-outline" size={16} color={ACC} />
            <Text style={styles.mpesaAlertText}>
              {mpesaUnallocated} unallocated M-Pesa payment{mpesaUnallocated > 1 ? 's' : ''} — tap to allocate
            </Text>
            <Ionicons name="chevron-forward" size={14} color={ACC} />
          </TouchableOpacity>
        )}

        {/* Quick actions */}
        <View style={styles.actionsRow}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: CW }]} onPress={() => router.push('/carwash/jobs/new' as any)}>
            <Ionicons name="add-circle-outline" size={18} color="#fff" />
            <Text style={styles.actionBtnText}>New Job</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: ACC }]} onPress={() => router.push('/carwash/mpesa' as any)}>
            <Ionicons name="phone-portrait-outline" size={18} color="#fff" />
            <Text style={styles.actionBtnText}>M-Pesa</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#065F46' }]} onPress={() => router.push('/carwash/jobs' as any)}>
            <Ionicons name="list-outline" size={18} color="#fff" />
            <Text style={styles.actionBtnText}>All Jobs</Text>
          </TouchableOpacity>
        </View>

        {/* Recent jobs */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{isToday ? "TODAY'S JOBS" : `${fmtDateLabel(date).toUpperCase()} JOBS`}</Text>
            <TouchableOpacity onPress={() => router.push('/carwash/jobs' as any)}>
              <Text style={[styles.seeAll, { color: CW }]}>See all</Text>
            </TouchableOpacity>
          </View>

          {jobs.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="car-outline" size={44} color="#CBD5E1" />
              <Text style={styles.emptyText}>No jobs recorded yet</Text>
            </View>
          ) : (
            <View style={styles.jobsList}>
              {jobs.slice(0, 10).map((job, i, arr) => {
                const sc = STATUS_STYLE[job.status] ?? STATUS_STYLE.cancelled;
                return (
                  <TouchableOpacity
                    key={job._id}
                    style={[styles.jobRow, i === arr.length - 1 && { borderBottomWidth: 0 }]}
                    onPress={() => router.push(`/carwash/jobs/${job._id}` as any)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.jobPlateBox, { backgroundColor: CWL }]}>
                      <Text style={[styles.jobPlate, { color: CW }]}>{job.plateNumber || '—'}</Text>
                    </View>
                    <View style={styles.jobMeta}>
                      <Text style={styles.jobVehicle} numberOfLines={1}>
                        {job.customerName || job.vehicleType || job.serviceName || 'Walk-in'}
                      </Text>
                      <Text style={styles.jobTime}>{fmtTime(job.createdAt)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                        <Text style={[styles.statusBadgeText, { color: sc.color }]}>
                          {job.status.replace('_', ' ').toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.jobAmount}>{fmt(Math.max(0, Number(job.price || 0) - Number(job.discountAmount || 0)))}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/carwash/jobs/new' as any)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F8FAFC' },
  scroll: { padding: 16, gap: 16, paddingBottom: 100 },

  dateStepper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  stepBtn:       { padding: 14 },
  dateLabel:     { flex: 1, alignItems: 'center', paddingVertical: 12 },
  dateLabelText: { fontSize: 15, fontWeight: '700', color: CW },
  dateLabelSub:  { fontSize: 10, color: '#94A3B8', marginTop: 2 },

  revenueCard: {
    backgroundColor: CW, borderRadius: 18, padding: 20, gap: 6,
  },
  revenueLabel:  { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: 'rgba(255,255,255,0.65)' },
  revenueAmount: { fontSize: 32, fontWeight: '900', color: '#fff' },
  revenueBreakdown: { flexDirection: 'row', marginTop: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 10 },
  revItem:       { flex: 1, gap: 3 },
  revItemBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 10 },
  revDot:        { width: 6, height: 6, borderRadius: 3, marginBottom: 2 },
  revItemLabel:  { fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: '600' },
  revItemVal:    { fontSize: 12, color: '#fff', fontWeight: '800' },

  queueRow: { flexDirection: 'row', gap: 10 },
  queueCard: {
    flex: 1, alignItems: 'center', gap: 4,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0',
    borderLeftWidth: 3,
    paddingVertical: 14,
  },
  queueCount: { fontSize: 24, fontWeight: '900' },
  queueLabel: { fontSize: 10, fontWeight: '600', color: '#64748B' },

  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 12, paddingVertical: 12,
  },
  actionBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  section:       { gap: 10 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle:  { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: '#64748B' },
  seeAll:        { fontSize: 12, fontWeight: '700' },

  emptyWrap:  { alignItems: 'center', gap: 10, paddingVertical: 32 },
  emptyText:  { fontSize: 14, color: '#94A3B8' },

  jobsList: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden',
  },
  jobRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  jobPlateBox: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  jobPlate:    { fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  jobMeta:     { flex: 1 },
  jobVehicle:  { fontSize: 13, fontWeight: '600', color: '#0F172A' },
  jobTime:     { fontSize: 11, color: '#94A3B8' },
  jobAmount:   { fontSize: 12, fontWeight: '800', color: '#0F172A' },

  statusBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },

  mpesaAlert: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1.5,
    borderColor: '#FED7AA', backgroundColor: '#FFF7ED',
    paddingHorizontal: 14, paddingVertical: 11,
  },
  mpesaAlertText: { flex: 1, fontSize: 13, fontWeight: '700', color: ACC },

  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: CW,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },
});
