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

  const menuItems: MenuItem[] = [
    { icon: 'speedometer-outline',  label: 'Meter Readings',   onPress: () => {} },
    { icon: 'alert-circle-outline', label: 'Delinquency',      onPress: () => {} },
    { icon: 'bar-chart-outline',    label: 'Reports',          onPress: () => {} },
    { icon: 'notifications-outline',label: 'Notifications',    onPress: () => {} },
    { icon: 'settings-outline',     label: 'Settings',         onPress: () => {} },
    { icon: 'log-out-outline',      label: 'Sign Out',         onPress: handleLogout, danger: true },
  ];

  return (
    <SafeAreaView style={styles.safe}>
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
