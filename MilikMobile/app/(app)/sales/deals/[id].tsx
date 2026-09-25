import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, TextInput, Modal, Linking,
  KeyboardAvoidingView, Platform, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { DateField } from '../../../../components/ui/DateField';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useSaleSettings } from '../../../../hooks/useSaleSettings';
import { cleanDecimal, fmtDate, fmtKES, fmtMoney, todayISO } from '../../../../utils/pmsFormat';
import { preferredCashbook, round2, type Cashbook } from '../../../../utils/carwash';
import {
  DEAL_STATUS_STYLE, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, PAYMENT_TYPES,
  SBG, SC, dealBalance, dealPct, humanize, refName, saleError,
} from '../../../../utils/sales';

type ScheduleItem = {
  _id:               string;
  installmentNumber: number;
  dueDate:           string;
  expectedAmount:    number;
  description?:      string;
  status:            'upcoming' | 'overdue' | 'paid' | 'waived';
};

type Payment = {
  _id:           string;
  paymentNumber?: string;
  paymentDate:   string;
  amount:        number;
  paymentType:   string;
  paymentMethod: string;
  reference?:    string;
  notes?:        string;
  status:        'paid' | 'pending' | 'cancelled';
};

type Deal = {
  _id:                  string;
  dealNumber?:          string;
  listing?:             { title?: string; listingNumber?: string; location?: string; town?: string };
  buyer?:               { fullName?: string; buyerNumber?: string; phone?: string; email?: string };
  agent?:               { fullName?: string; phone?: string };
  agreedPrice:          number;
  totalPaid?:           number;
  balance?:             number;
  status:               string;
  dealDate?:            string;
  expectedClosingDate?: string;
  actualClosingDate?:   string;
  notes?:               string;
};

// Same asset-account test the web uses to decide which accounts are cashbooks.
const CASHBOOK_RE = /cash|bank|m-?pesa|mobile money|wallet|petty|till|collection/i;
const isCashbook = (a: Record<string, any>) =>
  !a?.isHeader && a?.isPosting !== false && !a?.isControl &&
  CASHBOOK_RE.test(`${a?.name || ''} ${a?.group || ''} ${a?.subGroup || ''}`);

// preferredCashbook (shared with Car Wash) knows cash / mpesa / bank
const CASHBOOK_METHOD: Record<string, string> = { cash: 'cash', mpesa: 'mpesa', bank_transfer: 'bank', cheque: 'bank', other: 'other' };

const REF_LABEL: Record<string, { label: string; hint: string }> = {
  mpesa:         { label: 'M-Pesa transaction code', hint: 'e.g. QJ1X23ABC4D' },
  cheque:        { label: 'Cheque number',           hint: 'Cheque no.' },
  bank_transfer: { label: 'EFT / reference no.',     hint: 'e.g. RTGS/001/2026' },
};

const SCHEDULE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  paid:     { bg: '#D1FAE5', color: '#065F46', label: 'Paid'     },
  waived:   { bg: '#E0E7FF', color: '#4338CA', label: 'Waived'   },
  overdue:  { bg: '#FEE2E2', color: '#DC2626', label: 'Overdue'  },
  upcoming: { bg: '#F1F5F9', color: '#64748B', label: 'Upcoming' },
};

export default function DealDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { height } = useWindowDimensions();
  const { terms: T } = useSaleSettings();

  const [deal,       setDeal]       = useState<Deal | null>(null);
  const [schedule,   setSchedule]   = useState<ScheduleItem[]>([]);
  const [payments,   setPayments]   = useState<Payment[]>([]);
  const [scheduleErr, setScheduleErr] = useState<string | null>(null);
  const [paymentsErr, setPaymentsErr] = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [tab,        setTab]        = useState<'schedule' | 'payments'>('schedule');
  const [closing,    setClosing]    = useState(false);
  const reqRef = useRef(0);

  // Payment form
  const [payModal,  setPayModal]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const savingRef = useRef(false);
  const [payAmount, setPayAmount] = useState('');
  const [payType,   setPayType]   = useState<string>('installment');
  const [payMethod, setPayMethod] = useState<string>('bank_transfer');
  const [payDate,   setPayDate]   = useState(todayISO());
  const [payRef,    setPayRef]    = useState('');
  const [payNotes,  setPayNotes]  = useState('');
  const [cashbooks, setCashbooks] = useState<Cashbook[]>([]);
  const [cashbookId, setCashbookId] = useState('');
  const [cashbooksLoading, setCashbooksLoading] = useState(false);
  const [cashbooksErr, setCashbooksErr] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    const rid = ++reqRef.current;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    // The deal is the page; the schedule / payments are separate endpoints with their own permissions.
    const [d, s, p] = await Promise.allSettled([
      api.get(`/sale/deals/${id}`),
      api.get('/sale/schedule', { params: { dealId: id } }),
      api.get('/sale/payments', { params: { deal: id, limit: 200 } }),
    ]);
    if (rid !== reqRef.current) return;

    if (d.status === 'fulfilled') { setDeal(d.value.data); setError(null); }
    else setError(saleError(d.reason, 'Could not load this deal.'));

    if (s.status === 'fulfilled') { setSchedule(Array.isArray(s.value.data?.data) ? s.value.data.data : []); setScheduleErr(null); }
    else setScheduleErr(saleError(s.reason, 'Could not load the instalment schedule.'));

    if (p.status === 'fulfilled') { setPayments(Array.isArray(p.value.data?.data) ? p.value.data.data : []); setPaymentsErr(null); }
    else setPaymentsErr(saleError(p.reason, 'Could not load the payments.'));

    setLoading(false);
    setRefreshing(false);
  }, [id]);

  useEffect(() => { load('initial'); }, [load]);

  const loadCashbooks = useCallback(async () => {
    setCashbooksLoading(true);
    setCashbooksErr(null);
    try {
      const { data } = await api.get('/chart-of-accounts', { params: { type: 'asset' } });
      const rows: Record<string, any>[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      setCashbooks(rows.filter(isCashbook).map(a => ({
        _id: String(a._id), code: a.code, name: String(a.name ?? a.accountName ?? ''), subGroup: a.subGroup,
      })));
    } catch (e) {
      setCashbooksErr(saleError(e, 'Could not load the cashbook accounts.'));
    } finally { setCashbooksLoading(false); }
  }, []);

  // Keep a valid cashbook selected: the method's own default, or whatever the cashier picked if still in the list
  useEffect(() => {
    if (!cashbooks.length) { setCashbookId(''); return; }
    setCashbookId(cur => (cur && cashbooks.some(c => c._id === cur) ? cur : preferredCashbook(cashbooks, CASHBOOK_METHOD[payMethod] || 'other', {})));
  }, [cashbooks, payMethod]);

  const balance = useMemo(() => dealBalance(deal), [deal]);

  // Follow the method's own cashbook (M-Pesa -> the M-Pesa account ...); "other" keeps whatever was picked
  const changeMethod = (m: string) => {
    setPayMethod(m);
    if (m !== 'other' && cashbooks.length) setCashbookId(cur => preferredCashbook(cashbooks, CASHBOOK_METHOD[m] || 'other', {}) || cur);
  };

  const openPayment = () => {
    setPayAmount(''); setPayRef(''); setPayNotes('');
    setPayType(payments.some(p => p.status === 'paid') ? 'installment' : 'deposit');
    setPayMethod('bank_transfer'); setPayDate(todayISO());
    setPayModal(true);
    if (!cashbooks.length) loadCashbooks();
  };

  const recordPayment = () => {
    if (savingRef.current || !deal) return;
    const amt = round2(parseFloat(payAmount));
    if (!Number.isFinite(amt) || amt <= 0) { Alert.alert('Amount needed', 'Enter the amount received.'); return; }
    if (amt > balance + 0.01) {
      Alert.alert('Too much', `The balance on this ${T.saleDeal.toLowerCase()} is ${fmtKES(balance)}. A payment cannot be more than that.`);
      return;
    }
    if (cashbooks.length > 0 && !cashbookId) { Alert.alert('Cashbook needed', 'Choose the cashbook this payment goes into.'); return; }
    const cb = cashbooks.find(c => c._id === cashbookId);

    Alert.alert(
      'Record payment?',
      `${fmtKES(amt)} ${humanize(payType).toLowerCase()} by ${PAYMENT_METHOD_LABEL[payMethod] || payMethod}` +
      `${cb ? ` into ${cb.name}` : ''}, dated ${fmtDate(payDate)}.\n\nThis posts to the accounts.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Record',
          onPress: async () => {
            if (savingRef.current) return;
            savingRef.current = true; setSaving(true);
            try {
              await api.post('/sale/payments', {
                deal:          id,
                amount:        amt,
                paymentType:   payType,
                paymentMethod: payMethod,
                paymentDate:   payDate,
                cashbook:      cashbookId || undefined,
                reference:     payRef.trim() || undefined,
                notes:         payNotes.trim() || undefined,
              });
              setPayModal(false);
              setTab('payments');
              await load('silent');
            } catch (err) {
              Alert.alert('Payment not recorded', saleError(err, 'Failed to record the payment.'));
            } finally { savingRef.current = false; setSaving(false); }
          },
        },
      ],
    );
  };

  const closeDeal = () => {
    if (!deal || closing) return;
    Alert.alert(
      `Close ${T.saleDeal.toLowerCase()}?`,
      `${deal.dealNumber || 'This'} is fully paid. Closing marks the ${T.saleListing.toLowerCase()} as sold, approves the ${T.saleAgent.toLowerCase()}'s commission and posts to the accounts. This cannot be undone here.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          onPress: async () => {
            setClosing(true);
            try {
              await api.patch(`/sale/deals/${id}/close`, {});
              await load('silent');
            } catch (err) {
              Alert.alert('Could not close', saleError(err, `Failed to close the ${T.saleDeal.toLowerCase()}.`));
            } finally { setClosing(false); }
          },
        },
      ],
    );
  };

  if (loading && !deal) return <MilikLoader fullscreen />;
  if (!deal) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ErrorState message={error || `Could not load this ${T.saleDeal.toLowerCase()}.`} onRetry={() => load('initial')} />
      </SafeAreaView>
    );
  }

  const sc     = DEAL_STATUS_STYLE[deal.status] ?? DEAL_STATUS_STYLE.active;
  const paid   = Number(deal.totalPaid || 0);
  const pct    = dealPct(deal);
  const phone  = deal.buyer?.phone;
  const isActive = deal.status === 'active';
  const refCfg = REF_LABEL[payMethod] ?? { label: 'Reference', hint: 'Optional' };
  const locationText = [deal.listing?.location, deal.listing?.town].filter(Boolean).join(', ');

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={SC} />}
      >
        {/* a refresh that failed keeps the old data on screen, so say so */}
        {error ? <View style={{ marginHorizontal: -16 }}><ErrorBanner message={error} onRetry={() => load('refresh')} /></View> : null}

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              {deal.dealNumber ? <Text style={styles.heroNum}>{deal.dealNumber}</Text> : null}
              <Text style={styles.heroListing} numberOfLines={2}>{refName(deal.listing, 'title', 'listingNumber') || '—'}</Text>
              {locationText ? <Text style={styles.heroLoc} numberOfLines={1}>{locationText}</Text> : null}
            </View>
            <View style={[styles.badge, { backgroundColor: sc.color + '25' }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
          </View>

          <Text style={styles.heroLbl}>Agreed price</Text>
          <Text style={styles.heroPrice} numberOfLines={1} adjustsFontSizeToFit>{fmtKES(deal.agreedPrice)}</Text>

          <View style={styles.progressWrap}>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.progressTxt}>{pct.toFixed(0)}%</Text>
          </View>

          <View style={styles.heroAmounts}>
            <View style={styles.heroAmt}>
              <Text style={styles.heroAmtVal} numberOfLines={1} adjustsFontSizeToFit>{fmtKES(paid)}</Text>
              <Text style={styles.heroAmtLbl}>Paid</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroAmt}>
              <Text style={[styles.heroAmtVal, { color: balance > 0 ? '#FCA5A5' : '#6EE7B7' }]} numberOfLines={1} adjustsFontSizeToFit>{fmtKES(deal.status === 'cancelled' ? 0 : balance)}</Text>
              <Text style={styles.heroAmtLbl}>Balance</Text>
            </View>
          </View>
        </View>

        {/* Parties */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>DETAILS</Text>
          <InfoRow icon="person-outline" label={T.saleBuyer} value={refName(deal.buyer, 'fullName') || '—'} />
          {phone ? (
            <TouchableOpacity onPress={() => Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() => {})} activeOpacity={0.7}>
              <InfoRow icon="call-outline" label="Phone" value={phone} link />
            </TouchableOpacity>
          ) : null}
          {deal.buyer?.email ? <InfoRow icon="mail-outline" label="Email" value={deal.buyer.email} /> : null}
          <InfoRow icon="briefcase-outline" label={T.saleAgent} value={refName(deal.agent, 'fullName') || '—'} />
          {deal.dealDate ? <InfoRow icon="calendar-outline" label={`${T.saleDeal} date`} value={fmtDate(deal.dealDate)} /> : null}
          {deal.expectedClosingDate ? <InfoRow icon="flag-outline" label="Expected close" value={fmtDate(deal.expectedClosingDate)} /> : null}
          {deal.actualClosingDate ? <InfoRow icon="checkmark-done-outline" label="Closed on" value={fmtDate(deal.actualClosingDate)} /> : null}
          {deal.notes ? <InfoRow icon="document-text-outline" label="Notes" value={deal.notes} /> : null}
        </View>

        {/* Schedule / Payments tabs */}
        <View style={styles.card}>
          <View style={styles.tabsInline}>
            <TouchableOpacity style={[styles.tabInline, tab === 'schedule' && styles.tabInlineActive]} onPress={() => setTab('schedule')}>
              <Text style={[styles.tabInlineTxt, tab === 'schedule' && styles.tabInlineTxtActive]}>Schedule ({schedule.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tabInline, tab === 'payments' && styles.tabInlineActive]} onPress={() => setTab('payments')}>
              <Text style={[styles.tabInlineTxt, tab === 'payments' && styles.tabInlineTxtActive]}>
                Payments ({payments.filter(p => p.status === 'paid').length})
              </Text>
            </TouchableOpacity>
          </View>

          {tab === 'schedule' && (
            scheduleErr ? <Text style={styles.errTxt}>{scheduleErr}</Text>
            : schedule.length === 0 ? <Text style={styles.emptyTxt}>No instalment schedule set.</Text>
            : schedule.map((s, i) => {
                const late  = s.status === 'upcoming' && new Date(s.dueDate).getTime() < Date.now();
                const style = SCHEDULE_STYLE[late ? 'overdue' : s.status] ?? SCHEDULE_STYLE.upcoming;
                return (
                  <View key={s._id} style={[styles.rowLine, i % 2 === 1 && { backgroundColor: '#F8FAFC' }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineTitle}>#{s.installmentNumber} · {fmtDate(s.dueDate)}</Text>
                      {s.description ? <Text style={styles.lineSub} numberOfLines={2}>{s.description}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={styles.lineAmt}>{fmtMoney(s.expectedAmount)}</Text>
                      <View style={[styles.pill, { backgroundColor: style.bg }]}>
                        <Text style={[styles.pillTxt, { color: style.color }]}>{style.label}</Text>
                      </View>
                    </View>
                  </View>
                );
              })
          )}

          {tab === 'payments' && (
            paymentsErr ? <Text style={styles.errTxt}>{paymentsErr}</Text>
            : payments.length === 0 ? <Text style={styles.emptyTxt}>No payments recorded yet.</Text>
            : payments.map((p, i) => {
                const voided = p.status === 'cancelled';
                return (
                  <View key={p._id} style={[styles.rowLine, i % 2 === 1 && { backgroundColor: '#F8FAFC' }, voided && { opacity: 0.55 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineTitle}>{fmtDate(p.paymentDate)}{p.paymentNumber ? ` · ${p.paymentNumber}` : ''}</Text>
                      <View style={styles.payTags}>
                        <View style={[styles.pill, { backgroundColor: '#F1F5F9' }]}><Text style={[styles.pillTxt, { color: '#64748B' }]}>{humanize(p.paymentType)}</Text></View>
                        <View style={[styles.pill, { backgroundColor: '#F1F5F9' }]}><Text style={[styles.pillTxt, { color: '#64748B' }]}>{PAYMENT_METHOD_LABEL[p.paymentMethod] || humanize(p.paymentMethod)}</Text></View>
                        {voided ? <View style={[styles.pill, { backgroundColor: '#FEE2E2' }]}><Text style={[styles.pillTxt, { color: '#DC2626' }]}>Voided</Text></View> : null}
                      </View>
                      {p.reference ? <Text style={styles.lineSub}>Ref: {p.reference}</Text> : null}
                    </View>
                    <Text style={[styles.lineAmt, voided && { textDecorationLine: 'line-through' }]}>{fmtMoney(p.amount)}</Text>
                  </View>
                );
              })
          )}
        </View>
      </ScrollView>

      {/* Action bar */}
      {isActive && (
        <View style={styles.actionsWrap}>
          {balance > 0.01 ? (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: SC }]} onPress={openPayment} activeOpacity={0.85}>
              <Ionicons name="cash-outline" size={18} color="#fff" />
              <Text style={styles.actionTxt}>Record Payment</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#065F46' }, closing && { opacity: 0.6 }]} onPress={closeDeal} disabled={closing} activeOpacity={0.85}>
              {closing ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
                  <Text style={styles.actionTxt}>Close {T.saleDeal}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Payment Modal */}
      <Modal visible={payModal} animationType="slide" transparent onRequestClose={() => !saving && setPayModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => !saving && setPayModal(false)} />
          <View style={[styles.paySheet, { maxHeight: height * 0.88 }]}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.paySheetTitle}>Record Payment</Text>
              <Text style={styles.paySheetSub}>{deal.dealNumber} · balance {fmtKES(balance)}</Text>

              <Text style={styles.label}>Amount (KES) *</Text>
              <View style={styles.amountRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]} value={payAmount}
                  onChangeText={t => setPayAmount(cleanDecimal(t))}
                  placeholder="0.00" placeholderTextColor="#94A3B8" keyboardType="decimal-pad"
                />
                <TouchableOpacity style={styles.fullBtn} onPress={() => setPayAmount(String(round2(balance)))}>
                  <Text style={styles.fullBtnTxt}>Full balance</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Payment type</Text>
              <ChipRow items={PAYMENT_TYPES.map(t => ({ key: t, label: humanize(t) }))} value={payType} onChange={setPayType} />

              <Text style={styles.label}>Payment method</Text>
              <ChipRow items={PAYMENT_METHODS.map(m => ({ key: m, label: PAYMENT_METHOD_LABEL[m] }))} value={payMethod} onChange={changeMethod} />

              <Text style={styles.label}>Receiving cashbook{cashbooks.length ? ' *' : ''}</Text>
              {cashbooksLoading ? <ActivityIndicator color={SC} style={{ alignSelf: 'flex-start', marginBottom: 12 }} />
              : cashbooks.length ? (
                <ChipRow items={cashbooks.map(c => ({ key: c._id, label: c.name || c.code || 'Cashbook' }))} value={cashbookId} onChange={setCashbookId} />
              ) : (
                <TouchableOpacity onPress={loadCashbooks} style={{ marginBottom: 12 }}>
                  <Text style={styles.errTxtLeft}>
                    {cashbooksErr ? `${cashbooksErr} Tap to retry.` : 'No cashbook account found. The payment will post to the default sales account. Tap to reload.'}
                  </Text>
                </TouchableOpacity>
              )}

              <View style={{ marginBottom: 12 }}>
                <DateField label="DATE RECEIVED" value={payDate} onChange={setPayDate} required />
              </View>

              <Text style={styles.label}>{refCfg.label}</Text>
              <TextInput style={[styles.input, { marginBottom: 12 }]} value={payRef} onChangeText={setPayRef}
                placeholder={refCfg.hint} placeholderTextColor="#94A3B8" autoCapitalize="characters" />

              <Text style={styles.label}>Notes</Text>
              <TextInput style={[styles.input, styles.textarea, { marginBottom: 16 }]} value={payNotes} onChangeText={setPayNotes}
                placeholder="Optional notes..." placeholderTextColor="#94A3B8" multiline numberOfLines={2} textAlignVertical="top" />

              <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.6 }]} onPress={recordPayment} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Ionicons name="cash-outline" size={18} color="#fff" />
                    <Text style={styles.submitTxt}>Save Payment</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function ChipRow({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginBottom: 12, flexGrow: 0 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {items.map(it => (
          <TouchableOpacity key={it.key} style={[styles.chip, value === it.key && styles.chipActive]} onPress={() => onChange(it.key)}>
            <Text style={[styles.chipTxt, value === it.key && styles.chipTxtActive]}>{it.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

function InfoRow({ icon, label, value, link }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string; link?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={14} color="#94A3B8" style={{ marginTop: 1 }} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, link && { color: '#1D4ED8' }]} numberOfLines={3}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: SBG },
  scroll: { padding: 16, gap: 14, paddingBottom: 24 },

  hero: {
    backgroundColor: SC, borderRadius: 18, padding: 20, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  heroTop:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  heroNum:     { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.8, marginBottom: 2 },
  heroListing: { fontSize: 18, fontWeight: '900', color: '#fff' },
  heroLoc:     { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  heroLbl:     { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.55)', marginTop: 6, letterSpacing: 0.6 },
  heroPrice:   { fontSize: 26, fontWeight: '900', color: '#fff' },
  badge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  badgeTxt:    { fontSize: 11, fontWeight: '800' },

  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  progressBg:   { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#6EE7B7', borderRadius: 3 },
  progressTxt:  { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.75)', width: 36, textAlign: 'right' },

  heroAmounts: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  heroAmt:     { flex: 1 },
  heroAmtVal:  { fontSize: 15, fontWeight: '900', color: '#fff' },
  heroAmtLbl:  { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  heroDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 16 },

  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, gap: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  infoRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontSize: 12, color: '#94A3B8', width: 96 },
  infoValue: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },

  tabsInline:        { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3 },
  tabInline:         { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabInlineActive:   { backgroundColor: '#fff' },
  tabInlineTxt:      { fontSize: 12, fontWeight: '700', color: '#94A3B8' },
  tabInlineTxtActive:{ color: SC },
  emptyTxt:  { fontSize: 13, color: '#94A3B8', textAlign: 'center', paddingVertical: 12 },
  errTxt:    { fontSize: 13, color: '#B91C1C', textAlign: 'center', paddingVertical: 12, lineHeight: 18 },
  errTxtLeft:{ fontSize: 12, color: '#B45309', lineHeight: 17 },

  rowLine:   { flexDirection: 'row', gap: 10, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 8 },
  lineTitle: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  lineSub:   { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  lineAmt:   { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  payTags:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  pill:      { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  pillTxt:   { fontSize: 10, fontWeight: '800' },

  actionsWrap: { borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', padding: 16, flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 14 },
  actionTxt: { fontSize: 14, fontWeight: '800', color: '#fff' },

  // Modal
  paySheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 28 },
  paySheetTitle: { fontSize: 18, fontWeight: '900', color: '#0F172A' },
  paySheetSub:   { fontSize: 12, color: '#94A3B8', marginBottom: 14, marginTop: 2 },
  label: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 },
  input: {
    backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0',
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A',
  },
  textarea: { minHeight: 64, paddingTop: 11 },
  amountRow: { flexDirection: 'row', gap: 8, marginBottom: 12, alignItems: 'center' },
  fullBtn:   { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, backgroundColor: SC + '15' },
  fullBtnTxt:{ fontSize: 12, fontWeight: '800', color: SC },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E2E8F0' },
  chipActive:    { backgroundColor: SC + '15', borderColor: SC },
  chipTxt:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipTxtActive: { color: SC, fontWeight: '700' },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: SC, borderRadius: 14, paddingVertical: 14 },
  submitTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
