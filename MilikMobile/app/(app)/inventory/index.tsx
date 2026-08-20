import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../services/api';

const INV = '#92400E';

type POSSummary = { count?: number; grandTotal?: number; totalVat?: number; totalDiscount?: number };

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const QUICK_ACTIONS = [
  { label: 'Products',        icon: 'cube-outline',          route: '/inventory/products',        color: INV       },
  { label: 'Purchase Orders', icon: 'document-text-outline', route: '/inventory/purchase-orders', color: '#1D4ED8' },
  { label: 'Stock Movements', icon: 'swap-vertical-outline', route: '/inventory/stock-movements', color: '#065F46' },
  { label: 'POS Sales',       icon: 'cart-outline',          route: '/inventory/pos-sales',       color: '#7C3AED' },
] as const;

export default function InventoryDashboardScreen() {
  const router = useRouter();

  const [summary,    setSummary]    = useState<POSSummary>({});
  const [lowStock,   setLowStock]   = useState(0);
  const [totalProds, setTotalProds] = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const today = todayStr();
    const [sumRes, lowRes, prodRes] = await Promise.allSettled([
      api.get('/pos/sales/summary', { params: { date: today } }),
      api.get('/inventory/stock-movements/low-stock'),
      api.get('/inventory/products', { params: { limit: 1, active: 'true' } }),
    ]);

    if (sumRes.status === 'fulfilled') {
      const d = sumRes.value.data?.data ?? sumRes.value.data;
      setSummary(d ?? {});
    }
    if (lowRes.status === 'fulfilled') {
      const d = lowRes.value.data;
      setLowStock(d?.total ?? (d?.data?.length ?? 0));
    }
    if (prodRes.status === 'fulfilled') {
      setTotalProds(prodRes.value.data?.total ?? 0);
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={INV} />}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>TODAY'S POS SALES</Text>
          <Text style={styles.heroTitle}>{loading ? '—' : fmt(summary.grandTotal ?? 0)}</Text>
          {loading ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 14 }} />
          ) : (
            <View style={styles.heroRow}>
              <View style={styles.heroStat}>
                <Text style={styles.heroVal}>{summary.count ?? 0}</Text>
                <Text style={styles.heroLbl}>Transactions</Text>
              </View>
              <View style={styles.heroDivider} />
              <View style={styles.heroStat}>
                <Text style={styles.heroVal}>{totalProds}</Text>
                <Text style={styles.heroLbl}>Products</Text>
              </View>
              <View style={styles.heroDivider} />
              <View style={styles.heroStat}>
                <Text style={[styles.heroVal, lowStock > 0 && { color: '#FCA5A5' }]}>
                  {lowStock}
                </Text>
                <Text style={styles.heroLbl}>Low Stock</Text>
              </View>
            </View>
          )}
        </View>

        {/* Low stock alert */}
        {!loading && lowStock > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            onPress={() => router.push('/inventory/products' as any)}
          >
            <Ionicons name="warning-outline" size={20} color="#D97706" />
            <Text style={styles.alertTxt}>
              {lowStock} product{lowStock !== 1 ? 's' : ''} below reorder level — tap to review
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#D97706" />
          </TouchableOpacity>
        )}

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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FFFBEB' },
  scroll: { padding: 16, gap: 16, paddingBottom: 40 },

  hero: {
    backgroundColor: INV, borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  heroEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5, color: 'rgba(255,255,255,0.55)' },
  heroTitle:   { fontSize: 30, fontWeight: '900', color: '#fff', marginTop: 4, letterSpacing: -0.5 },
  heroRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  heroDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 14 },
  heroStat:    { flex: 1 },
  heroVal:     { fontSize: 18, fontWeight: '900', color: '#fff' },
  heroLbl:     { fontSize: 9, color: 'rgba(255,255,255,0.6)', marginTop: 2, fontWeight: '500' },

  alertCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFBEB', borderRadius: 14,
    borderWidth: 1, borderColor: '#FDE68A', padding: 14,
  },
  alertTxt: { flex: 1, fontSize: 13, fontWeight: '600', color: '#D97706' },

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
