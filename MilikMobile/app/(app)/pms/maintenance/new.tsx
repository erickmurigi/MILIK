import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import api from '../../../../services/api';
import { Dropdown } from '../../../../components/ui/Dropdown';

type DropItem = { _id: string; label: string; sublabel?: string };

const PRIORITY_STYLES: Record<string, { backgroundColor: string; color: string; borderColor: string }> = {
  low:    { backgroundColor: Colors.borderLight,  color: Colors.textMuted, borderColor: Colors.border },
  medium: { backgroundColor: Colors.warningLight, color: Colors.warning,   borderColor: Colors.warning + '40' },
  high:   { backgroundColor: Colors.dangerLight,  color: Colors.danger,    borderColor: Colors.danger + '40' },
  urgent: { backgroundColor: '#FFF1F0',            color: '#CF1322',        borderColor: '#CF132240' },
};

const PRIORITIES = [
  { _id: 'low',    label: 'Low',    sublabel: 'No rush' },
  { _id: 'medium', label: 'Medium', sublabel: 'Within a week' },
  { _id: 'high',   label: 'High',   sublabel: 'Within 48 hours' },
  { _id: 'urgent', label: 'Urgent', sublabel: 'Immediate attention' },
];

export default function NewMaintenanceScreen() {
  const router = useRouter();

  // Property dropdown
  const [properties,       setProperties]       = useState<DropItem[]>([]);
  const [selectedPropId,   setSelectedPropId]   = useState('');
  const [selectedPropLabel,setSelectedPropLabel] = useState('');
  const [propsLoading,     setPropsLoading]     = useState(false);
  const [propOpen,         setPropOpen]         = useState(false);

  // Tenant dropdown
  const [tenants,          setTenants]          = useState<DropItem[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedTenantLabel, setSelectedTenantLabel] = useState('');
  const [tenantsLoading,   setTenantsLoading]   = useState(false);
  const [tenantOpen,       setTenantOpen]       = useState(false);

  // Priority dropdown
  const [priorityOpen,     setPriorityOpen]     = useState(false);
  const [selectedPriority, setSelectedPriority] = useState('medium');
  const [selectedPriorityLabel, setSelectedPriorityLabel] = useState('Medium');

  // Form fields
  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo,  setAssignedTo]  = useState('');
  const [submitting,  setSubmitting]  = useState(false);

  // Load properties on mount
  useEffect(() => {
    setPropsLoading(true);
    api.get('/properties', { params: { limit: 100 } })
      .then(({ data }) =>
        setProperties((data.data ?? []).map((p: any) => ({ _id: p._id, label: p.propertyName })))
      )
      .catch(() => {})
      .finally(() => setPropsLoading(false));
  }, []);

  // Load tenants when property changes
  const loadTenants = useCallback(async (propId?: string) => {
    setTenantsLoading(true);
    try {
      const params: any = { limit: 100, status: 'active' };
      if (propId) params.property = propId;
      const { data } = await api.get('/tenants', { params });
      setTenants((data.data ?? []).map((t: any) => ({
        _id:      t._id,
        label:    t.name,
        sublabel: [t.unit?.unitNumber, t.unit?.property?.propertyName].filter(Boolean).join(' · '),
      })));
    } catch { setTenants([]); }
    finally  { setTenantsLoading(false); }
  }, []);

  useEffect(() => { loadTenants(selectedPropId || undefined); }, [selectedPropId]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert('Required', 'Please enter a title for the maintenance request.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/maintenances', {
        title:       title.trim(),
        description: description.trim(),
        priority:    selectedPriority,
        assignedTo:  assignedTo.trim() || undefined,
        tenant:      selectedTenantId  || undefined,
      });
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to submit request.');
    } finally { setSubmitting(false); }
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
              placeholder="All properties"
              selectedId={selectedPropId}
              selectedLabel={selectedPropLabel}
              items={properties}
              loading={propsLoading}
              open={propOpen}
              onToggle={() => {
                setPropOpen(v => !v);
                setTenantOpen(false);
                setPriorityOpen(false);
              }}
              onSelect={(id, label) => {
                setSelectedPropId(id);
                setSelectedPropLabel(label);
                setSelectedTenantId('');
                setSelectedTenantLabel('');
                setPropOpen(false);
              }}
              onClear={() => {
                setSelectedPropId('');
                setSelectedPropLabel('');
                setSelectedTenantId('');
                setSelectedTenantLabel('');
              }}
            />

            {/* Tenant */}
            <Dropdown
              label="Tenant"
              placeholder="Select tenant"
              selectedId={selectedTenantId}
              selectedLabel={selectedTenantLabel}
              items={tenants}
              loading={tenantsLoading}
              open={tenantOpen}
              onToggle={() => {
                setTenantOpen(v => !v);
                setPropOpen(false);
                setPriorityOpen(false);
              }}
              onSelect={(id, label) => {
                setSelectedTenantId(id);
                setSelectedTenantLabel(label);
                setTenantOpen(false);
              }}
              onClear={() => {
                setSelectedTenantId('');
                setSelectedTenantLabel('');
              }}
              emptyText={selectedPropId ? 'No tenants in this property' : 'No active tenants'}
            />

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
                setTenantOpen(false);
              }}
              onSelect={(id, label) => {
                setSelectedPriority(id);
                setSelectedPriorityLabel(label);
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
              <Text style={styles.label}>Description <Text style={styles.optional}>(optional)</Text></Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="More details about the issue..."
                placeholderTextColor={Colors.textMuted}
                value={description}
                onChangeText={setDescription}
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
            {selectedPriority && (
              <View style={[styles.priorityBadge, PRIORITY_STYLES[selectedPriority]]}>
                <Ionicons name="alert-circle-outline" size={14} color={PRIORITY_STYLES[selectedPriority]?.color} />
                <Text style={[styles.priorityText, { color: PRIORITY_STYLES[selectedPriority]?.color }]}>
                  {selectedPriorityLabel} priority request
                </Text>
              </View>
            )}

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
