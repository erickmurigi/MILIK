import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { Colors } from '../../../constants/colors';
import api from '../../../services/api';
import MilikLoader from '../../../components/ui/MilikLoader';
import { ErrorState } from '../../../components/ui/PmsStates';
import { apiError, fmtMoney } from '../../../utils/pmsFormat';

type QuickAction = {
  icon:      string;
  label:     string;
  route:     string;
  badgeKey?: 'maint' | 'mpesa';
};

const QUICK_ACTIONS: QuickAction[] = [
  { icon: 'business-outline',       label: 'Properties',     route: '/pms/properties'  },
  { icon: 'people-outline',         label: 'Tenants',        route: '/pms/tenants'     },
  { icon: 'receipt-outline',        label: 'Invoices',       route: '/pms/invoices'    },
  { icon: 'cash-outline',           label: 'Receipts',       route: '/pms/receipts'    },
  { icon: 'phone-portrait-outline', label: 'M-Pesa',         route: '/pms/mpesa',        badgeKey: 'mpesa' },
  { icon: 'construct-outline',      label: 'Maintenance',    route: '/pms/maintenance',  badgeKey: 'maint' },
  { icon: 'speedometer-outline',    label: 'Meter Readings', route: '/pms/meters'      },
  { icon: 'alert-circle-outline',   label: 'Delinquency',   route: '/pms/delinquency' },
  { icon: 'warning-outline',        label: 'Penalties',      route: '/pms/penalties'   },
];

const fmtK = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
};

const ageInDays = (d?: string): number | null => {
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));
};

type KPI = { occupancy: string; collected: string; arrears: string };

type OverdueInvoice = {
  _id:            string;
  tenant?:        { name?: string } | string | null;
  tenantName?:    string;
  amount:         number;
  adjustedAmount?: number;
  outstanding?:   number;
  computedStatus?: string;
  dueDate?:       string;
  createdAt?:     string;
};

export default function PMSDashboard() {
  const router = useRouter();

  const [loading,         setLoading]         = useState(true);
  const [refreshing,      setRefreshing]       = useState(false);
  const [kpi,             setKpi]             = useState<KPI | null>(null);
  const [maintPending,    setMaintPending]    = useState(0);
  const [mpesaUnmatched,  setMpesaUnmatched]  = useState(0);
  const [overdueInvoices, setOverdueInvoices] = useState<OverdueInvoice[]>([]);
  const [overdueCount,    setOverdueCount]    = useState(0);
  const [loadError,       setLoadError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    // "Issued" = pending + partially paid; snapshots give the real outstanding balance per invoice.
    const [summaryRes, maintRes, mpesaRes, invRes] = await Promise.allSettled([
      api.get('/dashboard/summary'),
      api.get('/maintenances',       { params: { status: 'pending',   limit: 1 } }),
      api.get('/mpesa-collections',  { params: { status: 'unmatched', limit: 1 } }),
      api.get('/tenant-invoices',    { params: { status: 'Issued', limit: 40, includeSnapshots: 'true' } }),
    ]);

    // Every request failed -> show a real error instead of a dashboard full of zeros / dashes.
    if ([summaryRes, maintRes, mpesaRes, invRes].every(r => r.status === 'rejected')) {
      setLoadError(apiError((summaryRes as PromiseRejectedResult).reason, 'Could not load the dashboard.'));
    } else {
      setLoadError(null);
    }

    if (summaryRes.status === 'fulfilled') {
      const d = summaryRes.value.data;
      setKpi({
        occupancy: `${Math.min(100, Math.round(d.occupancyRate ?? 0))}%`,
        collected: fmtK(Number(d.collectedThisMonth ?? 0)),
        arrears:   fmtK(Number(d.outstandingArrears ?? 0)),
      });
      setOverdueCount(Number(d.overdueInvoiceCount ?? 0));
    }
    if (maintRes.status === 'fulfilled') {
      setMaintPending(maintRes.value.data?.total ?? 0);
    }
    if (mpesaRes.status === 'fulfilled') {
      // /mpesa-collections reports its total under pagination.total (there is no top-level total)
      setMpesaUnmatched(mpesaRes.value.data?.pagination?.total ?? 0);
    }
    if (invRes.status === 'fulfilled') {
      const rows: OverdueInvoice[] = invRes.value.data?.data ?? [];
      const now = Date.now();
      const balance = (i: OverdueInvoice) => Number(i.outstanding ?? i.adjustedAmount ?? i.amount ?? 0);
      // Truly overdue only (due date passed, still owing), oldest first.
      setOverdueInvoices(
        rows
          .filter(i => i.dueDate && new Date(i.dueDate).getTime() < now && balance(i) > 0.009)
          .sort((a, b) => new Date(a.dueDate as string).getTime() - new Date(b.dueDate as string).getTime())
          .slice(0, 5),
      );
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (!loading && loadError && !kpi) {
    return (
      <>
        <Stack.Screen options={{ title: 'Property Management' }} />
        <SafeAreaView style={styles.safe} edges={['bottom']}>
          <ErrorState message={loadError} onRetry={() => { setLoading(true); load(); }} />
        </SafeAreaView>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Property Management' }} />
        <SafeAreaView style={styles.safe} edges={['bottom']}>
          <MilikLoader fullscreen />
        </SafeAreaView>
      </>
    );
  }

  const badges: Record<string, number> = { maint: maintPending, mpesa: mpesaUnmatched };
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
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

          {/* Alert badges */}
          {(maintPending > 0 || mpesaUnmatched > 0) && (
            <View style={styles.alertRow}>
              {maintPending > 0 && (
                <TouchableOpacity
                  style={[styles.alertBadge, styles.alertDanger]}
                  onPress={() => router.push('/pms/maintenance' as any)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="construct-outline" size={16} color={Colors.danger} />
                  <Text style={[styles.alertText, { color: Colors.danger }]}>
                    {maintPending} Maintenance Pending
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.danger} />
                </TouchableOpacity>
              )}
              {mpesaUnmatched > 0 && (
                <TouchableOpacity
                  style={[styles.alertBadge, styles.alertWarning]}
                  onPress={() => router.push('/pms/mpesa' as any)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="phone-portrait-outline" size={16} color={Colors.warning} />
                  <Text style={[styles.alertText, { color: Colors.warning }]}>
                    {mpesaUnmatched} M-Pesa Unmatched
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.warning} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Overdue invoices */}
          {overdueInvoices.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>OVERDUE INVOICES{overdueCount > 0 ? ` (${overdueCount})` : ''}</Text>
                <TouchableOpacity onPress={() => router.push('/pms/invoices?status=Issued' as any)}>
                  <Text style={styles.seeAll}>See all</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.listCard}>
                {overdueInvoices.map((inv, i, arr) => {
                  const tenantName =
                    inv.tenant && typeof inv.tenant === 'object'
                      ? (inv.tenant.name ?? 'Tenant')
                      : (inv.tenantName ?? 'Tenant');
                  const age = ageInDays(inv.dueDate || inv.createdAt);
                  return (
                    <TouchableOpacity
                      key={inv._id}
                      style={[styles.invoiceRow, i === arr.length - 1 && styles.invoiceRowLast]}
                      onPress={() => router.push(`/pms/invoices/${inv._id}` as any)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.invoiceStripe} />
                      <View style={styles.invoiceBody}>
                        <Text style={styles.invoiceTenant} numberOfLines={1}>{tenantName}</Text>
                        {age !== null && age > 0 && (
                          <Text style={styles.invoiceAge}>{age}d overdue</Text>
                        )}
                      </View>
                      <Text style={styles.invoiceAmt}>
                        KES {fmtMoney(Math.abs(inv.outstanding ?? inv.adjustedAmount ?? inv.amount ?? 0))}
                      </Text>
                      <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} style={styles.invoiceChevron} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Quick access grid */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>QUICK ACCESS</Text>
            <View style={styles.grid}>
              {QUICK_ACTIONS.map((action) => {
                const count = action.badgeKey ? (badges[action.badgeKey] ?? 0) : 0;
                return (
                  <TouchableOpacity
                    key={action.label}
                    style={styles.actionTile}
                    onPress={() => router.push(action.route as any)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.iconWrap}>
                      <View style={styles.actionIcon}>
                        <Ionicons name={action.icon as any} size={24} color={Colors.primary} />
                      </View>
                      {count > 0 && (
                        <View style={styles.tileBadge}>
                          <Text style={styles.tileBadgeText}>{count > 99 ? '99+' : count}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.actionLabel}>{action.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
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
  },
  kpi:       { flex: 1, alignItems: 'center' },
  kpiBorder: { borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.15)' },
  kpiValue:  { fontSize: 22, fontWeight: '900', color: Colors.white },
  kpiLabel:  { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontWeight: '600' },

  alertRow:    { gap: 8 },
  alertBadge:  {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1.5,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  alertDanger:  { backgroundColor: Colors.dangerLight,  borderColor: Colors.danger  },
  alertWarning: { backgroundColor: Colors.warningLight, borderColor: Colors.warning },
  alertText:    { flex: 1, fontSize: 13, fontWeight: '700' },

  section:       { gap: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel:  { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: Colors.textMuted },
  seeAll:        { fontSize: 12, fontWeight: '700', color: Colors.primary },

  listCard: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  invoiceRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.dangerLight,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  invoiceRowLast: { borderBottomWidth: 0 },
  invoiceStripe:  { width: 4, alignSelf: 'stretch', backgroundColor: Colors.danger },
  invoiceBody:    { flex: 1, paddingVertical: 13, paddingLeft: 12, gap: 2 },
  invoiceTenant:  { fontSize: 13, fontWeight: '700', color: Colors.text },
  invoiceAge:     { fontSize: 11, color: Colors.danger, fontWeight: '600' },
  invoiceAmt:     { fontSize: 13, fontWeight: '800', color: Colors.danger, marginRight: 4 },
  invoiceChevron: { marginRight: 12 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionTile: {
    width: '30%', flexGrow: 1,
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center',
    paddingVertical: 18, paddingHorizontal: 8,
    gap: 10,
  },
  iconWrap:    { position: 'relative' },
  actionIcon: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: Colors.primaryFaded,
    alignItems: 'center', justifyContent: 'center',
  },
  tileBadge: {
    position: 'absolute', top: -6, right: -6,
    backgroundColor: Colors.danger,
    borderRadius: 10, minWidth: 20, height: 20,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5, borderColor: Colors.white,
  },
  tileBadgeText: { fontSize: 10, fontWeight: '800', color: Colors.white },
  actionLabel:   { fontSize: 12, fontWeight: '700', color: Colors.text, textAlign: 'center' },
});
