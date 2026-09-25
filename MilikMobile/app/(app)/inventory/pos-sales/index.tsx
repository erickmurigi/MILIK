import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Modal, ScrollView,
  ActivityIndicator, RefreshControl, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useDebounced, usePmsList, useReloadOnFocus } from '../../../../hooks/usePmsList';
import { fmtDate, fmtDateTime, fmtKES, todayISO } from '../../../../utils/pmsFormat';
import { fmtTime } from '../../../../utils/carwash';
import { pageOf } from '../../../../utils/sales';
import {
  INV, INVBG, SALE_FILTERS, dayParams, fmtQty, invError, normalizeSummary, payLabel, saleCustomer, shiftDay,
  userName, voidBody, type PosSale, type SalesSummary,
} from '../../../../utils/inventory';

const parse = (data: any) => pageOf<PosSale>(data);

export default function POSSalesScreen() {
  const today = todayISO();
  const [day,          setDay]          = useState(today);
  const [statusFilter, setStatusFilter] = useState('completed');
  const [search,       setSearch]       = useState('');
  const debounced = useDebounced(search.trim(), 400);

  const [summary,        setSummary]        = useState<SalesSummary | null>(null);
  const [summaryFailed,  setSummaryFailed]  = useState(false);
  const sumReq = useRef(0);

  const [selected,  setSelected]  = useState<PosSale | null>(null);
  const [voiding,   setVoiding]   = useState(false);   // the reason box is showing
  const [reason,    setReason]    = useState('');
  const [busy,      setBusy]      = useState(false);
  const busyRef = useRef(false);

  const params = useMemo(() => ({
    ...dayParams(day),
    status: statusFilter || undefined,
    search: debounced || undefined,
  }), [day, statusFilter, debounced]);

  const list = usePmsList<PosSale>({ path: '/pos/sales', params, limit: 30, parse });

  const loadSummary = useCallback(async () => {
    const id = ++sumReq.current;
    try {
      const { data } = await api.get('/pos/sales/summary', { params: dayParams(day) });
      if (id !== sumReq.current) return;
      setSummary(normalizeSummary(data?.data));
      setSummaryFailed(false);
    } catch {
      if (id !== sumReq.current) return;
      setSummaryFailed(true);
    }
  }, [day]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useReloadOnFocus(useCallback(() => { list.reload(); loadSummary(); }, [list.reload, loadSummary]));

  const refreshAll = () => { list.refresh(); loadSummary(); };

  const closeDetail = () => { if (busyRef.current) return; setSelected(null); setVoiding(false); setReason(''); };

  const confirmVoid = () => {
    if (!selected || busyRef.current) return;
    if (!reason.trim()) { Alert.alert('Reason needed', 'Say why this sale is being voided.'); return; }
    Alert.alert(
      'Void sale',
      `Void ${selected.receiptNumber} (${fmtKES(selected.grandTotal)})?\n\nThe stock is returned to ${selected.location?.name ?? 'the location'} and the sale is reversed in the accounts. This cannot be undone.`,
      [
        { text: 'Keep sale', style: 'cancel' },
        {
          text: 'Void sale',
          style: 'destructive',
          onPress: async () => {
            if (busyRef.current) return;
            busyRef.current = true; setBusy(true);
            try {
              await api.post(`/pos/sales/${selected._id}/void`, voidBody(reason));
              busyRef.current = false; setBusy(false);
              setSelected(null); setVoiding(false); setReason('');
            } catch (e) {
              Alert.alert('Could not void', invError(e, 'The sale was not voided.'));
            } finally {
              busyRef.current = false; setBusy(false);
              list.reload(); loadSummary();   // it may already have been voided elsewhere
            }
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: PosSale }) => {
    const voided = item.status === 'voided';
    const methods = (item.payments ?? []).map(p => `${payLabel(p.method)} ${fmtKES(p.amount)}`).join('  ·  ');
    const cashier = userName(item.cashier);
    return (
      <TouchableOpacity style={[styles.card, voided && { opacity: 0.7 }]} onPress={() => setSelected(item)} activeOpacity={0.75}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.receipt}>{item.receiptNumber ?? '—'}</Text>
            <Text style={styles.customer} numberOfLines={1}>{saleCustomer(item)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[styles.grandTotal, voided && { textDecorationLine: 'line-through', color: '#94A3B8' }]}>{fmtKES(item.grandTotal)}</Text>
            {voided ? <View style={styles.voidBadge}><Text style={styles.voidBadgeTxt}>VOIDED</Text></View> : null}
          </View>
        </View>
        <View style={styles.cardMid}>
          {cashier ? (
            <View style={styles.metaChip}>
              <Ionicons name="person-outline" size={11} color="#94A3B8" />
              <Text style={styles.metaChipTxt}>{cashier}</Text>
            </View>
          ) : null}
          {Number(item.totalDiscount) > 0 ? (
            <View style={styles.metaChip}>
              <Ionicons name="pricetag-outline" size={11} color="#DC2626" />
              <Text style={[styles.metaChipTxt, { color: '#DC2626' }]}>-{fmtKES(item.totalDiscount)}</Text>
            </View>
          ) : null}
          {Number(item.totalVat) > 0 ? (
            <View style={styles.metaChip}><Text style={styles.metaChipTxt}>VAT {fmtKES(item.totalVat)}</Text></View>
          ) : null}
        </View>
        {methods ? <Text style={styles.methods} numberOfLines={1}>{methods}</Text> : null}
        <Text style={styles.time}>{fmtTime(item.createdAt)}</Text>
      </TouchableOpacity>
    );
  };

  const isToday = day === today;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Date nav */}
      <View style={styles.dateNav}>
        <TouchableOpacity style={styles.dateBtn} onPress={() => setDay(d => shiftDay(d, -1))}>
          <Ionicons name="chevron-back" size={20} color={INV} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateCenter} onPress={() => setDay(today)} disabled={isToday} activeOpacity={0.7}>
          <Text style={styles.dateLabel}>{fmtDate(day + 'T00:00:00')}</Text>
          <Text style={styles.dateSub}>{isToday ? 'Today' : 'Tap for today'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.dateBtn, isToday && { opacity: 0.3 }]} onPress={() => setDay(d => shiftDay(d, 1))} disabled={isToday}>
          <Ionicons name="chevron-forward" size={20} color={INV} />
        </TouchableOpacity>
      </View>

      {/* Day summary (completed sales only) */}
      <View style={styles.summary}>
        {summary ? (
          <>
            <View style={styles.sumItem}><Text style={styles.sumVal}>{summary.count}</Text><Text style={styles.sumLbl}>Sales</Text></View>
            <View style={styles.sumItem}><Text style={styles.sumVal}>{fmtKES(summary.grandTotal)}</Text><Text style={styles.sumLbl}>Total</Text></View>
            <View style={styles.sumItem}><Text style={styles.sumVal}>{fmtKES(summary.totalVat)}</Text><Text style={styles.sumLbl}>VAT</Text></View>
            <View style={styles.sumItem}><Text style={styles.sumVal}>{fmtKES(summary.totalDiscount)}</Text><Text style={styles.sumLbl}>Discounts</Text></View>
          </>
        ) : (
          <Text style={styles.sumLbl}>{summaryFailed ? 'Day totals could not be loaded' : 'Loading totals...'}</Text>
        )}
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Receipt no., customer, phone..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={{ flexGrow: 0 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow} keyboardShouldPersistTaps="handled">
          {SALE_FILTERS.map(t => (
            <TouchableOpacity key={t.key || 'all'} style={[styles.tab, statusFilter === t.key && styles.tabActive]} onPress={() => setStatusFilter(t.key)}>
              <Text style={[styles.tabTxt, statusFilter === t.key && styles.tabTxtActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {list.loading ? <MilikLoader fullscreen /> : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : (
        <>
          {list.error ? <ErrorBanner message={list.error} onRetry={list.retry} /> : null}
          <FlatList
            data={list.items}
            keyExtractor={s => s._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={refreshAll} tintColor={INV} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="cart-outline" size={48} color="#CBD5E1" />
                <Text style={styles.emptyTxt}>{debounced || statusFilter !== 'completed' ? 'No sales match' : 'No sales on this day'}</Text>
              </View>
            }
            ListFooterComponent={list.loadingMore ? <ActivityIndicator color={INV} style={{ padding: 20 }} /> : null}
          />
        </>
      )}

      {/* Sale detail + void */}
      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={closeDetail}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
          {selected ? (
            <View style={styles.sheet}>
              <View style={styles.sheetHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle}>{selected.receiptNumber}</Text>
                  <Text style={styles.sheetSub}>{fmtDateTime(selected.createdAt)}{selected.location?.name ? `  ·  ${selected.location.name}` : ''}</Text>
                </View>
                <TouchableOpacity onPress={closeDetail} hitSlop={8}><Ionicons name="close" size={22} color="#64748B" /></TouchableOpacity>
              </View>

              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
                {selected.status === 'voided' ? (
                  <View style={styles.voidBox}>
                    <Text style={styles.voidTitle}>Voided {selected.voidedAt ? fmtDateTime(selected.voidedAt) : ''}{userName(selected.voidedBy) ? ` by ${userName(selected.voidedBy)}` : ''}</Text>
                    {selected.voidReason ? <Text style={styles.voidReason}>{selected.voidReason}</Text> : null}
                  </View>
                ) : null}

                <Text style={styles.detailLine}>
                  {saleCustomer(selected)}{selected.customerName && selected.customerPhone ? `  ·  ${selected.customerPhone}` : ''}
                  {userName(selected.cashier) ? `  ·  Cashier ${userName(selected.cashier)}` : ''}
                </Text>

                <View style={styles.linesBox}>
                  {(selected.lines ?? []).map((l, i) => (
                    <View key={l._id ?? i} style={styles.lineRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.lineName} numberOfLines={2}>{l.productName || 'Item'}</Text>
                        <Text style={styles.lineSub}>
                          {fmtQty(l.qty)} × {fmtKES(l.unitPrice)}{Number(l.discount) > 0 ? `  (-${fmtKES(l.discount)} each)` : ''}{Number(l.vatRate) > 0 ? `  · VAT ${l.vatRate}%` : ''}
                        </Text>
                      </View>
                      <Text style={styles.lineTotal}>{fmtKES(l.lineTotal)}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.totals}>
                  <TotalRow label="Subtotal" value={fmtKES(selected.subtotal)} />
                  {Number(selected.totalDiscount) > 0 ? <TotalRow label="Discount" value={`-${fmtKES(selected.totalDiscount)}`} /> : null}
                  {Number(selected.totalVat) > 0 ? <TotalRow label="VAT" value={fmtKES(selected.totalVat)} /> : null}
                  <TotalRow label="Total" value={fmtKES(selected.grandTotal)} bold />
                  {(selected.payments ?? []).map((p, i) => (
                    <TotalRow key={i} label={`Paid · ${payLabel(p.method)}${p.ref ? ` (${p.ref})` : ''}`} value={fmtKES(p.amount)} />
                  ))}
                  {Number(selected.change) > 0 ? <TotalRow label="Change" value={fmtKES(selected.change)} /> : null}
                </View>
                {selected.notes ? <Text style={styles.notes}>{selected.notes}</Text> : null}

                {selected.status === 'completed' ? (
                  voiding ? (
                    <View style={{ gap: 8 }}>
                      <Text style={styles.label}>REASON FOR VOIDING (required)</Text>
                      <TextInput
                        style={styles.reasonInput}
                        value={reason}
                        onChangeText={setReason}
                        placeholder="e.g. Customer returned items, wrong product scanned"
                        placeholderTextColor="#94A3B8"
                        multiline
                        maxLength={300}
                        autoFocus
                      />
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity style={[styles.btn, { backgroundColor: '#F1F5F9' }]} onPress={() => { setVoiding(false); setReason(''); }} disabled={busy}>
                          <Text style={[styles.btnTxt, { color: '#475569' }]}>Back</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.btn, { backgroundColor: '#DC2626', flex: 1 }, (busy || !reason.trim()) && { opacity: 0.5 }]} onPress={confirmVoid} disabled={busy}>
                          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Void this sale</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity style={[styles.btn, { backgroundColor: '#FEE2E2' }]} onPress={() => setVoiding(true)}>
                      <Ionicons name="ban-outline" size={16} color="#DC2626" />
                      <Text style={[styles.btnTxt, { color: '#DC2626' }]}>Void sale</Text>
                    </TouchableOpacity>
                  )
                ) : null}
              </ScrollView>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLbl, bold && { fontWeight: '900', color: '#0F172A' }]}>{label}</Text>
      <Text style={[styles.totalVal, bold && { fontWeight: '900', fontSize: 16 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: INVBG },

  dateNav:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  dateBtn:    { width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  dateCenter: { alignItems: 'center' },
  dateLabel:  { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  dateSub:    { fontSize: 10, color: '#94A3B8', marginTop: 1 },

  summary: { flexDirection: 'row', backgroundColor: INV, marginHorizontal: 16, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10, minHeight: 56, alignItems: 'center' },
  sumItem: { flex: 1, alignItems: 'center' },
  sumVal:  { fontSize: 12, fontWeight: '900', color: '#fff' },
  sumLbl:  { fontSize: 9, color: 'rgba(255,255,255,0.65)', marginTop: 2, fontWeight: '600' },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginBottom: 10, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 46 },
  searchInput: { flex: 1, fontSize: 15, color: '#0F172A' },

  tabsRow:     { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  tab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabActive:   { backgroundColor: INV, borderColor: INV },
  tabTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  tabTxtActive:{ color: '#fff' },

  list:      { paddingHorizontal: 16, paddingBottom: 40 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 50 },
  emptyTxt:  { fontSize: 15, color: '#94A3B8' },

  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 8 },
  cardTop:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  receipt:    { fontSize: 13, fontWeight: '800', color: INV, fontVariant: ['tabular-nums'] },
  customer:   { fontSize: 13, color: '#475569', marginTop: 2 },
  grandTotal: { fontSize: 16, fontWeight: '900', color: '#0F172A' },
  voidBadge:  { backgroundColor: '#FEE2E2', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  voidBadgeTxt: { fontSize: 9, fontWeight: '800', color: '#DC2626' },
  cardMid:    { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  metaChip:   { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F1F5F9', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  metaChipTxt:{ fontSize: 10, fontWeight: '600', color: '#64748B' },
  methods:    { fontSize: 11, color: '#64748B' },
  time:       { fontSize: 11, color: '#94A3B8' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:   { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30, maxHeight: '92%', gap: 12 },
  sheetHead:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  sheetSub:   { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  detailLine: { fontSize: 13, color: '#475569' },

  voidBox:    { backgroundColor: '#FEF2F2', borderRadius: 10, padding: 10, gap: 3 },
  voidTitle:  { fontSize: 12, fontWeight: '800', color: '#DC2626' },
  voidReason: { fontSize: 12, color: '#7F1D1D' },

  linesBox: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 10, gap: 10 },
  lineRow:  { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  lineName: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  lineSub:  { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  lineTotal:{ fontSize: 13, fontWeight: '800', color: '#0F172A', fontVariant: ['tabular-nums'] },

  totals:   { gap: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLbl: { fontSize: 12, color: '#64748B' },
  totalVal: { fontSize: 13, fontWeight: '700', color: '#0F172A', fontVariant: ['tabular-nums'] },
  notes:    { fontSize: 12, color: '#64748B', fontStyle: 'italic' },

  label:       { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#94A3B8' },
  reasonInput: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingTop: 10, height: 76, textAlignVertical: 'top', fontSize: 14, color: '#0F172A' },
  btn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, height: 46, paddingHorizontal: 18 },
  btnTxt: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
