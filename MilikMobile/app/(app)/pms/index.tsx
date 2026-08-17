import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { Colors } from '../../../constants/colors';
import api from '../../../services/api';

type QuickAction = { icon: string; label: string; route: string };

const QUICK_ACTIONS: QuickAction[] = [
  { icon: 'business-outline',      label: 'Properties',     route: '/pms/properties'   },
  { icon: 'people-outline',        label: 'Tenants',        route: '/pms/tenants'      },
  { icon: 'receipt-outline',       label: 'Invoices',       route: '/pms/invoices'     },
  { icon: 'cash-outline',          label: 'Receipts',       route: '/pms/receipts'     },
  { icon: 'phone-portrait-outline',label: 'M-Pesa',         route: '/pms/mpesa'        },
  { icon: 'construct-outline',     label: 'Maintenance',    route: '/pms/maintenance'  },
  { icon: 'speedometer-outline',   label: 'Meter Readings', route: '/pms/meters'       },
  { icon: 'alert-circle-outline',  label: 'Delinquency',    route: '/pms/delinquency'  },
  { icon: 'warning-outline',       label: 'Penalties',      route: '/pms/penalties'    },
];

const fmtK = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
};

export default function PMSDashboard() {
  const router = useRouter();
  const [kpi, setKpi]           = useState<{ occupancy: string; collected: string; arrears: string } | null>(null);
  const [refreshing, setRefresh] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/dashboard/summary');
      setKpi({
        occupancy: `${Math.round(data.occupancyRate ?? 0)}%`,
        collected: fmtK(Number(data.collectedThisMonth ?? 0)),
        arrears:   fmtK(Number(data.outstandingArrears ?? 0)),
      });
    } catch { /* fail silently — show stale values */ }
    finally { setRefresh(false); }
  };

  useEffect(() => { load(); }, []);

  const kpiItems = [
    { label: 'Occupancy', value: kpi?.occupancy ?? '—' },
    { label: 'Collected', value: kpi?.collected ?? '—' },
    { label: 'Arrears',   value: kpi?.arrears   ?? '—' },
  ];

  return (
    <>
      <Stack.Screen options={{ title: 'Property Management' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefresh(true); load(); }} tintColor={Colors.white} />}
        >
          {/* KPI strip */}
          <View style={styles.kpiRow}>
            {kpiItems.map((k, i) => (
              <View key={k.label} style={[styles.kpi, i < kpiItems.length - 1 && styles.kpiBorder]}>
                <Text style={styles.kpiValue}>{k.value}</Text>
                <Text style={styles.kpiLabel}>{k.label}</Text>
              </View>
            ))}
          </View>

          {/* Quick actions */}
          <Text style={styles.sectionLabel}>QUICK ACCESS</Text>
          <View style={styles.grid}>
            {QUICK_ACTIONS.map((action) => (
              <TouchableOpacity
                key={action.label}
                style={styles.actionTile}
                onPress={() => router.push(action.route as any)}
                activeOpacity={0.75}
              >
                <View style={styles.actionIcon}>
                  <Ionicons name={action.icon as any} size={24} color={Colors.primary} />
                </View>
                <Text style={styles.actionLabel}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, paddingBottom: 40, gap: 20 },

  kpiRow: {
    flexDirection: 'row',
    backgroundColor: Colors.primary,
    borderRadius: 18,
    padding: 20,
    gap: 0,
  },
  kpi:       { flex: 1, alignItems: 'center' },
  kpiBorder: { borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.15)' },
  kpiValue:  { fontSize: 22, fontWeight: '900', color: Colors.white },
  kpiLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontWeight: '600' },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: Colors.textMuted,
  },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12,
  },
  actionTile: {
    width: '30%', flexGrow: 1,
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center',
    paddingVertical: 18, paddingHorizontal: 8,
    gap: 10,
  },
  actionIcon: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: Colors.primaryFaded,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 12, fontWeight: '700', color: Colors.text, textAlign: 'center',
  },
});
