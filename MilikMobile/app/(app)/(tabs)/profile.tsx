import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  Modal, FlatList, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useDispatch, useSelector } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearCredentials, setCredentials } from '../../../redux/slices/authSlice';
import { RootState } from '../../../redux/store';
import { Colors } from '../../../constants/colors';
import { STORAGE_KEYS } from '../../../constants';
import api from '../../../services/api';

export default function ProfileScreen() {
  const router   = useRouter();
  const dispatch = useDispatch();
  const { user, company } = useSelector((s: RootState) => s.auth);

  const [showSwitcher, setShowSwitcher] = useState(false);
  const [companies,    setCompanies]    = useState<any[]>([]);
  const [loadingList,  setLoadingList]  = useState(false);
  const [switching,    setSwitching]    = useState<string | null>(null);

  const displayName =
    [user?.surname, user?.otherNames].filter(Boolean).join(' ') ||
    user?.name || 'User';

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          try {
            await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
            await AsyncStorage.removeItem(STORAGE_KEYS.USER);
            await AsyncStorage.removeItem(STORAGE_KEYS.COMPANY);
          } catch (_) {}
          dispatch(clearCredentials());
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const openSwitcher = async () => {
    setShowSwitcher(true);
    setLoadingList(true);
    try {
      const { data } = await api.get('/auth/accessible-companies');
      setCompanies(data?.companies || []);
    } catch {
      Alert.alert('Error', 'Could not load companies.');
      setShowSwitcher(false);
    } finally {
      setLoadingList(false);
    }
  };

  const switchTo = async (companyId: string) => {
    setSwitching(companyId);
    try {
      const { data } = await api.post('/auth/switch-company', { companyId });
      const { token, user: newUser, company: newCompany } = data;
      await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
      await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(newUser));
      await AsyncStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(newCompany));
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_COMPANY, companyId);
      dispatch(setCredentials({ token, user: newUser, company: newCompany }));
      setShowSwitcher(false);
      router.replace('/(app)/(tabs)');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to switch company.');
    } finally {
      setSwitching(null);
    }
  };

  const rows = [
    { icon: 'business-outline',        label: 'Switch Company',         onPress: openSwitcher },
    { icon: 'settings-outline',        label: 'Settings',               onPress: undefined },
    { icon: 'help-circle-outline',     label: 'Help & Support',         onPress: undefined },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Profile</Text>
      </View>

      {/* Avatar card */}
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {displayName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{displayName}</Text>
        <Text style={styles.email}>{user?.email || ''}</Text>
        <Text style={styles.company}>{company?.companyName || 'No company selected'}</Text>
      </View>

      {/* Menu */}
      <View style={styles.menu}>
        {rows.map((row) => (
          <TouchableOpacity
            key={row.label}
            style={styles.row}
            activeOpacity={0.7}
            onPress={row.onPress}
            disabled={!row.onPress}
          >
            <Ionicons name={row.icon as any} size={20} color={Colors.primary} />
            <Text style={styles.rowLabel}>{row.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.row, styles.rowDanger]} onPress={handleLogout} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
          <Text style={[styles.rowLabel, { color: Colors.danger }]}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Company Switcher Modal */}
      <Modal visible={showSwitcher} animationType="slide" transparent onRequestClose={() => setShowSwitcher(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Switch Company</Text>
              <TouchableOpacity onPress={() => setShowSwitcher(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {loadingList ? (
              <ActivityIndicator style={{ marginTop: 32 }} color={Colors.primary} />
            ) : (
              <FlatList
                data={companies}
                keyExtractor={(item) => item._id}
                contentContainerStyle={{ paddingBottom: 24 }}
                renderItem={({ item }) => {
                  const isActive  = item._id === company?._id;
                  const isBusy    = switching === item._id;
                  const itemLogoUrl = item.logo
                    ? item.logo.startsWith('http') ? item.logo : `https://milikproperty.com${item.logo}`
                    : null;
                  return (
                    <TouchableOpacity
                      style={[styles.companyRow, isActive && styles.companyRowActive]}
                      onPress={() => !isActive && switchTo(item._id)}
                      activeOpacity={isActive ? 1 : 0.7}
                      disabled={!!switching}
                    >
                      <View style={styles.companyIcon}>
                        {itemLogoUrl
                          ? <Image source={{ uri: itemLogoUrl }} style={styles.companyLogoImg} resizeMode="contain" />
                          : <Ionicons name="business-outline" size={18} color={isActive ? Colors.white : Colors.primary} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.companyRowName, isActive && { color: Colors.white }]}>
                          {item.companyName}
                        </Text>
                        {item.town ? (
                          <Text style={[styles.companyRowSub, isActive && { color: 'rgba(255,255,255,0.7)' }]}>
                            {item.town}
                          </Text>
                        ) : null}
                      </View>
                      {isBusy
                        ? <ActivityIndicator size="small" color={isActive ? Colors.white : Colors.primary} />
                        : isActive
                          ? <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
                          : null}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  topBar:  { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title:   { fontSize: 24, fontWeight: '800', color: Colors.text },

  card: {
    alignItems: 'center', gap: 4,
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: Colors.white,
    borderRadius: 20, padding: 24,
    borderWidth: 1, borderColor: Colors.border,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  avatarText: { color: Colors.white, fontSize: 30, fontWeight: '900' },
  name:       { fontSize: 18, fontWeight: '800', color: Colors.text },
  email:      { fontSize: 13, color: Colors.textMuted },
  company:    { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },

  menu: {
    marginHorizontal: 20, marginTop: 20,
    backgroundColor: Colors.white,
    borderRadius: 18, borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 18, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  rowDanger:  { borderBottomWidth: 0 },
  rowLabel:   { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.text },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 8, maxHeight: '75%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: Colors.text },

  companyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginHorizontal: 16, marginTop: 10,
    paddingHorizontal: 14, paddingVertical: 14,
    borderRadius: 14, backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border,
  },
  companyRowActive: {
    backgroundColor: Colors.primary, borderColor: Colors.primary,
  },
  companyIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(11,59,46,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  companyLogoImg: { width: 28, height: 28, borderRadius: 6 },
  companyRowName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  companyRowSub:  { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
});
