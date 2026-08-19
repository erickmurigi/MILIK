import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const INV = '#92400E';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

type POLine = {
  _id:          string;
  product?:     { name?: string; sku?: string; unitOfMeasure?: string } | string;
  qtyOrdered:   number;
  qtyReceived:  number;
  unitCost:     number;
  totalCost:    number;
};

type PurchaseOrder = {
  _id:           string;
  poNumber:      string;
  supplier?:     { _id: string; name?: string; phone?: string; email?: string } | string;
  location?:     { name?: string } | string;
  status:        string;
  totalAmount:   number;
  orderDate?:    string;
  expectedDate?: string;
  notes?:        string;
  lines:         POLine[];
  createdBy?:    { name?: string };
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  draft:              { bg: '#F1F5F9', color: '#64748B', label: 'Draft'           },
  sent:               { bg: '#DBEAFE', color: '#1D4ED8', label: 'Sent'            },
  partially_received: { bg: '#FEF3C7', color: '#D97706', label: 'Partial Receipt' },
  received:           { bg: '#D1FAE5', color: '#065F46', label: 'Received'        },
  cancelled:          { bg: '#FEE2E2', color: '#DC2626', label: 'Cancelled'       },
};

const getSupplier = (s: PurchaseOrder['supplier']) =>
  typeof s === 'object' ? s : null;
const getLocation = (l: PurchaseOrder['location']) =>
  typeof l === 'object' ? (l?.name ?? '—') : (l ?? '—');
const getProdName = (p: POLine['product']) =>
  typeof p === 'object' ? (p?.name ?? '—') : (p ?? '—');
const getProdSku = (p: POLine['product']) =>
  typeof p === 'object' ? (p?.sku ?? '') : '';
const getProdUom = (p: POLine['product']) =>
  typeof p === 'object' ? (p?.unitOfMeasure ?? '') : '';

export default function PurchaseOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [po,         setPo]         = useState<PurchaseOrder | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting,     setActing]     = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const { data } = await api.get(`/inventory/purchase-orders/${id}`);
      setPo(data?.data ?? data);
    } catch { Alert.alert('Error', 'Could not load purchase order.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleReceiveAll = () => {
    if (!po) return;
    const outstanding = po.lines.filter(l => l.qtyOrdered > l.qtyReceived);
    if (!outstanding.length) { Alert.alert('Info', 'All items already received.'); return; }
    Alert.alert(
      'Receive All Outstanding',
      `Receive remaining stock for ${outstanding.length} line(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Receive',
          onPress: async () => {
            setActing(true);
            try {
              const lines = outstanding.map(l => ({
                lineId: l._id,
                qtyReceived: l.qtyOrdered - l.qtyReceived,
              }));
              await api.post(`/inventory/purchase-orders/${id}/receive-goods`, { lines });
              await load(true);
            } catch (err: any) {
              Alert.alert('Error', err?.response?.data?.message ?? 'Receive failed.');
            } finally { setActing(false); }
          },
        },
      ]
    );
  };

  if (loading) return <MilikLoader fullscreen />;
  if (!po)     return null;

  const sc       = STATUS_CFG[po.status] ?? STATUS_CFG.draft;
  const supplier = getSupplier(po.supplier);
  const canReceive = po.status === 'sent' || po.status === 'partially_received';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={INV} />}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.poNum}>{po.poNumber}</Text>
              <Text style={styles.supplierName}>
                {supplier?.name ?? (typeof po.supplier === 'string' ? po.supplier : '—')}
              </Text>
              <Text style={styles.locationTxt}>{getLocation(po.location)}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
          </View>

          <Text style={styles.totalAmount}>{fmt(po.totalAmount)}</Text>

          <View style={styles.heroMeta}>
            {po.orderDate && (
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.6)" />
                <Text style={styles.metaTxt}>Ordered {fmtDate(po.orderDate)}</Text>
              </View>
            )}
            {po.expectedDate && (
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.6)" />
                <Text style={styles.metaTxt}>Expected {fmtDate(po.expectedDate)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Lines */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ORDER LINES ({po.lines.length})</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.thTxt, { flex: 3 }]}>Product</Text>
            <Text style={[styles.thTxt, { flex: 1, textAlign: 'right' }]}>Ord</Text>
            <Text style={[styles.thTxt, { flex: 1, textAlign: 'right' }]}>Rcvd</Text>
            <Text style={[styles.thTxt, { flex: 2, textAlign: 'right' }]}>Total</Text>
          </View>
          {po.lines.map((line, i) => {
            const isFullyReceived = line.qtyReceived >= line.qtyOrdered;
            const isPartial = line.qtyReceived > 0 && !isFullyReceived;
            return (
              <View key={line._id} style={[styles.tableRow, i % 2 === 1 && { backgroundColor: '#F8FAFC' }]}>
                <View style={{ flex: 3 }}>
                  <Text style={styles.prodName} numberOfLines={1}>{getProdName(line.product)}</Text>
                  {getProdSku(line.product) ? (
                    <Text style={styles.prodSku}>{getProdSku(line.product)}</Text>
                  ) : null}
                </View>
                <Text style={[styles.tdNum, { flex: 1 }]}>
                  {line.qtyOrdered}{getProdUom(line.product) ? ` ${getProdUom(line.product)}` : ''}
                </Text>
                <Text style={[styles.tdNum, { flex: 1,
                  color: isFullyReceived ? '#065F46' : isPartial ? '#D97706' : '#64748B',
                  fontWeight: isPartial ? '800' : '600',
                }]}>
                  {line.qtyReceived}
                </Text>
                <Text style={[styles.tdNum, { flex: 2, color: '#0F172A', fontWeight: '700' }]}>
                  {fmt(line.totalCost)}
                </Text>
              </View>
            );
          })}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{fmt(po.totalAmount)}</Text>
          </View>
        </View>

        {/* Notes */}
        {po.notes ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>NOTES</Text>
            <Text style={styles.noteTxt}>{po.notes}</Text>
          </View>
        ) : null}

        {/* Audit */}
        {po.createdBy?.name && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>CREATED BY</Text>
            <View style={styles.auditRow}>
              <Ionicons name="person-outline" size={14} color="#94A3B8" />
              <Text style={styles.auditValue}>{po.createdBy.name}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Actions */}
      {canReceive && (
        <View style={styles.footer}>
          {acting ? (
            <View style={[styles.actionBtn, { backgroundColor: INV, opacity: 0.6 }]}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: INV }]} onPress={handleReceiveAll}>
              <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
              <Text style={styles.actionBtnTxt}>Receive All Outstanding</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FFFBEB' },
  scroll: { padding: 16, gap: 14, paddingBottom: 16 },

  hero: { backgroundColor: INV, borderRadius: 18, padding: 20, gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  heroTop:      { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  poNum:        { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.8, marginBottom: 2, fontVariant: ['tabular-nums'] },
  supplierName: { fontSize: 18, fontWeight: '900', color: '#fff' },
  locationTxt:  { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
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

  noteTxt:    { fontSize: 14, color: '#475569', lineHeight: 22 },
  auditRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  auditValue: { fontSize: 13, fontWeight: '600', color: '#0F172A' },

  footer:     { borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', padding: 16 },
  actionBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 15 },
  actionBtnTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
