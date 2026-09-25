import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { DateField } from '../../../../components/ui/DateField';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { apiError, fmtDate, fmtMoney, todayISO } from '../../../../utils/pmsFormat';

// ── Types (shapes as returned by /late-penalties/*) ───────────────────────────
type Rule = {
  _id:                string;
  ruleName:           string;
  active:             boolean;
  effectiveFrom?:     string;
  graceDays?:         number;
  minimumOverdueDays?: number;
  penalizeItem?:      string;
  calculationType?:   string;
  rateOrAmount?:      number;
  maximumPenaltyCap?: number;
};

type BatchItem = {
  _id:                  string;
  status:               string;   // processed | skipped | duplicate | failed | reversed | deleted
  calculatedPenalty:    number;
  overdueDays?:         number;
  outstandingBalance?:  number;
  reason?:              string;
  isDeleted?:           boolean;
  reversedAt?:          string | null;
  sourceInvoiceNumber?: string;
  tenant?:              { name?: string } | null;
  unit?:                { unitNumber?: string } | null;
  property?:            { propertyName?: string } | null;
  penaltyInvoice?:      { invoiceNumber?: string; status?: string } | null;
};

type Batch = {
  _id:                  string;
  batchName?:           string;
  ruleName?:            string;
  rule?:                { ruleName?: string } | null;
  runDate:              string;
  createdAt:            string;
  totalPenaltyAmount:   number;
  invoicesCreatedCount: number;
  status:               string;   // processed | partial | failed | reversed_ready
  canDeleteBatch?:      boolean;
  items?:               BatchItem[];
};

type PreviewRow = {
  sourceInvoiceId:     string;
  sourceInvoiceNumber: string;
  tenantName:          string;
  unitNumber:          string;
  propertyName:        string;
  overdueDays:         number;
  outstandingBalance:  number;
  calculatedPenalty:   number;
  skippedReason:       string;
};

type Preview = {
  summary: { totalRows: number; eligibleCount: number; skippedCount: number; totalPenaltyAmount: number };
  rows:    PreviewRow[];
};

// ── Labels ────────────────────────────────────────────────────────────────────
const CALC_LABEL = (r: Rule) => {
  const v = Number(r.rateOrAmount || 0);
  switch (r.calculationType) {
    case 'flat_amount':                return `KES ${fmtMoney(v)} flat`;
    case 'percentage_overdue_balance': return `${v}% of overdue balance`;
    case 'daily_fixed_amount':         return `KES ${fmtMoney(v)} per day overdue`;
    case 'daily_percentage':           return `${v}% of balance per day`;
    default:                           return `${v}`;
  }
};

const PENALIZE_LABEL: Record<string, string> = {
  rent_only:                         'Rent only',
  current_period_rent_only:          'Current-period rent',
  current_period_bill_balance_only:  'Current-period bills',
  all_arrears:                       'All arrears',
  outstanding_invoice_balance:       'Outstanding invoice balance',
};

const ruleSummary = (r: Rule) =>
  [
    CALC_LABEL(r),
    `grace ${Number(r.graceDays || 0)}d`,
    r.penalizeItem ? PENALIZE_LABEL[r.penalizeItem] ?? r.penalizeItem : '',
    Number(r.maximumPenaltyCap || 0) > 0 ? `cap KES ${fmtMoney(r.maximumPenaltyCap)}` : '',
  ].filter(Boolean).join(' · ');

const BATCH_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  processed:      { label: 'PROCESSED', bg: Colors.successLight, text: Colors.success },
  partial:        { label: 'PARTIAL',   bg: Colors.warningLight, text: Colors.warning },
  failed:         { label: 'FAILED',    bg: Colors.dangerLight,  text: Colors.danger },
  reversed_ready: { label: 'REVERSED',  bg: Colors.borderLight,  text: Colors.textMuted },
};

const ITEM_STATUS: Record<string, { label: string; color: string }> = {
  processed: { label: 'Processed', color: Colors.success },
  reversed:  { label: 'Reversed',  color: Colors.textMuted },
  deleted:   { label: 'Deleted',   color: Colors.textMuted },
  failed:    { label: 'Failed',    color: Colors.danger },
  duplicate: { label: 'Duplicate', color: Colors.warning },
  skipped:   { label: 'Skipped',   color: Colors.warning },
};

const itemStatus = (it: BatchItem) =>
  it.isDeleted ? 'deleted' : it.reversedAt ? 'reversed' : (it.status || 'processed');

// ── Screen ────────────────────────────────────────────────────────────────────
export default function PenaltiesScreen() {
  const [rules,      setRules]      = useState<Rule[]>([]);
  const [batches,    setBatches]    = useState<Batch[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const reqRef = useRef(0);

  // Run-batch modal state
  const [modalOpen,    setModalOpen]    = useState(false);
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [runDate,      setRunDate]      = useState(todayISO());
  const [preview,      setPreview]      = useState<Preview | null>(null);
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [showSkipped,  setShowSkipped]  = useState(false);
  const [previewing,   setPreviewing]   = useState(false);
  const [processing,   setProcessing]   = useState(false);

  // Batch detail modal
  const [detailId,  setDetailId]  = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState<string | null>(null); // item id or 'batch'

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    const id = ++reqRef.current;
    if (mode === 'initial') setLoading(true);
    else if (mode === 'refresh') setRefreshing(true);
    try {
      const [rulesRes, batchesRes] = await Promise.all([
        api.get('/late-penalties/rules'),
        api.get('/late-penalties/batches'),
      ]);
      if (id !== reqRef.current) return;
      setRules(Array.isArray(rulesRes.data?.rules) ? rulesRes.data.rules : []);
      setBatches(Array.isArray(batchesRes.data?.batches) ? batchesRes.data.batches : []);
      setError(null);
    } catch (err) {
      if (id !== reqRef.current) return;
      setError(apiError(err, 'Could not load late penalties.'));
    } finally {
      if (id === reqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeRules = useMemo(() => rules.filter(r => r.active), [rules]);
  const detailBatch = useMemo(() => batches.find(b => b._id === detailId) ?? null, [batches, detailId]);

  // ── Run batch ────────────────────────────────────────────────────────────
  const resetPreview = () => { setPreview(null); setSelected(new Set()); setShowSkipped(false); };

  const openModal = () => {
    setSelectedRule(activeRules[0] ?? null);
    setRunDate(todayISO());
    resetPreview();
    setModalOpen(true);
  };

  const closeModal = () => { if (!processing) setModalOpen(false); };

  const runPreview = async () => {
    if (!selectedRule || previewing) return;
    if (runDate > todayISO()) { Alert.alert('Invalid date', 'The run date cannot be in the future.'); return; }
    if (selectedRule.effectiveFrom && runDate < selectedRule.effectiveFrom.slice(0, 10)) {
      Alert.alert('Invalid date', `This rule only becomes effective on ${fmtDate(selectedRule.effectiveFrom)}.`);
      return;
    }
    setPreviewing(true);
    try {
      const { data } = await api.post('/late-penalties/preview', { ruleId: selectedRule._id, runDate }, { timeout: 120_000 });
      const p: Preview = { summary: data?.summary, rows: Array.isArray(data?.rows) ? data.rows : [] };
      setPreview(p);
      setSelected(new Set(p.rows.filter(r => !r.skippedReason && r.calculatedPenalty > 0).map(r => r.sourceInvoiceId)));
      setShowSkipped(false);
    } catch (err) {
      Alert.alert('Preview failed', apiError(err, 'Could not generate preview.'));
    } finally { setPreviewing(false); }
  };

  const eligibleRows = useMemo(
    () => (preview?.rows ?? []).filter(r => !r.skippedReason && r.calculatedPenalty > 0),
    [preview],
  );
  const skippedRows = useMemo(() => (preview?.rows ?? []).filter(r => !!r.skippedReason), [preview]);
  const selectedTotal = useMemo(
    () => eligibleRows.reduce((s, r) => (selected.has(r.sourceInvoiceId) ? s + r.calculatedPenalty : s), 0),
    [eligibleRows, selected],
  );

  const toggleRow = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const allSelected = eligibleRows.length > 0 && selected.size === eligibleRows.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(eligibleRows.map(r => r.sourceInvoiceId)));

  const applyPenalties = () => {
    if (!selectedRule || !preview || processing) return;
    if (selected.size === 0) { Alert.alert('Nothing selected', 'Select at least one tenant to charge.'); return; }
    Alert.alert(
      'Apply late penalties',
      `Create ${selected.size} penalty invoice${selected.size === 1 ? '' : 's'} totalling KES ${fmtMoney(selectedTotal)} ` +
        `using "${selectedRule.ruleName}" as at ${fmtDate(runDate)}?\n\nThese are posted to the ledger. You can reverse them later from the batch.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          style: 'destructive',
          onPress: async () => {
            setProcessing(true);
            try {
              const { data } = await api.post('/late-penalties/process', {
                ruleId: selectedRule._id,
                runDate,
                // must be non-empty: the server treats an empty list as "process everything"
                selectedSourceInvoiceIds: [...selected],
                batchName: `Late Penalties ${runDate}`,
              }, { timeout: 120_000 });
              const s = data?.summary ?? {};
              setModalOpen(false);
              resetPreview();
              load('silent');
              const parts = [`${s.processedCount ?? 0} penalty invoice(s) created`];
              if (s.duplicateCount) parts.push(`${s.duplicateCount} already existed`);
              if (s.failedCount) parts.push(`${s.failedCount} failed`);
              Alert.alert(s.failedCount ? 'Processed with issues' : 'Done', `${parts.join(', ')}. Total KES ${fmtMoney(s.totalPenaltyAmount)}.`);
            } catch (err) {
              Alert.alert('Error', apiError(err, 'Failed to apply penalties.'));
            } finally { setProcessing(false); }
          },
        },
      ],
    );
  };

  // ── Batch actions ────────────────────────────────────────────────────────
  const reverseItem = (batch: Batch, item: BatchItem) => {
    if (batchBusy) return;
    Alert.alert(
      'Reverse penalty',
      `Reverse the KES ${fmtMoney(item.calculatedPenalty)} penalty for ${item.tenant?.name ?? 'this tenant'}? ` +
        `The penalty invoice${item.penaltyInvoice?.invoiceNumber ? ` ${item.penaltyInvoice.invoiceNumber}` : ''} will be reversed in the ledger.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reverse',
          style: 'destructive',
          onPress: async () => {
            setBatchBusy(item._id);
            try {
              await api.post('/late-penalties/reverse', { itemIds: [item._id], reason: 'Reversed from mobile app' });
              await load('silent');
            } catch (err) {
              Alert.alert('Could not reverse', apiError(err, 'Failed to reverse penalty.'));
            } finally { setBatchBusy(null); }
          },
        },
      ],
    );
  };

  const deleteBatch = (batch: Batch) => {
    if (batchBusy) return;
    if (!batch.canDeleteBatch) {
      Alert.alert('Cannot delete', 'Reverse every active penalty invoice in this batch first.');
      return;
    }
    Alert.alert('Delete batch', `Delete "${batch.batchName || 'this batch'}"? All its penalty invoices are already cleared, so only the batch record is removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBatchBusy('batch');
          try {
            await api.delete(`/late-penalties/batches/${batch._id}`);
            setDetailId(null);
            await load('silent');
          } catch (err) {
            Alert.alert('Could not delete', apiError(err, 'Failed to delete batch.'));
          } finally { setBatchBusy(null); }
        },
      },
    ]);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const renderBatch = ({ item }: { item: Batch }) => {
    const st = BATCH_STATUS[item.status] ?? BATCH_STATUS.processed;
    return (
      <TouchableOpacity style={styles.card} onPress={() => setDetailId(item._id)} activeOpacity={0.75}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.ruleName} numberOfLines={1}>{item.rule?.ruleName ?? item.ruleName ?? item.batchName ?? 'Penalty batch'}</Text>
            <Text style={styles.meta}>Run date: {fmtDate(item.runDate)}</Text>
            <Text style={styles.meta}>Created: {fmtDate(item.createdAt)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={styles.amount}>KES {fmtMoney(item.totalPenaltyAmount)}</Text>
            <Text style={styles.count}>{item.invoicesCreatedCount} invoice{item.invoicesCreatedCount === 1 ? '' : 's'}</Text>
            <View style={[styles.badge, { backgroundColor: st.bg }]}>
              <Text style={[styles.badgeText, { color: st.text }]}>{st.label}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderPreviewRow = ({ item }: { item: PreviewRow }) => {
    const skipped = !!item.skippedReason;
    const on = selected.has(item.sourceInvoiceId);
    return (
      <TouchableOpacity
        style={styles.previewRowItem}
        onPress={() => !skipped && toggleRow(item.sourceInvoiceId)}
        activeOpacity={skipped ? 1 : 0.7}
      >
        {!skipped ? (
          <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? Colors.primary : Colors.border} />
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.previewTenant} numberOfLines={1}>
            {item.tenantName}{item.unitNumber && item.unitNumber !== '-' ? ` · ${item.unitNumber}` : ''}
          </Text>
          <Text style={styles.dateHint} numberOfLines={1}>
            {[item.propertyName, item.sourceInvoiceNumber, `${item.overdueDays}d after grace`, `bal ${fmtMoney(item.outstandingBalance)}`].filter(Boolean).join(' · ')}
          </Text>
          {skipped ? <Text style={[styles.dateHint, { color: Colors.warning }]}>{item.skippedReason}</Text> : null}
        </View>
        {!skipped ? <Text style={[styles.previewAmt, { color: Colors.danger }]}>{fmtMoney(item.calculatedPenalty)}</Text> : null}
      </TouchableOpacity>
    );
  };

  const modalHeader = (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>SELECT RULE</Text>
        {rules.map(r => {
          const on = selectedRule?._id === r._id;
          return (
            <TouchableOpacity
              key={r._id}
              style={[styles.ruleOption, on && styles.ruleOptionActive, !r.active && { opacity: 0.5 }]}
              disabled={!r.active}
              onPress={() => { setSelectedRule(r); resetPreview(); }}
            >
              <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={18} color={on ? Colors.primary : Colors.border} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.ruleOptionText, on && { color: Colors.primary }]}>{r.ruleName}{r.active ? '' : '  (inactive)'}</Text>
                <Text style={styles.dateHint}>{ruleSummary(r)}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View>
        <DateField label="RUN DATE" value={runDate} onChange={(v) => { setRunDate(v); resetPreview(); }} required />
        <Text style={[styles.dateHint, { marginTop: 6 }]}>Penalties are calculated on invoices overdue as at this date (not in the future).</Text>
      </View>

      {!preview ? (
        <TouchableOpacity
          style={[styles.btn, (!selectedRule || previewing) && styles.btnDisabled]}
          onPress={runPreview}
          disabled={!selectedRule || previewing}
        >
          {previewing ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.btnText}>Preview Penalties</Text>}
        </TouchableOpacity>
      ) : (
        <>
          <View style={styles.previewCard}>
            <Text style={styles.sectionTitle}>PREVIEW</Text>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Eligible invoices</Text>
              <Text style={styles.previewValue}>{preview.summary?.eligibleCount ?? eligibleRows.length}</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Skipped</Text>
              <Text style={styles.previewValue}>{preview.summary?.skippedCount ?? skippedRows.length}</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Selected ({selected.size})</Text>
              <Text style={[styles.previewValue, { color: Colors.danger }]}>KES {fmtMoney(selectedTotal)}</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setShowSkipped(false)} hitSlop={6}>
              <Text style={[styles.linkText, !showSkipped && styles.linkTextActive]}>Eligible ({eligibleRows.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSkipped(true)} hitSlop={6}>
              <Text style={[styles.linkText, showSkipped && styles.linkTextActive]}>Skipped ({skippedRows.length})</Text>
            </TouchableOpacity>
            {!showSkipped && eligibleRows.length > 0 ? (
              <TouchableOpacity onPress={toggleAll} hitSlop={6}>
                <Text style={styles.linkText}>{allSelected ? 'Select none' : 'Select all'}</Text>
              </TouchableOpacity>
            ) : <View />}
          </View>
        </>
      )}
    </View>
  );

  const modalFooter = preview ? (
    <View style={styles.modalFooter}>
      <TouchableOpacity style={[styles.btn, { flex: 1, backgroundColor: Colors.border }]} onPress={resetPreview} disabled={processing}>
        <Text style={[styles.btnText, { color: Colors.text }]}>Recalculate</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.btn, { flex: 1.4, backgroundColor: Colors.danger }, (processing || selected.size === 0) && styles.btnDisabled]}
        onPress={applyPenalties}
        disabled={processing || selected.size === 0}
      >
        {processing
          ? <ActivityIndicator size="small" color={Colors.white} />
          : <Text style={styles.btnText}>Apply {selected.size} Penalt{selected.size === 1 ? 'y' : 'ies'}</Text>}
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {loading ? (
        <MilikLoader fullscreen />
      ) : error && rules.length === 0 && batches.length === 0 ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : (
        <FlatList
          data={batches}
          keyExtractor={item => item._id}
          renderItem={renderBatch}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={Colors.primary} />}
          ListHeaderComponent={
            <View style={{ gap: 12 }}>
              {error ? <ErrorBanner message={error} onRetry={() => load('refresh')} /> : null}
              <View style={styles.rulesCard}>
                <Text style={styles.sectionTitle}>PENALTY RULES</Text>
                {rules.length === 0 ? (
                  <Text style={styles.dateHint}>No rules yet. Create a late penalty rule on the web app first.</Text>
                ) : rules.map(r => (
                  <View key={r._id} style={styles.ruleRow}>
                    <Ionicons name={r.active ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={r.active ? Colors.success : Colors.border} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.ruleLabel, !r.active && { color: Colors.textMuted }]}>{r.ruleName}</Text>
                      <Text style={styles.dateHint}>{ruleSummary(r)}</Text>
                    </View>
                  </View>
                ))}
              </View>
              {batches.length > 0 ? <Text style={styles.sectionTitle}>RECENT BATCHES</Text> : null}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="alert-circle-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No penalty batches yet</Text>
            </View>
          }
        />
      )}

      {/* FAB */}
      {!loading && activeRules.length > 0 ? (
        <TouchableOpacity style={styles.fab} onPress={openModal} activeOpacity={0.85}>
          <Ionicons name="add" size={28} color={Colors.white} />
        </TouchableOpacity>
      ) : null}

      {/* Run Batch Modal */}
      <Modal visible={modalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
        <SafeAreaView style={styles.modalSafe} edges={['bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Run Penalty Batch</Text>
            <TouchableOpacity onPress={closeModal} hitSlop={8} disabled={processing}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={preview ? (showSkipped ? skippedRows : eligibleRows) : []}
            keyExtractor={r => r.sourceInvoiceId}
            renderItem={renderPreviewRow}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 20, gap: 8 }}
            ListHeaderComponent={modalHeader}
            ListEmptyComponent={
              preview ? (
                <Text style={[styles.dateHint, { textAlign: 'center', paddingVertical: 20 }]}>
                  {showSkipped ? 'No skipped invoices.' : 'Nothing is eligible for penalties on this date.'}
                </Text>
              ) : null
            }
          />
          {modalFooter}
        </SafeAreaView>
      </Modal>

      {/* Batch detail modal */}
      <Modal visible={!!detailBatch} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailId(null)}>
        <SafeAreaView style={styles.modalSafe} edges={['bottom']}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle} numberOfLines={1}>{detailBatch?.batchName || 'Penalty batch'}</Text>
              {detailBatch ? (
                <Text style={styles.meta}>
                  {detailBatch.rule?.ruleName ?? detailBatch.ruleName} · run {fmtDate(detailBatch.runDate)} · KES {fmtMoney(detailBatch.totalPenaltyAmount)}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={() => setDetailId(null)} hitSlop={8}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={detailBatch?.items ?? []}
            keyExtractor={it => it._id}
            contentContainerStyle={{ padding: 20, gap: 8 }}
            renderItem={({ item }) => {
              const st = itemStatus(item);
              const meta = ITEM_STATUS[st] ?? ITEM_STATUS.processed;
              const canReverse = st === 'processed' && !!detailBatch;
              return (
                <View style={styles.previewRowItem}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.previewTenant} numberOfLines={1}>
                      {item.tenant?.name ?? 'Tenant'}{item.unit?.unitNumber ? ` · ${item.unit.unitNumber}` : ''}
                    </Text>
                    <Text style={styles.dateHint} numberOfLines={1}>
                      {[item.property?.propertyName, item.sourceInvoiceNumber, item.penaltyInvoice?.invoiceNumber].filter(Boolean).join(' · ')}
                    </Text>
                    <Text style={[styles.dateHint, { color: meta.color, fontWeight: '700' }]}>
                      {meta.label}{item.reason && st !== 'processed' ? ` — ${item.reason}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={[styles.previewAmt, { color: st === 'processed' ? Colors.danger : Colors.textMuted }]}>{fmtMoney(item.calculatedPenalty)}</Text>
                    {canReverse ? (
                      batchBusy === item._id ? (
                        <ActivityIndicator size="small" color={Colors.primary} />
                      ) : (
                        <TouchableOpacity style={styles.smallBtn} onPress={() => detailBatch && reverseItem(detailBatch, item)} disabled={!!batchBusy}>
                          <Text style={styles.smallBtnText}>Reverse</Text>
                        </TouchableOpacity>
                      )
                    ) : null}
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={<Text style={[styles.dateHint, { textAlign: 'center', paddingVertical: 20 }]}>This batch has no items.</Text>}
          />
          {detailBatch ? (
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.btn, { flex: 1, backgroundColor: detailBatch.canDeleteBatch ? Colors.danger : Colors.border }, !!batchBusy && styles.btnDisabled]}
                onPress={() => deleteBatch(detailBatch)}
                disabled={!!batchBusy}
              >
                {batchBusy === 'batch'
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={[styles.btnText, !detailBatch.canDeleteBatch && { color: Colors.textMuted }]}>Delete batch</Text>}
              </TouchableOpacity>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  list:    { padding: 16, gap: 12, paddingBottom: 100 },
  empty:   { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textMuted },

  rulesCard: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 10,
  },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  ruleLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },

  card: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, padding: 14,
  },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  ruleName: { fontSize: 14, fontWeight: '800', color: Colors.text },
  meta:    { fontSize: 11, color: Colors.textMuted },
  amount:  { fontSize: 15, fontWeight: '800', color: Colors.danger },
  count:   { fontSize: 12, color: Colors.textMuted, fontWeight: '600' },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },

  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },

  modalSafe:   { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle:  { fontSize: 17, fontWeight: '800', color: Colors.text },
  modalFooter: {
    flexDirection: 'row', gap: 10, padding: 16,
    borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.white,
  },

  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },

  ruleOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  ruleOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFaded },
  ruleOptionText:   { fontSize: 14, fontWeight: '600', color: Colors.text },

  dateHint:    { fontSize: 12, color: Colors.textMuted },

  btn: {
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontSize: 15, fontWeight: '700', color: Colors.white },

  previewCard: {
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 10,
  },
  previewRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewLabel: { fontSize: 13, color: Colors.textSecondary },
  previewValue: { fontSize: 14, fontWeight: '800', color: Colors.text },

  linkText:       { fontSize: 12, fontWeight: '700', color: Colors.textMuted },
  linkTextActive: { color: Colors.primary },

  previewRowItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  previewTenant: { fontSize: 13, fontWeight: '600', color: Colors.text },
  previewAmt:    { fontSize: 13, fontWeight: '700' },

  smallBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.danger,
  },
  smallBtnText: { fontSize: 11, fontWeight: '700', color: Colors.danger },
});
