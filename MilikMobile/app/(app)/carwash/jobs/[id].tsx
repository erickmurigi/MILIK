import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, TextInput, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const CW  = '#1E3A8A';
const CWL = '#EEF2FF';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDT = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

type Job = {
  _id:            string;
  jobNumber?:     string;
  plateNumber:    string;
  vehicleType?:   string;
  serviceName?:   string;
  status:         string;
  paymentStatus?: string;
  price:          number;
  discountAmount?: number;
  amountPaid?:    number;
  notes?:         string;
  createdAt:      string;
  customerName?:  string;
  phone?:         string;
  assignedStaff?: { name?: string; phone?: string }[];
  serviceLines?:  { service?: { name?: string }; serviceName?: string; vehicleType?: string; price?: number }[];
};

const STATUS_FLOW = ['waiting', 'washing', 'done', 'paid'] as const;
const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  waiting:   { bg: '#FEF3C7', color: '#D97706', label: 'Waiting'   },
  washing:   { bg: '#DBEAFE', color: '#1D4ED8', label: 'Washing'   },
  done:      { bg: '#EDE9FE', color: '#7C3AED', label: 'Done'      },
  paid:      { bg: '#D1FAE5', color: '#065F46', label: 'Paid'      },
  cancelled: { bg: '#FEE2E2', color: '#DC2626', label: 'Cancelled' },
};

const PAYMENT_METHODS = ['cash', 'mpesa', 'bank', 'card', 'other'] as const;
type PayMethod = typeof PAYMENT_METHODS[number];
const PAY_ICONS: Record<PayMethod, string> = {
  cash: 'cash-outline', mpesa: 'phone-portrait-outline', bank: 'business-outline',
  card: 'card-outline', other: 'ellipsis-horizontal-outline',
};
const PAY_LABELS: Record<PayMethod, string> = {
  cash: 'Cash', mpesa: 'M-Pesa', bank: 'Bank', card: 'Card', other: 'Other',
};

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [job,        setJob]        = useState<Job | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating,   setUpdating]   = useState(false);

  const [payMethod,  setPayMethod]  = useState<PayMethod>('cash');
  const [payAmount,  setPayAmount]  = useState('');
  const [payRef,     setPayRef]     = useState('');
  const [paying,     setPaying]     = useState(false);

  const load = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const { data } = await api.get(`/carwash/jobs/${id}`);
      const j = data?.data ?? data;
      setJob(j);
      const netPrice = Math.max(0, Number(j?.price ?? 0) - Number(j?.discountAmount ?? 0));
      const bal      = netPrice - Number(j?.amountPaid ?? 0);
      if (bal > 0) setPayAmount(String(Math.round(bal * 100) / 100));
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, [id]);

  const advanceStatus = (next: string) => {
    const cfg = STATUS_CFG[next];
    Alert.alert(
      'Update Status',
      `Move job to "${cfg?.label ?? next}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setUpdating(true);
            try {
              await api.patch(`/carwash/jobs/${id}/status`, { status: next });
              await load(true);
            } catch (err: any) {
              Alert.alert('Error', err?.response?.data?.message ?? 'Failed to update.');
            } finally { setUpdating(false); }
          },
        },
      ]
    );
  };

  const cancelJob = () => {
    Alert.alert('Cancel Job', 'This action cannot be undone. Cancel this job?', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel Job', style: 'destructive', onPress: () => advanceStatus('cancelled') },
    ]);
  };

  const recordPayment = async () => {
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) { Alert.alert('Invalid', 'Enter a valid amount.'); return; }
    setPaying(true);
    try {
      await api.post('/carwash/payments', {
        job:       id,
        amount,
        method:    payMethod,
        reference: payRef.trim() || undefined,
      });
      setPayRef('');
      await load(true);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Payment failed.');
    } finally { setPaying(false); }
  };

  if (loading) return <MilikLoader fullscreen />;
  if (!job) return (
    <>
      <Stack.Screen options={{ title: 'Job' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#CBD5E1" />
          <Text style={styles.emptyText}>Job not found</Text>
        </View>
      </SafeAreaView>
    </>
  );

  const sc          = STATUS_CFG[job.status] ?? STATUS_CFG.cancelled;
  const netPrice    = Math.max(0, Number(job.price ?? 0) - Number(job.discountAmount ?? 0));
  const amountPaid  = Number(job.amountPaid ?? 0);
  const balance     = netPrice - amountPaid;
  const isPaid      = job.paymentStatus === 'paid' || balance <= 0.01;
  const isCancelled = job.status === 'cancelled';
  const currentIdx  = STATUS_FLOW.indexOf(job.status as any);

  const svcList = (job.serviceLines ?? []).map(s => ({
    name:  s.serviceName || s.service?.name || '—',
    price: Number(s.price ?? 0),
  }));
  const svcTotal = svcList.reduce((sum, s) => sum + s.price, 0);

  const payAmtNum = parseFloat(payAmount || '0') || 0;

  return (
    <>
      <Stack.Screen options={{ title: `${job.plateNumber || '—'}${job.jobNumber ? '  ·  #' + job.jobNumber : ''}` }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={CW} />}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Navy hero ── */}
          <View style={styles.heroCard}>
            {/* Plate + status row */}
            <View style={styles.heroTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.plateTxt}>{job.plateNumber || '—'}</Text>
                {job.vehicleType ? <Text style={styles.vehicleTxt}>{job.vehicleType}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 8 }}>
                <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.statusPillTxt, { color: sc.color }]}>{sc.label.toUpperCase()}</Text>
                </View>
                {job.jobNumber ? <Text style={styles.jobNumTxt}>Job #{job.jobNumber}</Text> : null}
              </View>
            </View>

            {/* Customer */}
            {(job.customerName || job.phone) ? (
              <View style={styles.heroDivider} />
            ) : null}
            {job.customerName ? <Text style={styles.customerTxt}>{job.customerName}</Text> : null}
            {job.phone ? (
              <TouchableOpacity
                style={styles.phoneRow}
                onPress={() => Linking.openURL(`tel:${job.phone}`)}
                activeOpacity={0.75}
              >
                <Ionicons name="call-outline" size={13} color="rgba(255,255,255,0.65)" />
                <Text style={styles.phoneTxt}>{job.phone}</Text>
              </TouchableOpacity>
            ) : null}

            {/* Footer row: staff + date */}
            <View style={styles.heroFooterRow}>
              {job.assignedStaff?.length ? (
                <View style={styles.heroMeta}>
                  <Ionicons name="person-outline" size={11} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.heroMetaTxt} numberOfLines={1}>
                    {job.assignedStaff.map(s => s.name).filter(Boolean).join(', ')}
                  </Text>
                </View>
              ) : <View />}
              <Text style={styles.heroMetaTxt}>{fmtDT(job.createdAt)}</Text>
            </View>

            {/* Notes */}
            {job.notes ? (
              <View style={styles.notesBox}>
                <Ionicons name="document-text-outline" size={12} color="rgba(255,255,255,0.55)" />
                <Text style={styles.notesTxt} numberOfLines={3}>{job.notes}</Text>
              </View>
            ) : null}
          </View>

          {/* ── Status stepper ── */}
          {!isCancelled && (
            <View style={styles.stepperCard}>
              {updating ? (
                <ActivityIndicator color={CW} style={{ paddingVertical: 4 }} />
              ) : (
                <>
                  <View style={styles.stepper}>
                    {STATUS_FLOW.map((s, i) => {
                      const isPast   = i < currentIdx;
                      const isCurr   = i === currentIdx;
                      const isFuture = i > currentIdx;
                      const cfg      = STATUS_CFG[s];
                      return (
                        <View key={s} style={styles.stepCol}>
                          {i > 0 && (
                            <View style={[styles.stepLineL, { backgroundColor: (isPast || isCurr) ? CW : '#E2E8F0' }]} />
                          )}
                          {i < STATUS_FLOW.length - 1 && (
                            <View style={[styles.stepLineR, { backgroundColor: isPast ? CW : '#E2E8F0' }]} />
                          )}
                          <TouchableOpacity
                            style={[
                              styles.stepCircle,
                              isPast   && { backgroundColor: CW,        borderColor: CW         },
                              isCurr   && { backgroundColor: cfg.color, borderColor: cfg.color  },
                              isFuture && { backgroundColor: '#fff',    borderColor: '#E2E8F0'  },
                            ]}
                            onPress={() => isFuture && advanceStatus(s)}
                            disabled={isCurr || isPast}
                            activeOpacity={0.7}
                          >
                            {isPast  && <Ionicons name="checkmark" size={14} color="#fff" />}
                            {isCurr  && <View style={[styles.stepDot, { backgroundColor: '#fff' }]} />}
                          </TouchableOpacity>
                          <Text style={[styles.stepLbl, isCurr && { color: cfg.color, fontWeight: '700' }]}>
                            {cfg.label}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  {currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1 && (
                    <Text style={styles.stepHint}>Tap a future step to advance</Text>
                  )}
                </>
              )}
            </View>
          )}

          {/* ── Financials ── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>FINANCIALS</Text>
            <View style={styles.finRow}>
              <View style={styles.finStat}>
                <Text style={styles.finLabel}>TOTAL</Text>
                <Text style={styles.finValue}>{fmt(netPrice)}</Text>
              </View>
              <View style={[styles.finStat, styles.finBorder]}>
                <Text style={styles.finLabel}>PAID</Text>
                <Text style={[styles.finValue, { color: amountPaid > 0 ? '#065F46' : '#94A3B8' }]}>
                  {fmt(amountPaid)}
                </Text>
              </View>
              <View style={styles.finStat}>
                <Text style={styles.finLabel}>BALANCE</Text>
                <Text style={[styles.finValue, { color: balance > 0 ? '#DC2626' : '#065F46' }]}>
                  {balance > 0 ? fmt(balance) : 'Paid ✓'}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Services ── */}
          {svcList.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>SERVICES ({svcList.length})</Text>
              {svcList.map((s, i) => (
                <View key={i} style={[styles.svcRow, i === svcList.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={styles.svcName}>{s.name}</Text>
                  <Text style={styles.svcPrice}>{fmt(s.price)}</Text>
                </View>
              ))}
              {svcList.length > 1 && (
                <View style={styles.svcTotalRow}>
                  <Text style={styles.svcTotalLabel}>Total</Text>
                  <Text style={styles.svcTotalValue}>{fmt(svcTotal)}</Text>
                </View>
              )}
            </View>
          )}

          {/* ── Record payment ── */}
          {!isPaid && !isCancelled && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>RECORD PAYMENT</Text>
              <View style={styles.payForm}>
                {/* Method pills */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                  {PAYMENT_METHODS.map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.methodChip, payMethod === m && styles.methodChipActive]}
                      onPress={() => setPayMethod(m)}
                    >
                      <Ionicons name={PAY_ICONS[m] as any} size={13} color={payMethod === m ? '#fff' : '#64748B'} />
                      <Text style={[styles.methodChipText, payMethod === m && styles.methodChipTextActive]}>
                        {PAY_LABELS[m]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={styles.payAmountWrap}>
                  <Text style={styles.payAmountPrefix}>KES</Text>
                  <TextInput
                    style={styles.payAmountInput}
                    placeholder="0.00"
                    placeholderTextColor="#CBD5E1"
                    value={payAmount}
                    onChangeText={setPayAmount}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                  />
                  {balance > 0 && (
                    <TouchableOpacity
                      style={styles.payFullBtn}
                      onPress={() => setPayAmount(String(Math.round(balance * 100) / 100))}
                    >
                      <Text style={styles.payFullBtnTxt}>Full</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {payMethod === 'mpesa' && (
                  <TextInput
                    style={styles.payInput}
                    placeholder="M-Pesa reference (optional)"
                    placeholderTextColor="#94A3B8"
                    value={payRef}
                    onChangeText={setPayRef}
                  />
                )}

                <TouchableOpacity
                  style={[styles.payBtn, paying && { opacity: 0.6 }]}
                  onPress={recordPayment}
                  disabled={paying}
                >
                  {paying ? <ActivityIndicator color="#fff" size="small" /> : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                      <Text style={styles.payBtnText}>
                        Record {payAmtNum > 0 ? `KES ${payAmtNum.toLocaleString('en-KE')}` : 'Payment'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Cancel job ── */}
          {!isCancelled && job.status !== 'paid' && (
            <TouchableOpacity style={styles.dangerBtn} onPress={cancelJob}>
              <Ionicons name="close-circle-outline" size={16} color="#DC2626" />
              <Text style={styles.dangerBtnTxt}>Cancel Job</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#F0F4FF' },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: '#94A3B8' },
  scroll:    { padding: 16, gap: 12, paddingBottom: 52 },

  /* Hero */
  heroCard:    { backgroundColor: CW, borderRadius: 20, padding: 18, gap: 8 },
  heroTopRow:  { flexDirection: 'row', alignItems: 'flex-start' },
  plateTxt:    { fontSize: 30, fontWeight: '900', color: '#fff', letterSpacing: 1.5 },
  vehicleTxt:  { fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 3, fontWeight: '500' },
  statusPill:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusPillTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  jobNumTxt:   { fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: '600' },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 2 },
  customerTxt: { fontSize: 17, fontWeight: '700', color: '#fff' },
  phoneRow:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  phoneTxt:    { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  heroFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  heroMeta:    { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  heroMetaTxt: { fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
  notesBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 8, padding: 10, marginTop: 4 },
  notesTxt:    { fontSize: 12, color: 'rgba(255,255,255,0.65)', flex: 1, lineHeight: 18 },

  /* Stepper */
  stepperCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 16, alignItems: 'center', gap: 0 },
  stepper:     { flexDirection: 'row', width: '100%' },
  stepCol:     { flex: 1, alignItems: 'center', position: 'relative' },
  stepLineL:   { position: 'absolute', left: 0, right: '50%', top: 13, height: 2, zIndex: 0 },
  stepLineR:   { position: 'absolute', left: '50%', right: 0, top: 13, height: 2, zIndex: 0 },
  stepCircle:  { width: 26, height: 26, borderRadius: 13, zIndex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  stepDot:     { width: 8, height: 8, borderRadius: 4 },
  stepLbl:     { fontSize: 10, fontWeight: '600', color: '#94A3B8', marginTop: 5, textAlign: 'center' },
  stepHint:    { fontSize: 11, color: '#CBD5E1', marginTop: 10 },

  /* Cards */
  card:      { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16 },
  cardTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: '#94A3B8', marginBottom: 12 },

  finRow:    { flexDirection: 'row' },
  finStat:   { flex: 1, alignItems: 'center', gap: 4 },
  finBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#E2E8F0' },
  finLabel:  { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: '#94A3B8' },
  finValue:  { fontSize: 16, fontWeight: '900', color: '#0F172A' },

  svcRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  svcName:      { fontSize: 14, color: '#0F172A', fontWeight: '600', flex: 1 },
  svcPrice:     { fontSize: 14, fontWeight: '800', color: CW },
  svcTotalRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, marginTop: 2, borderTopWidth: 1.5, borderTopColor: '#E2E8F0' },
  svcTotalLabel: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  svcTotalValue: { fontSize: 15, fontWeight: '900', color: CW },

  /* Payment */
  payForm:    { gap: 12, marginTop: 2 },
  methodChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  methodChipActive:    { backgroundColor: CW, borderColor: CW },
  methodChipText:      { fontSize: 12, fontWeight: '700', color: '#475569' },
  methodChipTextActive:{ color: '#fff' },

  payAmountWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 14, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, paddingVertical: 4 },
  payAmountPrefix: { fontSize: 16, fontWeight: '700', color: '#94A3B8', marginRight: 6 },
  payAmountInput: { flex: 1, fontSize: 24, fontWeight: '800', color: '#0F172A', paddingVertical: 10 },
  payFullBtn: { backgroundColor: CWL, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  payFullBtnTxt: { fontSize: 12, fontWeight: '800', color: CW },

  payInput: { backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#0F172A' },
  payBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#065F46', borderRadius: 14, paddingVertical: 16 },
  payBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  dangerBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FFF5F5' },
  dangerBtnTxt: { fontSize: 14, fontWeight: '700', color: '#DC2626' },
});
