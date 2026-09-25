import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../services/api';
import { ErrorBanner, ErrorState } from '../../../components/ui/PmsStates';
import { useReloadOnFocus } from '../../../hooks/usePmsList';
import { fmtDate } from '../../../utils/pmsFormat';
import { HC, hrError, personName, refLabel, type HrStats } from '../../../utils/hr';

const QUICK_ACTIONS = [
  { label: 'Employees',  icon: 'people-outline',   route: '/hr/employees',  color: HC       },
  { label: 'Leave',      icon: 'calendar-outline', route: '/hr/leave',      color: '#0369A1' },
  { label: 'Attendance', icon: 'time-outline',     route: '/hr/attendance', color: '#065F46' },
] as const;

const daysUntil = (d?: string | null) =>
  d ? Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)) : null;

export default function HRDashboardScreen() {
  const router = useRouter();
  const [stats,      setStats]      = useState<HrStats | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    const req = ++reqRef.current;
    if (mode === 'initial') setLoading(true);
    else if (mode === 'refresh') setRefreshing(true);
    try {
      const { data } = await api.get('/hr/employees/stats');
      if (req !== reqRef.current) return;
      setStats(data && typeof data === 'object' ? (data as HrStats) : {});
      setError(null);
    } catch (err) {
      if (req !== reqRef.current) return;
      setError(hrError(err, 'Could not load the HR summary.'));
    } finally {
      if (req === reqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // pending leaves / headcount change after approving leave or editing staff elsewhere
  useReloadOnFocus(useCallback(() => { load('silent'); }, [load]));

  const s = stats ?? {};
  const departments = useMemo(
    () => (s.byDepartment ?? []).filter(d => d.name !== 'Unassigned').length,
    [s.byDepartment],
  );
  const maxDept = useMemo(() => Math.max(1, ...(s.byDepartment ?? []).map(d => d.count)), [s.byDepartment]);
  const male   = s.byGender?.Male   ?? 0;
  const female = s.byGender?.Female ?? 0;
  const pending = s.pendingLeave ?? 0;

  const kpis = [
    { label: 'Total Staff',    value: s.total        ?? 0, icon: 'people-outline',           color: HC,        route: '/hr/employees' },
    { label: 'Active',         value: s.active       ?? 0, icon: 'checkmark-circle-outline', color: '#065F46', route: '/hr/employees?status=Active' },
    { label: 'On Probation',   value: s.probation    ?? 0, icon: 'hourglass-outline',        color: '#D97706', route: '/hr/employees?status=Probation' },
    { label: 'Pending Leaves', value: pending,               icon: 'calendar-outline',         color: '#DC2626', route: '/hr/leave' },
    { label: 'On Leave Today', value: s.onLeaveToday ?? 0, icon: 'airplane-outline',         color: '#7C3AED', route: '/hr/leave' },
    { label: 'Departments',    value: departments,           icon: 'business-outline',         color: '#0369A1', route: '' },
  ];

  const alerts: { key: string; text: string; route: string; color: string }[] = [];
  if (pending > 0) alerts.push({ key: 'leave', text: `${pending} leave application${pending > 1 ? 's' : ''} awaiting approval`, route: '/hr/leave', color: '#D97706' });
  if ((s.suspended ?? 0) > 0) alerts.push({ key: 'susp', text: `${s.suspended} employee${(s.suspended ?? 0) > 1 ? 's' : ''} currently suspended`, route: '/hr/employees?status=Suspended', color: '#EA580C' });
  const probEnding = s.probationEndingSoon ?? [];
  if (probEnding.length > 0) alerts.push({ key: 'prob', text: `${probEnding.length} employee${probEnding.length > 1 ? 's' : ''} ending probation within 30 days`, route: '/hr/employees?status=Probation', color: '#1D4ED8' });

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}><ActivityIndicator color={HC} size="large" /></View>
      </SafeAreaView>
    );
  }
  if (!stats) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ErrorState message={error ?? 'Could not load the HR summary.'} onRetry={() => load()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={HC} />}
      >
        {error ? <ErrorBanner message={error} onRetry={() => load()} /> : null}

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>MILIK HR</Text>
          <Text style={styles.heroTitle}>People &amp; Workforce</Text>
          <View style={styles.heroRow}>
            <View style={styles.heroStat}>
              <Text style={styles.heroVal}>{s.total ?? 0}</Text>
              <Text style={styles.heroLbl}>Total Staff</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroVal}>{male} / {female}</Text>
              <Text style={styles.heroLbl}>Male / Female</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroVal, pending > 0 && { color: '#FCA5A5' }]}>{pending}</Text>
              <Text style={styles.heroLbl}>Pending Leaves</Text>
            </View>
          </View>
        </View>

        {/* Alerts */}
        {alerts.map(a => (
          <TouchableOpacity key={a.key} style={[styles.alertCard, { borderColor: a.color + '55' }]} onPress={() => router.push(a.route as any)} activeOpacity={0.8}>
            <Ionicons name="alert-circle-outline" size={20} color={a.color} />
            <Text style={[styles.alertTxt, { color: a.color }]}>{a.text}</Text>
            <Ionicons name="chevron-forward" size={14} color={a.color} />
          </TouchableOpacity>
        ))}

        {/* KPI grid */}
        <View style={styles.kpiGrid}>
          {kpis.map(k => (
            <TouchableOpacity
              key={k.label}
              style={styles.kpiCard}
              activeOpacity={k.route ? 0.75 : 1}
              disabled={!k.route}
              onPress={() => router.push(k.route as any)}
            >
              <View style={[styles.kpiIcon, { backgroundColor: k.color + '15' }]}>
                <Ionicons name={k.icon as any} size={20} color={k.color} />
              </View>
              <Text style={styles.kpiVal}>{k.value}</Text>
              <Text style={styles.kpiLbl}>{k.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Quick access */}
        <Text style={styles.sectionLabel}>QUICK ACCESS</Text>
        <View style={styles.actionsGrid}>
          {QUICK_ACTIONS.map(a => (
            <TouchableOpacity key={a.label} style={styles.actionCard} onPress={() => router.push(a.route as any)} activeOpacity={0.75}>
              <View style={[styles.actionIcon, { backgroundColor: a.color + '12' }]}>
                <Ionicons name={a.icon as any} size={24} color={a.color} />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
              <Ionicons name="chevron-forward" size={14} color="#CBD5E1" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Headcount by department */}
        {(s.byDepartment ?? []).length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>HEADCOUNT BY DEPARTMENT</Text>
            {(s.byDepartment ?? []).map((d, i) => (
              <View key={`${d.name}-${i}`} style={styles.barRow}>
                <Text style={styles.barLabel} numberOfLines={1}>{d.name}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.max(4, (d.count / maxDept) * 100)}%` }]} />
                </View>
                <Text style={styles.barVal}>{d.count}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* By employment type */}
        {Object.values(s.byType ?? {}).some(n => n > 0) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>EMPLOYMENT TYPE</Text>
            <View style={styles.typeRow}>
              {(['Permanent', 'Contract', 'Casual', 'Intern'] as const).filter(t => (s.byType?.[t] ?? 0) > 0).map(t => (
                <View key={t} style={styles.typeChip}>
                  <Text style={styles.typeVal}>{s.byType?.[t]}</Text>
                  <Text style={styles.typeLbl}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Probation ending soon */}
        {probEnding.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>ENDING PROBATION (30 DAYS)</Text>
            {probEnding.map(e => {
              const left = daysUntil(e.probationEndDate);
              return (
                <TouchableOpacity key={e._id} style={styles.listRow} onPress={() => router.push(`/hr/employees/${e._id}` as any)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listName} numberOfLines={1}>{personName(e)}</Text>
                    <Text style={styles.listSub}>{refLabel(e.department) || 'No department'} · ends {fmtDate(e.probationEndDate)}</Text>
                  </View>
                  {left != null ? <Text style={styles.listTag}>{left === 0 ? 'Today' : `${left}d`}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {/* Recent joiners */}
        {(s.recentJoiners ?? []).length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>RECENT JOINERS</Text>
            {(s.recentJoiners ?? []).map(e => (
              <TouchableOpacity key={e._id} style={styles.listRow} onPress={() => router.push(`/hr/employees/${e._id}` as any)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listName} numberOfLines={1}>{personName(e)}</Text>
                  <Text style={styles.listSub} numberOfLines={1}>
                    {[refLabel(e.designation), refLabel(e.department)].filter(Boolean).join(' · ') || 'No designation'}
                  </Text>
                </View>
                <Text style={styles.listSub}>{fmtDate(e.dateJoined)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F5F3FF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 16, paddingBottom: 40 },

  hero: {
    backgroundColor: HC, borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  heroEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5, color: 'rgba(255,255,255,0.55)' },
  heroTitle:   { fontSize: 22, fontWeight: '900', color: '#fff', marginTop: 4 },
  heroRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  heroDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 14 },
  heroStat:    { flex: 1 },
  heroVal:     { fontSize: 18, fontWeight: '900', color: '#fff' },
  heroLbl:     { fontSize: 9, color: 'rgba(255,255,255,0.6)', marginTop: 2, fontWeight: '500' },

  alertCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, padding: 14,
  },
  alertTxt: { flex: 1, fontSize: 13, fontWeight: '600' },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: {
    width: '30.5%', backgroundColor: '#fff',
    borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0',
    padding: 12, gap: 6, alignItems: 'flex-start',
  },
  kpiIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  kpiVal:  { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  kpiLbl:  { fontSize: 10, color: '#94A3B8', fontWeight: '500' },

  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  actionsGrid: { gap: 8 },
  actionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 14,
  },
  actionIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0F172A' },

  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, gap: 10 },
  cardTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  barRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 96, fontSize: 12, color: '#475569', fontWeight: '600' },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#F1F5F9', overflow: 'hidden' },
  barFill:  { height: 8, borderRadius: 4, backgroundColor: HC },
  barVal:   { width: 28, textAlign: 'right', fontSize: 12, fontWeight: '800', color: '#0F172A' },

  typeRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { backgroundColor: HC + '10', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', minWidth: 76 },
  typeVal:  { fontSize: 16, fontWeight: '900', color: HC },
  typeLbl:  { fontSize: 10, color: '#64748B', fontWeight: '600', marginTop: 1 },

  listRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  listName: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  listSub:  { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  listTag:  { fontSize: 11, fontWeight: '800', color: '#1D4ED8' },
});
