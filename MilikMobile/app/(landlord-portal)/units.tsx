import { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import landlordPortalApi from '../../services/landlordPortalApi';
import { Colors } from '../../constants/colors';

const fmt = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

const STATUS_COLOR: Record<string, string> = {
  vacant:         '#854d0e',
  occupied:       '#15803d',
  owner_occupied: '#1d4ed8',
  maintenance:    '#b91c1c',
  reserved:       '#475569',
  archived:       '#475569',
};

export default function LandlordPortalUnits() {
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await landlordPortalApi.get('/landlord-portal/units');
      setUnits(data?.data || []);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={units.length === 0 ? styles.center : { padding: 14 }}
      data={units}
      keyExtractor={(item) => item._id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      ListEmptyComponent={<Text style={styles.empty}>No units found</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.unit}>Unit {item.unitNumber}</Text>
            <Text style={[styles.badge, { color: STATUS_COLOR[item.status] || Colors.textMuted }]}>
              {String(item.status || '').replace('_', ' ')}
            </Text>
          </View>
          {item.property?.propertyCode && (
            <Text style={styles.property}>{item.property.propertyCode} – {item.property.propertyName}</Text>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Rent</Text>
            <Text style={styles.value}>{fmt(item.rent)}</Text>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { color: Colors.textMuted, fontSize: 13 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  unit: { fontSize: 13, fontWeight: '700', color: Colors.text },
  badge: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  property: { fontSize: 12, color: Colors.textSecondary, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  label: { fontSize: 12, color: Colors.textMuted },
  value: { fontSize: 12, fontWeight: '600', color: Colors.text },
});
