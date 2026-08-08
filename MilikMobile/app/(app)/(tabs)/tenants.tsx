import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, FlatList,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../../constants/colors';

export default function TenantsScreen() {
  const router  = useRouter();
  const [query, setQuery] = useState('');

  return (
    <SafeAreaView style={styles.safe}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.title}>Tenants</Text>
        <TouchableOpacity style={styles.iconBtn}>
          <Ionicons name="filter-outline" size={22} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={Colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search tenants, units, properties..."
          placeholderTextColor={Colors.textMuted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Empty state */}
      <View style={styles.empty}>
        <Ionicons name="people-outline" size={56} color={Colors.border} />
        <Text style={styles.emptyTitle}>Search for a tenant</Text>
        <Text style={styles.emptySub}>Type a name, phone number, or unit number above</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
  },
  title:       { fontSize: 24, fontWeight: '800', color: Colors.text },
  iconBtn:     { padding: 8 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 20, marginBottom: 16,
    backgroundColor: Colors.white,
    borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, height: 48,
  },
  searchIcon:  { marginRight: 10 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40,
  },
  emptyTitle:  { fontSize: 17, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptySub:    { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
