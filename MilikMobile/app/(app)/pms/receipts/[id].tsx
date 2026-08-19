import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  RefreshControl, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

type Allocation = {
  invoiceNumber?: string;
  category?:      string;
  appliedAmount:  number;
  description?:   string;
};

type Receipt = {
  _id:             string;
  receiptNumber:   string;
  referenceNumber: string;
  paymentDate:     string;
  amount:          number;
  paymentType:     string;
  isConfirmed:     boolean;
  isReversed:      boolean;
  isCancelled:     boolean;
  description:     string;
  tenant?:         { name?: string; phone?: string };
  unit?:           { unitNumber?: string; property?: { propertyName?: string; name?: string } };
  allocationSummary?: { unapplied?: number; totalAllocated?: number };
  allocations?:    Allocation[];
  cashbook?:       string;
  createdAt:       string;
};

const CATEGORY_LABELS: Record<string, string> = {
  RENT_CHARGE:         'Rent',
  UTILITY_CHARGE:      'Utility',
  DEPOSIT_CHARGE:      'Deposit',
  LATE_PENALTY_CHARGE: 'Penalty',
  PENALTY_CHARGE:      'Penalty',
  DEBIT_NOTE:          'Debit Note',
  TAKE_ON_DEBIT:       'Take-on',
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

const Row = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
  </View>
);

export default function ReceiptDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [receipt,    setReceipt]    = useState<Receipt | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const fetchReceipt = useCallback(async (): Promise<Receipt | null> => {
    const { data } = await api.get(`/rent-payments/${id}`);
    return data?.data ?? data;
  }, [id]);

  useEffect(() => {
    setLoading(true);
    fetchReceipt().then(setReceipt).catch(() => setReceipt(null)).finally(() => setLoading(false));
  }, [fetchReceipt]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    fetchReceipt().then(setReceipt).catch(() => {}).finally(() => setRefreshing(false));
  }, [fetchReceipt]);

  const confirm = useCallback(async () => {
    setConfirming(true);
    try {
      await api.put(`/rent-payments/confirm/${id}`);
      const updated = await fetchReceipt();
      if (updated) setReceipt(updated);
      Alert.alert('Confirmed', 'Receipt has been confirmed successfully.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      Alert.alert('Error', msg ?? 'Failed to confirm receipt.');
    } finally { setConfirming(false); }
  }, [id, fetchReceipt]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Receipt' }} />
        <MilikLoader fullscreen />
      </SafeAreaView>
    );
  }

  if (!receipt) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Receipt' }} />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.border} />
          <Text style={styles.emptyText}>Receipt not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isVoided    = receipt.isReversed || receipt.isCancelled;
  const statusLabel = isVoided ? 'REVERSED'
    : receipt.isConfirmed ? 'CONFIRMED' : 'PENDING';
  const statusColor = isVoided ? Colors.textMuted
    : receipt.isConfirmed ? Colors.success : Colors.warning;
  const statusBg    = isVoided ? Colors.borderLight
    : receipt.isConfirmed ? Colors.successLight : Colors.warningLight;

  const totalAllocated = Number(receipt.allocationSummary?.totalAllocated ?? 0);
  const unapplied      = Number(receipt.allocationSummary?.unapplied ?? 0);
  const propName       = receipt.unit?.property?.propertyName ?? receipt.unit?.property?.name ?? '';

  return (
    <>
      <Stack.Screen options={{ title: receipt.receiptNumber ?? 'Receipt' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />
          }
        >
          {receipt.isConfirmed && !isVoided && (
            <View style={styles.confirmedBanner}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.confirmedText}>Receipt confirmed</Text>
            </View>
          )}

          {isVoided && (
            <View style={styles.voidedBanner}>
              <Ionicons name="ban-outline" size={15} color={Colors.textMuted} />
              <Text style={styles.voidedText}>This receipt has been {receipt.isReversed ? 'reversed' : 'cancelled'}</Text>
            </View>
          )}

          {/* Hero */}
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.receiptNum}>
                  {receipt.receiptNumber ?? receipt.referenceNumber ?? '—'}
                </Text>
                <Text style={styles.tenantName}>{receipt.tenant?.name ?? 'Unknown Tenant'}</Text>
                {(receipt.unit?.unitNumber || propName) ? (
                  <Text style={styles.meta}>
                    {[
                      receipt.unit?.unitNumber && `Unit ${receipt.unit.unitNumber}`,
                      propName,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <View style={[styles.badge, { backgroundColor: statusBg }]}>
                  <Text style={[styles.badgeText, { color: statusColor }]}>{statusLabel}</Text>
                </View>
                <Text style={styles.amount}>KES {fmt(receipt.amount)}</Text>
              </View>
            </View>
          </View>

          {/* Payment details */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>RECEIPT DETAILS</Text>
            <Row label="Reference No."  value={receipt.referenceNumber || '—'} />
            <Row label="Payment Method" value={receipt.paymentType ?? '—'} />
            <Row label="Payment Date"   value={fmtDate(receipt.paymentDate)} />
            {receipt.cashbook ? <Row label="Cashbook" value={receipt.cashbook} /> : null}
            {receipt.description ? <Row label="Description" value={receipt.description} /> : null}
            <View style={styles.divider} />
            <Row label="Total Amount"  value={`KES ${fmt(receipt.amount)}`} />
            <Row label="Allocated"     value={`KES ${fmt(totalAllocated)}`} valueColor={Colors.success} />
            {unapplied > 0 ? (
              <Row label="Unallocated" value={`KES ${fmt(unapplied)}`} valueColor={Colors.warning} />
            ) : null}
          </View>

          {/* Applied invoices */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>APPLIED TO INVOICES</Text>
            {!receipt.allocations || receipt.allocations.length === 0 ? (
              <View style={styles.emptySection}>
                <Ionicons name="link-outline" size={32} color={Colors.border} />
                <Text style={styles.emptySectionText}>
                  {unapplied > 0 ? 'Not yet allocated to any invoice' : 'No allocation details available'}
                </Text>
              </View>
            ) : (
              receipt.allocations.map((alloc, i) => {
                const catLabel = alloc.category ? (CATEGORY_LABELS[alloc.category] ?? alloc.category) : '';
                const invNum   = alloc.invoiceNumber ?? '';
                return (
                  <View key={i} style={styles.allocRow}>
                    <View style={styles.allocIcon}>
                      <Ionicons name="receipt-outline" size={14} color={Colors.primary} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.allocInv}>
                        {[invNum, catLabel].filter(Boolean).join(' · ') || alloc.description || 'Invoice'}
                      </Text>
                    </View>
                    <Text style={styles.allocAmt}>KES {fmt(alloc.appliedAmount)}</Text>
                  </View>
                );
              })
            )}
            {unapplied > 0 && (
              <View style={styles.unappliedRow}>
                <Ionicons name="warning-outline" size={14} color={Colors.warning} />
                <Text style={styles.unappliedText}>
                  KES {fmt(unapplied)} unallocated — awaiting allocation
                </Text>
              </View>
            )}
          </View>

          {!receipt.isConfirmed && !isVoided && (
            <TouchableOpacity
              style={[styles.confirmBtn, confirming && { opacity: 0.6 }]}
              onPress={confirm}
              disabled={confirming}
              activeOpacity={0.85}
            >
              {confirming ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color={Colors.white} />
                  <Text style={styles.confirmBtnText}>Confirm Receipt</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textMuted },
  scroll:    { padding: 16, gap: 12, paddingBottom: 40 },

  confirmedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.successLight,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  confirmedText: { fontSize: 13, color: Colors.success, fontWeight: '600' },

  voidedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.borderLight,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  voidedText: { fontSize: 13, color: Colors.textMuted, fontWeight: '600' },

  heroCard: {
    backgroundColor: Colors.white, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border, padding: 16,
  },
  heroTop:    { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  receiptNum: { fontSize: 16, fontWeight: '900', color: Colors.text },
  tenantName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  meta:       { fontSize: 12, color: Colors.textMuted },
  amount:     { fontSize: 18, fontWeight: '900', color: Colors.success },
  badge:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  card: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, padding: 16,
  },
  cardTitle: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1,
    color: Colors.textMuted, marginBottom: 12,
  },

  row:      {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  rowLabel: { fontSize: 13, color: Colors.textSecondary },
  rowValue: { fontSize: 13, fontWeight: '700', color: Colors.text },
  divider:  { height: 1, backgroundColor: Colors.border, marginVertical: 4 },

  emptySection:     { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptySectionText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },

  allocRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  allocIcon: {
    width: 28, height: 28, borderRadius: 7,
    backgroundColor: Colors.primaryFaded,
    alignItems: 'center', justifyContent: 'center',
  },
  allocInv: { fontSize: 13, fontWeight: '600', color: Colors.text },
  allocAmt: { fontSize: 14, fontWeight: '800', color: Colors.success },

  unappliedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.warningLight, borderRadius: 8,
    padding: 10, marginTop: 4,
  },
  unappliedText: { flex: 1, fontSize: 13, color: Colors.warning, fontWeight: '600' },

  confirmBtn: {
    backgroundColor: Colors.primary, borderRadius: 14,
    height: 54, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, marginTop: 4,
  },
  confirmBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
});
