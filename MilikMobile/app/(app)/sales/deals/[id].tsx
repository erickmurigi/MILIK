import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, TextInput, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const SC = '#7C2D12';

type ScheduleItem = {
  _id:             string;
  dueDate:         string;
  amount:          number;
  description?:    string;
  isPaid:          boolean;
  linkedPayment?:  string;
};

type Payment = {
  _id:          string;
  paymentDate:  string;
  amount:       number;
  paymentType:  string;
  paymentMethod:string;
  reference?:   string;
  notes?:       string;
  isVoided?:    boolean;
};

type Deal = {
  _id:                  string;
  dealNumber?:          string;
  listing?:             { title?: string; propertyName?: string } | string;
  buyer?:               { fullName?: string; phone?: string; email?: string } | string;
  agent?:               { name?: string } | string;
  agreedPrice:          number;
  totalPaid?:           number;
  balance?:             number;
  status:               string;
  dealDate?:            string;
  expectedClosingDate?: string;
  notes?:               string;
  schedule?:            ScheduleItem[];
  payments?:            Payment[];
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  active:    { bg: '#FEF3C7', color: '#92400E', label: 'Active'    },
  closed:    { bg: '#D1FAE5', color: '#065F46', label: 'Closed'    },
  cancelled: { bg: '#F1F5F9', color: '#64748B', label: 'Cancelled' },
};

const PAYMENT_TYPES   = ['deposit', 'installment', 'final_payment', 'other'];
const PAYMENT_METHODS = ['cash', 'mpesa', 'bank_transfer', 'cheque', 'other'];

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const cap = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const getListingName = (l: Deal['listing']) =>
  typeof l === 'object' ? (l?.title ?? l?.propertyName ?? '—') : (l ?? '—');

const getBuyerName = (b: Deal['buyer']) =>
  typeof b === 'object' ? (b?.fullName ?? '—') : (b ?? '—');

const getBuyerPhone = (b: Deal['buyer']) =>
  typeof b === 'object' ? (b?.phone ?? null) : null;

const getAgentName = (a: Deal['agent']) =>
  typeof a === 'object' ? (a?.name ?? '—') : (a ?? '—');

export default function DealDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();

  const [deal,      setDeal]      = useState<Deal | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [payModal,  setPayModal]  = useState(false);
  const [savingPay, setSavingPay] = useState(false);
  const [tab,       setTab]       = useState<'schedule' | 'payments'>('schedule');

  // Payment form
  const [payAmount,  setPayAmount]  = useState('');
  const [payType,    setPayType]    = useState('installment');
  const [payMethod,  setPayMethod]  = useState('bank_transfer');
  const [payDate,    setPayDate]    = useState(todayStr());
  const [payRef,     setPayRef]     = useState('');
  const [payNotes,   setPayNotes]   = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/sale/deals/${id}`, { params: { includeSchedule: true, includePayments: true } });
      setDeal(data?.data ?? data);
    } catch { Alert.alert('Error', 'Could not load deal.'); router.back(); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const recordPayment = async () => {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { Alert.alert('Required', 'Enter a valid amount.'); return; }
    setSavingPay(true);
    try {
      await api.post('/sale/payments', {
        deal:          id,
        amount:        amt,
        paymentType:   payType,
        paymentMethod: payMethod,
        paymentDate:   payDate,
        reference:     payRef.trim() || undefined,
        notes:         payNotes.trim() || undefined,
      });
      setPayModal(false);
      setPayAmount(''); setPayRef(''); setPayNotes('');
      await load();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to record payment.');
    } finally { setSavingPay(false); }
  };

  if (loading) return <MilikLoader fullscreen />;
  if (!deal)   return null;

  const sc      = STATUS_CFG[deal.status] ?? STATUS_CFG.active;
  const paid    = deal.totalPaid ?? 0;
  const balance = deal.balance ?? (deal.agreedPrice - paid);
  const pct     = deal.agreedPrice > 0 ? Math.min(100, (paid / deal.agreedPrice) * 100) : 0;
  const schedule = deal.schedule ?? [];
  const payments = deal.payments ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              {deal.dealNumber && <Text style={styles.heroNum}>{deal.dealNumber}</Text>}
              <Text style={styles.heroListing} numberOfLines={2}>{getListingName(deal.listing)}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: sc.color + '25' }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
          </View>

          <Text style={styles.heroPrice}>{fmt(deal.agreedPrice)}</Text>

          {/* Progress */}
          <View style={styles.progressWrap}>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
            </View>
            <Text style={styles.progressTxt}>{pct.toFixed(0)}%</Text>
          </View>

          <View style={styles.heroAmounts}>
            <View style={styles.heroAmt}>
              <Text style={styles.heroAmtVal}>{fmt(paid)}</Text>
              <Text style={styles.heroAmtLbl}>Collected</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroAmt}>
              <Text style={[styles.heroAmtVal, { color: balance > 0 ? '#FCA5A5' : '#6EE7B7' }]}>{fmt(balance)}</Text>
              <Text style={styles.heroAmtLbl}>Balance</Text>
            </View>
          </View>
        </View>

        {/* Parties */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>PARTIES</Text>
          <InfoRow icon="person-outline"      label="Buyer"  value={getBuyerName(deal.buyer)} />
          {getBuyerPhone(deal.buyer) && (
            <InfoRow icon="call-outline"      label="Phone"  value={getBuyerPhone(deal.buyer)!} />
          )}
          <InfoRow icon="briefcase-outline"   label="Agent"  value={getAgentName(deal.agent)} />
          {deal.dealDate && (
            <InfoRow icon="calendar-outline"  label="Deal Date" value={fmtDate(deal.dealDate)} />
          )}
          {deal.expectedClosingDate && (
            <InfoRow icon="flag-outline"      label="Expected Close" value={fmtDate(deal.expectedClosingDate)} />
          )}
          {deal.notes && (
            <InfoRow icon="document-text-outline" label="Notes" value={deal.notes} />
          )}
        </View>

        {/* Schedule / Payments tabs */}
        <View style={styles.card}>
          <View style={styles.tabsInline}>
            <TouchableOpacity
              style={[styles.tabInline, tab === 'schedule' && styles.tabInlineActive]}
              onPress={() => setTab('schedule')}
            >
              <Text style={[styles.tabInlineTxt, tab === 'schedule' && styles.tabInlineTxtActive]}>
                Schedule ({schedule.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabInline, tab === 'payments' && styles.tabInlineActive]}
              onPress={() => setTab('payments')}
            >
              <Text style={[styles.tabInlineTxt, tab === 'payments' && styles.tabInlineTxtActive]}>
                Payments ({payments.length})
              </Text>
            </TouchableOpacity>
          </View>

          {tab === 'schedule' && (
            schedule.length === 0
              ? <Text style={styles.emptyTxt}>No installment schedule set.</Text>
              : schedule.map((s, i) => {
                  const overdue = !s.isPaid && new Date(s.dueDate) < new Date();
                  return (
                    <View key={s._id} style={[styles.schedRow, i % 2 === 1 && { backgroundColor: '#F8FAFC' }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.schedDate}>{fmtDate(s.dueDate)}</Text>
                        {s.description && <Text style={styles.schedDesc}>{s.description}</Text>}
                      </View>
                      <Text style={styles.schedAmt}>{fmt(s.amount)}</Text>
                      <View style={[styles.schedBadge, {
                        backgroundColor: s.isPaid ? '#D1FAE5' : overdue ? '#FEE2E2' : '#F1F5F9',
                      }]}>
                        <Text style={[styles.schedBadgeTxt, {
                          color: s.isPaid ? '#065F46' : overdue ? '#DC2626' : '#64748B',
                        }]}>
                          {s.isPaid ? 'Paid' : overdue ? 'Overdue' : 'Pending'}
                        </Text>
                      </View>
                    </View>
                  );
                })
          )}

          {tab === 'payments' && (
            payments.length === 0
              ? <Text style={styles.emptyTxt}>No payments recorded yet.</Text>
              : payments.filter(p => !p.isVoided).map((p, i) => (
                  <View key={p._id} style={[styles.payRow, i % 2 === 1 && { backgroundColor: '#F8FAFC' }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.payDate}>{fmtDate(p.paymentDate)}</Text>
                      <View style={styles.payTags}>
                        <View style={styles.pill}><Text style={styles.pillTxt}>{cap(p.paymentType)}</Text></View>
                        <View style={styles.pill}><Text style={styles.pillTxt}>{cap(p.paymentMethod)}</Text></View>
                      </View>
                      {p.reference && <Text style={styles.payRef}>Ref: {p.reference}</Text>}
                    </View>
                    <Text style={styles.payAmt}>{fmt(p.amount)}</Text>
                  </View>
                ))
          )}
        </View>
      </ScrollView>

      {/* Action bar */}
      {deal.status === 'active' && (
        <View style={styles.actionsWrap}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: SC }]} onPress={() => setPayModal(true)}>
            <Ionicons name="cash-outline" size={18} color="#fff" />
            <Text style={styles.actionTxt}>Record Payment</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Payment Modal */}
      <Modal visible={payModal} animationType="slide" transparent onRequestClose={() => setPayModal(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
          activeOpacity={1}
          onPress={() => setPayModal(false)}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.paySheet}>
            <Text style={styles.paySheetTitle}>Record Payment</Text>

            <Text style={styles.label}>Amount (KES) *</Text>
            <TextInput style={[styles.input, { marginBottom: 12 }]} value={payAmount}
              onChangeText={setPayAmount} placeholder="0.00" placeholderTextColor="#94A3B8"
              keyboardType="decimal-pad" />

            <Text style={styles.label}>Payment Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {PAYMENT_TYPES.map(t => (
                  <TouchableOpacity key={t} style={[styles.chip, payType === t && styles.chipActive]} onPress={() => setPayType(t)}>
                    <Text style={[styles.chipTxt, payType === t && styles.chipTxtActive]}>{cap(t)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.label}>Payment Method</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {PAYMENT_METHODS.map(m => (
                  <TouchableOpacity key={m} style={[styles.chip, payMethod === m && styles.chipActive]} onPress={() => setPayMethod(m)}>
                    <Text style={[styles.chipTxt, payMethod === m && styles.chipTxtActive]}>{cap(m)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Date</Text>
                <TextInput style={[styles.input, { marginBottom: 12 }]} value={payDate}
                  onChangeText={setPayDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94A3B8" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Reference</Text>
                <TextInput style={[styles.input, { marginBottom: 12 }]} value={payRef}
                  onChangeText={setPayRef} placeholder="Ref / Cheque no." placeholderTextColor="#94A3B8" />
              </View>
            </View>

            <Text style={styles.label}>Notes</Text>
            <TextInput style={[styles.input, styles.textarea, { marginBottom: 16 }]}
              value={payNotes} onChangeText={setPayNotes}
              placeholder="Optional notes..." placeholderTextColor="#94A3B8"
              multiline numberOfLines={2} textAlignVertical="top" />

            <TouchableOpacity
              style={[styles.submitBtn, savingPay && { opacity: 0.6 }]}
              onPress={recordPayment}
              disabled={savingPay}
            >
              {savingPay ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="cash-outline" size={18} color="#fff" />
                  <Text style={styles.submitTxt}>Save Payment</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon as any} size={14} color="#94A3B8" style={{ marginTop: 1 }} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={3}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FFF7ED' },
  scroll: { padding: 16, gap: 14, paddingBottom: 16 },

  hero: {
    backgroundColor: SC, borderRadius: 18, padding: 20, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  heroTop:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  heroNum:     { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.8, marginBottom: 2 },
  heroListing: { fontSize: 19, fontWeight: '900', color: '#fff' },
  badge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  badgeTxt:    { fontSize: 11, fontWeight: '800' },
  heroPrice:   { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },

  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressBg:   { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#fff', borderRadius: 3 },
  progressTxt:  { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.7)', width: 32, textAlign: 'right' },

  heroAmounts: { flexDirection: 'row', alignItems: 'center' },
  heroDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 20 },
  heroAmt:     { flex: 1 },
  heroAmtVal:  { fontSize: 15, fontWeight: '900', color: '#fff' },
  heroAmtLbl:  { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 2 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1,
    borderColor: '#E2E8F0', padding: 16, gap: 10,
  },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  infoRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontSize: 12, color: '#94A3B8', width: 90 },
  infoValue: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },

  tabsInline: { flexDirection: 'row', gap: 0, borderRadius: 10, overflow: 'hidden', backgroundColor: '#F1F5F9', padding: 3 },
  tabInline:        { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8 },
  tabInlineActive:  { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  tabInlineTxt:     { fontSize: 12, fontWeight: '600', color: '#94A3B8' },
  tabInlineTxtActive:{ color: '#0F172A', fontWeight: '800' },

  emptyTxt: { fontSize: 13, color: '#94A3B8', textAlign: 'center', paddingVertical: 12 },

  schedRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderRadius: 6, paddingHorizontal: 4 },
  schedDate:    { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  schedDesc:    { fontSize: 11, color: '#94A3B8' },
  schedAmt:     { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  schedBadge:   { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  schedBadgeTxt:{ fontSize: 10, fontWeight: '700' },

  payRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderRadius: 6, paddingHorizontal: 4 },
  payDate: { fontSize: 12, fontWeight: '700', color: '#0F172A' },
  payTags: { flexDirection: 'row', gap: 6, marginTop: 4 },
  pill:    { backgroundColor: '#F1F5F9', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  pillTxt: { fontSize: 10, fontWeight: '600', color: '#64748B' },
  payRef:  { fontSize: 11, color: '#94A3B8', marginTop: 3 },
  payAmt:  { fontSize: 14, fontWeight: '900', color: '#065F46', marginTop: 2 },

  actionsWrap: {
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
    backgroundColor: '#fff', padding: 16,
    flexDirection: 'row', gap: 10,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, paddingVertical: 14,
  },
  actionTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },

  paySheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36,
  },
  paySheetTitle: { fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 16 },
  label:  { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 },
  input: {
    backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0',
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A',
  },
  textarea: { minHeight: 64, paddingTop: 11 },
  row2:   { flexDirection: 'row', gap: 10 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E2E8F0',
  },
  chipActive:    { backgroundColor: SC + '15', borderColor: SC },
  chipTxt:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipTxtActive: { color: SC, fontWeight: '700' },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: SC, borderRadius: 14, paddingVertical: 14,
  },
  submitTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
