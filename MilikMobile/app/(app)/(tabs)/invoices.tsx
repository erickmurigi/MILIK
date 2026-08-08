import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../constants/colors';

export default function InvoicesScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Invoices</Text>
        <TouchableOpacity style={styles.iconBtn}>
          <Ionicons name="add-circle-outline" size={26} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Filter chips */}
      <View style={styles.chips}>
        {['All', 'Unpaid', 'Overdue', 'Paid'].map((chip, i) => (
          <TouchableOpacity
            key={chip}
            style={[styles.chip, i === 0 && styles.chipActive]}
          >
            <Text style={[styles.chipText, i === 0 && styles.chipTextActive]}>{chip}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.empty}>
        <Ionicons name="receipt-outline" size={56} color={Colors.border} />
        <Text style={styles.emptyTitle}>No invoices</Text>
        <Text style={styles.emptySub}>Invoices will appear here once loaded</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
  },
  title:   { fontSize: 24, fontWeight: '800', color: Colors.text },
  iconBtn: { padding: 4 },
  chips: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 20, marginBottom: 16,
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, backgroundColor: Colors.white,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primary, borderColor: Colors.primary,
  },
  chipText:       { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
  chipTextActive: { color: Colors.white },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
