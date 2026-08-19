import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useDispatch, useSelector } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearCredentials } from '../../../redux/slices/authSlice';
import { RootState } from '../../../redux/store';
import { Colors } from '../../../constants/colors';
import { STORAGE_KEYS } from '../../../constants';

type MenuItem = {
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
};

export default function MoreScreen() {
  const router   = useRouter();
  const dispatch = useDispatch();
  const { user, company } = useSelector((s: RootState) => s.auth);

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          await Promise.all([
            AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN),
            AsyncStorage.removeItem(STORAGE_KEYS.USER),
            AsyncStorage.removeItem(STORAGE_KEYS.COMPANY),
          ]);
          dispatch(clearCredentials());
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const menuItems: MenuItem[] = [
    { icon: 'notifications-outline', label: 'Notifications',    onPress: () => router.push('/notifications' as any) },
    { icon: 'settings-outline',      label: 'Settings',         onPress: () => {} },
    { icon: 'log-out-outline',       label: 'Sign Out',         onPress: handleLogout, danger: true },
  ];

  type ShortcutItem = { icon: string; label: string; color: string; route: string; moduleKey?: string };

  const mods: string[] = company?.modules
    ? Object.entries(company.modules).filter(([, v]) => v).map(([k]) => k)
    : [];
  const hasModule = (key: string) => mods.length === 0 || mods.includes(key);

  const shortcuts: ShortcutItem[] = [
    { icon: 'document-text-outline',  label: 'Journals',     color: '#1D4ED8', route: '/accounting/journals',     moduleKey: 'accounts' },
    { icon: 'receipt-outline',        label: 'Vouchers',     color: '#7C3AED', route: '/accounting/vouchers',     moduleKey: 'accounts' },
    { icon: 'list-circle-outline',    label: 'Requisitions', color: '#D97706', route: '/accounting/requisitions', moduleKey: 'accounts' },
    { icon: 'wallet-outline',         label: 'Petty Cash',   color: '#DC2626', route: '/accounting/petty-cash',   moduleKey: 'accounts' },
    { icon: 'bar-chart-outline',      label: 'Reports',      color: '#064E3B', route: '/accounting/reports',      moduleKey: 'accounts' },
    { icon: 'phone-portrait-outline', label: 'M-Pesa',       color: '#059669', route: '/carwash/mpesa',           moduleKey: 'carwash'  },
  ].filter((s) => !s.moduleKey || hasModule(s.moduleKey));

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* Profile card */}
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.name?.charAt(0)?.toUpperCase() || 'U'}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName}>{user?.name || 'Field Officer'}</Text>
          <Text style={styles.profileSub}>{company?.companyName || 'Milik'}</Text>
        </View>
      </View>

      {/* Quick shortcuts */}
      <Text style={styles.sectionLabel}>QUICK ACCESS</Text>
      <View style={styles.shortcuts}>
        {shortcuts.map((s) => (
          <TouchableOpacity
            key={s.label}
            style={styles.shortcutItem}
            onPress={() => router.push(s.route as any)}
            activeOpacity={0.75}
          >
            <View style={[styles.shortcutIcon, { backgroundColor: s.color + '18' }]}>
              <Ionicons name={s.icon as any} size={20} color={s.color} />
            </View>
            <Text style={styles.shortcutLabel}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Menu */}
      <View style={styles.menu}>
        {menuItems.map((item) => (
          <TouchableOpacity
            key={item.label}
            style={styles.menuItem}
            onPress={item.onPress}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIcon, item.danger && styles.menuIconDanger]}>
              <Ionicons
                name={item.icon as any}
                size={20}
                color={item.danger ? Colors.danger : Colors.primary}
              />
            </View>
            <Text style={[styles.menuLabel, item.danger && styles.menuLabelDanger]}>
              {item.label}
            </Text>
            {!item.danger && (
              <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.version}>Milik Mobile · v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  profile: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    margin: 20, padding: 18,
    backgroundColor: Colors.white, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText:    { color: Colors.white, fontSize: 22, fontWeight: '800' },
  profileName:   { fontSize: 17, fontWeight: '700', color: Colors.text },
  profileSub:    { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  menu: {
    marginHorizontal: 20,
    backgroundColor: Colors.white,
    borderRadius: 18, borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8', marginHorizontal: 20, marginBottom: 10, marginTop: 20 },
  shortcuts: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    marginHorizontal: 20, marginBottom: 4,
  },
  shortcutItem: {
    width: '30%', alignItems: 'center', gap: 7,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    paddingVertical: 14,
  },
  shortcutIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  shortcutLabel: { fontSize: 11, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 18, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  menuIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.primaryFaded,
    alignItems: 'center', justifyContent: 'center',
  },
  menuIconDanger: { backgroundColor: '#FEF0F0' },
  menuLabel:      { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.text },
  menuLabelDanger:{ color: Colors.danger },
  version: {
    textAlign: 'center', marginTop: 'auto',
    paddingBottom: 24, fontSize: 11, color: Colors.textMuted,
  },
});
