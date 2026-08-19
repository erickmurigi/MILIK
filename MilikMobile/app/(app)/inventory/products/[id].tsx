import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const INV = '#92400E';

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type StockByLocation = { location: string; locationName: string; balance: number };

type Product = {
  _id:             string;
  name:            string;
  sku?:            string;
  barcode?:        string;
  category?:       { name?: string } | string;
  unitOfMeasure?:  string;
  costPrice:       number;
  sellingPrice:    number;
  vatRate:         number;
  reorderLevel:    number;
  trackStock:      boolean;
  serialized:      boolean;
  description?:    string;
  active:          boolean;
  stockByLocation?: StockByLocation[];
};

const getCat = (c: Product['category']) =>
  typeof c === 'object' ? (c?.name ?? '—') : (c ?? '—');

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [product,    setProduct]    = useState<Product | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const { data } = await api.get(`/inventory/products/${id}`, { params: { withStock: 'true' } });
      setProduct(data?.data ?? data);
    } catch { Alert.alert('Error', 'Could not load product.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <MilikLoader fullscreen />;
  if (!product) return null;

  const totalStock = product.stockByLocation?.reduce((s, l) => s + l.balance, 0) ?? 0;
  const isLow = product.trackStock && product.reorderLevel > 0 && totalStock <= product.reorderLevel;
  const margin = product.sellingPrice > 0
    ? ((product.sellingPrice - product.costPrice) / product.sellingPrice * 100).toFixed(1)
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={INV} />}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="cube-outline" size={32} color={INV} />
          </View>
          <Text style={styles.heroName}>{product.name}</Text>
          {product.sku ? <Text style={styles.heroSku}>SKU: {product.sku}</Text> : null}
          {product.barcode ? <Text style={styles.heroSku}>Barcode: {product.barcode}</Text> : null}

          <View style={styles.pricingRow}>
            <View style={styles.pricingItem}>
              <Text style={styles.pricingLbl}>Selling</Text>
              <Text style={styles.pricingVal}>{fmt(product.sellingPrice)}</Text>
            </View>
            <View style={styles.pricingDivider} />
            <View style={styles.pricingItem}>
              <Text style={styles.pricingLbl}>Cost</Text>
              <Text style={styles.pricingVal}>{fmt(product.costPrice)}</Text>
            </View>
            {margin !== null && (
              <>
                <View style={styles.pricingDivider} />
                <View style={styles.pricingItem}>
                  <Text style={styles.pricingLbl}>Margin</Text>
                  <Text style={[styles.pricingVal, { color: '#065F46' }]}>{margin}%</Text>
                </View>
              </>
            )}
          </View>

          {isLow && (
            <View style={styles.lowAlert}>
              <Ionicons name="warning-outline" size={14} color="#D97706" />
              <Text style={styles.lowAlertTxt}>Stock below reorder level ({product.reorderLevel})</Text>
            </View>
          )}
        </View>

        {/* Details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>PRODUCT DETAILS</Text>
          <FieldRow label="Category"      value={getCat(product.category)} />
          <FieldRow label="Unit of Measure" value={product.unitOfMeasure} />
          <FieldRow label="VAT Rate"      value={product.vatRate > 0 ? `${product.vatRate}%` : 'Exempt'} />
          <FieldRow label="Reorder Level" value={product.trackStock ? String(product.reorderLevel) : 'Not tracked'} />
          <FieldRow label="Serialized"    value={product.serialized ? 'Yes' : 'No'} />
          <FieldRow label="Status"        value={product.active ? 'Active' : 'Inactive'} />
          {product.description ? <FieldRow label="Description" value={product.description} /> : null}
        </View>

        {/* Stock by location */}
        {product.trackStock && product.stockByLocation && product.stockByLocation.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>STOCK BY LOCATION</Text>
              <Text style={[styles.totalStock, isLow && { color: '#D97706' }]}>
                {totalStock} {product.unitOfMeasure ?? 'units'} total
              </Text>
            </View>
            {product.stockByLocation.map(loc => (
              <View key={loc.location} style={styles.locRow}>
                <Ionicons name="location-outline" size={14} color="#94A3B8" />
                <Text style={styles.locName} numberOfLines={1}>{loc.locationName}</Text>
                <Text style={[
                  styles.locBalance,
                  product.reorderLevel > 0 && loc.balance <= product.reorderLevel && { color: '#D97706', fontWeight: '800' },
                ]}>
                  {loc.balance} {product.unitOfMeasure ?? 'units'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
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
  safe:   { flex: 1, backgroundColor: '#FFFBEB' },
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
  heroName:  { fontSize: 20, fontWeight: '900', color: '#0F172A', textAlign: 'center' },
  heroSku:   { fontSize: 12, color: '#94A3B8', fontWeight: '500', fontVariant: ['tabular-nums'] },

  pricingRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 12, alignSelf: 'stretch' },
  pricingItem:    { flex: 1, alignItems: 'center', gap: 3 },
  pricingDivider: { width: 1, height: 32, backgroundColor: '#E2E8F0', marginHorizontal: 8 },
  pricingLbl:     { fontSize: 9, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5 },
  pricingVal:     { fontSize: 15, fontWeight: '900', color: '#0F172A' },

  lowAlert:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEF3C7', borderRadius: 8, padding: 8, marginTop: 4 },
  lowAlertTxt: { fontSize: 12, fontWeight: '600', color: '#D97706' },

  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, gap: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle:  { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },
  totalStock: { fontSize: 13, fontWeight: '800', color: '#065F46' },

  fieldRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  fieldLabel: { fontSize: 12, color: '#94A3B8', width: 110 },
  fieldValue: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },

  locRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locName:    { flex: 1, fontSize: 13, color: '#475569', fontWeight: '500' },
  locBalance: { fontSize: 13, fontWeight: '700', color: '#0F172A', fontVariant: ['tabular-nums'] },
});
