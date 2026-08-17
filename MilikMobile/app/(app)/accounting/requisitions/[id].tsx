import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const AC  = '#064E3B';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type LineItem = {
  _id?:        string;
  description: string;
  quantity:    number;
  unitPrice:   number;
  amount:      number;
};

type Requisition = {
  _id:               string;
  requisitionNumber?: string;
  purpose:           string;
  notes?:            string;
  date?:             string;
  createdAt:         string;
  totalAmount:       number;
  status:            string;
  urgency?:          string;
  department?:       string;
  requestedBy?:      { name?: string };
  approvedBy?:       { name?: string };
  items?:            LineItem[];
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  draft:    { bg: '#F1F5F9', color: '#64748B', label: 'Draft'    },
  pending:  { bg: '#FEF3C7', color: '#D97706', label: 'Pending'  },
  approved: { bg: '#D1FAE5', color: '#065F46', label: 'Approved' },
  rejected: { bg: '#FEE2E2', color: '#DC2626', label: 'Rejected' },
  paid:     { bg: '#EDE9FE', color: '#7C3AED', label: 'Paid'     },
};

const URGENCY_COLOR: Record<string, string> = {
  low: '#64748B', medium: '#D97706', high: '#DC2626', urgent: '#7C3AED',
};

export default function RequisitionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();

  const [req,     setReq]     = useState<Requisition | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting,  setActing]  = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/expense-requisitions/${id}`);
      setReq(data?.data ?? data);
    } catch { Alert.alert('Error', 'Could not load requisition.'); router.back(); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setStatus = (status: string, label: string) => {
    Alert.alert(label, `${label} this requisition?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: label,
        style: status === 'rejected' ? 'destructive' : 'default',
        onPress: async () => {
          setActing(true);
          try {
            await api.put(`/expense-requisitions/${id}/status`, { status });
            await load();
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.message ?? `Failed to ${label.toLowerCase()}.`);
          } finally { setActing(false); }
        },
      },
    ]);
  };

  if (loading) return <MilikLoader fullscreen />;
  if (!req) return null;

  const sc  = STATUS_CFG[req.status] ?? STATUS_CFG.draft;
  const urg = req.urgency ? URGENCY_COLOR[req.urgency] : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              {req.requisitionNumber && (
                <Text style={styles.heroNum}>{req.requisitionNumber}</Text>
              )}
              <Text style={styles.heroPurpose}>{req.purpose}</Text>
              {req.department && (
                <Text style={styles.heroDept}>{req.department}</Text>
              )}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <View style={[styles.badge, { backgroundColor: sc.color + '25' }]}>
                <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
              </View>
              {urg && req.urgency && (
                <View style={[styles.urgBadge, { borderColor: urg }]}>
                  <Text style={[styles.urgTxt, { color: urg }]}>{req.urgency.toUpperCase()}</Text>
                </View>
              )}
            </View>
          </View>

          <Text style={styles.heroAmount}>{fmt(req.totalAmount)}</Text>

          <View style={styles.heroMeta}>
            <View style={styles.heroMetaItem}>
              <Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.6)" />
              <Text style={styles.heroMetaTxt}>{fmtDate(req.date ?? req.createdAt)}</Text>
            </View>
            {req.requestedBy?.name && (
              <View style={styles.heroMetaItem}>
                <Ionicons name="person-outline" size={13} color="rgba(255,255,255,0.6)" />
                <Text style={styles.heroMetaTxt}>{req.requestedBy.name}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Line items */}
        {req.items && req.items.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>ITEMS</Text>

            {/* Table header */}
            <View style={styles.tableHeader}>
              <Text style={[styles.thTxt, { flex: 3 }]}>Description</Text>
              <Text style={[styles.thTxt, { flex: 1, textAlign: 'right' }]}>Qty</Text>
              <Text style={[styles.thTxt, { flex: 2, textAlign: 'right' }]}>Unit</Text>
              <Text style={[styles.thTxt, { flex: 2, textAlign: 'right' }]}>Total</Text>
            </View>

            {req.items.map((item, i) => (
              <View key={item._id ?? String(i)} style={[styles.tableRow, i % 2 === 1 && { backgroundColor: '#F8FAFC' }]}>
                <Text style={[styles.tdTxt, { flex: 3 }]} numberOfLines={2}>{item.description}</Text>
                <Text style={[styles.tdNum, { flex: 1 }]}>{item.quantity}</Text>
                <Text style={[styles.tdNum, { flex: 2 }]}>{fmt(item.unitPrice)}</Text>
                <Text style={[styles.tdNum, { flex: 2, fontWeight: '800', color: '#0F172A' }]}>{fmt(item.amount)}</Text>
              </View>
            ))}

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>TOTAL</Text>
              <Text style={styles.totalValue}>{fmt(req.totalAmount)}</Text>
            </View>
          </View>
        )}

        {/* Notes */}
        {req.notes && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>NOTES</Text>
            <Text style={styles.noteTxt}>{req.notes}</Text>
          </View>
        )}

        {/* Audit */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>AUDIT</Text>
          {req.requestedBy?.name && (
            <View style={styles.auditRow}>
              <Ionicons name="person-add-outline" size={14} color="#94A3B8" />
              <Text style={styles.auditLabel}>Requested by</Text>
              <Text style={styles.auditValue}>{req.requestedBy.name}</Text>
            </View>
          )}
          {req.approvedBy?.name && (
            <View style={styles.auditRow}>
              <Ionicons name="checkmark-circle-outline" size={14} color="#065F46" />
              <Text style={styles.auditLabel}>Approved by</Text>
              <Text style={styles.auditValue}>{req.approvedBy.name}</Text>
            </View>
          )}
          <View style={styles.auditRow}>
            <Ionicons name="time-outline" size={14} color="#94A3B8" />
            <Text style={styles.auditLabel}>Created</Text>
            <Text style={styles.auditValue}>{fmtDate(req.createdAt)}</Text>
          </View>
        </View>

      </ScrollView>

      {/* Action bar */}
      {acting ? (
        <View style={styles.actionsWrap}>
          <ActivityIndicator color={AC} />
        </View>
      ) : (
        <ActionBar status={req.status} setStatus={setStatus} />
      )}
    </SafeAreaView>
  );
}

function ActionBar({ status, setStatus }: { status: string; setStatus: (s: string, l: string) => void }) {
  if (status === 'draft') {
    return (
      <View style={styles.actionsWrap}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#1D4ED8' }]} onPress={() => setStatus('pending', 'Submit')}>
          <Ionicons name="send-outline" size={16} color="#fff" />
          <Text style={styles.actionBtnTxt}>Submit for Review</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (status === 'pending') {
    return (
      <View style={styles.actionsWrap}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#DC2626', flex: 0.6 }]} onPress={() => setStatus('rejected', 'Reject')}>
          <Ionicons name="close-outline" size={16} color="#fff" />
          <Text style={styles.actionBtnTxt}>Reject</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: AC }]} onPress={() => setStatus('approved', 'Approve')}>
          <Ionicons name="checkmark-outline" size={16} color="#fff" />
          <Text style={styles.actionBtnTxt}>Approve</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (status === 'approved') {
    return (
      <View style={styles.actionsWrap}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#7C3AED' }]} onPress={() => setStatus('paid', 'Mark as Paid')}>
          <Ionicons name="cash-outline" size={16} color="#fff" />
          <Text style={styles.actionBtnTxt}>Mark as Paid</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return null;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F0FDF4' },
  scroll: { padding: 16, gap: 14, paddingBottom: 16 },

  hero: {
    backgroundColor: AC, borderRadius: 18, padding: 20, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  heroTop:     { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  heroNum:     { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.8, marginBottom: 2 },
  heroPurpose: { fontSize: 19, fontWeight: '900', color: '#fff' },
  heroDept:    { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  heroAmount:  { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: -0.5, marginTop: 4 },
  heroMeta:    { flexDirection: 'row', gap: 14, flexWrap: 'wrap', marginTop: 6 },
  heroMetaItem:{ flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroMetaTxt: { fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: '500' },

  badge:   { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeTxt:{ fontSize: 11, fontWeight: '800' },
  urgBadge:{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  urgTxt:  { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1,
    borderColor: '#E2E8F0', padding: 16, gap: 12,
  },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  tableHeader: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  thTxt: { fontSize: 10, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.5 },
  tableRow: { flexDirection: 'row', paddingVertical: 8, borderRadius: 6, paddingHorizontal: 4 },
  tdTxt:    { fontSize: 13, color: '#0F172A', fontWeight: '500' },
  tdNum:    { fontSize: 13, color: '#64748B', fontWeight: '600', textAlign: 'right', fontVariant: ['tabular-nums'] },

  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1.5, borderTopColor: '#E2E8F0', paddingTop: 10 },
  totalLabel: { fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 0.8 },
  totalValue: { fontSize: 18, fontWeight: '900', color: AC },

  noteTxt:    { fontSize: 14, color: '#475569', lineHeight: 22 },

  auditRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  auditLabel: { fontSize: 12, color: '#94A3B8', flex: 1 },
  auditValue: { fontSize: 13, fontWeight: '600', color: '#0F172A' },

  actionsWrap: {
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
    backgroundColor: '#fff', padding: 16,
    flexDirection: 'row', gap: 10,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 7,
    borderRadius: 14, paddingVertical: 14,
  },
  actionBtnTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
