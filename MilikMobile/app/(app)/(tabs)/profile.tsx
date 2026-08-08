import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useDispatch, useSelector } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearCredentials } from '../../../redux/slices/authSlice';
import { RootState } from '../../../redux/store';
import { Colors } from '../../../constants/colors';
import { STORAGE_KEYS } from '../../../constants';

export default function ProfileScreen() {
  const router   = useRouter();
  const dispatch = useDispatch();
  const { user, company } = useSelector((s: RootState) => s.auth);

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          await AsyncStorage.multiRemove([
            STORAGE_KEYS.AUTH_TOKEN,
            STORAGE_KEYS.USER,
            STORAGE_KEYS.COMPANY,
          ]);
          dispatch(clearCredentials());
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const rows = [
    { icon: 'settings-outline',      label: 'Settings' },
    { icon: 'shield-checkmark-outline', label: 'Security' },
    { icon: 'help-circle-outline',   label: 'Help & Support' },
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
            {user?.name?.charAt(0)?.toUpperCase() || 'U'}
          </Text>
        </View>
        <Text style={styles.name}>{user?.name || 'Field Officer'}</Text>
        <Text style={styles.email}>{user?.email || ''}</Text>
        <Text style={styles.company}>{company?.companyName || 'Milik'}</Text>
      </View>

      {/* Menu */}
      <View style={styles.menu}>
        {rows.map((row) => (
          <TouchableOpacity key={row.label} style={styles.row} activeOpacity={0.7}>
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
});
