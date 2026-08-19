import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../services/api';

const SC  = '#7C2D12';
const SCL = '#FEF3C7';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

type Stats = {
  activeListings?:  number;
  totalLeads?:      number;
  activeDeals?:     number;
  totalDealValue?:  number;
  totalCollected?:  number;
  overdueInstallments?: number;
};

const QUICK_ACTIONS = [
  { label: 'Leads',    icon: 'people-outline',         route: '/sales/leads',    color: '#1D4ED8' },
  { label: 'Deals',    icon: 'handshake-outline',      route: '/sales/deals',    color: SC        },
  { label: 'Listings', icon: 'home-outline',           route: '/sales/listings', color: '#065F46' },
  { label: 'Schedule', icon: 'calendar-number-outline',route: '/sales/deals',    color: '#7C3AED' },
] as const;

export default function SalesDashboardScreen() {
  const router = useRouter();
  const [stats,     setStats]     = useState<Stats>({});
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const { data } = await api.get('/sale/reports/dashboard');
      const d = data?.data ?? data;
      setStats(d ?? {});
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const statCards = [
    { label: 'Active Listings',   value: String(stats.activeListings  ?? 0), icon: 'home-outline',       color: '#065F46' },
    { label: 'Total Leads',       value: String(stats.totalLeads      ?? 0), icon: 'people-outline',     color: '#1D4ED8' },
    { label: 'Active Deals',      value: String(stats.activeDeals     ?? 0), icon: 'handshake-outline',  color: SC        },
    { label: 'Overdue Items',     value: String(stats.overdueInstallments ?? 0), icon: 'alert-circle-outline', color: '#DC2626' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={SC} />}
      >
        {/* Hero banner */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>MILIK PROPERTY SALES</Text>
          <Text style={styles.heroTitle}>Sales Pipeline</Text>
          {loading ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 12 }} />
          ) : (
            <View style={styles.heroRow}>
              <View style={styles.heroStat}>
                <Text style={styles.heroStatVal}>{fmt(stats.totalCollected ?? 0)}</Text>
                <Text style={styles.heroStatLbl}>Total Collected</Text>
              </View>
              <View style={styles.heroDivider} />
              <View style={styles.heroStat}>
                <Text style={styles.heroStatVal}>{fmt(stats.totalDealValue ?? 0)}</Text>
                <Text style={styles.heroStatLbl}>Pipeline Value</Text>
              </View>
            </View>
          )}
        </View>

        {/* Stat cards */}
        <View style={styles.statsGrid}>
          {statCards.map(s => (
            <View key={s.label} style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: s.color + '15' }]}>
                <Ionicons name={s.icon as any} size={20} color={s.color} />
              </View>
              <Text style={styles.statVal}>{s.value}</Text>
              <Text style={styles.statLbl}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Quick actions */}
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FFF7ED' },
  scroll: { padding: 16, gap: 16, paddingBottom: 40 },

  hero: {
    backgroundColor: SC, borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  heroEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5, color: 'rgba(255,255,255,0.55)' },
  heroTitle:   { fontSize: 24, fontWeight: '900', color: '#fff', marginTop: 4 },
  heroRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  heroDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 20 },
  heroStat:    { flex: 1 },
  heroStatVal: { fontSize: 16, fontWeight: '900', color: '#fff' },
  heroStatLbl: { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 2, fontWeight: '500' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    flex: 1, minWidth: '44%', backgroundColor: '#fff',
    borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0',
    padding: 14, gap: 6,
  },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statVal:  { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  statLbl:  { fontSize: 11, color: '#94A3B8', fontWeight: '500' },

  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  actionsGrid: { gap: 8 },
  actionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', padding: 14,
  },
  actionIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0F172A' },
});
