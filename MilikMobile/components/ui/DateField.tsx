import { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_FULL  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
const pad2        = (n: number) => String(n).padStart(2, '0');

type Props = {
  label: string;
  value: string;           // 'YYYY-MM-DD'
  onChange: (v: string) => void;
  required?: boolean;
  optional?: boolean;
};

export function DateField({ label, value, onChange, required, optional }: Props) {
  const parsed    = value ? new Date(value + 'T00:00:00') : new Date();
  const [year,  setYear]  = useState(parsed.getFullYear());
  const [month, setMonth] = useState(parsed.getMonth() + 1);
  const [day,   setDay]   = useState(parsed.getDate());
  const [open,  setOpen]  = useState(false);

  const confirm = () => {
    onChange(`${year}-${pad2(month)}-${pad2(day)}`);
    setOpen(false);
  };

  const prevMonth = () => {
    const nm = month === 1 ? 12 : month - 1;
    const ny = month === 1 ? year - 1 : year;
    setDay((d) => Math.min(d, daysInMonth(ny, nm)));
    setMonth(nm); setYear(ny);
  };
  const nextMonth = () => {
    const nm = month === 12 ? 1 : month + 1;
    const ny = month === 12 ? year + 1 : year;
    setDay((d) => Math.min(d, daysInMonth(ny, nm)));
    setMonth(nm); setYear(ny);
  };

  const displayDate = value
    ? (() => {
        const d = new Date(value + 'T00:00:00');
        return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
      })()
    : '';

  return (
    <>
      <View style={styles.wrapper}>
        <Text style={styles.fieldLabel}>
          {label}
          {required ? <Text style={{ color: Colors.danger }}> *</Text> : null}
          {optional ? <Text style={{ color: Colors.textMuted }}> (optional)</Text> : null}
        </Text>
        <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)} activeOpacity={0.75}>
          <Ionicons name="calendar-outline" size={17} color={value ? Colors.primary : Colors.textMuted} />
          <Text style={[styles.triggerText, value && styles.triggerTextFilled]}>
            {displayDate || 'Select date'}
          </Text>
          <Ionicons name="chevron-down" size={15} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          {/* Month nav */}
          <View style={styles.monthRow}>
            <TouchableOpacity style={styles.navBtn} onPress={prevMonth}>
              <Ionicons name="chevron-back" size={20} color={Colors.primary} />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{MONTHS_FULL[month - 1]} {year}</Text>
            <TouchableOpacity style={styles.navBtn} onPress={nextMonth}>
              <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
            </TouchableOpacity>
          </View>

          {/* Day grid */}
          <View style={styles.grid}>
            {Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1).map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.dayCell, day === d && styles.dayCellActive]}
                onPress={() => setDay(d)}
              >
                <Text style={[styles.dayText, day === d && styles.dayTextActive]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.confirmBtn} onPress={confirm}>
            <Text style={styles.confirmText}>
              Confirm — {day} {MONTHS_SHORT[month - 1]} {year}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrapper:    { gap: 6 },
  fieldLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },

  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, height: 50,
  },
  triggerText:       { flex: 1, fontSize: 14, color: Colors.textMuted },
  triggerTextFilled: { color: Colors.text, fontWeight: '600' },

  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 40,
  },
  monthRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  navBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontSize: 17, fontWeight: '800', color: Colors.text },

  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 4 },
  dayCell: {
    width: '13%', aspectRatio: 1,
    alignItems: 'center', justifyContent: 'center', borderRadius: 8,
  },
  dayCellActive: { backgroundColor: Colors.primary },
  dayText:       { fontSize: 14, fontWeight: '600', color: Colors.text },
  dayTextActive: { color: Colors.white },

  confirmBtn: {
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: Colors.primary, borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center',
  },
  confirmText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
