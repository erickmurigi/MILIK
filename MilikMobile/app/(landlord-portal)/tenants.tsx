import { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import landlordPortalApi from '../../services/landlordPortalApi';
import { Colors } from '../../constants/colors';

const STATUS_COLOR: Record<string, string> = {
  active:     '#15803d',
  inactive:   '#475569',
  terminated: '#b91c1c',
  evicted:    '#b91c1c',
  overdue:    '#854d0e',
};

export default function LandlordPortalTenants() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await landlordPortalApi.get('/landlord-portal/tenants');
      setTenants(data?.data || []);
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
      contentContainerStyle={tenants.length === 0 ? styles.center : { padding: 14 }}
      data={tenants}
      keyExtractor={(item) => item._id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      ListEmptyComponent={<Text style={styles.empty}>No tenants found</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={[styles.badge, { color: STATUS_COLOR[item.status] || Colors.textMuted }]}>{item.status}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Unit</Text>
            <Text style={styles.value}>{item.unit?.unitNumber || '—'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Contact</Text>
            <Text style={styles.value}>{item.phone || item.email || '—'}</Text>
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
  name: { fontSize: 13, fontWeight: '700', color: Colors.text },
  badge: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  label: { fontSize: 12, color: Colors.textMuted },
  value: { fontSize: 12, fontWeight: '600', color: Colors.text },
});
