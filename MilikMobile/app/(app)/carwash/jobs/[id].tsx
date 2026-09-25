import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, TextInput, Linking, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { cleanDecimal, fmtDate, fmtDateTime, fmtKES, todayISO } from '../../../../utils/pmsFormat';
import {
  CW, CWL, JOB_FLOW, JOB_STATUS_STYLE, PAY_METHODS, PAY_METHOD_ICON, PAY_METHOD_LABEL, PAY_STATUS_STYLE,
  cwError, jobNet, jobStatusLabel, listOf, preferredCashbook, round2, toMsisdn,
  type Cashbook, type PayMethod,
} from '../../../../utils/carwash';

type Job = {
  _id:             string;
  jobNumber?:      string;
  jobType?:        string;
  plateNumber?:    string;
  itemDescription?: string;
  vehicleType?:    string;
  serviceName?:    string;
  status:          string;
  paymentStatus?:  string;
  price:           number;
  discountAmount?: number;
  taxAmount?:      number;
  amountPaid?:     number;
  notes?:          string;
  createdAt:       string;
  customerName?:   string;
  phone?:          string;
  maskedMsisdn?:   string;
  assignedStaff?:  { _id?: string; name?: string }[];
  serviceLines?:   { service?: { name?: string } | null; serviceName?: string; vehicleType?: string; price?: number; isRewardLine?: boolean }[];
};

type Payment = {
  _id: string; amount: number; discountAmount?: number; method: string;
  reference?: string; paymentDate?: string; createdAt?: string;
};

type StkState =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'waiting'; phone: string }
  | { state: 'paid' | 'failed' | 'timeout' | 'untracked'; message: string };

const STK_POLL_MS = 3000;
const STK_POLL_TRIES = 30;   // 90 seconds, like the web
// Default cashbook for a method; with a single cashbook there is nothing to choose.
const pickCashbook = (list: Cashbook[], method: string, defs: Record<string, string>) =>
  preferredCashbook(list, method, defs) || (list.length === 1 ? list[0]._id : '');
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [job,        setJob]        = useState<Job | null>(null);
  const [payments,   setPayments]   = useState<Payment[] | null>(null);   // null = could not be loaded
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<{ message: string; notFound: boolean } | null>(null);
  const [warning,    setWarning]    = useState<string | null>(null);
  const [updating,   setUpdating]   = useState(false);

  // Payment form
  const [payMethod,  setPayMethod]  = useState<PayMethod>('cash');
  const [payAmount,  setPayAmount]  = useState('');
  const [payRef,     setPayRef]     = useState('');
  const [payPhone,   setPayPhone]   = useState('');
  const [cashbookId, setCashbookId] = useState('');
  const [paying,     setPaying]     = useState(false);
  const payLock = useRef(false);
  const [stk,        setStk]        = useState<StkState>({ state: 'idle' });
  const stkToken = useRef(0);

  // Cashbooks (every payment must be booked into one)
  const [cashbooks,   setCashbooks]   = useState<Cashbook[]>([]);
  const [defaults,    setDefaults]    = useState<Record<string, string>>({});
  const [cashbookErr, setCashbookErr] = useState<string | null>(null);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const seq = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    const my = ++seq.current;
    if (mode === 'refresh') setRefreshing(true); else if (mode === 'initial') setLoading(true);
    const [jobRes, payRes] = await Promise.allSettled([
      api.get(`/carwash/jobs/${id}`),
      api.get('/carwash/payments', { params: { job: id, limit: 100 } }),
    ]);
    if (my !== seq.current) return;
    if (jobRes.status === 'fulfilled') {
      const j = jobRes.value.data?.data ?? jobRes.value.data?.job;
      setJob(j ?? null);
      setError(j ? null : { message: 'Job not found.', notFound: true });
    } else {
      const notFound = (jobRes.reason as any)?.response?.status === 404;
      setError({ message: notFound ? 'Job not found.' : cwError(jobRes.reason, 'Could not load this job.'), notFound });
    }
    if (payRes.status === 'fulfilled') {
      setPayments(listOf<Payment>(payRes.value.data, 'payments'));
      setWarning(null);
    } else {
      setPayments(null);
      setWarning(cwError(payRes.reason, 'Could not load the payment history.'));
    }
    setLoading(false); setRefreshing(false);
  }, [id]);

  useEffect(() => { load('initial'); }, [load]);
  useEffect(() => () => { stkToken.current += 1; seq.current += 1; }, []);   // stop polling / drop late responses on leave

  const loadCashbooks = useCallback(async () => {
    setCashbookErr(null);
    const [cbRes, setRes, brRes] = await Promise.allSettled([
      api.get('/chart-of-accounts', { params: { type: 'asset', moduleScope: 'carwash', search: 'Cashbooks' } }),
      api.get('/carwash/settings'),
      api.get('/carwash/branches/active'),
    ]);
    if (cbRes.status === 'rejected') {
      setCashbookErr(cwError(cbRes.reason, 'Could not load the cashbooks.'));
      return;
    }
    const all: Record<string, any>[] = Array.isArray(cbRes.value.data) ? cbRes.value.data : [];
    // The server only accepts posting accounts in a "Cashbooks" sub-group (same test as the web).
    const list: Cashbook[] = all
      .filter(a => !a.isHeader && a.isPosting !== false && /cashbook/i.test(String(a.subGroup || '')))
      .map(a => ({ _id: String(a._id), code: a.code, name: a.name, subGroup: a.subGroup }));
    setCashbooks(list);
    if (list.length === 0) setCashbookErr('No cashbook account is set up for Car Wash. Ask an administrator to add one in Chart of Accounts.');

    const company = setRes.status === 'fulfilled' ? (setRes.value.data?.data?.defaultCashbooks ?? {}) : {};
    const branch  = brRes.status  === 'fulfilled' ? (brRes.value.data?.data?.defaultCashbooks  ?? {}) : {};
    const defs: Record<string, string> = {};
    (['cash', 'mpesa', 'bank', 'card', 'other'] as const).forEach(m => {
      const b = branch[m]?._id || branch[m] || '';
      const c = company[m]?._id || company[m] || '';
      defs[m] = String(b || c || '');
    });
    setDefaults(defs);
  }, []);

  useEffect(() => { loadCashbooks(); }, [loadCashbooks]);

  // Pick the default cashbook for the method whenever the list, the defaults or the method change
  // (a cashbook the cashier picked by hand is kept while it is still valid for the list).
  useEffect(() => {
    if (!cashbooks.length) return;
    setCashbookId(cur => (cur && cashbooks.some(c => c._id === cur) ? cur : pickCashbook(cashbooks, payMethod, defaultsRef.current)));
  }, [cashbooks, defaults, payMethod]);

  const chooseMethod = (m: PayMethod) => {
    setPayMethod(m);
    if (cashbooks.length) setCashbookId(cur => preferredCashbook(cashbooks, m, defaultsRef.current) || cur);   // follow the method's own default
    if (m !== 'mpesa') setStk(s => (s.state === 'waiting' || s.state === 'sending' ? s : { state: 'idle' }));
  };

  // ── Figures (paid includes any write-off, exactly like the server) ───────────
  const net = jobNet(job);
  const paidTotal = useMemo(() => {
    if (payments) return round2(payments.reduce((s, p) => s + Number(p.amount || 0) + Number(p.discountAmount || 0), 0));
    return round2(Number(job?.amountPaid ?? 0));
  }, [payments, job?.amountPaid]);
  const balance = Math.max(0, round2(net - paidTotal));

  // Pre-fill the amount with what is still owed, and the payer's phone with the job's number.
  useEffect(() => { setPayAmount(balance > 0 ? String(balance) : ''); }, [balance]);
  useEffect(() => { if (job?.phone) setPayPhone(p => p || job.phone || ''); }, [job?.phone]);

  const confirm = (title: string, message: string, okText: string, onOk: () => void, destructive = false) =>
    Alert.alert(title, message, [
      { text: 'Back', style: 'cancel' },
      { text: okText, style: destructive ? 'destructive' : 'default', onPress: onOk },
    ]);

  // ── Status changes ──────────────────────────────────────────────────────────
  const setStatus = async (next: string) => {
    if (updating) return;
    setUpdating(true);
    try {
      await api.patch(`/carwash/jobs/${id}/status`, { status: next });
      await load('silent');
    } catch (err) {
      Alert.alert('Could not update the job', cwError(err, 'Failed to update the status.'));
    } finally { setUpdating(false); }
  };

  const moveTo = (next: string) =>
    confirm('Update status', `Move this job to "${jobStatusLabel(next, job?.jobType)}"?`, 'Confirm', () => setStatus(next));

  const cancelJob = () =>
    confirm('Cancel job', 'Cancel this job? A cancelled job cannot be worked on or paid.', 'Cancel job', () => setStatus('cancelled'), true);

  // ── Payments ────────────────────────────────────────────────────────────────
  const amountNum = parseFloat(payAmount) || 0;

  const validatePayment = (): string | null => {
    if (amountNum <= 0)                    return 'Enter the amount received.';
    if (amountNum > balance + 0.009)       return `The amount is more than the balance of ${fmtKES(balance)}.`;
    if (!cashbookId)                       return 'Choose the cashbook this payment goes into.';
    if (payMethod === 'mpesa' && !payRef.trim()) return 'Enter the M-Pesa transaction code.';
    if (payMethod === 'mpesa' && payPhone.trim() && !toMsisdn(payPhone)) return 'The payer phone number is not valid (07XXXXXXXX).';
    return null;
  };

  const doRecord = async () => {
    if (payLock.current) return;
    payLock.current = true;
    setPaying(true);
    try {
      await api.post('/carwash/payments', {
        job:             id,
        amount:          amountNum,
        method:          payMethod,
        cashbookAccount: cashbookId,
        paymentDate:     todayISO(),
        reference:       payMethod === 'mpesa' ? payRef.trim().toUpperCase() : undefined,
        receivedFromPhone: payMethod === 'mpesa' && payPhone.trim() ? payPhone.trim() : undefined,
      });
      setPayRef('');
      await load('silent');
    } catch (err) {
      Alert.alert('Payment not recorded', cwError(err, 'Could not record the payment.'));
    } finally { payLock.current = false; setPaying(false); }
  };

  const recordPayment = () => {
    if (payLock.current) return;
    const problem = validatePayment();
    if (problem) { Alert.alert('Check the payment', problem); return; }
    const cb = cashbooks.find(c => c._id === cashbookId);
    confirm(
      'Record payment',
      `${fmtKES(amountNum)} received by ${PAY_METHOD_LABEL[payMethod]}${cb ? `\nInto: ${cb.code ? `${cb.code} - ` : ''}${cb.name}` : ''}${payMethod === 'mpesa' ? `\nCode: ${payRef.trim().toUpperCase()}` : ''}`,
      'Record',
      doRecord,
    );
  };

  const reversePayment = (p: Payment) =>
    confirm(
      'Reverse payment',
      `Delete the ${PAY_METHOD_LABEL[p.method] ?? p.method} payment of ${fmtKES(p.amount)}? The job goes back to unpaid/partial and any commission for it is cancelled. This cannot be undone.`,
      'Reverse',
      async () => {
        try {
          await api.delete(`/carwash/payments/${p._id}`);
          await load('silent');
        } catch (err) {
          Alert.alert('Could not reverse the payment', cwError(err, 'Failed to reverse the payment.'));
        }
      },
      true,
    );

  // ── STK push: "sent" only means Safaricom accepted the request; the outcome arrives on the callback ──
  const watchStk = async (checkoutId: string, phone: string) => {
    const token = ++stkToken.current;
    for (let i = 0; i < STK_POLL_TRIES; i += 1) {
      await sleep(STK_POLL_MS);
      if (stkToken.current !== token) return;          // a newer push, or the screen closed
      try {
        const { data } = await api.get(`/carwash/payments/stk-status/${encodeURIComponent(checkoutId)}`);
        const out = data?.data ?? data;
        if (out?.state === 'paid') {
          setStk({ state: 'paid', message: 'M-Pesa payment received.' });
          load('silent');
          return;
        }
        if (out?.state === 'failed') {
          setStk({ state: 'failed', message: out.message || 'The M-Pesa request failed.' });
          return;
        }
      } catch { /* keep trying until the time is up */ }
    }
    if (stkToken.current === token) {
      setStk({ state: 'timeout', message: `No answer from M-Pesa yet. Ask the customer (${phone}) to check their phone, or send the prompt again.` });
    }
  };

  const sendStk = () => {
    if (stk.state === 'sending' || stk.state === 'waiting') return;
    const msisdn = toMsisdn(payPhone);
    if (!msisdn)          { Alert.alert('Phone number needed', "Enter the customer's M-Pesa number (07XXXXXXXX)."); return; }
    if (amountNum <= 0)   { Alert.alert('Amount needed', 'Enter the amount to request.'); return; }
    if (amountNum > balance + 0.009) { Alert.alert('Check the amount', `The amount is more than the balance of ${fmtKES(balance)}.`); return; }
    confirm('Send M-Pesa prompt', `Ask ${payPhone.trim()} to pay ${fmtKES(Math.ceil(amountNum))} by M-Pesa?`, 'Send', async () => {
      setStk({ state: 'sending' });
      try {
        const { data } = await api.post('/carwash/payments/stk-push', { phone: msisdn, amount: amountNum, jobId: id });
        const checkoutId: string | undefined = data?.data?.CheckoutRequestID;
        if (!checkoutId) {
          setStk({ state: 'untracked', message: 'The request was sent but cannot be tracked from here. Check the M-Pesa screen in a minute.' });
          return;
        }
        setStk({ state: 'waiting', phone: payPhone.trim() });
        watchStk(checkoutId, payPhone.trim());
      } catch (err) {
        setStk({ state: 'failed', message: cwError(err, 'The M-Pesa request could not be sent.') });
      }
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return <MilikLoader fullscreen />;
  if (!job) return (
    <>
      <Stack.Screen options={{ title: 'Job' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ErrorState
          message={error?.message ?? 'Job not found.'}
          onRetry={error?.notFound ? undefined : () => load('initial')}
        />
      </SafeAreaView>
    </>
  );

  const isCarpet    = job.jobType === 'carpet';
  const sc          = JOB_STATUS_STYLE[job.status] ?? JOB_STATUS_STYLE.cancelled;
  const ps          = PAY_STATUS_STYLE[job.paymentStatus ?? 'unpaid'] ?? PAY_STATUS_STYLE.unpaid;
  const isCancelled = job.status === 'cancelled';
  const isPaid      = job.paymentStatus === 'paid' || (net > 0 && balance <= 0.009);
  const isFinal     = job.status === 'paid' || (job.status === 'done' && job.paymentStatus === 'paid');
  const currentIdx  = job.status === 'paid' ? JOB_FLOW.length : JOB_FLOW.indexOf(job.status as any);
  const hasPayments = (payments?.length ?? 0) > 0 || paidTotal > 0;
  const canCancel   = !isCancelled && job.paymentStatus === 'unpaid' && !hasPayments;
  const title       = `${isCarpet ? 'Carpet' : (job.plateNumber || '—')}${job.jobNumber ? `  ·  #${job.jobNumber}` : ''}`;

  const lines = (job.serviceLines?.length
    ? job.serviceLines
    : [{ serviceName: job.serviceName, price: job.price, vehicleType: job.vehicleType }]
  ).map(s => ({
    name:   s.serviceName || (s as any).service?.name || '—',
    price:  Number(s.price ?? 0),
    reward: !!(s as any).isRewardLine,
  }));
  const linesTotal = round2(lines.reduce((sum, s) => sum + s.price, 0));
  const stkBusy = stk.state === 'sending' || stk.state === 'waiting';
  const phoneDisplay = job.phone || (job.maskedMsisdn ? 'Number hidden by M-Pesa' : '');

  return (
    <>
      <Stack.Screen options={{ title }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={CW} />}
          showsVerticalScrollIndicator={false}
        >
          {error ? <ErrorBanner message={error.message} onRetry={() => load('silent')} /> : null}
          {warning ? <ErrorBanner message={warning} onRetry={() => load('silent')} /> : null}

          {/* ── Navy hero ── */}
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.plateTxt} numberOfLines={2}>{isCarpet ? (job.itemDescription || 'Carpet') : (job.plateNumber || '—')}</Text>
                {job.vehicleType && !isCarpet ? <Text style={styles.vehicleTxt}>{job.vehicleType}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.statusPillTxt, { color: sc.color }]}>{jobStatusLabel(job.status, job.jobType).toUpperCase()}</Text>
                </View>
                {!isCancelled ? (
                  <View style={[styles.statusPill, { backgroundColor: ps.bg }]}>
                    <Text style={[styles.statusPillTxt, { color: ps.color }]}>{ps.label.toUpperCase()}</Text>
                  </View>
                ) : null}
                {job.jobNumber ? <Text style={styles.jobNumTxt}>Job #{job.jobNumber}</Text> : null}
              </View>
            </View>

            {(job.customerName || phoneDisplay) ? <View style={styles.heroDivider} /> : null}
            {job.customerName ? <Text style={styles.customerTxt}>{job.customerName}</Text> : null}
            {phoneDisplay ? (
              <TouchableOpacity
                style={styles.phoneRow}
                onPress={() => { if (job.phone) Linking.openURL(`tel:${job.phone}`).catch(() => {}); }}
                disabled={!job.phone}
                activeOpacity={0.75}
              >
                <Ionicons name="call-outline" size={13} color="rgba(255,255,255,0.65)" />
                <Text style={styles.phoneTxt}>{phoneDisplay}</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.heroFooterRow}>
              {job.assignedStaff?.length ? (
                <View style={styles.heroMeta}>
                  <Ionicons name="person-outline" size={11} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.heroMetaTxt} numberOfLines={1}>
                    {job.assignedStaff.map(s => s.name).filter(Boolean).join(', ')}
                  </Text>
                </View>
              ) : <View />}
              <Text style={styles.heroMetaTxt}>{fmtDateTime(job.createdAt)}</Text>
            </View>

            {job.notes ? (
              <View style={styles.notesBox}>
                <Ionicons name="document-text-outline" size={12} color="rgba(255,255,255,0.55)" />
                <Text style={styles.notesTxt}>{job.notes}</Text>
              </View>
            ) : null}
          </View>

          {/* ── Status stepper ── */}
          {!isCancelled && (
            <View style={styles.stepperCard}>
              {updating ? (
                <ActivityIndicator color={CW} style={{ paddingVertical: 8 }} />
              ) : (
                <>
                  <View style={styles.stepper}>
                    {JOB_FLOW.map((s, i) => {
                      const isPast = i < currentIdx;
                      const isCurr = i === currentIdx;
                      const cfg    = JOB_STATUS_STYLE[s];
                      return (
                        <View key={s} style={styles.stepCol}>
                          {i > 0 && <View style={[styles.stepLineL, { backgroundColor: (isPast || isCurr) ? CW : '#E2E8F0' }]} />}
                          {i < JOB_FLOW.length - 1 && <View style={[styles.stepLineR, { backgroundColor: isPast ? CW : '#E2E8F0' }]} />}
                          <TouchableOpacity
                            style={[
                              styles.stepCircle,
                              isPast && { backgroundColor: CW, borderColor: CW },
                              isCurr && { backgroundColor: cfg.color, borderColor: cfg.color },
                              !isPast && !isCurr && { backgroundColor: '#fff', borderColor: '#CBD5E1' },
                            ]}
                            onPress={() => moveTo(s)}
                            disabled={isCurr || isFinal}
                            activeOpacity={0.7}
                            accessibilityLabel={`Move to ${jobStatusLabel(s, job.jobType)}`}
                          >
                            {isPast && <Ionicons name="checkmark" size={14} color="#fff" />}
                            {isCurr && <View style={[styles.stepDot, { backgroundColor: '#fff' }]} />}
                          </TouchableOpacity>
                          <Text style={[styles.stepLbl, isCurr && { color: cfg.color, fontWeight: '700' }]} numberOfLines={1}>
                            {jobStatusLabel(s, job.jobType)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  <Text style={styles.stepHint}>
                    {isFinal ? 'Done and fully paid — the status is final.' : 'Tap a step to move the job there.'}
                  </Text>
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
                <Text style={styles.finValue}>{fmtKES(net)}</Text>
              </View>
              <View style={[styles.finStat, styles.finBorder]}>
                <Text style={styles.finLabel}>PAID</Text>
                <Text style={[styles.finValue, { color: paidTotal > 0 ? '#065F46' : '#94A3B8' }]}>{fmtKES(paidTotal)}</Text>
              </View>
              <View style={styles.finStat}>
                <Text style={styles.finLabel}>BALANCE</Text>
                <Text style={[styles.finValue, { color: isCancelled ? '#94A3B8' : balance > 0 ? '#DC2626' : '#065F46' }]}>
                  {isCancelled ? '—' : balance > 0 ? fmtKES(balance) : 'Paid ✓'}
                </Text>
              </View>
            </View>
            {Number(job.discountAmount) > 0 ? (
              <Text style={styles.finNote}>Price {fmtKES(job.price)} less discount {fmtKES(job.discountAmount)}</Text>
            ) : null}
            {Number(job.taxAmount) > 0 ? <Text style={styles.finNote}>Includes VAT of {fmtKES(job.taxAmount)}</Text> : null}
          </View>

          {/* ── Services ── */}
          {lines.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>SERVICES ({lines.length})</Text>
              {lines.map((s, i) => (
                <View key={i} style={[styles.svcRow, i === lines.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={styles.svcName}>{s.name}{s.reward ? '  (loyalty reward)' : ''}</Text>
                  <Text style={styles.svcPrice}>{fmtKES(s.price)}</Text>
                </View>
              ))}
              {lines.length > 1 && (
                <View style={styles.svcTotalRow}>
                  <Text style={styles.svcTotalLabel}>Total</Text>
                  <Text style={styles.svcTotalValue}>{fmtKES(linesTotal)}</Text>
                </View>
              )}
            </View>
          )}

          {/* ── Payment history ── */}
          {payments && payments.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>PAYMENT HISTORY ({payments.length})</Text>
              {payments.map((p, i) => (
                <View key={p._id} style={[styles.svcRow, i === payments.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.svcName}>{PAY_METHOD_LABEL[p.method] ?? p.method}</Text>
                    {p.reference ? <Text style={styles.payHistoryRef}>{p.reference}</Text> : null}
                    {Number(p.discountAmount) > 0 ? <Text style={styles.payHistoryDate}>+ write-off {fmtKES(p.discountAmount)}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text style={styles.svcPrice}>{fmtKES(p.amount)}</Text>
                    <Text style={styles.payHistoryDate}>{fmtDate(p.paymentDate || p.createdAt)}</Text>
                  </View>
                  <TouchableOpacity style={styles.reverseBtn} onPress={() => reversePayment(p)} accessibilityLabel="Reverse payment" hitSlop={8}>
                    <Ionicons name="arrow-undo-outline" size={16} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* ── Record payment ── */}
          {!isPaid && !isCancelled && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>RECORD PAYMENT</Text>
              <View style={styles.payForm}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                  {PAY_METHODS.map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.methodChip, payMethod === m && styles.methodChipActive]}
                      onPress={() => chooseMethod(m)}
                    >
                      <Ionicons name={PAY_METHOD_ICON[m] as any} size={13} color={payMethod === m ? '#fff' : '#64748B'} />
                      <Text style={[styles.methodChipText, payMethod === m && styles.methodChipTextActive]}>{PAY_METHOD_LABEL[m]}</Text>
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
                    onChangeText={t => setPayAmount(cleanDecimal(t))}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                  />
                  {balance > 0 && (
                    <TouchableOpacity style={styles.payFullBtn} onPress={() => setPayAmount(String(balance))}>
                      <Text style={styles.payFullBtnTxt}>Full</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.hint}>Balance {fmtKES(balance)}</Text>

                {/* Cashbook */}
                <View>
                  <Text style={styles.fieldLabel}>PAID INTO</Text>
                  {cashbooks.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                      {cashbooks.map(c => (
                        <TouchableOpacity
                          key={c._id}
                          style={[styles.methodChip, cashbookId === c._id && styles.methodChipActive]}
                          onPress={() => setCashbookId(c._id)}
                        >
                          <Text style={[styles.methodChipText, cashbookId === c._id && styles.methodChipTextActive]}>
                            {c.code ? `${c.code} · ` : ''}{c.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  ) : cashbookErr ? (
                    <TouchableOpacity onPress={loadCashbooks} activeOpacity={0.8}>
                      <Text style={styles.cashbookErr}>{cashbookErr}  Tap to retry.</Text>
                    </TouchableOpacity>
                  ) : (
                    <ActivityIndicator size="small" color={CW} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
                  )}
                </View>

                {payMethod === 'mpesa' && (
                  <>
                    <TextInput
                      style={styles.payInput}
                      placeholder="M-Pesa transaction code (required)"
                      placeholderTextColor="#94A3B8"
                      value={payRef}
                      onChangeText={t => setPayRef(t.toUpperCase().replace(/\s/g, ''))}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={20}
                    />
                    <TextInput
                      style={styles.payInput}
                      placeholder="Payer's phone 07XX... (for the receipt SMS and STK prompt)"
                      placeholderTextColor="#94A3B8"
                      value={payPhone}
                      onChangeText={setPayPhone}
                      keyboardType="phone-pad"
                    />

                    {/* STK push */}
                    <TouchableOpacity
                      style={[styles.stkBtn, stkBusy && { opacity: 0.6 }]}
                      onPress={sendStk}
                      disabled={stkBusy}
                      activeOpacity={0.8}
                    >
                      {stk.state === 'sending'
                        ? <ActivityIndicator size="small" color="#C8511A" />
                        : <Ionicons name="phone-portrait-outline" size={16} color="#C8511A" />}
                      <Text style={styles.stkBtnText}>
                        {stk.state === 'sending' ? 'Sending…' : stk.state === 'waiting' ? 'Waiting for the customer…' : 'Ask customer to pay by M-Pesa prompt'}
                      </Text>
                    </TouchableOpacity>
                    {stk.state === 'waiting' ? (
                      <View style={[styles.stkNote, { borderColor: '#FED7AA', backgroundColor: '#FFF7ED' }]}>
                        <ActivityIndicator size="small" color="#C8511A" />
                        <Text style={[styles.stkNoteText, { color: '#9A3412' }]}>
                          Prompt sent to {stk.phone}. Waiting for the customer to enter their PIN — this can take up to 90 seconds.
                        </Text>
                      </View>
                    ) : null}
                    {stk.state === 'paid' ? (
                      <View style={[styles.stkNote, { borderColor: '#6EE7B7', backgroundColor: '#ECFDF5' }]}>
                        <Ionicons name="checkmark-circle" size={16} color="#059669" />
                        <Text style={[styles.stkNoteText, { color: '#065F46' }]}>{stk.message}</Text>
                      </View>
                    ) : null}
                    {stk.state === 'failed' || stk.state === 'timeout' || stk.state === 'untracked' ? (
                      <View style={[styles.stkNote, { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }]}>
                        <Ionicons name="alert-circle" size={16} color="#DC2626" />
                        <Text style={[styles.stkNoteText, { color: '#991B1B' }]}>{stk.message}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.hint}>
                      The prompt is not a payment until the customer pays; then it is recorded automatically. Use the code above only for money already received.
                    </Text>
                  </>
                )}

                <TouchableOpacity
                  style={[styles.payBtn, (paying || !cashbookId) && { opacity: 0.6 }]}
                  onPress={recordPayment}
                  disabled={paying || !cashbookId}
                >
                  {paying ? <ActivityIndicator color="#fff" size="small" /> : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                      <Text style={styles.payBtnText}>Record {amountNum > 0 ? fmtKES(amountNum) : 'payment'}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Cancel job ── */}
          {canCancel && (
            <TouchableOpacity style={styles.dangerBtn} onPress={cancelJob} disabled={updating}>
              <Ionicons name="close-circle-outline" size={16} color="#DC2626" />
              <Text style={styles.dangerBtnTxt}>Cancel Job</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#F0F4FF' },
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
  heroFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8 },
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
  stepHint:    { fontSize: 11, color: '#94A3B8', marginTop: 10 },

  /* Cards */
  card:      { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16 },
  cardTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: '#94A3B8', marginBottom: 12 },

  finRow:    { flexDirection: 'row' },
  finStat:   { flex: 1, alignItems: 'center', gap: 4 },
  finBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#E2E8F0' },
  finLabel:  { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: '#94A3B8' },
  finValue:  { fontSize: 15, fontWeight: '900', color: '#0F172A' },
  finNote:   { fontSize: 11, color: '#64748B', marginTop: 8, textAlign: 'center' },

  svcRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  svcName:      { fontSize: 14, color: '#0F172A', fontWeight: '600', flex: 1 },
  svcPrice:     { fontSize: 14, fontWeight: '800', color: CW },
  svcTotalRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, marginTop: 2, borderTopWidth: 1.5, borderTopColor: '#E2E8F0' },
  svcTotalLabel:    { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  svcTotalValue:    { fontSize: 15, fontWeight: '900', color: CW },
  payHistoryRef:  { fontSize: 10, color: '#94A3B8', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', marginTop: 1 },
  payHistoryDate: { fontSize: 10, color: '#94A3B8' },
  reverseBtn:     { padding: 6, borderRadius: 8, backgroundColor: '#FEF2F2' },

  /* Payment */
  payForm:    { gap: 12, marginTop: 2 },
  fieldLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: '#94A3B8' },
  hint:       { fontSize: 11, color: '#64748B', lineHeight: 16 },
  methodChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  methodChipActive:    { backgroundColor: CW, borderColor: CW },
  methodChipText:      { fontSize: 12, fontWeight: '700', color: '#475569' },
  methodChipTextActive:{ color: '#fff' },
  cashbookErr: { fontSize: 12, color: '#B91C1C', lineHeight: 17, marginTop: 4 },

  payAmountWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 14, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, paddingVertical: 4 },
  payAmountPrefix: { fontSize: 16, fontWeight: '700', color: '#94A3B8', marginRight: 6 },
  payAmountInput: { flex: 1, fontSize: 24, fontWeight: '800', color: '#0F172A', paddingVertical: 10 },
  payFullBtn: { backgroundColor: CWL, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  payFullBtnTxt: { fontSize: 12, fontWeight: '800', color: CW },

  payInput: { backgroundColor: '#F8FAFC', borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#0F172A' },
  payBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#065F46', borderRadius: 14, paddingVertical: 16 },
  payBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  stkBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 12, borderWidth: 1.5, borderColor: '#FED7AA', backgroundColor: '#FFF7ED' },
  stkBtnText: { fontSize: 13, fontWeight: '700', color: '#C8511A' },
  stkNote:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  stkNoteText:{ flex: 1, fontSize: 12, lineHeight: 17 },

  dangerBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FFF5F5' },
  dangerBtnTxt: { fontSize: 14, fontWeight: '700', color: '#DC2626' },
});
