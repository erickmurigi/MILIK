import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, TextInput, Modal, Linking,
  KeyboardAvoidingView, Platform, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { DateField } from '../../../../components/ui/DateField';
import { ErrorState } from '../../../../components/ui/PmsStates';
import { useSaleSettings } from '../../../../hooks/useSaleSettings';
import { fmtDate, fmtMoney, todayISO } from '../../../../utils/pmsFormat';
import {
  ACTIVITY_OUTCOMES, ACTIVITY_TYPES, SBG, SC, followUpOverdue, humanize, leadStatusStyle, refName, saleError,
} from '../../../../utils/sales';

type Icon = React.ComponentProps<typeof Ionicons>['name'];

type Activity = {
  _id:             string;
  type:            string;
  subject?:        string;
  notes?:          string;
  date?:           string;
  outcome?:        string;
  nextAction?:     string;
  nextActionDate?: string;
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
  lostReason?:       string;
  nextFollowUpDate?: string;
  lastContactDate?:  string;
  assignedAgent?:    { fullName?: string; phone?: string };
  interestedListings?: { _id: string; listingNumber?: string; title?: string }[];
  convertedBuyer?:   { _id?: string; buyerNumber?: string; fullName?: string } | null;
  convertedAt?:      string;
};

const ACT_ICONS: Record<string, Icon> = {
  call: 'call-outline', email: 'mail-outline', meeting: 'people-outline',
  site_visit: 'home-outline', whatsapp: 'chatbubble-outline',
  note: 'document-text-outline', follow_up: 'notifications-outline',
};
const OUTCOME_COLOR: Record<string, string> = {
  positive: '#065F46', neutral: '#64748B', negative: '#DC2626', no_answer: '#D97706', not_applicable: '#94A3B8',
};

const budgetText = (min?: number, max?: number) => {
  if (!min && !max) return null;
  if (min && max) return `KES ${fmtMoney(min)} – ${fmtMoney(max)}`;
  return max ? `Up to KES ${fmtMoney(max)}` : `From KES ${fmtMoney(min)}`;
};

/** A date picked without a time: today keeps the current time, another day is stored at midday (no day shift in any zone). */
const activityDate = (day: string) => (day === todayISO() ? new Date() : new Date(`${day}T12:00:00`)).toISOString();

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { stages, sources, terms: T } = useSaleSettings();

  const [lead,       setLead]       = useState<Lead | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [actsErr,    setActsErr]    = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const reqRef = useRef(0);
  const termRef = useRef(T);   // read inside load() so the settings arriving does not refetch the lead
  termRef.current = T;

  // Status sheet
  const [statusModal,  setStatusModal]  = useState(false);
  const [newStatus,    setNewStatus]    = useState('');
  const [lostReason,   setLostReason]   = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  // Convert sheet
  const [convertModal, setConvertModal] = useState(false);
  const [idNumber,     setIdNumber]     = useState('');
  const [converting,   setConverting]   = useState(false);

  // Activity sheet
  const [actModal,   setActModal]   = useState(false);
  const [actType,    setActType]    = useState<string>('call');
  const [actSubject, setActSubject] = useState('');
  const [actNotes,   setActNotes]   = useState('');
  const [actDate,    setActDate]    = useState(todayISO());
  const [actOutcome, setActOutcome] = useState<string>('not_applicable');
  const [nextAction, setNextAction] = useState('');
  const [nextDate,   setNextDate]   = useState('');
  const [savingAct,  setSavingAct]  = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    const rid = ++reqRef.current;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    // The lead is the page; its activity log is a separate endpoint (own permission) and may fail alone.
    const [l, a] = await Promise.allSettled([
      api.get(`/sale/leads/${id}`),
      api.get('/sale/activities', { params: { relatedLead: id, limit: 100 } }),
    ]);
    if (rid !== reqRef.current) return;
    if (l.status === 'fulfilled') { setLead(l.value.data); setError(null); }
    else setError(saleError(l.reason, `Could not load this ${termRef.current.saleLead.toLowerCase()}.`));
    if (a.status === 'fulfilled') { setActivities(Array.isArray(a.value.data?.data) ? a.value.data.data : []); setActsErr(null); }
    else setActsErr(saleError(a.reason, 'Could not load the activity log.'));
    setLoading(false);
    setRefreshing(false);
  }, [id]);

  useEffect(() => { load('initial'); }, [load]);

  const statusLabel = useMemo(() => {
    const map = new Map(stages.map(s => [s.value, s.label]));
    return (v: string) => map.get(v) ?? humanize(v);
  }, [stages]);
  const sourceLabel = useMemo(() => {
    const map = new Map(sources.map(s => [s.value, s.label]));
    return (v?: string) => (v ? map.get(v) ?? humanize(v) : '—');
  }, [sources]);

  const openStatus = () => { setNewStatus(lead?.status ?? ''); setLostReason(lead?.lostReason ?? ''); setStatusModal(true); };

  const saveStatus = async () => {
    if (busyRef.current || !lead || !newStatus || newStatus === lead.status && newStatus !== 'lost') { setStatusModal(false); return; }
    busyRef.current = true; setSavingStatus(true);
    try {
      await api.put(`/sale/leads/${id}`, { status: newStatus, ...(newStatus === 'lost' ? { lostReason: lostReason.trim() } : {}) });
      setStatusModal(false);
      await load('silent');
    } catch (err) {
      Alert.alert('Not updated', saleError(err, 'Failed to update the status.'));
    } finally { busyRef.current = false; setSavingStatus(false); }
  };

  const convert = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setConverting(true);
    try {
      await api.patch(`/sale/leads/${id}/convert`, { idNumber: idNumber.trim() });
      setConvertModal(false);
      setIdNumber('');
      await load('silent');
    } catch (err) {
      Alert.alert('Not converted', saleError(err, `Failed to convert the ${T.saleLead.toLowerCase()}.`));
    } finally { busyRef.current = false; setConverting(false); }
  };

  const openActivity = () => {
    setActType('call'); setActSubject(''); setActNotes(''); setActOutcome('not_applicable');
    setActDate(todayISO()); setNextAction(''); setNextDate('');
    setActModal(true);
  };

  const logActivity = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setSavingAct(true);
    try {
      await api.post('/sale/activities', {
        relatedLead:    id,
        type:           actType,
        subject:        actSubject.trim(),
        notes:          actNotes.trim(),
        date:           activityDate(actDate),
        outcome:        actOutcome,
        nextAction:     nextAction.trim(),
        nextActionDate: nextDate || null,
      });
      setActModal(false);
      await load('silent');
    } catch (err) {
      Alert.alert('Not saved', saleError(err, 'Failed to log the activity.'));
    } finally { busyRef.current = false; setSavingAct(false); }
  };

  if (loading && !lead) return <MilikLoader fullscreen />;
  if (!lead) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ErrorState message={error || `Could not load this ${T.saleLead.toLowerCase()}.`} onRetry={() => load('initial')} />
      </SafeAreaView>
    );
  }

  const sc        = leadStatusStyle(lead.status);
  const budget    = budgetText(lead.budgetMin, lead.budgetMax);
  const converted = !!lead.convertedBuyer || lead.status === 'converted';
  const overdue   = followUpOverdue(lead.nextFollowUpDate, lead.status);
  const agent     = refName(lead.assignedAgent, 'fullName');
  const statusChoices = stages.filter(s => s.value !== 'converted');

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={SC} />}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              {lead.leadNumber ? <Text style={styles.heroNum}>{lead.leadNumber}</Text> : null}
              <Text style={styles.heroName}>{lead.fullName}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: '#fff' }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{statusLabel(lead.status)}</Text>
            </View>
          </View>
          <View style={styles.heroContacts}>
            {lead.phone ? (
              <TouchableOpacity style={styles.heroContactRow} onPress={() => Linking.openURL(`tel:${lead.phone}`).catch(() => {})} activeOpacity={0.7}>
                <Ionicons name="call-outline" size={13} color="rgba(255,255,255,0.7)" />
                <Text style={styles.heroContactTxt}>{lead.phone}</Text>
              </TouchableOpacity>
            ) : null}
            {lead.email ? (
              <TouchableOpacity style={styles.heroContactRow} onPress={() => Linking.openURL(`mailto:${lead.email}`).catch(() => {})} activeOpacity={0.7}>
                <Ionicons name="mail-outline" size={13} color="rgba(255,255,255,0.7)" />
                <Text style={styles.heroContactTxt}>{lead.email}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Converted banner */}
        {converted ? (
          <View style={styles.convertedBox}>
            <Ionicons name="checkmark-circle-outline" size={18} color="#065F46" />
            <Text style={styles.convertedTxt}>
              Converted to {T.saleBuyer.toLowerCase()}
              {lead.convertedBuyer ? `: ${[lead.convertedBuyer.buyerNumber, lead.convertedBuyer.fullName].filter(Boolean).join(' · ')}` : ''}
              {lead.convertedAt ? ` on ${fmtDate(lead.convertedAt)}` : ''}
            </Text>
          </View>
        ) : null}

        {/* Info card */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>DETAILS</Text>
          <InfoRow icon="megaphone-outline" label="Source" value={sourceLabel(lead.source)} />
          {budget ? <InfoRow icon="wallet-outline" label="Budget" value={budget} /> : null}
          {agent ? <InfoRow icon="person-outline" label={T.saleAgent} value={agent} /> : null}
          {lead.nextFollowUpDate ? (
            <InfoRow icon="calendar-outline" label="Next follow-up" value={`${fmtDate(lead.nextFollowUpDate)}${overdue ? ' · overdue' : ''}`} danger={overdue} />
          ) : null}
          {lead.lastContactDate ? <InfoRow icon="time-outline" label="Last contact" value={fmtDate(lead.lastContactDate)} /> : null}
          {lead.status === 'lost' && lead.lostReason ? <InfoRow icon="close-circle-outline" label="Lost because" value={lead.lostReason} /> : null}
          {lead.notes ? <InfoRow icon="document-text-outline" label="Notes" value={lead.notes} /> : null}
          {(lead.interestedListings ?? []).length > 0 ? (
            <View style={{ gap: 6, marginTop: 2 }}>
              <Text style={styles.subLabel}>INTERESTED IN</Text>
              {(lead.interestedListings ?? []).map(l => (
                <TouchableOpacity key={l._id} style={styles.listingRow} onPress={() => router.push(`/sales/listings/${l._id}` as any)} activeOpacity={0.7}>
                  <Ionicons name="home-outline" size={14} color={SC} />
                  <Text style={styles.listingTxt} numberOfLines={1}>{[l.listingNumber, l.title].filter(Boolean).join(' · ')}</Text>
                  <Ionicons name="chevron-forward" size={14} color="#CBD5E1" />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>

        {/* Activities */}
        <View style={styles.card}>
          <View style={styles.actHeader}>
            <Text style={styles.sectionLabel}>ACTIVITIES ({activities.length})</Text>
            <TouchableOpacity style={styles.logBtn} onPress={openActivity}>
              <Ionicons name="add" size={14} color={SC} />
              <Text style={styles.logBtnTxt}>Log</Text>
            </TouchableOpacity>
          </View>

          {actsErr ? <Text style={styles.errTxt}>{actsErr}</Text>
          : activities.length === 0 ? <Text style={styles.emptyTxt}>No activities logged yet.</Text>
          : activities.map(act => {
              const oc = OUTCOME_COLOR[act.outcome ?? ''] ?? '#94A3B8';
              return (
                <View key={act._id} style={styles.actRow}>
                  <View style={styles.actIconWrap}>
                    <Ionicons name={ACT_ICONS[act.type] ?? 'ellipse-outline'} size={14} color={SC} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.actTop}>
                      <Text style={styles.actType}>{humanize(act.type)}</Text>
                      {act.date ? <Text style={styles.actDate}>{fmtDate(act.date)}</Text> : null}
                    </View>
                    {act.subject ? <Text style={styles.actSubject}>{act.subject}</Text> : null}
                    {act.notes ? <Text style={styles.actNotes}>{act.notes}</Text> : null}
                    {act.outcome && act.outcome !== 'not_applicable' ? (
                      <Text style={[styles.actOutcome, { color: oc }]}>{humanize(act.outcome)}</Text>
                    ) : null}
                    {act.nextAction || act.nextActionDate ? (
                      <Text style={styles.actNext}>
                        Next: {act.nextAction || 'follow up'}{act.nextActionDate ? ` · ${fmtDate(act.nextActionDate)}` : ''}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
        </View>
      </ScrollView>

      {/* Action bar */}
      {!converted && (
        <View style={styles.actionsWrap}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#fff', borderWidth: 1.5, borderColor: SC }]} onPress={openStatus} activeOpacity={0.85}>
            <Ionicons name="swap-horizontal-outline" size={16} color={SC} />
            <Text style={[styles.actionTxt, { color: SC }]}>Change status</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: SC }]} onPress={() => setConvertModal(true)} activeOpacity={0.85}>
            <Ionicons name="person-add-outline" size={16} color="#fff" />
            <Text style={styles.actionTxt}>Convert to {T.saleBuyer}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Status sheet */}
      <Modal visible={statusModal} animationType="slide" transparent onRequestClose={() => !savingStatus && setStatusModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => !savingStatus && setStatusModal(false)} />
          <View style={[styles.sheet, { maxHeight: height * 0.85 }]}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>Change status</Text>
              <View style={styles.chipWrap}>
                {statusChoices.map(s => (
                  <TouchableOpacity key={s.value} style={[styles.chip, newStatus === s.value && styles.chipActive]} onPress={() => setNewStatus(s.value)}>
                    <Text style={[styles.chipTxt, newStatus === s.value && styles.chipTxtActive]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {newStatus === 'lost' ? (
                <>
                  <Text style={styles.label}>Why was it lost?</Text>
                  <TextInput style={[styles.input, { marginBottom: 14 }]} value={lostReason} onChangeText={setLostReason}
                    placeholder="e.g. Bought elsewhere" placeholderTextColor="#94A3B8" />
                </>
              ) : null}
              <TouchableOpacity style={[styles.submitBtn, savingStatus && { opacity: 0.6 }]} onPress={saveStatus} disabled={savingStatus} activeOpacity={0.85}>
                {savingStatus ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitTxt}>Save status</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Convert sheet */}
      <Modal visible={convertModal} animationType="slide" transparent onRequestClose={() => !converting && setConvertModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => !converting && setConvertModal(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Convert to {T.saleBuyer}</Text>
            <Text style={styles.sheetText}>
              {lead.fullName} becomes a registered {T.saleBuyer.toLowerCase()} and this {T.saleLead.toLowerCase()} is marked converted.
              You cannot change its status afterwards.
            </Text>
            <Text style={styles.label}>ID / Passport number</Text>
            <TextInput style={[styles.input, { marginBottom: 14 }]} value={idNumber} onChangeText={setIdNumber}
              placeholder="Optional" placeholderTextColor="#94A3B8" autoCapitalize="characters" />
            <TouchableOpacity style={[styles.submitBtn, converting && { opacity: 0.6 }]} onPress={convert} disabled={converting} activeOpacity={0.85}>
              {converting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitTxt}>Convert to {T.saleBuyer}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Log Activity sheet */}
      <Modal visible={actModal} animationType="slide" transparent onRequestClose={() => !savingAct && setActModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => !savingAct && setActModal(false)} />
          <View style={[styles.sheet, { maxHeight: height * 0.9 }]}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>Log activity</Text>

              <Text style={styles.label}>Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginBottom: 12, flexGrow: 0 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {ACTIVITY_TYPES.map(t => (
                    <TouchableOpacity key={t} style={[styles.chip, actType === t && styles.chipActive]} onPress={() => setActType(t)}>
                      <Text style={[styles.chipTxt, actType === t && styles.chipTxtActive]}>{humanize(t)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <View style={{ marginBottom: 12 }}>
                <DateField label="DATE" value={actDate} onChange={setActDate} required />
              </View>

              <Text style={styles.label}>Subject</Text>
              <TextInput style={[styles.input, { marginBottom: 10 }]} value={actSubject} onChangeText={setActSubject}
                placeholder="Brief subject..." placeholderTextColor="#94A3B8" />

              <Text style={styles.label}>Notes</Text>
              <TextInput style={[styles.input, styles.textarea, { marginBottom: 10 }]} value={actNotes} onChangeText={setActNotes}
                placeholder="Details..." placeholderTextColor="#94A3B8" multiline numberOfLines={3} textAlignVertical="top" />

              <Text style={styles.label}>Outcome</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginBottom: 12, flexGrow: 0 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {ACTIVITY_OUTCOMES.map(o => (
                    <TouchableOpacity key={o} style={[styles.chip, actOutcome === o && styles.chipActive]} onPress={() => setActOutcome(o)}>
                      <Text style={[styles.chipTxt, actOutcome === o && styles.chipTxtActive]}>{humanize(o)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.label}>Next action</Text>
              <TextInput style={[styles.input, { marginBottom: 12 }]} value={nextAction} onChangeText={setNextAction}
                placeholder="e.g. Send site plan" placeholderTextColor="#94A3B8" />
              <View style={{ marginBottom: 16 }}>
                <DateField label="NEXT FOLLOW-UP" value={nextDate} onChange={setNextDate} optional />
              </View>

              <TouchableOpacity style={[styles.submitBtn, savingAct && { opacity: 0.6 }]} onPress={logActivity} disabled={savingAct} activeOpacity={0.85}>
                {savingAct ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitTxt}>Save activity</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value, danger }: { icon: Icon; label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={14} color={danger ? '#DC2626' : '#94A3B8'} style={{ marginTop: 1 }} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, danger && { color: '#DC2626' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: SBG },
  scroll: { padding: 16, gap: 14, paddingBottom: 16 },

  hero: {
    backgroundColor: SC, borderRadius: 18, padding: 20, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  heroTop:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  heroNum:        { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.8, marginBottom: 2 },
  heroName:       { fontSize: 22, fontWeight: '900', color: '#fff' },
  badge:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start', maxWidth: 140 },
  badgeTxt:       { fontSize: 11, fontWeight: '800' },
  heroContacts:   { gap: 8 },
  heroContactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroContactTxt: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },

  convertedBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ECFDF5', borderRadius: 12, borderWidth: 1, borderColor: '#A7F3D0', padding: 12 },
  convertedTxt: { flex: 1, fontSize: 12, fontWeight: '600', color: '#065F46', lineHeight: 17 },

  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, gap: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },
  subLabel:     { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#94A3B8' },

  infoRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontSize: 12, color: '#94A3B8', width: 96 },
  infoValue: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },

  listingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF7ED', borderRadius: 10, padding: 10 },
  listingTxt: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },

  actHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: SC + '15', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  logBtnTxt: { fontSize: 12, fontWeight: '700', color: SC },
  emptyTxt:  { fontSize: 13, color: '#94A3B8', textAlign: 'center', paddingVertical: 8 },
  errTxt:    { fontSize: 13, color: '#B91C1C', textAlign: 'center', paddingVertical: 8, lineHeight: 18 },

  actRow:     { flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  actIconWrap:{ width: 28, height: 28, borderRadius: 8, backgroundColor: SC + '12', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  actTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  actType:    { fontSize: 12, fontWeight: '800', color: '#0F172A' },
  actDate:    { fontSize: 11, color: '#94A3B8' },
  actSubject: { fontSize: 13, fontWeight: '600', color: '#0F172A' },
  actNotes:   { fontSize: 12, color: '#475569', lineHeight: 18 },
  actOutcome: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  actNext:    { fontSize: 11, color: '#64748B', marginTop: 2 },

  actionsWrap: { borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', padding: 16, flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 13 },
  actionTxt: { fontSize: 13, fontWeight: '800', color: '#fff' },

  // Sheets
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 28 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 14 },
  sheetText:  { fontSize: 13, color: '#64748B', lineHeight: 19, marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 },
  input: {
    backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0',
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A',
  },
  textarea: { minHeight: 72, paddingTop: 11 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E2E8F0' },
  chipActive:    { backgroundColor: SC + '15', borderColor: SC },
  chipTxt:       { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipTxtActive: { color: SC, fontWeight: '700' },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: SC, borderRadius: 14, paddingVertical: 14 },
  submitTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
