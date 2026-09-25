import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal,
  Alert, RefreshControl, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorState } from '../../../../components/ui/PmsStates';
import { cleanDecimal, fmtKES } from '../../../../utils/pmsFormat';
import {
  INV, INVBG, MANUAL_TYPES, MANUAL_TYPE_HELP, fmtQty, invError, isLowStock, marginPct, nameOf, priceInclVat,
  stockEntryBody, toNum, type ManualType, type Product,
} from '../../../../utils/inventory';

const TYPE_LABEL: Record<ManualType, string> = { adjustment: 'Adjustment', writeoff: 'Write-off' };

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [product,    setProduct]    = useState<Product | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const reqRef = useRef(0);

  // stock adjustment form
  const [adjOpen,   setAdjOpen]   = useState(false);
  const [locId,     setLocId]     = useState('');
  const [type,      setType]      = useState<ManualType>('adjustment');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [qtyText,   setQtyText]   = useState('');
  const [reason,    setReason]    = useState('');
  const [saving,    setSaving]    = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    const rid = ++reqRef.current;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const { data } = await api.get(`/inventory/products/${id}`, { params: { withStock: 'true' } });
      if (rid !== reqRef.current) return;
      setProduct(data?.data ?? null);
      setError(data?.data ? null : 'Product not found.');
    } catch (e) {
      if (rid !== reqRef.current) return;
      setError(invError(e, 'Could not load this product.'));
    } finally {
      if (rid === reqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [id]);

  useEffect(() => { load('initial'); }, [load]);

  if (loading) return <MilikLoader fullscreen />;
  if (!product) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ErrorState message={error ?? 'Product not found.'} onRetry={() => load('initial')} />
      </SafeAreaView>
    );
  }

  const locations = product.stockByLocation ?? [];
  const totalStock = Number(product.stockBalance ?? 0);
  const low = isLowStock(product);
  const margin = marginPct(product);
  const cat = nameOf(product.category);
  const uom = product.unitOfMeasure || 'pcs';
  const vat = Number(product.vatRate || 0);

  const selectedLoc = locations.find(l => l.location === locId);
  const balance = selectedLoc?.balance ?? 0;
  const qty = toNum(qtyText);
  const delta = type === 'writeoff' || direction === 'out' ? -qty : qty;
  const newBalance = Math.round((balance + delta) * 1000) / 1000;

  const openAdjust = () => {
    setLocId(locations[0]?.location ?? '');
    setType('adjustment'); setDirection('in'); setQtyText(''); setReason('');
    setAdjOpen(true);
  };

  const submit = async () => {
    if (savingRef.current) return;
    if (!selectedLoc) { Alert.alert('Location needed', 'Pick the location whose stock you are changing.'); return; }
    if (!(qty > 0)) { Alert.alert('Quantity needed', 'Enter a quantity greater than zero.'); return; }
    if (!reason.trim()) { Alert.alert('Reason needed', 'A reason is required for the audit trail (count date, cause of loss...).'); return; }
    if (newBalance < 0) {
      Alert.alert('Not enough stock', `${selectedLoc.locationName} has only ${fmtQty(balance)} ${uom}.`);
      return;
    }
    const what = delta > 0 ? `add ${fmtQty(qty)}` : `remove ${fmtQty(qty)}`;
    Alert.alert(
      `Confirm ${TYPE_LABEL[type].toLowerCase()}`,
      `${product.name}: ${what} ${uom} at ${selectedLoc.locationName}.\nBalance ${fmtQty(balance)} → ${fmtQty(newBalance)}.\nThis changes stock and the ledger and cannot be undone (only offset by another entry).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Post',
          style: type === 'writeoff' ? 'destructive' : 'default',
          onPress: async () => {
            if (savingRef.current) return;
            savingRef.current = true; setSaving(true);
            try {
              await api.post('/inventory/stock-movements', stockEntryBody({
                location: selectedLoc.location, product: product._id, type, direction, qty, notes: reason,
              }));
              setAdjOpen(false);
              await load('silent');
            } catch (e) {
              Alert.alert('Could not post', invError(e, 'The stock entry was not saved.'));
            } finally { savingRef.current = false; setSaving(false); }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={INV} />}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="cube-outline" size={32} color={INV} />
          </View>
          <Text style={styles.heroName}>{product.name}</Text>
          {product.sku ? <Text style={styles.heroSku}>SKU: {product.sku}</Text> : null}
          {product.barcode ? <Text style={styles.heroSku}>Barcode: {product.barcode}</Text> : null}
          {product.active === false ? <View style={styles.inactive}><Text style={styles.inactiveTxt}>INACTIVE</Text></View> : null}

          <View style={styles.pricingRow}>
            <View style={styles.pricingItem}>
              <Text style={styles.pricingLbl}>SELLING</Text>
              <Text style={styles.pricingVal}>{fmtKES(product.sellingPrice)}</Text>
            </View>
            <View style={styles.pricingDivider} />
            <View style={styles.pricingItem}>
              <Text style={styles.pricingLbl}>COST</Text>
              <Text style={styles.pricingVal}>{fmtKES(product.costPrice)}</Text>
            </View>
            {margin !== null ? (
              <>
                <View style={styles.pricingDivider} />
                <View style={styles.pricingItem}>
                  <Text style={styles.pricingLbl}>MARGIN</Text>
                  <Text style={[styles.pricingVal, { color: margin >= 0 ? '#065F46' : '#DC2626' }]}>{margin.toFixed(1)}%</Text>
                </View>
              </>
            ) : null}
          </View>

          {low ? (
            <View style={styles.lowAlert}>
              <Ionicons name="warning-outline" size={14} color="#D97706" />
              <Text style={styles.lowAlertTxt}>
                {totalStock <= 0 ? 'Out of stock' : `Only ${fmtQty(totalStock)} ${uom} left`} (reorder level {fmtQty(product.reorderLevel)})
              </Text>
            </View>
          ) : null}
        </View>

        {/* Details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>PRODUCT DETAILS</Text>
          <FieldRow label="Category" value={cat} />
          <FieldRow label="Unit of measure" value={uom} />
          <FieldRow label="VAT" value={vat > 0 ? `${vat}%` : 'No VAT (0%)'} />
          {vat > 0 ? <FieldRow label="Price incl. VAT" value={fmtKES(priceInclVat(product))} /> : null}
          <FieldRow label="Stock tracking" value={product.trackStock ? `Tracked · reorder at ${fmtQty(product.reorderLevel)}` : 'Not tracked'} />
          <FieldRow label="Serialized" value={product.serialized ? 'Yes' : 'No'} />
          <FieldRow label="Status" value={product.active === false ? 'Inactive' : 'Active'} />
          <FieldRow label="Description" value={product.description} />
        </View>

        {/* Stock */}
        {product.trackStock ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>STOCK ON HAND</Text>
              <Text style={[styles.totalStock, low && { color: '#D97706' }]}>{fmtQty(totalStock)} {uom} total</Text>
            </View>
            {locations.length === 0 ? (
              <Text style={styles.muted}>No active locations set up.</Text>
            ) : locations.map(loc => (
              <View key={loc.location} style={styles.locRow}>
                <Ionicons name="location-outline" size={14} color="#94A3B8" />
                <Text style={styles.locName} numberOfLines={1}>{loc.locationName}</Text>
                <Text style={[styles.locBalance, loc.balance <= 0 && { color: '#DC2626' }]}>{fmtQty(loc.balance)} {uom}</Text>
              </View>
            ))}
            {product.active !== false && locations.length > 0 ? (
              <TouchableOpacity style={styles.adjustBtn} onPress={openAdjust} activeOpacity={0.8}>
                <Ionicons name="create-outline" size={16} color="#fff" />
                <Text style={styles.adjustTxt}>Adjust stock</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Stock adjustment */}
      <Modal visible={adjOpen} animationType="slide" transparent onRequestClose={() => !saving && setAdjOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Adjust stock</Text>
              <TouchableOpacity onPress={() => !saving && setAdjOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
              <Text style={styles.label}>LOCATION</Text>
              <View style={styles.chipsWrap}>
                {locations.map(l => (
                  <TouchableOpacity key={l.location} style={[styles.chip, locId === l.location && styles.chipOn]} onPress={() => setLocId(l.location)}>
                    <Text style={[styles.chipTxt, locId === l.location && { color: '#fff' }]}>{l.locationName} · {fmtQty(l.balance)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>TYPE</Text>
              <View style={styles.chipsWrap}>
                {MANUAL_TYPES.map(t => (
                  <TouchableOpacity key={t} style={[styles.chip, type === t && styles.chipOn]} onPress={() => setType(t)}>
                    <Text style={[styles.chipTxt, type === t && { color: '#fff' }]}>{TYPE_LABEL[t]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.help}>{MANUAL_TYPE_HELP[type]}</Text>

              {type === 'adjustment' ? (
                <View style={styles.chipsWrap}>
                  <TouchableOpacity style={[styles.chip, direction === 'in' && styles.chipIn]} onPress={() => setDirection('in')}>
                    <Ionicons name="add-circle-outline" size={14} color={direction === 'in' ? '#fff' : '#065F46'} />
                    <Text style={[styles.chipTxt, direction === 'in' ? { color: '#fff' } : { color: '#065F46' }]}>Add stock</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.chip, direction === 'out' && styles.chipOut]} onPress={() => setDirection('out')}>
                    <Ionicons name="remove-circle-outline" size={14} color={direction === 'out' ? '#fff' : '#DC2626'} />
                    <Text style={[styles.chipTxt, direction === 'out' ? { color: '#fff' } : { color: '#DC2626' }]}>Remove stock</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <Text style={styles.label}>QUANTITY ({uom})</Text>
              <TextInput
                style={styles.input}
                value={qtyText}
                onChangeText={t => setQtyText(cleanDecimal(t))}
                placeholder="0"
                placeholderTextColor="#94A3B8"
                keyboardType="decimal-pad"
              />
              {qty > 0 && selectedLoc ? (
                <Text style={[styles.preview, newBalance < 0 && { color: '#DC2626' }]}>
                  Balance {fmtQty(balance)} → {fmtQty(newBalance)} {uom}
                </Text>
              ) : null}

              <Text style={styles.label}>REASON (required)</Text>
              <TextInput
                style={[styles.input, { height: 76, textAlignVertical: 'top', paddingTop: 10 }]}
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Stock count 25 Sep: 3 short, damaged in transit"
                placeholderTextColor="#94A3B8"
                multiline
                maxLength={300}
              />
            </ScrollView>

            <TouchableOpacity
              style={[styles.submit, (saving || !(qty > 0) || !reason.trim()) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitTxt}>Review and post</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: INVBG },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },

  hero: {
    backgroundColor: '#fff', borderRadius: 20,
    borderWidth: 1, borderColor: '#E2E8F0',
    padding: 20, alignItems: 'center', gap: 6,
  },
  heroIconWrap: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: INV + '12',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  heroName: { fontSize: 20, fontWeight: '900', color: '#0F172A', textAlign: 'center' },
  heroSku:  { fontSize: 12, color: '#94A3B8', fontWeight: '500', fontVariant: ['tabular-nums'] },
  inactive:    { backgroundColor: '#F1F5F9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  inactiveTxt: { fontSize: 10, fontWeight: '800', color: '#64748B', letterSpacing: 0.8 },

  pricingRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 12, alignSelf: 'stretch' },
  pricingItem:    { flex: 1, alignItems: 'center', gap: 3 },
  pricingDivider: { width: 1, height: 32, backgroundColor: '#E2E8F0', marginHorizontal: 8 },
  pricingLbl:     { fontSize: 9, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5 },
  pricingVal:     { fontSize: 14, fontWeight: '900', color: '#0F172A' },

  lowAlert:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEF3C7', borderRadius: 8, padding: 8, marginTop: 4 },
  lowAlertTxt: { fontSize: 12, fontWeight: '600', color: '#D97706', flexShrink: 1 },

  card:       { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, gap: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle:  { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },
  totalStock: { fontSize: 13, fontWeight: '800', color: '#065F46' },
  muted:      { fontSize: 12, color: '#94A3B8' },

  fieldRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  fieldLabel: { fontSize: 12, color: '#94A3B8', width: 110 },
  fieldValue: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },

  locRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locName:    { flex: 1, fontSize: 13, color: '#475569', fontWeight: '500' },
  locBalance: { fontSize: 13, fontWeight: '700', color: '#0F172A', fontVariant: ['tabular-nums'] },

  adjustBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: INV, borderRadius: 12, height: 44, marginTop: 4 },
  adjustTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:   { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30, maxHeight: '92%', gap: 12 },
  sheetHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  label:   { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#94A3B8' },
  help:    { fontSize: 12, color: '#64748B' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F8FAFC', borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 7 },
  chipOn:  { backgroundColor: INV, borderColor: INV },
  chipIn:  { backgroundColor: '#16A34A', borderColor: '#16A34A' },
  chipOut: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  chipTxt: { fontSize: 12, fontWeight: '700', color: '#475569' },
  input:   { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 14, height: 48, fontSize: 15, color: '#0F172A' },
  preview: { fontSize: 13, fontWeight: '700', color: '#065F46' },
  submit:  { backgroundColor: INV, borderRadius: 14, height: 50, alignItems: 'center', justifyContent: 'center' },
  submitTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
