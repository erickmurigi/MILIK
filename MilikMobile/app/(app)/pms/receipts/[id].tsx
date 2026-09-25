import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  RefreshControl, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import ListErrorState from '../../../../components/ui/ListErrorState';
import { fmtMoney, fmtDate, apiError } from '../../../../utils/pmsFormat';
import { INVOICE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL } from '../../../../utils/pmsBilling';

type Allocation = {
  invoiceNumber?:   string;
  category?:        string;
  appliedAmount:    number;
  description?:     string;
  isPrepayment?:    boolean;
  prepaymentLabel?: string | null;
};

type Receipt = {
  _id:              string;
  receiptNumber?:   string;
  referenceNumber?: string;
  paymentDate?:     string;
  amount:           number;
  paymentType?:     string;
  paymentMethod?:   string;
  isConfirmed?:     boolean;
  isReversed?:      boolean;
  isCancelled?:     boolean;
  postingStatus?:   string;
  postingError?:    string | null;
  reversalReason?:  string;
  description?:     string;
  paidDirectToLandlord?: boolean;
  tenant?:          { _id?: string; name?: string; phone?: string } | null;
  unit?:            { unitNumber?: string; property?: { propertyName?: string; name?: string } | null } | null;
  allocationSummary?: {
    rent?: number; deposit?: number; utility?: number; latePenalty?: number;
    debitNote?: number; other?: number; unapplied?: number;
  };
  allocations?:     Allocation[];
  cashbook?:        string;
  confirmedAt?:     string;
};

const TYPE_LABEL: Record<string, string> = {
  rent: 'Rent', deposit: 'Deposit', utility: 'Utility', late_fee: 'Late Penalty', other: 'Other',
};

const Row = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
  </View>
);

export default function ReceiptDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [receipt,    setReceipt]    = useState<Receipt | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const fetchReceipt = useCallback(async (): Promise<Receipt> => {
    const { data } = await api.get(`/rent-payments/${id}`);
    return (data?.data ?? data) as Receipt;
  }, [id]);

  const loadInitial = useCallback(() => {
    setLoading(true);
    fetchReceipt()
      .then(r => { setReceipt(r); setError(null); })
      .catch(e => { setReceipt(null); setError(apiError(e, 'Could not load this receipt.')); })
      .finally(() => setLoading(false));
  }, [fetchReceipt]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    fetchReceipt()
      .then(r => { setReceipt(r); setError(null); })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [fetchReceipt]);

  const doConfirm = useCallback(async () => {
    setConfirming(true);
    try {
      await api.put(`/rent-payments/confirm/${id}`);
      const updated = await fetchReceipt();
      setReceipt(updated);
      Alert.alert('Confirmed', 'Receipt has been confirmed and posted to the ledger.');
    } catch (err) {
      Alert.alert('Could not confirm receipt', apiError(err, 'Failed to confirm receipt.'));
      // A failed posting is recorded on the receipt; reload so the reason is visible.
      fetchReceipt().then(setReceipt).catch(() => {});
    } finally { setConfirming(false); }
  }, [id, fetchReceipt]);

  const confirm = useCallback(() => {
    if (confirming) return;
    Alert.alert(
      'Confirm receipt?',
      'Confirming posts this receipt to the ledger and reduces the tenant balance.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: doConfirm },
      ],
    );
  }, [confirming, doConfirm]);

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
        <ListErrorState message={error ?? 'Receipt not found'} onRetry={loadInitial} />
      </SafeAreaView>
    );
  }

  const isVoided    = !!(receipt.isReversed || receipt.isCancelled);
  const isFailed    = !isVoided && !receipt.isConfirmed && receipt.postingStatus === 'failed';
  const statusLabel = isVoided ? 'REVERSED'
    : isFailed ? 'FAILED'
    : receipt.isConfirmed ? 'CONFIRMED' : 'PENDING';
  const statusColor = isVoided ? Colors.textMuted
    : isFailed ? Colors.danger
    : receipt.isConfirmed ? Colors.success : Colors.warning;
  const statusBg    = isVoided ? Colors.borderLight
    : isFailed ? Colors.dangerLight
    : receipt.isConfirmed ? Colors.successLight : Colors.warningLight;

  const s              = receipt.allocationSummary ?? {};
  const unapplied      = Number(s.unapplied ?? 0);
  const allocated      = Math.max(0, Number(receipt.amount || 0) - unapplied);
  const propName       = receipt.unit?.property?.propertyName ?? receipt.unit?.property?.name ?? '';
  const allocations    = receipt.allocations ?? [];
  const method         = PAYMENT_METHOD_LABEL[receipt.paymentMethod ?? ''] ?? receipt.paymentMethod ?? '—';

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
              <Text style={styles.confirmedText}>
                Receipt confirmed{receipt.confirmedAt ? ` on ${fmtDate(receipt.confirmedAt)}` : ''}
              </Text>
            </View>
          )}

          {isVoided && (
            <View style={styles.voidedBanner}>
              <Ionicons name="ban-outline" size={15} color={Colors.textMuted} />
              <Text style={styles.voidedText}>
                This receipt has been {receipt.isReversed ? 'reversed' : 'cancelled'}
                {receipt.reversalReason ? `: ${receipt.reversalReason}` : ''}
              </Text>
            </View>
          )}

          {isFailed && (
            <View style={styles.failedBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={Colors.danger} />
              <Text style={styles.failedText}>
                Ledger posting failed{receipt.postingError ? `: ${receipt.postingError}` : '.'} You can try confirming again.
              </Text>
            </View>
          )}

          {/* Hero */}
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.receiptNum}>
                  {receipt.receiptNumber || receipt.referenceNumber || '—'}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  disabled={!receipt.tenant?._id}
                  onPress={() => receipt.tenant?._id && router.push(`/pms/tenants/${receipt.tenant._id}` as never)}
                >
                  <Text style={[styles.tenantName, receipt.tenant?._id ? { color: Colors.primary } : null]}>
                    {receipt.tenant?.name ?? 'Unknown Tenant'}
                  </Text>
                </TouchableOpacity>
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
                <Text style={styles.amount}>KES {fmtMoney(receipt.amount)}</Text>
              </View>
            </View>
          </View>

          {/* Payment details */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>RECEIPT DETAILS</Text>
            <Row label="Reference No."  value={receipt.referenceNumber || '—'} />
            <Row label="Payment Method" value={method} />
            {receipt.paymentType ? <Row label="Applies To" value={TYPE_LABEL[receipt.paymentType] ?? receipt.paymentType} /> : null}
            <Row label="Payment Date"   value={fmtDate(receipt.paymentDate)} />
            {receipt.paidDirectToLandlord
              ? <Row label="Received By" value="Paid directly to landlord" />
              : receipt.cashbook ? <Row label="Cashbook" value={receipt.cashbook} /> : null}
            {receipt.description ? <Row label="Description" value={receipt.description} /> : null}
            <View style={styles.divider} />
            <Row label="Total Amount"  value={`KES ${fmtMoney(receipt.amount)}`} />
            <Row label="Allocated"     value={`KES ${fmtMoney(allocated)}`} valueColor={Colors.success} />
            {unapplied > 0.009 ? (
              <Row label="Unallocated" value={`KES ${fmtMoney(unapplied)}`} valueColor={Colors.warning} />
            ) : null}
          </View>

          {/* Applied invoices */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>APPLIED TO INVOICES</Text>
            {allocations.length === 0 ? (
              <View style={styles.emptySection}>
                <Ionicons name="link-outline" size={32} color={Colors.border} />
                <Text style={styles.emptySectionText}>
                  {unapplied > 0.009
                    ? 'Not yet allocated to any invoice'
                    : receipt.isConfirmed ? 'No allocation details available' : 'Allocation is worked out when the receipt is confirmed'}
                </Text>
              </View>
            ) : (
              allocations.map((alloc, i) => {
                const catLabel = alloc.category ? (INVOICE_CATEGORY_LABEL[alloc.category] ?? alloc.category) : '';
                const title = alloc.isPrepayment
                  ? (alloc.prepaymentLabel || 'Prepayment')
                  : [alloc.invoiceNumber, catLabel].filter(Boolean).join(' · ') || alloc.description || 'Invoice';
                return (
                  <View key={`${alloc.invoiceNumber ?? 'a'}-${i}`} style={styles.allocRow}>
                    <View style={styles.allocIcon}>
                      <Ionicons name={alloc.isPrepayment ? 'time-outline' : 'receipt-outline'} size={14} color={Colors.primary} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.allocInv}>{title}</Text>
                      {alloc.isPrepayment ? <Text style={styles.allocSub}>Held for future invoices</Text> : null}
                    </View>
                    <Text style={styles.allocAmt}>KES {fmtMoney(alloc.appliedAmount)}</Text>
                  </View>
                );
              })
            )}
            {unapplied > 0.009 && (
              <View style={styles.unappliedRow}>
                <Ionicons name="warning-outline" size={14} color={Colors.warning} />
                <Text style={styles.unappliedText}>
                  KES {fmtMoney(unapplied)} is not applied to an invoice — kept as a prepayment on the tenant account
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
  voidedText: { flex: 1, fontSize: 13, color: Colors.textMuted, fontWeight: '600' },

  failedBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.dangerLight,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  failedText: { flex: 1, fontSize: 12, color: Colors.danger, fontWeight: '600', lineHeight: 18 },

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
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  rowLabel: { fontSize: 13, color: Colors.textSecondary },
  rowValue: { fontSize: 13, fontWeight: '700', color: Colors.text, flexShrink: 1, textAlign: 'right' },
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
  allocSub: { fontSize: 11, color: Colors.textMuted },
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
