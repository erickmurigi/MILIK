import { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity, ScrollView } from 'react-native';
import landlordPortalApi from '../../services/landlordPortalApi';
import { Colors } from '../../constants/colors';

const fmt = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
const fmtD = (d: string) => d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_COLOR: Record<string, string> = {
  approved: '#1d4ed8',
  sent:     '#15803d',
  revised:  '#854d0e',
};

const PERIODS: { key: 'this_month' | 'last_month'; label: string }[] = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
];

// A live, unsaved snapshot computed from the same engine the staff "Generate" workspace
// uses — never a saved/approved statement, so it's rendered separately and labeled as such.
function LiveSnapshot() {
  const [properties, setProperties] = useState<any[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [period, setPeriod] = useState<'this_month' | 'last_month'>('this_month');
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadProperties = useCallback(async () => {
    try {
      const { data } = await landlordPortalApi.get('/landlord-portal/properties');
      const list = data?.data || [];
      setProperties(list);
      if (list.length) setPropertyId((prev) => prev || list[0]._id);
    } catch {}
  }, []);

  useEffect(() => { loadProperties(); }, [loadProperties]);

  const loadSnapshot = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(false);
    try {
      // Runs the full statement-generation engine live (no pre-computed rows) — can
      // genuinely exceed the api instance's default 30s timeout for an older property.
      const { data } = await landlordPortalApi.get(`/landlord-portal/live-statement?propertyId=${propertyId}&period=${period}`, { timeout: 60000 });
      setSnapshot(data?.data || null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [propertyId, period]);

  useEffect(() => { loadSnapshot(); }, [loadSnapshot]);

  if (!properties.length) return null;

  return (
    <View style={snapStyles.card}>
      <View style={snapStyles.headerRow}>
        <Text style={snapStyles.title}>Live Snapshot</Text>
        <Text style={snapStyles.badge}>Unapproved</Text>
      </View>

      {properties.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={snapStyles.chipRow}>
          {properties.map((p) => (
            <TouchableOpacity
              key={p._id}
              style={[snapStyles.chip, propertyId === p._id && snapStyles.chipActive]}
              onPress={() => setPropertyId(p._id)}
            >
              <Text style={[snapStyles.chipText, propertyId === p._id && snapStyles.chipTextActive]}>
                {p.propertyCode || p.propertyName}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={snapStyles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[snapStyles.periodBtn, period === p.key && snapStyles.periodBtnActive]}
            onPress={() => setPeriod(p.key)}
          >
            <Text style={[snapStyles.periodText, period === p.key && snapStyles.periodTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 12 }} />
      ) : error ? (
        <Text style={snapStyles.hint}>Could not load the live snapshot.</Text>
      ) : snapshot ? (
        <View style={snapStyles.statsRow}>
          <View style={snapStyles.statCell}>
            <Text style={snapStyles.statLabel}>Opening</Text>
            <Text style={snapStyles.statValue}>{fmt(snapshot.openingBalance)}</Text>
          </View>
          <View style={snapStyles.statCell}>
            <Text style={snapStyles.statLabel}>Net</Text>
            <Text style={snapStyles.statValue}>{fmt(snapshot.periodNet)}</Text>
          </View>
          <View style={snapStyles.statCell}>
            <Text style={snapStyles.statLabel}>Closing</Text>
            <Text style={snapStyles.statValue}>{fmt(snapshot.closingBalance)}</Text>
          </View>
        </View>
      ) : null}

      {snapshot && !loading && !error && (
        <Text style={snapStyles.hint}>For the full live statement (PDF), visit the web portal.</Text>
      )}
    </View>
  );
}

export default function LandlordPortalStatements() {
  const [statements, setStatements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await landlordPortalApi.get('/landlord-portal/statements?limit=50');
      setStatements(data?.data?.statements || []);
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
      contentContainerStyle={{ padding: 14, flexGrow: 1 }}
      data={statements}
      keyExtractor={(item) => item._id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      ListHeaderComponent={<LiveSnapshot />}
      ListEmptyComponent={<Text style={styles.empty}>No statements found</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.period}>{fmtD(item.periodStart)} – {fmtD(item.periodEnd)}</Text>
            <Text style={[styles.badge, { color: STATUS_COLOR[item.status] || Colors.textMuted }]}>{item.status}</Text>
          </View>
          {item.property?.propertyCode && (
            <Text style={styles.property}>{item.property.propertyCode} – {item.property.propertyName}</Text>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Net for period</Text>
            <Text style={styles.net}>{fmt(item.periodNet)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Closing balance</Text>
            <Text style={styles.value}>{fmt(item.closingBalance)}</Text>
          </View>
          <Text style={styles.hint}>For a full PDF statement, visit the web portal.</Text>
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
  period: { fontSize: 13, fontWeight: '700', color: Colors.text },
  badge: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  property: { fontSize: 12, color: Colors.textSecondary, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  label: { fontSize: 12, color: Colors.textMuted },
  value: { fontSize: 12, fontWeight: '600', color: Colors.text },
  net: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  hint: { fontSize: 11, color: Colors.textMuted, marginTop: 8, fontStyle: 'italic' },
});

const snapStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '700', color: Colors.text },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: '#854d0e',
    backgroundColor: '#fef9c3',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  chipRow: { marginTop: 10 },
  chip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: Colors.background,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  chipTextActive: { color: Colors.white },
  periodRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  periodBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  periodBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  periodText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  periodTextActive: { color: Colors.white },
  statsRow: { flexDirection: 'row', marginTop: 14, gap: 10 },
  statCell: { flex: 1 },
  statLabel: { fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', marginBottom: 2 },
  statValue: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  hint: { fontSize: 12, color: Colors.textMuted, marginTop: 10 },
});
