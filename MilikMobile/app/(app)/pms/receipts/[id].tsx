import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

type Allocation = {
  invoice?:    { invoiceNumber?: string; category?: string; amount?: number };
  amount:      number;
  description: string;
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
  RENT_CHARGE:    'Rent',
  UTILITY_CHARGE: 'Utility',
  DEPOSIT_CHARGE: 'Deposit',
  PENALTY_CHARGE: 'Penalty',
  DEBIT_NOTE:     'Debit Note',
  TAKE_ON_DEBIT:  'Take-on',
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

  const load = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const { data } = await api.get(`/rent-payments/${id}`);
      setReceipt(data?.data ?? data);
    } catch { /* fail silently */ }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, [id]);

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

  const statusLabel = receipt.isReversed || receipt.isCancelled ? 'REVERSED'
    : receipt.isConfirmed ? 'CONFIRMED' : 'PENDING';
  const statusColor = receipt.isReversed || receipt.isCancelled ? Colors.textMuted
    : receipt.isConfirmed ? Colors.success : Colors.warning;
  const statusBg = receipt.isReversed || receipt.isCancelled ? Colors.borderLight
    : receipt.isConfirmed ? Colors.successLight : Colors.warningLight;

  const totalAllocated = Number(receipt.allocationSummary?.totalAllocated ?? 0);
  const unapplied      = Number(receipt.allocationSummary?.unapplied ?? 0);
  const propName = receipt.unit?.property?.propertyName ?? receipt.unit?.property?.name ?? '';

  return (
    <>
      <Stack.Screen options={{ title: receipt.receiptNumber ?? 'Receipt' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.primary} />
          }
        >
          {/* Hero */}
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.receiptNum}>{receipt.receiptNumber ?? receipt.referenceNumber ?? '—'}</Text>
                <Text style={styles.tenantName}>{receipt.tenant?.name ?? 'Unknown Tenant'}</Text>
                {(receipt.unit?.unitNumber || propName) ? (
                  <Text style={styles.meta}>
                    {[receipt.unit?.unitNumber && `Unit ${receipt.unit.unitNumber}`, propName].filter(Boolean).join(' · ')}
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

          {/* Details */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>RECEIPT DETAILS</Text>
            <Row label="Reference No."  value={receipt.referenceNumber || '—'} />
            <Row label="Payment Type"   value={receipt.paymentType ?? '—'} />
            <Row label="Payment Date"   value={fmtDate(receipt.paymentDate)} />
            {receipt.cashbook ? <Row label="Cashbook" value={receipt.cashbook} /> : null}
            {receipt.description ? <Row label="Description" value={receipt.description} /> : null}
            <View style={styles.divider} />
            <Row label="Total Amount"  value={`KES ${fmt(receipt.amount)}`} />
            <Row label="Allocated"     value={`KES ${fmt(totalAllocated)}`}    valueColor={Colors.success} />
            {unapplied > 0 ? (
              <Row label="Unallocated" value={`KES ${fmt(unapplied)}`} valueColor={Colors.warning} />
            ) : null}
          </View>

          {/* Allocations */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>APPLIED TO INVOICES</Text>
            {!receipt.allocations || receipt.allocations.length === 0 ? (
              <View style={styles.emptyNotes}>
                <Ionicons name="link-outline" size={32} color={Colors.border} />
                <Text style={styles.emptyNotesText}>
                  {unapplied > 0 ? 'Not yet allocated to any invoice' : 'No allocation details available'}
                </Text>
              </View>
            ) : (
              receipt.allocations.map((alloc, i) => {
                const cat = alloc.invoice?.category;
                const catLabel = cat ? (CATEGORY_LABELS[cat] ?? cat) : '';
                const invNum = alloc.invoice?.invoiceNumber ?? '';
                return (
                  <View key={i} style={styles.allocRow}>
                    <View style={styles.allocIcon}>
                      <Ionicons name="receipt-outline" size={14} color={Colors.primary} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.allocInv}>{[invNum, catLabel].filter(Boolean).join(' · ') || alloc.description || 'Invoice'}</Text>
                    </View>
                    <Text style={styles.allocAmt}>KES {fmt(alloc.amount)}</Text>
                  </View>
                );
              })
            )}
            {unapplied > 0 && (
              <View style={[styles.allocRow, { backgroundColor: Colors.warningLight, borderRadius: 8, padding: 10, marginTop: 4 }]}>
                <Ionicons name="warning-outline" size={14} color={Colors.warning} />
                <Text style={{ flex: 1, fontSize: 13, color: Colors.warning, fontWeight: '600', marginLeft: 8 }}>
                  KES {fmt(unapplied)} unallocated — awaiting allocation
                </Text>
              </View>
            )}
          </View>
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
  cardTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted, marginBottom: 12 },

  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  rowLabel: { fontSize: 13, color: Colors.textSecondary },
  rowValue: { fontSize: 13, fontWeight: '700', color: Colors.text },
  divider:  { height: 1, backgroundColor: Colors.border, marginVertical: 4 },

  emptyNotes:     { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyNotesText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },

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
});
