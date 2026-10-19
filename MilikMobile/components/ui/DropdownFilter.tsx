import { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, FlatList, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type FilterOption = { key: string; label: string };

/** Compact "Today ▾" style button that opens a bottom-sheet list of options — replaces a
 *  row of horizontally-scrolling filter chips, which take a lot of vertical space and can
 *  clip the active chip off-screen when it isn't the first one. */
export default function DropdownFilter({
  title, value, options, onChange, style,
}: {
  title: string;
  value: string;
  options: FilterOption[];
  onChange: (key: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.key === value);

  return (
    <>
      <TouchableOpacity style={[styles.btn, style]} onPress={() => setOpen(true)} activeOpacity={0.75}>
        <Text style={styles.btnText} numberOfLines={1}>{selected?.label ?? title}</Text>
        <Ionicons name="chevron-down" size={14} color="#64748B" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <FlatList
              data={options}
              keyExtractor={o => o.key || 'default'}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.optRow}
                  onPress={() => { onChange(item.key); setOpen(false); }}
                >
                  <Text style={[styles.optText, item.key === value && styles.optTextActive]}>{item.label}</Text>
                  {item.key === value ? <Ionicons name="checkmark" size={18} color="#0B3B2E" /> : null}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
    paddingHorizontal: 12, height: 40,
    borderRadius: 10, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  btnText: { fontSize: 12, fontWeight: '700', color: '#475569', flexShrink: 1 },

  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingTop: 14, paddingBottom: 24, maxHeight: '60%',
  },
  sheetTitle: {
    fontSize: 11, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.8,
    paddingHorizontal: 18, marginBottom: 6, textTransform: 'uppercase',
  },
  optRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 },
  optText: { fontSize: 15, color: '#0F172A' },
  optTextActive: { fontWeight: '800', color: '#0B3B2E' },
  sep: { height: 1, backgroundColor: '#F1F5F9', marginHorizontal: 18 },
});
