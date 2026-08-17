import { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

export type DropdownItem = { _id: string; label: string; sublabel?: string };

type Props = {
  label: string;
  placeholder?: string;
  selectedId?: string;
  selectedLabel?: string;
  items: DropdownItem[];
  onSelect: (item: DropdownItem) => void;
  onClear?: () => void;
  loading?: boolean;
  open: boolean;
  onToggle: () => void;
  required?: boolean;
  emptyText?: string;
  maxListHeight?: number;
};

export function Dropdown({
  label,
  placeholder = 'Select…',
  selectedId,
  selectedLabel,
  items,
  onSelect,
  onClear,
  loading,
  open,
  onToggle,
  required,
  emptyText = 'No items found',
  maxListHeight = 210,
}: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.sublabel ?? '').toLowerCase().includes(q),
    );
  }, [items, query]);

  const handleSelect = (item: DropdownItem) => {
    setQuery('');
    onSelect(item);
  };

  const handleClear = () => {
    setQuery('');
    onClear?.();
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={{ color: Colors.danger }}> *</Text> : null}
      </Text>

      {/* Trigger */}
      <TouchableOpacity
        style={[
          styles.trigger,
          open && styles.triggerOpen,
          !!selectedId && styles.triggerFilled,
        ]}
        onPress={onToggle}
        activeOpacity={0.75}
      >
        {loading && !selectedId ? (
          <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 4 }} />
        ) : (
          <Ionicons
            name="chevron-down"
            size={16}
            color={open ? Colors.primary : Colors.textMuted}
            style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
          />
        )}
        <Text
          style={[styles.triggerText, !!selectedId && styles.triggerTextFilled]}
          numberOfLines={1}
        >
          {selectedId ? selectedLabel : placeholder}
        </Text>
        {selectedId && onClear ? (
          <TouchableOpacity
            onPress={handleClear}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>

      {/* Panel */}
      {open ? (
        <View style={styles.panel}>
          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={14} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search…"
              placeholderTextColor={Colors.textMuted}
              value={query}
              onChangeText={setQuery}
              autoFocus
            />
            {query ? (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={14} color={Colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          <ScrollView
            style={{ maxHeight: maxListHeight }}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <View style={styles.centerMsg}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.centerMsg}>
                <Text style={styles.emptyText}>{emptyText}</Text>
              </View>
            ) : (
              filtered.map((item, idx) => {
                const active = selectedId === item._id;
                return (
                  <TouchableOpacity
                    key={item._id}
                    style={[
                      styles.item,
                      idx < filtered.length - 1 && styles.itemBorder,
                      active && styles.itemActive,
                    ]}
                    onPress={() => handleSelect(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>
                        {item.label}
                      </Text>
                      {item.sublabel ? (
                        <Text style={styles.itemSub}>{item.sublabel}</Text>
                      ) : null}
                    </View>
                    {active ? (
                      <Ionicons name="checkmark" size={16} color={Colors.primary} />
                    ) : null}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:   { gap: 6 },
  fieldLabel:{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },

  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, height: 50,
  },
  triggerOpen:   { borderColor: Colors.primary, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  triggerFilled: { borderColor: Colors.primary + '80' },
  triggerText:   { flex: 1, fontSize: 14, color: Colors.textMuted },
  triggerTextFilled: { color: Colors.text, fontWeight: '600' },

  panel: {
    backgroundColor: Colors.white,
    borderWidth: 1.5, borderTopWidth: 0,
    borderColor: Colors.primary,
    borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
    overflow: 'hidden',
  },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 13, color: Colors.text, paddingVertical: 0 },

  centerMsg: { padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 13, color: Colors.textMuted },

  item: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  itemActive: { backgroundColor: Colors.primaryFaded },
  itemLabel:  { fontSize: 14, fontWeight: '600', color: Colors.text },
  itemLabelActive: { color: Colors.primary },
  itemSub:    { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
});
