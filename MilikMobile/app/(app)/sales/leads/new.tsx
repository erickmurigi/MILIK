import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../services/api';
import { DateField } from '../../../../components/ui/DateField';
import { useSaleSettings } from '../../../../hooks/useSaleSettings';
import { cleanDecimal } from '../../../../utils/pmsFormat';
import { SBG, SC, saleError } from '../../../../utils/sales';

type AgentOpt = { _id: string; fullName: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function NewLeadScreen() {
  const router = useRouter();
  const { stages, sources, terms: T } = useSaleSettings();

  const [fullName,  setFullName]  = useState('');
  const [phone,     setPhone]     = useState('');
  const [email,     setEmail]     = useState('');
  const [source,    setSource]    = useState('');
  const [agentId,   setAgentId]   = useState('');
  const [followUp,  setFollowUp]  = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [notes,     setNotes]     = useState('');
  const [agents,    setAgents]    = useState<AgentOpt[]>([]);
  const [saving,    setSaving]    = useState(false);
  const savingRef = useRef(false);

  // Lead sources are configured per company (Sale Settings); start on the first one
  const sourceValue = source && sources.some(s => s.value === source) ? source : (sources[0]?.value ?? 'walk_in');
  // New leads start at the first open stage of the company's pipeline
  const startStatus = stages.find(s => s.value !== 'converted' && s.value !== 'lost')?.value ?? 'new';

  // Optional: who follows this lead up. Agent-restricted users are assigned to themselves by the server anyway.
  useEffect(() => {
    let alive = true;
    api.get('/sale/agents', { params: { limit: 200, status: 'active' } })
      .then(({ data }) => { if (alive) setAgents(Array.isArray(data?.data) ? data.data : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const handleSubmit = async () => {
    if (savingRef.current) return;
    const name = fullName.trim();
    if (!name) { Alert.alert('Name needed', `Enter the ${T.saleLead.toLowerCase()}'s full name.`); return; }
    if (phone.trim() && phone.replace(/\D/g, '').length < 7) { Alert.alert('Check the phone number', 'That phone number looks too short.'); return; }
    if (email.trim() && !EMAIL_RE.test(email.trim())) { Alert.alert('Check the email', 'That email address does not look right.'); return; }
    const min = budgetMin ? parseFloat(budgetMin) : 0;
    const max = budgetMax ? parseFloat(budgetMax) : 0;
    if (min && max && min > max) { Alert.alert('Check the budget', 'The minimum budget is more than the maximum.'); return; }

    savingRef.current = true; setSaving(true);
    try {
      await api.post('/sale/leads', {
        fullName:  name,
        phone:     phone.trim(),
        email:     email.trim(),
        source:    sourceValue,
        status:    startStatus,
        assignedAgent:    agentId || undefined,
        nextFollowUpDate: followUp || undefined,
        budgetMin: min || undefined,
        budgetMax: max || undefined,
        notes:     notes.trim() || undefined,
      });
      router.back();
    } catch (err) {
      Alert.alert('Not saved', saleError(err, `Failed to create the ${T.saleLead.toLowerCase()}.`));
    } finally { savingRef.current = false; setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Contact info */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CONTACT DETAILS</Text>
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Full Name <Text style={styles.req}>*</Text></Text>
              <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
                placeholder="e.g. James Kamau" placeholderTextColor="#94A3B8" autoCapitalize="words" />
            </View>
            <View style={styles.row2}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>Phone</Text>
                <TextInput style={styles.input} value={phone} onChangeText={setPhone}
                  placeholder="07XX XXX XXX" placeholderTextColor="#94A3B8" keyboardType="phone-pad" />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>Email</Text>
                <TextInput style={styles.input} value={email} onChangeText={setEmail}
                  placeholder="Optional" placeholderTextColor="#94A3B8" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
              </View>
            </View>
          </View>

          {/* Source */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{T.saleLead.toUpperCase()} SOURCE</Text>
            <View style={styles.chipRow}>
              {sources.map(s => (
                <TouchableOpacity key={s.value} style={[styles.chip, sourceValue === s.value && styles.chipActive]} onPress={() => setSource(s.value)}>
                  <Text style={[styles.chipTxt, sourceValue === s.value && styles.chipTxtActive]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Agent */}
          {agents.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>ASSIGNED {T.saleAgent.toUpperCase()}</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity style={[styles.chip, !agentId && styles.chipActive]} onPress={() => setAgentId('')}>
                  <Text style={[styles.chipTxt, !agentId && styles.chipTxtActive]}>Unassigned</Text>
                </TouchableOpacity>
                {agents.map(a => (
                  <TouchableOpacity key={a._id} style={[styles.chip, agentId === a._id && styles.chipActive]} onPress={() => setAgentId(a._id)}>
                    <Text style={[styles.chipTxt, agentId === a._id && styles.chipTxtActive]}>{a.fullName}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}

          {/* Follow-up */}
          <View style={styles.section}>
            <DateField label="NEXT FOLLOW-UP" value={followUp} onChange={setFollowUp} optional />
          </View>

          {/* Budget */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>BUDGET RANGE (KES)</Text>
            <View style={styles.row2}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>Minimum</Text>
                <TextInput style={styles.input} value={budgetMin} onChangeText={t => setBudgetMin(cleanDecimal(t))}
                  placeholder="0" placeholderTextColor="#94A3B8" keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>Maximum</Text>
                <TextInput style={styles.input} value={budgetMax} onChangeText={t => setBudgetMax(cleanDecimal(t))}
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
              placeholder={`Any additional information about this ${T.saleLead.toLowerCase()}...`}
              placeholderTextColor="#94A3B8"
              multiline numberOfLines={3} textAlignVertical="top"
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.6 }]} onPress={handleSubmit} disabled={saving} activeOpacity={0.85}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name="person-add-outline" size={18} color="#fff" />
                <Text style={styles.submitTxt}>Create {T.saleLead}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: SBG },
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
