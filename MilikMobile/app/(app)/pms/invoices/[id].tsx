import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';

type Note = {
  _id:       string;
  noteType:  string;
  amount:    number;
  noteDate:  string;
  description: string;
  sourceInvoice?: { invoiceNumber?: string };
};

const CATEGORY_LABELS: Record<string, string> = {
  RENT_CHARGE:    'Rent Charge',
  UTILITY_CHARGE: 'Utility Charge',
  DEPOSIT_CHARGE: 'Deposit Charge',
  PENALTY_CHARGE: 'Late Penalty',
  DEBIT_NOTE:     'Debit Note',
  TAKE_ON_DEBIT:  'Take-on Balance',
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  unpaid:    { bg: Colors.dangerLight,  text: Colors.danger  },
  partial:   { bg: Colors.warningLight, text: Colors.warning },
  paid:      { bg: Colors.successLight, text: Colors.success },
  cancelled: { bg: Colors.borderLight,  text: Colors.textMuted },
  reversed:  { bg: Colors.borderLight,  text: Colors.textMuted },
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

export default function InvoiceDetailScreen() {
  // All key fields passed as search params from the list screen
  const {
    id, invoiceNumber, status, category, amount, outstanding,
    invoiceDate, dueDate, tenantName, tenantId, unit, property, description,
  } = useLocalSearchParams<Record<string, string>>();

  const [notes,      setNotes]      = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotes = async () => {
    if (!tenantId) return;
    setNotesLoading(true);
    try {
      const { data } = await api.get('/tenant-invoices/notes', { params: { tenant: tenantId } });
      const allNotes: Note[] = Array.isArray(data) ? data : [];
      // Filter to notes belonging to this invoice
      setNotes(allNotes.filter((n: any) =>
        String(n.sourceInvoice?._id || n.sourceInvoice || '') === String(id)
      ));
    } catch { setNotes([]); }
    finally { setNotesLoading(false); setRefreshing(false); }
  };

  useEffect(() => { loadNotes(); }, [id, tenantId]);

  const sc = STATUS_COLORS[status ?? ''] ?? STATUS_COLORS.unpaid;
  const amountNum      = Number(amount ?? 0);
  const outstandingNum = Number(outstanding ?? 0);

  return (
    <>
      <Stack.Screen options={{ title: invoiceNumber ?? 'Invoice' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadNotes(); }} tintColor={Colors.primary} />
          }
        >
          {/* Status + amount hero */}
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.invoiceNum}>{invoiceNumber ?? '—'}</Text>
                <Text style={styles.tenantName}>{tenantName ?? 'Unknown Tenant'}</Text>
                {(unit || property) ? (
                  <Text style={styles.meta}>
                    {[unit, property].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <View style={[styles.badge, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.badgeText, { color: sc.text }]}>
                    {String(status ?? 'unpaid').toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.amount}>KES {fmt(amountNum)}</Text>
              </View>
            </View>
          </View>

          {/* Details card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>INVOICE DETAILS</Text>
            <Row label="Category"       value={CATEGORY_LABELS[category ?? ''] ?? category ?? '—'} />
            <Row label="Invoice Date"   value={invoiceDate ? fmtDate(invoiceDate) : '—'} />
            {dueDate ? <Row label="Due Date" value={fmtDate(dueDate)} /> : null}
            <View style={styles.divider} />
            <Row label="Charged"     value={`KES ${fmt(amountNum)}`} />
            <Row
              label="Outstanding"
              value={`KES ${fmt(outstandingNum)}`}
              valueColor={outstandingNum > 0 ? Colors.danger : Colors.success}
            />
            <Row
              label="Paid"
              value={`KES ${fmt(Math.max(0, amountNum - outstandingNum))}`}
              valueColor={Colors.success}
            />
            {description ? (
              <>
                <View style={styles.divider} />
                <Text style={styles.descriptionLabel}>DESCRIPTION</Text>
                <Text style={styles.description}>{description}</Text>
              </>
            ) : null}
          </View>

          {/* Adjustments / notes */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>ADJUSTMENTS & NOTES</Text>
            {notesLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 16 }} />
            ) : notes.length === 0 ? (
              <View style={styles.emptyNotes}>
                <Ionicons name="document-text-outline" size={32} color={Colors.border} />
                <Text style={styles.emptyNotesText}>No adjustments on this invoice</Text>
              </View>
            ) : (
              notes.map(note => (
                <View key={note._id} style={styles.noteRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.noteType}>{note.noteType?.replace(/_/g, ' ') ?? 'Adjustment'}</Text>
                    {note.description ? <Text style={styles.noteDesc}>{note.description}</Text> : null}
                    <Text style={styles.noteDate}>{note.noteDate ? fmtDate(note.noteDate) : ''}</Text>
                  </View>
                  <Text style={[
                    styles.noteAmount,
                    { color: note.amount > 0 ? Colors.danger : Colors.success },
                  ]}>
                    {note.amount > 0 ? '+' : '−'} KES {fmt(Math.abs(note.amount))}
                  </Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },

  heroCard: {
    backgroundColor: Colors.white, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border, padding: 16,
  },
  heroTop:     { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  invoiceNum:  { fontSize: 16, fontWeight: '900', color: Colors.text },
  tenantName:  { fontSize: 14, fontWeight: '600', color: Colors.text },
  meta:        { fontSize: 12, color: Colors.textMuted },
  amount:      { fontSize: 18, fontWeight: '900', color: Colors.text },
  badge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText:   { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  card: {
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 16, gap: 0,
  },
  cardTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted, marginBottom: 12 },

  row:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  rowLabel:  { fontSize: 13, color: Colors.textSecondary },
  rowValue:  { fontSize: 13, fontWeight: '700', color: Colors.text },
  divider:   { height: 1, backgroundColor: Colors.borderLight, marginVertical: 4 },

  descriptionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted, marginTop: 8, marginBottom: 4 },
  description:      { fontSize: 13, color: Colors.text, lineHeight: 20 },

  emptyNotes:     { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyNotesText: { fontSize: 13, color: Colors.textMuted },

  noteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  noteType:   { fontSize: 13, fontWeight: '700', color: Colors.text, textTransform: 'capitalize' },
  noteDesc:   { fontSize: 12, color: Colors.textMuted },
  noteDate:   { fontSize: 11, color: Colors.textMuted },
  noteAmount: { fontSize: 14, fontWeight: '800' },
});
