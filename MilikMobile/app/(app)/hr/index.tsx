import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../services/api';

const HC  = '#4C1D95';

type Stats = {
  total?:          number;
  active?:         number;
  onProbation?:    number;
  terminated?:     number;
  onLeaveToday?:   number;
  pendingLeaves?:  number;
  departments?:    number;
  maleCount?:      number;
  femaleCount?:    number;
  contractExpiring?: number;
};

const QUICK_ACTIONS = [
  { label: 'Employees',  icon: 'people-outline',      route: '/hr/employees',  color: HC       },
  { label: 'Leave',      icon: 'calendar-outline',    route: '/hr/leave',      color: '#0369A1' },
  { label: 'Attendance', icon: 'time-outline',        route: '/hr/attendance', color: '#065F46' },
] as const;

export default function HRDashboardScreen() {
  const router = useRouter();
  const [stats,      setStats]      = useState<Stats>({});
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const { data } = await api.get('/hr/employees/stats');
      setStats(data?.data ?? data ?? {});
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const kpis = [
    { label: 'Total Staff',       value: stats.total        ?? 0, icon: 'people-outline',        color: HC        },
    { label: 'Active',            value: stats.active       ?? 0, icon: 'checkmark-circle-outline', color: '#065F46' },
    { label: 'On Probation',      value: stats.onProbation  ?? 0, icon: 'time-outline',           color: '#D97706' },
    { label: 'Pending Leaves',    value: stats.pendingLeaves?? 0, icon: 'calendar-outline',       color: '#DC2626' },
    { label: 'On Leave Today',    value: stats.onLeaveToday ?? 0, icon: 'airplane-outline',       color: '#7C3AED' },
    { label: 'Departments',       value: stats.departments  ?? 0, icon: 'business-outline',       color: '#0369A1' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={HC} />}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>MILIK HR</Text>
          <Text style={styles.heroTitle}>People &amp; Workforce</Text>
          {loading ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 14 }} />
          ) : (
            <View style={styles.heroRow}>
              <View style={styles.heroStat}>
                <Text style={styles.heroVal}>{stats.total ?? 0}</Text>
                <Text style={styles.heroLbl}>Total Staff</Text>
              </View>
              <View style={styles.heroDivider} />
              <View style={styles.heroStat}>
                <Text style={styles.heroVal}>{stats.maleCount ?? 0} / {stats.femaleCount ?? 0}</Text>
                <Text style={styles.heroLbl}>Male / Female</Text>
              </View>
              <View style={styles.heroDivider} />
              <View style={styles.heroStat}>
                <Text style={[styles.heroVal, (stats.pendingLeaves ?? 0) > 0 && { color: '#FCA5A5' }]}>
                  {stats.pendingLeaves ?? 0}
                </Text>
                <Text style={styles.heroLbl}>Pending Leaves</Text>
              </View>
            </View>
          )}
        </View>

        {/* KPI grid */}
        <View style={styles.kpiGrid}>
          {kpis.map(k => (
            <View key={k.label} style={styles.kpiCard}>
              <View style={[styles.kpiIcon, { backgroundColor: k.color + '15' }]}>
                <Ionicons name={k.icon as any} size={20} color={k.color} />
              </View>
              <Text style={styles.kpiVal}>{k.value}</Text>
              <Text style={styles.kpiLbl}>{k.label}</Text>
            </View>
          ))}
        </View>

        {/* Quick access */}
        <Text style={styles.sectionLabel}>QUICK ACCESS</Text>
        <View style={styles.actionsGrid}>
          {QUICK_ACTIONS.map(a => (
            <TouchableOpacity
              key={a.label}
              style={styles.actionCard}
              onPress={() => router.push(a.route as any)}
              activeOpacity={0.75}
            >
              <View style={[styles.actionIcon, { backgroundColor: a.color + '12' }]}>
                <Ionicons name={a.icon as any} size={24} color={a.color} />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
              <Ionicons name="chevron-forward" size={14} color="#CBD5E1" />
            </TouchableOpacity>
          ))}
        </View>

        {(stats.contractExpiring ?? 0) > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            onPress={() => router.push('/hr/employees' as any)}
          >
            <Ionicons name="alert-circle-outline" size={20} color="#D97706" />
            <Text style={styles.alertTxt}>
              {stats.contractExpiring} contract{(stats.contractExpiring ?? 0) > 1 ? 's' : ''} expiring soon
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#D97706" />
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F5F3FF' },
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

  alertCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFBEB', borderRadius: 14,
    borderWidth: 1, borderColor: '#FDE68A', padding: 14,
  },
  alertTxt: { flex: 1, fontSize: 13, fontWeight: '600', color: '#D97706' },
});
