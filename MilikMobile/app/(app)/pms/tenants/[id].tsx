import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Linking, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

type TenantDetail = {
  _id:         string;
  name:        string;
  phone?:      string;
  email?:      string;
  tenantCode?: string;
  status?:     string;
  balance?:    number;
  unit?:       { _id: string; unitNumber?: string; property?: { propertyName?: string; propertyCode?: string } };
  moveInDate?: string;
  rent?:       number;
};

type BalanceData = {
  currentBalance: number;
  totalPaid:      number;
  depositAmount:  number;
  depositHeldBy?: string;
};

type Invoice = {
  _id:           string;
  invoiceNumber?: string;
  amount:        number;
  status:        string;
  category?:     string;
  dueDate?:      string;
  createdAt?:    string;
};

type Payment = {
  _id:         string;
  receiptNumber?: string;
  amount:      number;
  paymentDate?: string;
  paymentMethod?: string;
  isConfirmed?: boolean;
};

const fmt = (n: number) =>
  `KES ${Math.abs(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const INV_STATUS_COLOR: Record<string, string> = {
  unpaid:    Colors.danger,
  partial:   Colors.warning,
  paid:      Colors.success,
  cancelled: Colors.textMuted,
  reversed:  Colors.textMuted,
};

export default function TenantProfileScreen() {
  const { id }   = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();

  const [tenant,    setTenant]    = useState<TenantDetail | null>(null);
  const [balance,   setBalance]   = useState<BalanceData | null>(null);
  const [invoices,  setInvoices]  = useState<Invoice[]>([]);
  const [payments,  setPayments]  = useState<Payment[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = async () => {
    try {
      const [tenantRes, balRes, invRes, payRes] = await Promise.all([
        api.get(`/tenants/${id}`),
        api.get(`/tenants/balance/${id}`),
        api.get('/tenant-invoices', { params: { tenant: id, limit: 10, page: 1 } }),
        api.get(`/tenants/payments/${id}`, { params: { limit: 10 } }),
      ]);
      setTenant(tenantRes.data.data || tenantRes.data);
      setBalance(balRes.data.data);
      setInvoices(invRes.data.data || []);
      setPayments(payRes.data.data || []);
    } catch (err) {
      console.error('Tenant profile load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadAll(); }, [id]);

  const onRefresh = () => { setRefreshing(true); loadAll(); };

  const openWhatsApp = () => {
    if (!tenant?.phone) return;
    const phone = tenant.phone.replace(/\D/g, '');
    // Kenya numbers: normalise to international format
    const intl = phone.startsWith('0') ? `254${phone.slice(1)}` : phone;
    Linking.openURL(`https://wa.me/${intl}`);
  };

  const callTenant = () => {
    if (!tenant?.phone) return;
    Linking.openURL(`tel:${tenant.phone}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Tenant Profile' }} />
        <MilikLoader fullscreen />
      </SafeAreaView>
    );
  }

  if (!tenant) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <View style={styles.loadingWrap}>
          <Text style={styles.errorText}>Tenant not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const currentBalance = balance?.currentBalance ?? tenant.balance ?? 0;
  const unitNumber     = tenant.unit?.unitNumber || '—';
  const propertyName   = (tenant.unit as any)?.property?.propertyName || '';

  return (
    <>
      <Stack.Screen options={{ title: tenant.name }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          {/* Header card */}
          <View style={styles.heroCard}>
            <View style={styles.heroAvatar}>
              <Text style={styles.heroAvatarText}>{tenant.name?.charAt(0)?.toUpperCase()}</Text>
            </View>
            <Text style={styles.heroName}>{tenant.name}</Text>
            <Text style={styles.heroUnit}>
              Unit {unitNumber}{propertyName ? ` · ${propertyName}` : ''}
            </Text>
            {tenant.tenantCode && (
              <Text style={styles.heroCode}>{tenant.tenantCode}</Text>
            )}

            {/* Action buttons */}
            <View style={styles.heroActions}>
              {tenant.phone && (
                <TouchableOpacity style={styles.actionBtn} onPress={callTenant}>
                  <Ionicons name="call-outline" size={20} color={Colors.primary} />
                  <Text style={styles.actionBtnLabel}>Call</Text>
                </TouchableOpacity>
              )}
              {tenant.phone && (
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnWhatsApp]} onPress={openWhatsApp}>
                  <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                  <Text style={[styles.actionBtnLabel, { color: '#25D366' }]}>WhatsApp</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnPrimary]}
                onPress={() => router.push(`/pms/receipts/new?tenant=${id}` as any)}
              >
                <Ionicons name="cash-outline" size={20} color={Colors.white} />
                <Text style={[styles.actionBtnLabel, { color: Colors.white }]}>Receipt</Text>
              </TouchableOpacity>
            </View>

            {/* Statement link */}
            <TouchableOpacity
              style={styles.statementBtn}
              onPress={() => router.push(`/pms/tenants/${id}/statement` as any)}
            >
              <Ionicons name="document-text-outline" size={15} color="rgba(255,255,255,0.8)" />
              <Text style={styles.statementBtnLabel}>View Full Statement</Text>
              <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>

          {/* Balance card */}
          <View style={[styles.balanceCard, { borderColor: currentBalance > 0 ? Colors.danger : Colors.success }]}>
            <View style={styles.balanceRow}>
              <View style={styles.balanceStat}>
                <Text style={styles.balanceStatLabel}>BALANCE DUE</Text>
                <Text style={[styles.balanceStatValue, { color: currentBalance > 0 ? Colors.danger : Colors.success }]}>
                  {currentBalance > 0 ? fmt(currentBalance) : 'Settled'}
                </Text>
              </View>
              <View style={[styles.balanceStat, styles.balanceStatBorder]}>
                <Text style={styles.balanceStatLabel}>TOTAL PAID</Text>
                <Text style={styles.balanceStatValue}>{fmt(balance?.totalPaid ?? 0)}</Text>
              </View>
              <View style={styles.balanceStat}>
                <Text style={styles.balanceStatLabel}>DEPOSIT</Text>
                <Text style={styles.balanceStatValue}>{fmt(balance?.depositAmount ?? 0)}</Text>
              </View>
            </View>
          </View>

          {/* Tenant details */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>DETAILS</Text>
            <View style={styles.detailCard}>
              {[
                { label: 'Phone',     value: tenant.phone || '—' },
                { label: 'Email',     value: tenant.email || '—' },
                { label: 'Move-in',   value: fmtDate(tenant.moveInDate) },
                { label: 'Rent (p.m)',value: tenant.rent ? fmt(tenant.rent) : '—' },
                { label: 'Status',    value: tenant.status || '—' },
              ].map((row, i, arr) => (
                <View key={row.label} style={[styles.detailRow, i === arr.length - 1 && styles.detailRowLast]}>
                  <Text style={styles.detailLabel}>{row.label}</Text>
                  <Text style={styles.detailValue} numberOfLines={1}>{row.value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Recent invoices */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>RECENT INVOICES</Text>
              <TouchableOpacity onPress={() => router.push(`/pms/invoices?tenant=${id}` as any)}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>
            {invoices.length === 0 ? (
              <Text style={styles.emptyListText}>No invoices found</Text>
            ) : (
              <View style={styles.listCard}>
                {invoices.slice(0, 5).map((inv, i, arr) => (
                  <View key={inv._id} style={[styles.listRow, i === arr.length - 1 && styles.listRowLast]}>
                    <View style={[styles.statusStripe, { backgroundColor: INV_STATUS_COLOR[inv.status] || Colors.textMuted }]} />
                    <View style={styles.listRowBody}>
                      <Text style={styles.listRowTitle}>
                        {inv.invoiceNumber || inv.category || 'Invoice'}
                      </Text>
                      <Text style={styles.listRowSub}>{fmtDate(inv.dueDate || inv.createdAt)}</Text>
                    </View>
                    <Text style={[styles.listRowAmt, { color: INV_STATUS_COLOR[inv.status] || Colors.text }]}>
                      {fmt(inv.amount)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Recent payments */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>RECENT PAYMENTS</Text>
            </View>
            {payments.length === 0 ? (
              <Text style={styles.emptyListText}>No payments recorded</Text>
            ) : (
              <View style={styles.listCard}>
                {payments.slice(0, 5).map((pay, i, arr) => (
                  <View key={pay._id} style={[styles.listRow, i === arr.length - 1 && styles.listRowLast]}>
                    <View style={[styles.statusStripe, { backgroundColor: pay.isConfirmed ? Colors.success : Colors.warning }]} />
                    <View style={styles.listRowBody}>
                      <Text style={styles.listRowTitle}>
                        {pay.receiptNumber || 'Payment'}
                      </Text>
                      <Text style={styles.listRowSub}>{fmtDate(pay.paymentDate)}</Text>
                    </View>
                    <Text style={[styles.listRowAmt, { color: Colors.success }]}>
                      {fmt(pay.amount)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  scroll:      { padding: 16, paddingBottom: 48, gap: 16 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText:   { fontSize: 16, color: Colors.textMuted },

  /* Hero */
  heroCard: {
    backgroundColor: Colors.primary,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  heroAvatar: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  heroAvatarText: { fontSize: 28, fontWeight: '900', color: Colors.white },
  heroName:       { fontSize: 20, fontWeight: '800', color: Colors.white },
  heroUnit:       { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  heroCode:       { fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5 },

  heroActions: {
    flexDirection: 'row', gap: 10, marginTop: 16,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  actionBtnWhatsApp: { backgroundColor: 'rgba(37,211,102,0.15)' },
  actionBtnPrimary:  { backgroundColor: Colors.accent },
  actionBtnLabel:    { fontSize: 13, fontWeight: '700', color: Colors.white },
  statementBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 14,
    paddingVertical: 10, paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10, alignSelf: 'stretch',
    justifyContent: 'center',
  },
  statementBtnLabel: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },

  /* Balance */
  balanceCard: {
    backgroundColor: Colors.white,
    borderRadius: 16, borderWidth: 2,
    padding: 16,
  },
  balanceRow:       { flexDirection: 'row' },
  balanceStat:      { flex: 1, alignItems: 'center', gap: 4 },
  balanceStatBorder:{ borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.border },
  balanceStatLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: Colors.textMuted },
  balanceStatValue: { fontSize: 15, fontWeight: '800', color: Colors.text },

  /* Sections */
  section:      { gap: 8 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.textMuted },
  sectionHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seeAll:       { fontSize: 12, fontWeight: '700', color: Colors.primary },

  /* Detail card */
  detailCard: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel:   { fontSize: 13, color: Colors.textMuted, fontWeight: '500' },
  detailValue:   { fontSize: 13, color: Colors.text, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },

  /* List card (invoices / payments) */
  listCard: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  listRow: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  listRowLast:  { borderBottomWidth: 0 },
  statusStripe: { width: 4, alignSelf: 'stretch' },
  listRowBody:  { flex: 1, paddingVertical: 13, paddingLeft: 12, gap: 3 },
  listRowTitle: { fontSize: 13, fontWeight: '700', color: Colors.text },
  listRowSub:   { fontSize: 11, color: Colors.textMuted },
  listRowAmt:   { fontSize: 14, fontWeight: '800', paddingRight: 14 },

  emptyListText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', paddingVertical: 16 },
});
