import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal,
  Alert, RefreshControl, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorState } from '../../../../components/ui/PmsStates';
import { cleanDecimal, fmtDate, fmtDateTime, fmtKES } from '../../../../utils/pmsFormat';
import {
  INV, INVBG, PO_STATUS, canCancelPO, canReceivePO, canSendPO, fmtQty, invError, markSentBody,
  nameOf, outstanding, receiveBody, round2, toNum, userName, type POLine, type PurchaseOrder,
} from '../../../../utils/inventory';

type Row = { qty: string; cost: string };

export default function PurchaseOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [po,         setPo]         = useState<PurchaseOrder | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [acting,     setActing]     = useState(false);
  const actingRef = useRef(false);
  const reqRef = useRef(0);

  const [recvOpen, setRecvOpen] = useState(false);
  const [rows,     setRows]     = useState<Record<string, Row>>({});
  const [grnRef,   setGrnRef]   = useState('');

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    const rid = ++reqRef.current;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const { data } = await api.get(`/inventory/purchase-orders/${id}`);
      if (rid !== reqRef.current) return;
      setPo(data?.data ?? null);
      setError(data?.data ? null : 'Purchase order not found.');
    } catch (e) {
      if (rid !== reqRef.current) return;
      setError(invError(e, 'Could not load this purchase order.'));
    } finally {
      if (rid === reqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [id]);

  useEffect(() => { load('initial'); }, [load]);

  /** Run one state-changing call; only one at a time, and the order is re-read afterwards (the server may have moved it on). */
  const act = async (call: () => Promise<unknown>, failMsg: string, after?: () => void) => {
    if (actingRef.current) return;
    actingRef.current = true; setActing(true);
    try {
      await call();
      after?.();
    } catch (e) {
      Alert.alert('Could not update', invError(e, failMsg));
    } finally {
      actingRef.current = false; setActing(false);
      load('silent');
    }
  };

  if (loading) return <MilikLoader fullscreen />;
  if (!po) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ErrorState message={error ?? 'Purchase order not found.'} onRetry={() => load('initial')} />
      </SafeAreaView>
    );
  }

  const lines: POLine[] = po.lines ?? [];
  const sc = PO_STATUS[po.status] ?? PO_STATUS.draft;
  const supplier = po.supplier;
  const openLines = lines.filter(l => outstanding(l) > 0);

  // ── actions ──────────────────────────────────────────────────────────────────
  const openReceive = () => {
    if (!openLines.length) { Alert.alert('Nothing to receive', 'Every line has already been received.'); return; }
    const init: Record<string, Row> = {};
    openLines.forEach(l => { init[l._id] = { qty: String(outstanding(l)), cost: String(l.unitCost ?? 0) }; });
    setRows(init); setGrnRef(''); setRecvOpen(true);
  };

  const receiveTotal = round2(openLines.reduce((s, l) => s + toNum(rows[l._id]?.qty ?? '') * toNum(rows[l._id]?.cost ?? ''), 0));

  const submitReceive = () => {
    if (actingRef.current) return;
    const entries = openLines.map(l => ({ line: l, qty: toNum(rows[l._id]?.qty ?? ''), unitCost: toNum(rows[l._id]?.cost ?? '') }));
    const over = entries.find(e => e.qty > outstanding(e.line) + 1e-9);
    if (over) {
      Alert.alert('Too many', `${nameOf(over.line.product) || 'A line'}: only ${fmtQty(outstanding(over.line))} still outstanding.`);
      return;
    }
    const body = receiveBody(
      entries.map(e => ({ lineId: e.line._id, qty: e.qty, unitCost: e.unitCost })),
      grnRef,
    );
    if (!body.lines.length) { Alert.alert('Nothing to receive', 'Enter a quantity above zero for at least one line.'); return; }
    const units = body.lines.reduce((s, l) => s + l.qtyReceived, 0);
    Alert.alert(
      'Receive goods',
      `Receive ${fmtQty(units)} unit${units !== 1 ? 's' : ''} across ${body.lines.length} line${body.lines.length !== 1 ? 's' : ''} into ${nameOf(po.location) || 'the receiving location'}?\n\nThis adds stock, sets each product's cost to the unit cost entered and posts to the accounts.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Receive',
          onPress: () => act(
            () => api.post(`/inventory/purchase-orders/${po._id}/receive-goods`, body),
            'Receiving failed.',
            () => setRecvOpen(false),
          ),
        },
      ],
    );
  };

  const markSent = () => {
    Alert.alert('Mark as sent', `Mark ${po.poNumber} as sent to ${nameOf(supplier) || 'the supplier'}?`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Mark sent', onPress: () => act(() => api.put(`/inventory/purchase-orders/${po._id}`, markSentBody()), 'Could not mark as sent.') },
    ]);
  };

  const cancelPO = () => {
    Alert.alert('Cancel purchase order', `Cancel ${po.poNumber}? This cannot be undone.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel PO', style: 'destructive', onPress: () => act(() => api.post(`/inventory/purchase-orders/${po._id}/cancel`), 'Could not cancel the order.') },
    ]);
  };

  const receipts = po.receipts ?? [];
  const showActions = canReceivePO(po.status) || canSendPO(po.status) || canCancelPO(po.status);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={INV} />}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.poNum}>{po.poNumber}</Text>
              <Text style={styles.supplierName}>{nameOf(supplier) || 'No supplier'}</Text>
              {supplier?.phone ? <Text style={styles.locationTxt}>{supplier.phone}</Text> : null}
              <Text style={styles.locationTxt}>Receiving at {nameOf(po.location) || '—'}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
          </View>

          <Text style={styles.totalAmount}>{fmtKES(po.totalAmount)}</Text>

          <View style={styles.heroMeta}>
            {po.orderDate ? (
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.6)" />
                <Text style={styles.metaTxt}>Ordered {fmtDate(po.orderDate)}</Text>
              </View>
            ) : null}
            {po.expectedDate ? (
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.6)" />
                <Text style={styles.metaTxt}>Expected {fmtDate(po.expectedDate)}</Text>
              </View>
            ) : null}
            {po.receivedAt ? (
              <View style={styles.metaItem}>
                <Ionicons name="checkmark-circle-outline" size={13} color="rgba(255,255,255,0.6)" />
                <Text style={styles.metaTxt}>Received {fmtDate(po.receivedAt)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Lines */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ORDER LINES ({lines.length})</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.thTxt, { flex: 3 }]}>Product</Text>
            <Text style={[styles.thTxt, { flex: 1, textAlign: 'right' }]}>Ord</Text>
            <Text style={[styles.thTxt, { flex: 1, textAlign: 'right' }]}>Rcvd</Text>
            <Text style={[styles.thTxt, { flex: 2, textAlign: 'right' }]}>Total</Text>
          </View>
          {lines.map((line, i) => {
            const full = Number(line.qtyReceived) >= Number(line.qtyOrdered);
            const partial = Number(line.qtyReceived) > 0 && !full;
            const uom = line.product?.unitOfMeasure ?? '';
            return (
              <View key={line._id} style={[styles.tableRow, i % 2 === 1 && { backgroundColor: '#F8FAFC' }]}>
                <View style={{ flex: 3 }}>
                  <Text style={styles.prodName} numberOfLines={2}>{line.product?.name ?? 'Deleted product'}</Text>
                  <Text style={styles.prodSku}>{line.product?.sku ? `${line.product.sku} · ` : ''}@ {fmtKES(line.unitCost)}</Text>
                </View>
                <Text style={[styles.tdNum, { flex: 1 }]}>{fmtQty(line.qtyOrdered)}{uom ? ` ${uom}` : ''}</Text>
                <Text style={[styles.tdNum, {
                  flex: 1, color: full ? '#065F46' : partial ? '#D97706' : '#64748B', fontWeight: partial ? '800' : '600',
                }]}>{fmtQty(line.qtyReceived)}</Text>
                <Text style={[styles.tdNum, { flex: 2, color: '#0F172A', fontWeight: '700' }]}>{fmtKES(line.totalCost)}</Text>
              </View>
            );
          })}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{fmtKES(po.totalAmount)}</Text>
          </View>
        </View>

        {/* Receipts */}
        {receipts.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>GOODS RECEIVED ({receipts.length})</Text>
            {receipts.map(r => {
              const units = (r.lines ?? []).reduce((s, l) => s + Number(l.qty || 0), 0);
              const value = (r.lines ?? []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitCost || 0), 0);
              const cancelled = r.status === 'cancelled';
              return (
                <View key={r._id} style={[styles.receipt, cancelled && { opacity: 0.6 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.receiptTop}>{fmtDateTime(r.receivedAt)}{r.grnRef ? `  ·  ${r.grnRef}` : ''}</Text>
                    <Text style={styles.receiptSub}>
                      {fmtQty(units)} unit{units !== 1 ? 's' : ''} · {fmtKES(value)}
                      {cancelled && r.cancelReason ? `  ·  ${r.cancelReason}` : ''}
                    </Text>
                  </View>
                  <View style={[styles.miniBadge, { backgroundColor: cancelled ? '#FEE2E2' : '#D1FAE5' }]}>
                    <Text style={[styles.miniBadgeTxt, { color: cancelled ? '#DC2626' : '#065F46' }]}>{cancelled ? 'Cancelled' : 'Received'}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {po.notes ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>NOTES</Text>
            <Text style={styles.noteTxt}>{po.notes}</Text>
          </View>
        ) : null}

        {userName(po.createdBy) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>CREATED BY</Text>
            <View style={styles.auditRow}>
              <Ionicons name="person-outline" size={14} color="#94A3B8" />
              <Text style={styles.auditValue}>{userName(po.createdBy)}</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Actions */}
      {showActions ? (
        <View style={styles.footer}>
          {acting ? (
            <View style={[styles.actionBtn, { backgroundColor: INV, opacity: 0.6 }]}><ActivityIndicator color="#fff" /></View>
          ) : (
            <View style={styles.footerRow}>
              {canCancelPO(po.status) ? (
                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FEE2E2' }]} onPress={cancelPO}>
                  <Ionicons name="close-circle-outline" size={16} color="#DC2626" />
                  <Text style={[styles.smallBtnTxt, { color: '#DC2626' }]}>Cancel</Text>
                </TouchableOpacity>
              ) : null}
              {canSendPO(po.status) ? (
                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#DBEAFE' }]} onPress={markSent}>
                  <Ionicons name="paper-plane-outline" size={16} color="#1D4ED8" />
                  <Text style={[styles.smallBtnTxt, { color: '#1D4ED8' }]}>Mark sent</Text>
                </TouchableOpacity>
              ) : null}
              {canReceivePO(po.status) ? (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: INV, flex: 1 }]} onPress={openReceive}>
                  <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
                  <Text style={styles.actionBtnTxt}>Receive goods</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>
      ) : null}

      {/* Receive goods */}
      <Modal visible={recvOpen} animationType="slide" transparent onRequestClose={() => !acting && setRecvOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Receive goods</Text>
              <TouchableOpacity onPress={() => !acting && setRecvOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>
            <Text style={styles.help}>Quantities are pre-filled with what is still outstanding. Lower them for a partial delivery; the rest stays open.</Text>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
              {openLines.map(l => (
                <View key={l._id} style={styles.recvLine}>
                  <Text style={styles.recvName} numberOfLines={2}>{l.product?.name ?? 'Deleted product'}</Text>
                  <Text style={styles.recvSub}>Outstanding {fmtQty(outstanding(l))} {l.product?.unitOfMeasure ?? ''}</Text>
                  <View style={styles.recvInputs}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>RECEIVE NOW</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        value={rows[l._id]?.qty ?? ''}
                        onChangeText={t => setRows(r => ({ ...r, [l._id]: { ...(r[l._id] ?? { cost: '' }), qty: cleanDecimal(t) } }))}
                        placeholder="0"
                        placeholderTextColor="#94A3B8"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>UNIT COST</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        value={rows[l._id]?.cost ?? ''}
                        onChangeText={t => setRows(r => ({ ...r, [l._id]: { ...(r[l._id] ?? { qty: '' }), cost: cleanDecimal(t) } }))}
                        placeholder="0.00"
                        placeholderTextColor="#94A3B8"
                      />
                    </View>
                  </View>
                </View>
              ))}
              <View>
                <Text style={styles.label}>DELIVERY NOTE / GRN REF (optional)</Text>
                <TextInput style={styles.input} value={grnRef} onChangeText={setGrnRef} placeholder="e.g. DN-00123" placeholderTextColor="#94A3B8" maxLength={60} />
              </View>
            </ScrollView>
            <View style={styles.recvTotal}>
              <Text style={styles.totalLabel}>VALUE RECEIVED</Text>
              <Text style={styles.totalValue}>{fmtKES(receiveTotal)}</Text>
            </View>
            <TouchableOpacity style={[styles.submit, acting && { opacity: 0.5 }]} onPress={submitReceive} disabled={acting} activeOpacity={0.85}>
              {acting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitTxt}>Review and receive</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: INVBG },
  scroll: { padding: 16, gap: 14, paddingBottom: 16 },

  hero: { backgroundColor: INV, borderRadius: 18, padding: 20, gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  heroTop:      { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  poNum:        { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.8, marginBottom: 2, fontVariant: ['tabular-nums'] },
  supplierName: { fontSize: 18, fontWeight: '900', color: '#fff' },
  locationTxt:  { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  badge:        { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeTxt:     { fontSize: 11, fontWeight: '800' },
  totalAmount:  { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: -0.5, marginTop: 4 },
  heroMeta:     { flexDirection: 'row', gap: 14, flexWrap: 'wrap', marginTop: 4 },
  metaItem:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaTxt:      { fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: '500' },

  card:      { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, gap: 10 },
  cardTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  tableHeader: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  thTxt:       { fontSize: 10, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.5 },
  tableRow:    { flexDirection: 'row', paddingVertical: 8, borderRadius: 6, paddingHorizontal: 4, alignItems: 'center' },
  prodName:    { fontSize: 13, color: '#0F172A', fontWeight: '600' },
  prodSku:     { fontSize: 10, color: '#94A3B8', marginTop: 1 },
  tdNum:       { fontSize: 13, color: '#64748B', fontWeight: '600', textAlign: 'right', fontVariant: ['tabular-nums'] },

  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1.5, borderTopColor: '#E2E8F0', paddingTop: 10 },
  totalLabel: { fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 0.8 },
  totalValue: { fontSize: 18, fontWeight: '900', color: INV },

  receipt:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  receiptTop:   { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  receiptSub:   { fontSize: 11, color: '#64748B', marginTop: 2 },
  miniBadge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  miniBadgeTxt: { fontSize: 10, fontWeight: '800' },

  noteTxt:    { fontSize: 14, color: '#475569', lineHeight: 22 },
  auditRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  auditValue: { fontSize: 13, fontWeight: '600', color: '#0F172A' },

  footer:     { borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', padding: 16 },
  footerRow:  { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 15 },
  actionBtnTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
  smallBtn:    { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 15 },
  smallBtnTxt: { fontSize: 13, fontWeight: '800' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:   { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30, maxHeight: '92%', gap: 12 },
  sheetHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  help:    { fontSize: 12, color: '#64748B' },
  label:   { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#94A3B8', marginBottom: 4 },
  recvLine:   { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, gap: 6, borderWidth: 1, borderColor: '#E2E8F0' },
  recvName:   { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  recvSub:    { fontSize: 11, color: '#64748B' },
  recvInputs: { flexDirection: 'row', gap: 10, marginTop: 4 },
  input:   { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 12, height: 46, fontSize: 15, color: '#0F172A' },
  recvTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  submit:  { backgroundColor: INV, borderRadius: 14, height: 50, alignItems: 'center', justifyContent: 'center' },
  submitTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
