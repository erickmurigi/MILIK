import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, TextInput, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';

const SC = '#7C2D12';

type Activity = {
  _id:            string;
  type:           string;
  subject?:       string;
  notes?:         string;
  date?:          string;
  outcome?:       string;
  nextAction?:    string;
  nextActionDate?:string;
};

type Lead = {
  _id:               string;
  leadNumber?:       string;
  fullName:          string;
  phone?:            string;
  email?:            string;
  source?:           string;
  status:            string;
  budgetMin?:        number;
  budgetMax?:        number;
  notes?:            string;
  nextFollowUpDate?: string;
  assignedAgent?:    { name?: string } | string;
  activities?:       Activity[];
};

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  new:           { bg: '#DBEAFE', color: '#1D4ED8', label: 'New'           },
  contacted:     { bg: '#E0F2FE', color: '#0369A1', label: 'Contacted'     },
  qualified:     { bg: '#EDE9FE', color: '#7C3AED', label: 'Qualified'     },
  site_visited:  { bg: '#E0E7FF', color: '#4338CA', label: 'Site Visited'  },
  proposal_sent: { bg: '#FEF3C7', color: '#D97706', label: 'Proposal Sent' },
  negotiating:   { bg: '#FFEDD5', color: '#EA580C', label: 'Negotiating'   },
  converted:     { bg: '#D1FAE5', color: '#065F46', label: 'Converted'     },
  lost:          { bg: '#FEE2E2', color: '#DC2626', label: 'Lost'          },
};

const ACT_ICONS: Record<string, string> = {
  call: 'call-outline', email: 'mail-outline', meeting: 'people-outline',
  site_visit: 'home-outline', whatsapp: 'chatbubble-outline',
  note: 'document-text-outline', follow_up: 'notifications-outline',
};

const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'site_visit', 'whatsapp', 'note', 'follow_up'];
const OUTCOMES       = ['positive', 'neutral', 'negative', 'no_answer', 'not_applicable'];

const OUTCOME_COLOR: Record<string, string> = {
  positive: '#065F46', neutral: '#64748B', negative: '#DC2626',
  no_answer: '#D97706', not_applicable: '#94A3B8',
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtBudget = (min?: number, max?: number) => {
  if (!min && !max) return null;
  const f = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : String(n);
  if (min && max) return `KES ${f(min)} – ${f(max)}`;
  return max ? `Up to KES ${f(max)}` : `KES ${f(min!)}+`;
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();

  const [lead,    setLead]    = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting,  setActing]  = useState(false);

  // Log activity modal
  const [actModal, setActModal] = useState(false);
  const [actType,  setActType]  = useState('call');
  const [actSubject, setActSubject] = useState('');
  const [actNotes, setActNotes] = useState('');
  const [actDate,  setActDate]  = useState(todayStr());
  const [actOutcome, setActOutcome] = useState('not_applicable');
  const [savingAct, setSavingAct] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/sale/leads/${id}`, { params: { includeActivities: true } });
      setLead(data?.data ?? data);
    } catch { Alert.alert('Error', 'Could not load lead.'); router.back(); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = (status: string, label: string) => {
    Alert.alert(label, `Mark this lead as ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: label, style: status === 'lost' ? 'destructive' : 'default',
        onPress: async () => {
          setActing(true);
          try {
            await api.put(`/sale/leads/${id}`, { status });
            await load();
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.message ?? 'Failed to update status.');
          } finally { setActing(false); }
        },
      },
    ]);
  };

  const logActivity = async () => {
    setSavingAct(true);
    try {
      await api.post('/sale/activities', {
        lead: id,
        type: actType,
        subject: actSubject.trim() || undefined,
        notes:   actNotes.trim() || undefined,
        date:    actDate,
        outcome: actOutcome,
      });
      setActModal(false);
      setActSubject(''); setActNotes('');
      await load();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to log activity.');
    } finally { setSavingAct(false); }
  };

  if (loading) return <MilikLoader fullscreen />;
  if (!lead)   return null;

  const sc     = STATUS_CFG[lead.status] ?? STATUS_CFG.new;
  const budget = fmtBudget(lead.budgetMin, lead.budgetMax);
  const isDone = ['converted', 'lost'].includes(lead.status);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              {lead.leadNumber && <Text style={styles.heroNum}>{lead.leadNumber}</Text>}
              <Text style={styles.heroName}>{lead.fullName}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: sc.color + '25' }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
          </View>
          <View style={styles.heroContacts}>
            {lead.phone && (
              <View style={styles.heroContactRow}>
                <Ionicons name="call-outline" size={13} color="rgba(255,255,255,0.6)" />
                <Text style={styles.heroContactTxt}>{lead.phone}</Text>
              </View>
            )}
            {lead.email && (
              <View style={styles.heroContactRow}>
                <Ionicons name="mail-outline" size={13} color="rgba(255,255,255,0.6)" />
                <Text style={styles.heroContactTxt}>{lead.email}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Info card */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>DETAILS</Text>
          <InfoRow icon="megaphone-outline" label="Source" value={(lead.source ?? '—').replace(/_/g, ' ')} />
          {budget && <InfoRow icon="wallet-outline" label="Budget" value={budget} />}
          {typeof lead.assignedAgent === 'object' && lead.assignedAgent?.name && (
            <InfoRow icon="person-outline" label="Agent" value={lead.assignedAgent.name} />
          )}
          {lead.nextFollowUpDate && (
            <InfoRow icon="calendar-outline" label="Next Follow-up" value={fmtDate(lead.nextFollowUpDate)} />
          )}
          {lead.notes && <InfoRow icon="document-text-outline" label="Notes" value={lead.notes} />}
        </View>

        {/* Activities */}
        <View style={styles.card}>
          <View style={styles.actHeader}>
            <Text style={styles.sectionLabel}>ACTIVITIES</Text>
            <TouchableOpacity style={styles.logBtn} onPress={() => setActModal(true)}>
              <Ionicons name="add" size={14} color={SC} />
              <Text style={styles.logBtnTxt}>Log</Text>
            </TouchableOpacity>
          </View>

          {(lead.activities ?? []).length === 0 ? (
            <Text style={styles.emptyTxt}>No activities logged yet.</Text>
          ) : (
            (lead.activities ?? []).slice().reverse().map(act => {
              const ic = ACT_ICONS[act.type] ?? 'ellipse-outline';
              const oc = OUTCOME_COLOR[act.outcome ?? ''] ?? '#94A3B8';
              return (
                <View key={act._id} style={styles.actRow}>
                  <View style={styles.actIconWrap}>
                    <Ionicons name={ic as any} size={14} color={SC} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.actTop}>
                      <Text style={styles.actType}>{act.type.replace(/_/g, ' ')}</Text>
                      {act.date && <Text style={styles.actDate}>{fmtDate(act.date)}</Text>}
                    </View>
                    {act.subject && <Text style={styles.actSubject}>{act.subject}</Text>}
                    {act.notes   && <Text style={styles.actNotes}>{act.notes}</Text>}
                    {act.outcome && act.outcome !== 'not_applicable' && (
                      <Text style={[styles.actOutcome, { color: oc }]}>{act.outcome.replace(/_/g, ' ')}</Text>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>

      </ScrollView>

      {/* Action bar */}
      {!isDone && (
        <View style={styles.actionsWrap}>
          {acting ? <ActivityIndicator color={SC} /> : (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#DC2626', flex: 0.55 }]}
                onPress={() => updateStatus('lost', 'Lost')}
              >
                <Ionicons name="close-outline" size={16} color="#fff" />
                <Text style={styles.actionTxt}>Lost</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#1D4ED8' }]}
                onPress={() => updateStatus('contacted', 'Contacted')}
              >
                <Ionicons name="call-outline" size={16} color="#fff" />
                <Text style={styles.actionTxt}>Contacted</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: SC }]}
                onPress={() => updateStatus('qualified', 'Qualify')}
              >
                <Ionicons name="checkmark-outline" size={16} color="#fff" />
                <Text style={styles.actionTxt}>Qualify</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Log Activity Modal */}
      <Modal visible={actModal} animationType="slide" transparent onRequestClose={() => setActModal(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
          activeOpacity={1}
          onPress={() => setActModal(false)}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.actSheet}>
            <Text style={styles.actSheetTitle}>Log Activity</Text>

            <Text style={styles.label}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {ACTIVITY_TYPES.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, actType === t && styles.chipActive]}
                    onPress={() => setActType(t)}
                  >
                    <Text style={[styles.chipTxt, actType === t && styles.chipTxtActive]}>
                      {t.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.label}>Subject</Text>
            <TextInput style={[styles.input, { marginBottom: 10 }]} value={actSubject}
              onChangeText={setActSubject} placeholder="Brief subject..." placeholderTextColor="#94A3B8" />

            <Text style={styles.label}>Notes</Text>
            <TextInput style={[styles.input, styles.textarea, { marginBottom: 10 }]}
              value={actNotes} onChangeText={setActNotes}
              placeholder="Details..." placeholderTextColor="#94A3B8"
              multiline numberOfLines={3} textAlignVertical="top" />

            <Text style={styles.label}>Outcome</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {OUTCOMES.map(o => (
                  <TouchableOpacity
                    key={o}
                    style={[styles.chip, actOutcome === o && styles.chipActive]}
                    onPress={() => setActOutcome(o)}
                  >
                    <Text style={[styles.chipTxt, actOutcome === o && styles.chipTxtActive]}>
                      {o.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.submitBtn, savingAct && { opacity: 0.6 }]}
              onPress={logActivity}
              disabled={savingAct}
            >
              {savingAct ? <ActivityIndicator color="#fff" size="small" /> : (
                <Text style={styles.submitTxt}>Save Activity</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon as any} size={14} color="#94A3B8" style={{ marginTop: 1 }} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FFF7ED' },
  scroll: { padding: 16, gap: 14, paddingBottom: 16 },

  hero: {
    backgroundColor: SC, borderRadius: 18, padding: 20, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  heroTop:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  heroNum:        { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.8, marginBottom: 2 },
  heroName:       { fontSize: 22, fontWeight: '900', color: '#fff' },
  badge:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  badgeTxt:       { fontSize: 11, fontWeight: '800' },
  heroContacts:   { gap: 6 },
  heroContactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroContactTxt: { fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: '500' },

  card: {
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1,
    borderColor: '#E2E8F0', padding: 16, gap: 10,
  },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  infoRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontSize: 12, color: '#94A3B8', width: 90 },
  infoValue: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },

  actHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: SC + '15', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  logBtnTxt: { fontSize: 12, fontWeight: '700', color: SC },
  emptyTxt:  { fontSize: 13, color: '#94A3B8', textAlign: 'center', paddingVertical: 8 },

  actRow:    { flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  actIconWrap:{ width: 28, height: 28, borderRadius: 8, backgroundColor: SC + '12', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  actTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  actType:   { fontSize: 12, fontWeight: '800', color: '#0F172A', textTransform: 'capitalize' },
  actDate:   { fontSize: 11, color: '#94A3B8' },
  actSubject:{ fontSize: 13, fontWeight: '600', color: '#0F172A' },
  actNotes:  { fontSize: 12, color: '#475569', lineHeight: 18 },
  actOutcome:{ fontSize: 11, fontWeight: '700', marginTop: 2, textTransform: 'capitalize' },

  actionsWrap: {
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
    backgroundColor: '#fff', padding: 16,
    flexDirection: 'row', gap: 8,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 12, paddingVertical: 13,
  },
  actionTxt: { fontSize: 13, fontWeight: '800', color: '#fff' },

  // Modal
  actSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36,
  },
  actSheetTitle: { fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 16 },
  label:  { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 },
  input: {
    backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0',
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A',
  },
  textarea: { minHeight: 72, paddingTop: 11 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E2E8F0',
  },
  chipActive:    { backgroundColor: SC + '15', borderColor: SC },
  chipTxt:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipTxtActive: { color: SC, fontWeight: '700' },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: SC, borderRadius: 14, paddingVertical: 14,
  },
  submitTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
