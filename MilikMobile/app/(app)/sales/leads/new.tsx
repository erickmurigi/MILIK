import { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../services/api';

const SC = '#7C2D12';

const SOURCES = [
  { key: 'walk_in',     label: 'Walk In'     },
  { key: 'referral',    label: 'Referral'    },
  { key: 'online',      label: 'Online'      },
  { key: 'social_media',label: 'Social'      },
  { key: 'agent',       label: 'Agent'       },
  { key: 'cold_call',   label: 'Cold Call'   },
  { key: 'other',       label: 'Other'       },
];

export default function NewLeadScreen() {
  const router = useRouter();

  const [fullName,  setFullName]  = useState('');
  const [phone,     setPhone]     = useState('');
  const [email,     setEmail]     = useState('');
  const [source,    setSource]    = useState('walk_in');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [notes,     setNotes]     = useState('');
  const [saving,    setSaving]    = useState(false);

  const handleSubmit = async () => {
    if (!fullName.trim()) { Alert.alert('Required', 'Enter the lead\'s full name.'); return; }
    if (!phone.trim())    { Alert.alert('Required', 'Enter a phone number.'); return; }
    setSaving(true);
    try {
      await api.post('/sale/leads', {
        fullName:  fullName.trim(),
        phone:     phone.trim(),
        email:     email.trim() || undefined,
        source,
        budgetMin: budgetMin ? parseFloat(budgetMin) : undefined,
        budgetMax: budgetMax ? parseFloat(budgetMax) : undefined,
        notes:     notes.trim() || undefined,
        status:    'new',
      });
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to create lead.');
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Contact info */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CONTACT DETAILS</Text>
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Full Name <Text style={styles.req}>*</Text></Text>
              <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
                placeholder="e.g. James Kamau" placeholderTextColor="#94A3B8" />
            </View>
            <View style={styles.row2}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>Phone <Text style={styles.req}>*</Text></Text>
                <TextInput style={styles.input} value={phone} onChangeText={setPhone}
                  placeholder="+254 7XX XXX XXX" placeholderTextColor="#94A3B8"
                  keyboardType="phone-pad" />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>Email</Text>
                <TextInput style={styles.input} value={email} onChangeText={setEmail}
                  placeholder="Optional" placeholderTextColor="#94A3B8"
                  keyboardType="email-address" autoCapitalize="none" />
              </View>
            </View>
          </View>

          {/* Source */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>LEAD SOURCE</Text>
            <View style={styles.chipRow}>
              {SOURCES.map(s => (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.chip, source === s.key && styles.chipActive]}
                  onPress={() => setSource(s.key)}
                >
                  <Text style={[styles.chipTxt, source === s.key && styles.chipTxtActive]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Budget */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>BUDGET RANGE (KES)</Text>
            <View style={styles.row2}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>Minimum</Text>
                <TextInput style={styles.input} value={budgetMin} onChangeText={setBudgetMin}
                  placeholder="0" placeholderTextColor="#94A3B8" keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>Maximum</Text>
                <TextInput style={styles.input} value={budgetMax} onChangeText={setBudgetMax}
                  placeholder="0" placeholderTextColor="#94A3B8" keyboardType="decimal-pad" />
              </View>
            </View>
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>NOTES</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={notes} onChangeText={setNotes}
              placeholder="Any additional information about this lead..."
              placeholderTextColor="#94A3B8"
              multiline numberOfLines={3} textAlignVertical="top"
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.submitBtn, saving && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name="person-add-outline" size={18} color="#fff" />
                <Text style={styles.submitTxt}>Create Lead</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FFF7ED' },
  scroll: { padding: 16, gap: 20, paddingBottom: 16 },

  section:      { gap: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },
  label:        { fontSize: 12, fontWeight: '700', color: '#475569' },
  req:          { color: '#DC2626' },
  row2:         { flexDirection: 'row', gap: 10 },

  input: {
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0',
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A',
  },
  textarea: { minHeight: 80, paddingTop: 11 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E2E8F0',
  },
  chipActive:   { backgroundColor: SC + '15', borderColor: SC },
  chipTxt:      { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipTxtActive:{ color: SC, fontWeight: '700' },

  footer: { borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', padding: 16 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: SC, borderRadius: 14, paddingVertical: 15,
  },
  submitTxt: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
