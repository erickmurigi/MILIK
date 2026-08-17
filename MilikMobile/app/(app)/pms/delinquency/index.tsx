import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

type Tenant = {
  _id:     string;
  name:    string;
  balance: number;
  phone?:  string;
  status?: string;
  unit?:   { unitNumber?: string; property?: { propertyName?: string; name?: string } };
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const avatarInitial = (name: string) =>
  name?.trim()?.charAt(0)?.toUpperCase() ?? '?';

export default function DelinquencyScreen() {
  const router = useRouter();
  const [tenants,    setTenants]    = useState<Tenant[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState('');

  const searchRef = useRef(search);
  searchRef.current = search;

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const params: Record<string, string> = {
        hasBalance: 'true', page: '1', limit: '200',
      };
      if (searchRef.current.trim()) params.search = searchRef.current.trim();

      const { data } = await api.get('/tenants', { params });
      const rows: Tenant[] = data.data ?? data.tenants ?? [];
      rows.sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0));
      setTenants(rows);
    } catch { /* fail silently */ }
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(), 400);
    return () => clearTimeout(t);
  }, [search]);

  const totalArrears = tenants.reduce((s, t) => s + Number(t.balance ?? 0), 0);

  const renderItem = ({ item }: { item: Tenant }) => {
    const propName = item.unit?.property?.propertyName ?? item.unit?.property?.name ?? '';
    const unitStr  = [item.unit?.unitNumber, propName].filter(Boolean).join(' · ');

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/pms/tenants/${item._id}` as any)}
        activeOpacity={0.75}
      >
        {/* Avatar */}
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{avatarInitial(item.name)}</Text>
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name}>{item.name}</Text>
          {unitStr ? <Text style={styles.meta}>{unitStr}</Text> : null}
        </View>

        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <Text style={styles.balance}>KES {fmt(item.balance)}</Text>
          {item.phone ? (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation?.(); Linking.openURL(`tel:${item.phone}`); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="call-outline" size={18} color={Colors.primary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Summary banner */}
      <View style={styles.banner}>
        <View>
          <Text style={styles.bannerLabel}>TOTAL ARREARS</Text>
          <Text style={styles.bannerValue}>KES {fmt(totalArrears)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.bannerLabel}>TENANTS</Text>
          <Text style={styles.bannerValue}>{tenants.length}</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search tenants..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={() => load()}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {loading ? (
        <MilikLoader fullscreen />
      ) : (
        <FlatList
          data={tenants}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="checkmark-circle-outline" size={56} color={Colors.success} />
              <Text style={styles.emptyTitle}>All Clear</Text>
              <Text style={styles.emptyText}>No tenants with outstanding balances</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle:{ fontSize: 17, fontWeight: '700', color: Colors.text },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
  list:    { paddingBottom: 40 },

  banner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 20, paddingVertical: 16,
  },
  bannerLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: 'rgba(255,255,255,0.6)' },
  bannerValue: { fontSize: 22, fontWeight: '900', color: Colors.white },

  searchRow: { paddingHorizontal: 16, paddingVertical: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: Colors.dangerLight,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '800', color: Colors.danger },
  name:       { fontSize: 14, fontWeight: '700', color: Colors.text },
  meta:       { fontSize: 11, color: Colors.textMuted },
  balance:    { fontSize: 15, fontWeight: '800', color: Colors.danger },
});
