import { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, FlatList,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';

type Tenant = {
  _id:        string;
  name:       string;
  phone?:     string;
  tenantCode?: string;
  status?:    string;
  balance?:   number;
  unit?:      { unitNumber?: string; property?: { propertyName?: string } };
};

const STATUS_COLOR: Record<string, string> = {
  active:     Colors.success,
  overdue:    Colors.danger,
  terminated: Colors.textMuted,
  moved_out:  Colors.textMuted,
};

export default function TenantSearchScreen() {
  const router = useRouter();

  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<Tenant[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [searched, setSearched] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    try {
      const { data } = await api.get('/tenants', { params: { search: q.trim(), limit: 30 } });
      setResults(data.data || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const onChangeText = (text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => search(text), 400);
  };

  const renderItem = ({ item }: { item: Tenant }) => {
    const unit     = item.unit?.unitNumber || '—';
    const property = (item.unit as any)?.property?.propertyName || '';
    const bal      = Number(item.balance || 0);
    const statusColor = STATUS_COLOR[item.status || ''] || Colors.textMuted;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/pms/tenants/${item._id}` as any)}
        activeOpacity={0.75}
      >
        {/* Avatar */}
        <View style={[styles.avatar, { backgroundColor: bal > 0 ? Colors.dangerLight : Colors.primaryFaded }]}>
          <Text style={[styles.avatarText, { color: bal > 0 ? Colors.danger : Colors.primary }]}>
            {item.name?.charAt(0)?.toUpperCase() || 'T'}
          </Text>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={styles.tenantName} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.balance, { color: bal > 0 ? Colors.danger : Colors.success }]}>
              {bal > 0 ? `KES ${bal.toLocaleString()}` : 'Settled'}
            </Text>
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.metaText} numberOfLines={1}>
              {unit}{property ? ` · ${property}` : ''}
            </Text>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          </View>
          {item.phone ? (
            <Text style={styles.phone}>{item.phone}</Text>
          ) : null}
        </View>

        <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Tenants' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        {/* Search bar */}
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Name, phone, unit, or ID number..."
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={onChangeText}
            returnKeyType="search"
            autoFocus
            clearButtonMode="while-editing"
          />
          {loading && <ActivityIndicator size="small" color={Colors.primary} style={{ marginLeft: 8 }} />}
        </View>

        {/* Results / states */}
        {!searched ? (
          <View style={styles.hint}>
            <Ionicons name="search-outline" size={48} color={Colors.border} />
            <Text style={styles.hintText}>Search for a tenant</Text>
            <Text style={styles.hintSub}>Type a name, phone, unit number, or ID</Text>
          </View>
        ) : !loading && results.length === 0 ? (
          <View style={styles.hint}>
            <Ionicons name="person-remove-outline" size={48} color={Colors.border} />
            <Text style={styles.hintText}>No tenants found</Text>
            <Text style={styles.hintSub}>Try a different search term</Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(t) => t._id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={styles.sep} />}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    margin: 16,
    backgroundColor: Colors.white,
    borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, height: 50,
  },
  searchIcon:  { marginRight: 10 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },

  hint: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingHorizontal: 48,
  },
  hintText: { fontSize: 17, fontWeight: '700', color: Colors.text },
  hintSub:  { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },

  list: { paddingHorizontal: 16, paddingBottom: 32 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
    padding: 14,
  },
  sep: { height: 8 },

  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '800' },

  cardBody:  { flex: 1 },
  cardTop: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 3,
  },
  tenantName: { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1, marginRight: 8 },
  balance:    { fontSize: 14, fontWeight: '800' },

  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: Colors.textMuted, flex: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },

  phone: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
});
