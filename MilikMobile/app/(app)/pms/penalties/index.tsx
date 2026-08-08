import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';

type Rule = {
  _id:      string;
  ruleName: string;
  active:   boolean;
};

type BatchItem = {
  tenant?:    { name?: string };
  unit?:      { unitNumber?: string };
  property?:  { propertyName?: string; name?: string };
  amount:     number;
  invoice?:   { invoiceNumber?: string };
};

type Batch = {
  _id:       string;
  rule?:     { ruleName?: string };
  runDate:   string;
  createdAt: string;
  totalPenaltyAmount: number;
  eligibleCount:      number;
  status:    string;
  items?:    BatchItem[];
};

type PreviewRow = {
  tenant?:   { name?: string };
  unit?:     { unitNumber?: string };
  amount:    number;
};

type Preview = {
  summary: { eligibleCount: number; totalPenaltyAmount: number };
  rows:    PreviewRow[];
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

export default function PenaltiesScreen() {
  const [rules,       setRules]       = useState<Rule[]>([]);
  const [batches,     setBatches]     = useState<Batch[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  // Run-batch modal state
  const [modalOpen,   setModalOpen]   = useState(false);
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [runDate,     setRunDate]     = useState(new Date().toISOString().slice(0, 10));
  const [preview,     setPreview]     = useState<Preview | null>(null);
  const [previewing,  setPreviewing]  = useState(false);
  const [processing,  setProcessing]  = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [rulesRes, batchesRes] = await Promise.all([
        api.get('/late-penalties/rules'),
        api.get('/late-penalties/batches'),
      ]);
      setRules(rulesRes.data?.rules ?? rulesRes.data ?? []);
      setBatches(batchesRes.data?.data ?? batchesRes.data ?? []);
    } catch { /* fail silently */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openModal = () => {
    const active = rules.find(r => r.active) ?? rules[0] ?? null;
    setSelectedRule(active);
    setPreview(null);
    setModalOpen(true);
  };

  const runPreview = async () => {
    if (!selectedRule) return;
    setPreviewing(true);
    try {
      const { data } = await api.post('/late-penalties/preview', {
        ruleId:  selectedRule._id,
        runDate,
      });
      setPreview(data);
    } catch (err: any) {
      Alert.alert('Preview failed', err?.response?.data?.message ?? 'Could not generate preview.');
    } finally { setPreviewing(false); }
  };

  const applyPenalties = async () => {
    if (!selectedRule || !preview) return;
    Alert.alert(
      'Apply Penalties',
      `Apply KES ${fmt(preview.summary.totalPenaltyAmount)} in penalties to ${preview.summary.eligibleCount} tenant(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          style: 'destructive',
          onPress: async () => {
            setProcessing(true);
            try {
              await api.post('/late-penalties/process', { ruleId: selectedRule._id, runDate });
              setModalOpen(false);
              setPreview(null);
              await load();
              Alert.alert('Done', 'Penalties applied successfully.');
            } catch (err: any) {
              Alert.alert('Error', err?.response?.data?.message ?? 'Failed to apply penalties.');
            } finally { setProcessing(false); }
          },
        },
      ]
    );
  };

  const renderBatch = ({ item }: { item: Batch }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.ruleName}>{item.rule?.ruleName ?? 'Penalty Batch'}</Text>
          <Text style={styles.meta}>Run date: {fmtDate(item.runDate)}</Text>
          <Text style={styles.meta}>Applied: {fmtDate(item.createdAt)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={styles.amount}>KES {fmt(item.totalPenaltyAmount)}</Text>
          <Text style={styles.count}>{item.eligibleCount} tenants</Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={batches}
          keyExtractor={item => item._id}
          renderItem={renderBatch}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.primary} />
          }
          ListHeaderComponent={
            rules.length > 0 ? (
              <View style={styles.rulesCard}>
                <Text style={styles.sectionTitle}>ACTIVE RULES</Text>
                {rules.filter(r => r.active).map(r => (
                  <View key={r._id} style={styles.ruleRow}>
                    <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                    <Text style={styles.ruleLabel}>{r.ruleName}</Text>
                  </View>
                ))}
                {rules.filter(r => !r.active).map(r => (
                  <View key={r._id} style={styles.ruleRow}>
                    <Ionicons name="ellipse-outline" size={16} color={Colors.border} />
                    <Text style={[styles.ruleLabel, { color: Colors.textMuted }]}>{r.ruleName}</Text>
                  </View>
                ))}
              </View>
            ) : null
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
      {rules.length > 0 && (
        <TouchableOpacity style={styles.fab} onPress={openModal} activeOpacity={0.85}>
          <Ionicons name="add" size={28} color={Colors.white} />
        </TouchableOpacity>
      )}

      {/* Run Batch Modal */}
      <Modal visible={modalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalOpen(false)}>
        <SafeAreaView style={styles.modalSafe} edges={['bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Run Penalty Batch</Text>
            <TouchableOpacity onPress={() => setModalOpen(false)}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={{ gap: 16, padding: 20 }}>
            {/* Rule picker */}
            <View style={{ gap: 8 }}>
              <Text style={styles.label}>SELECT RULE</Text>
              {rules.map(r => (
                <TouchableOpacity
                  key={r._id}
                  style={[styles.ruleOption, selectedRule?._id === r._id && styles.ruleOptionActive]}
                  onPress={() => { setSelectedRule(r); setPreview(null); }}
                >
                  <Ionicons
                    name={selectedRule?._id === r._id ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={selectedRule?._id === r._id ? Colors.primary : Colors.border}
                  />
                  <Text style={[styles.ruleOptionText, selectedRule?._id === r._id && { color: Colors.primary }]}>
                    {r.ruleName}
                    {r.active ? '  ✓ active' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Run date */}
            <View style={{ gap: 8 }}>
              <Text style={styles.label}>RUN DATE</Text>
              <Text style={styles.dateDisplay}>{fmtDate(runDate)}</Text>
              <Text style={styles.dateHint}>Penalties calculated for invoices overdue as of this date.</Text>
            </View>

            {/* Preview button */}
            {!preview ? (
              <TouchableOpacity
                style={[styles.btn, (!selectedRule || previewing) && styles.btnDisabled]}
                onPress={runPreview}
                disabled={!selectedRule || previewing}
              >
                {previewing
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.btnText}>Preview Penalties</Text>
                }
              </TouchableOpacity>
            ) : (
              <>
                {/* Preview summary */}
                <View style={styles.previewCard}>
                  <Text style={styles.sectionTitle}>PREVIEW</Text>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>Eligible tenants</Text>
                    <Text style={styles.previewValue}>{preview.summary.eligibleCount}</Text>
                  </View>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>Total penalties</Text>
                    <Text style={[styles.previewValue, { color: Colors.danger }]}>
                      KES {fmt(preview.summary.totalPenaltyAmount)}
                    </Text>
                  </View>
                </View>

                {/* Preview rows */}
                {preview.rows.slice(0, 20).map((row, i) => (
                  <View key={i} style={styles.previewRowItem}>
                    <Text style={styles.previewTenant} numberOfLines={1}>
                      {row.tenant?.name ?? 'Tenant'}
                      {row.unit?.unitNumber ? ` · Unit ${row.unit.unitNumber}` : ''}
                    </Text>
                    <Text style={[styles.previewAmt, { color: Colors.danger }]}>
                      KES {fmt(row.amount)}
                    </Text>
                  </View>
                ))}
                {preview.rows.length > 20 && (
                  <Text style={styles.dateHint}>+{preview.rows.length - 20} more tenants…</Text>
                )}

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    style={[styles.btn, { flex: 1, backgroundColor: Colors.border }]}
                    onPress={() => setPreview(null)}
                  >
                    <Text style={[styles.btnText, { color: Colors.text }]}>Recalculate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, { flex: 1, backgroundColor: Colors.danger }, processing && styles.btnDisabled]}
                    onPress={applyPenalties}
                    disabled={processing}
                  >
                    {processing
                      ? <ActivityIndicator size="small" color={Colors.white} />
                      : <Text style={styles.btnText}>Apply Penalties</Text>
                    }
                  </TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  list:    { padding: 16, gap: 12, paddingBottom: 100 },
  empty:   { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textMuted },

  rulesCard: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 10,
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle:  { fontSize: 17, fontWeight: '800', color: Colors.text },
  modalScroll: { flex: 1 },

  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },

  ruleOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  ruleOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFaded },
  ruleOptionText:   { fontSize: 14, fontWeight: '600', color: Colors.text, flex: 1 },

  dateDisplay: { fontSize: 16, fontWeight: '700', color: Colors.text },
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

  previewRowItem: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  previewTenant: { fontSize: 13, color: Colors.text, flex: 1 },
  previewAmt:    { fontSize: 13, fontWeight: '700' },
});
