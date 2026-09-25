import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Switch,
  TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import { Dropdown } from '../../../../components/ui/Dropdown';
import { apiError } from '../../../../utils/pmsFormat';

type DropItem = { _id: string; label: string; sublabel?: string };
type UnitOption = DropItem & { tenantId?: string; tenantName?: string };

// Priorities the server accepts: low | medium | high | emergency (Maintenance model enum).
const PRIORITY_STYLES: Record<string, { backgroundColor: string; color: string; borderColor: string }> = {
  low:       { backgroundColor: Colors.borderLight,  color: Colors.textMuted, borderColor: Colors.border },
  medium:    { backgroundColor: Colors.warningLight, color: Colors.warning,   borderColor: Colors.warning + '40' },
  high:      { backgroundColor: Colors.dangerLight,  color: Colors.danger,    borderColor: Colors.danger + '40' },
  emergency: { backgroundColor: '#FFF1F0',            color: '#CF1322',        borderColor: '#CF132240' },
};

const PRIORITIES = [
  { _id: 'low',       label: 'Low',       sublabel: 'No rush' },
  { _id: 'medium',    label: 'Medium',    sublabel: 'Within a week' },
  { _id: 'high',      label: 'High',      sublabel: 'Within 48 hours' },
  { _id: 'emergency', label: 'Emergency', sublabel: 'Immediate attention' },
];

export default function NewMaintenanceScreen() {
  const router = useRouter();

  // Property dropdown
  const [properties,        setProperties]        = useState<DropItem[]>([]);
  const [selectedPropId,    setSelectedPropId]    = useState('');
  const [selectedPropLabel, setSelectedPropLabel] = useState('');
  const [propsLoading,      setPropsLoading]      = useState(false);
  const [propOpen,          setPropOpen]          = useState(false);

  // Unit dropdown (the server requires a unit)
  const [units,             setUnits]             = useState<UnitOption[]>([]);
  const [selectedUnitId,    setSelectedUnitId]    = useState('');
  const [selectedUnitLabel, setSelectedUnitLabel] = useState('');
  const [selectedUnit,      setSelectedUnit]      = useState<UnitOption | null>(null);
  const [unitsLoading,      setUnitsLoading]      = useState(false);
  const [unitOpen,          setUnitOpen]          = useState(false);
  const [linkTenant,        setLinkTenant]        = useState(true);

  // Priority dropdown
  const [priorityOpen,          setPriorityOpen]          = useState(false);
  const [selectedPriority,      setSelectedPriority]      = useState('medium');
  const [selectedPriorityLabel, setSelectedPriorityLabel] = useState('Medium');

  // Form fields
  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo,  setAssignedTo]  = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const submittingRef = useRef(false);

  // Load properties on mount (the server's default page size is 10, so ask for more)
  useEffect(() => {
    setPropsLoading(true);
    api.get('/properties', { params: { limit: 500 } })
      .then(({ data }) =>
        setProperties((data.data ?? []).map((p: any) => ({ _id: p._id, label: p.propertyName, sublabel: p.propertyCode })))
      )
      .catch((err) => Alert.alert('Could not load properties', apiError(err, 'Failed to load properties.')))
      .finally(() => setPropsLoading(false));
  }, []);

  // Load units whenever the property changes
  useEffect(() => {
    setUnits([]); setSelectedUnitId(''); setSelectedUnitLabel(''); setSelectedUnit(null);
    if (!selectedPropId) return;
    let cancelled = false;
    setUnitsLoading(true);
    api.get('/units', { params: { property: selectedPropId, limit: 1000 } })
      .then(({ data }) => {
        if (cancelled) return;
        setUnits((data.data ?? []).map((u: any) => ({
          _id:        u._id,
          label:      `Unit ${u.unitNumber}`,
          sublabel:   u.currentTenant?.name ?? 'Vacant',
          tenantId:   u.currentTenant?._id,
          tenantName: u.currentTenant?.name,
        })));
      })
      .catch((err) => { if (!cancelled) Alert.alert('Could not load units', apiError(err, 'Failed to load units.')); })
      .finally(() => { if (!cancelled) setUnitsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedPropId]);

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!selectedUnitId) {
      Alert.alert('Required', 'Please select the property and unit the request is for.');
      return;
    }
    if (!title.trim()) {
      Alert.alert('Required', 'Please enter a title for the maintenance request.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Required', 'Please describe the issue.');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await api.post('/maintenances', {
        unit:        selectedUnitId,
        tenant:      linkTenant && selectedUnit?.tenantId ? selectedUnit.tenantId : undefined,
        title:       title.trim(),
        description: description.trim(),
        priority:    selectedPriority,
        assignedTo:  assignedTo.trim() || undefined,
      });
      router.back();
    } catch (err) {
      Alert.alert('Error', apiError(err, 'Failed to submit request.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New Maintenance Request' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Property */}
            <Dropdown
              label="Property"
              placeholder="Select property"
              selectedId={selectedPropId}
              selectedLabel={selectedPropLabel}
              items={properties}
              loading={propsLoading}
              open={propOpen}
              required
              onToggle={() => {
                setPropOpen(v => !v);
                setUnitOpen(false);
                setPriorityOpen(false);
              }}
              onSelect={(item) => {
                setSelectedPropId(item._id);
                setSelectedPropLabel(item.label);
                setPropOpen(false);
              }}
              onClear={() => {
                setSelectedPropId('');
                setSelectedPropLabel('');
              }}
            />

            {/* Unit */}
            <Dropdown
              label="Unit"
              placeholder={selectedPropId ? 'Select unit' : 'Select a property first'}
              selectedId={selectedUnitId}
              selectedLabel={selectedUnitLabel}
              items={units}
              loading={unitsLoading}
              open={unitOpen}
              required
              onToggle={() => {
                if (!selectedPropId) return;
                setUnitOpen(v => !v);
                setPropOpen(false);
                setPriorityOpen(false);
              }}
              onSelect={(item) => {
                setSelectedUnitId(item._id);
                setSelectedUnitLabel(item.label);
                setSelectedUnit(item as UnitOption);
                setLinkTenant(true);
                setUnitOpen(false);
              }}
              onClear={() => {
                setSelectedUnitId('');
                setSelectedUnitLabel('');
                setSelectedUnit(null);
              }}
              emptyText="No units in this property"
            />

            {/* Tenant — the unit's current occupant (optional link, as on the web form) */}
            {selectedUnit?.tenantId ? (
              <View style={styles.tenantRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.tenantLabel}>Link tenant</Text>
                  <Text style={styles.tenantSub} numberOfLines={1}>{selectedUnit.tenantName}</Text>
                </View>
                <Switch
                  value={linkTenant}
                  onValueChange={setLinkTenant}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.white}
                />
              </View>
            ) : null}

            {/* Priority */}
            <Dropdown
              label="Priority"
              placeholder="Select priority"
              selectedId={selectedPriority}
              selectedLabel={selectedPriorityLabel}
              items={PRIORITIES}
              open={priorityOpen}
              onToggle={() => {
                setPriorityOpen(v => !v);
                setPropOpen(false);
                setUnitOpen(false);
              }}
              onSelect={(item) => {
                setSelectedPriority(item._id);
                setSelectedPriorityLabel(item.label);
                setPriorityOpen(false);
              }}
              onClear={() => {
                setSelectedPriority('medium');
                setSelectedPriorityLabel('Medium');
              }}
              required
            />

            {/* Title */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Title <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Leaking tap in bathroom"
                placeholderTextColor={Colors.textMuted}
                value={title}
                onChangeText={setTitle}
                maxLength={120}
              />
            </View>

            {/* Description */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Description <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Describe the issue..."
                placeholderTextColor={Colors.textMuted}
                value={description}
                onChangeText={setDescription}
                maxLength={2000}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            {/* Assigned to */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Assigned To <Text style={styles.optional}>(optional)</Text></Text>
              <TextInput
                style={styles.input}
                placeholder="Technician or contractor name"
                placeholderTextColor={Colors.textMuted}
                value={assignedTo}
                onChangeText={setAssignedTo}
                maxLength={80}
              />
            </View>

            {/* Priority badge preview */}
            {selectedPriority ? (
              <View style={[styles.priorityBadge, PRIORITY_STYLES[selectedPriority]]}>
                <Ionicons name="alert-circle-outline" size={14} color={PRIORITY_STYLES[selectedPriority]?.color} />
                <Text style={[styles.priorityText, { color: PRIORITY_STYLES[selectedPriority]?.color }]}>
                  {selectedPriorityLabel} priority request
                </Text>
              </View>
            ) : null}

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <>
                  <Ionicons name="hammer-outline" size={18} color={Colors.white} />
                  <Text style={styles.submitText}>Submit Request</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 16, paddingBottom: 48 },

  fieldWrap: { gap: 6 },
  label:     { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  required:  { color: Colors.danger },
  optional:  { fontSize: 12, fontWeight: '400', color: Colors.textMuted },

  input: {
    backgroundColor: Colors.white,
    borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: Colors.text,
  },
  textArea: { minHeight: 100, paddingTop: 13 },

  tenantRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  tenantLabel: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  tenantSub:   { fontSize: 12, color: Colors.textMuted },

  priorityBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  priorityText: { fontSize: 13, fontWeight: '600' },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14, paddingVertical: 16,
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText:        { fontSize: 16, fontWeight: '800', color: Colors.white },
});
