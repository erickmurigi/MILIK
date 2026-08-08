import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '../../../redux/store';
import { Colors } from '../../../constants/colors';

type Module = {
  key:      string;
  label:    string;
  subtitle: string;
  icon:     string;
  color:    string;
  route:    string;
  // optional: which companyModules value enables this
  moduleKey?: string;
};

const ALL_MODULES: Module[] = [
  {
    key:       'pms',
    label:     'Property Management',
    subtitle:  'Tenants · Invoices · Maintenance',
    icon:      'business-outline',
    color:     '#0B3B2E',
    route:     '/pms',
    moduleKey: 'pms',
  },
  {
    key:       'carwash',
    label:     'Car Wash',
    subtitle:  'Jobs · Payments · Queue',
    icon:      'car-outline',
    color:     '#1E3A8A',
    route:     '/carwash',
    moduleKey: 'carwash',
  },
  {
    key:       'inventory',
    label:     'Inventory',
    subtitle:  'Stock · Orders · Suppliers',
    icon:      'cube-outline',
    color:     '#78350F',
    route:     '/inventory',
    moduleKey: 'inventory',
  },
  {
    key:       'hr',
    label:     'Human Resources',
    subtitle:  'Staff · Payroll · Attendance',
    icon:      'people-outline',
    color:     '#3B0764',
    route:     '/hr',
    moduleKey: 'hr',
  },
  {
    key:       'sales',
    label:     'Property Sales',
    subtitle:  'Listings · Leads · Deals',
    icon:      'home-outline',
    color:     '#064E3B',
    route:     '/sales',
    moduleKey: 'propertySale',
  },
  {
    key:       'accounts',
    label:     'Accounts',
    subtitle:  'GL · Reports · Balance Sheet',
    icon:      'bar-chart-outline',
    color:     '#0C4A6E',
    route:     '/accounts',
    moduleKey: 'accounts',
  },
];

export default function ModulesHomeScreen() {
  const router  = useRouter();
  const { user, company } = useSelector((s: RootState) => s.auth);

  // Show only modules the company has access to.
  // If company.modules is undefined (e.g. super admin) show all.
  const companyModules: string[] = company?.modules ?? [];
  const visibleModules = companyModules.length === 0
    ? ALL_MODULES
    : ALL_MODULES.filter((m) => !m.moduleKey || companyModules.includes(m.moduleKey));

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>{greeting()},</Text>
            <Text style={styles.userName} numberOfLines={1}>
              {user?.name?.split(' ')[0] || 'there'}
            </Text>
            <Text style={styles.companyName} numberOfLines={1}>
              {company?.companyName || 'Milik'}
            </Text>
          </View>
          <TouchableOpacity style={styles.notifBtn} onPress={() => router.push('/notifications' as any)}>
            <Ionicons name="notifications-outline" size={22} color={Colors.text} />
            <View style={styles.notifDot} />
          </TouchableOpacity>
        </View>

        {/* Section label */}
        <Text style={styles.sectionLabel}>YOUR MODULES</Text>

        {/* Module grid */}
        <View style={styles.grid}>
          {visibleModules.map((mod) => (
            <TouchableOpacity
              key={mod.key}
              style={[styles.tile, { backgroundColor: mod.color }]}
              onPress={() => router.push(mod.route as any)}
              activeOpacity={0.82}
            >
              <View style={styles.tileIcon}>
                <Ionicons name={mod.icon as any} size={28} color="rgba(255,255,255,0.9)" />
              </View>
              <Text style={styles.tileLabel}>{mod.label}</Text>
              <Text style={styles.tileSub}>{mod.subtitle}</Text>
              <View style={styles.tileArrow}>
                <Ionicons name="arrow-forward" size={14} color="rgba(255,255,255,0.6)" />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, paddingBottom: 40 },

  header: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    marginBottom:   28,
  },
  headerLeft:  { flex: 1, marginRight: 12 },
  greeting:    { fontSize: 13, color: Colors.textMuted, fontWeight: '500' },
  userName:    { fontSize: 26, fontWeight: '900', color: Colors.text, marginTop: 2 },
  companyName: { fontSize: 13, color: Colors.textSecondary, marginTop: 2, fontWeight: '500' },

  notifBtn: {
    width: 44, height: 44,
    borderRadius: 22,
    backgroundColor: Colors.white,
    borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  notifDot: {
    position: 'absolute', top: 10, right: 10,
    width: 8, height: 8,
    borderRadius: 4,
    backgroundColor: Colors.danger,
    borderWidth: 1.5, borderColor: Colors.white,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: Colors.textMuted,
    marginBottom: 14,
  },

  grid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           14,
  },

  tile: {
    width:        '47%',
    borderRadius: 20,
    padding:      18,
    minHeight:    160,
    justifyContent: 'space-between',
    // subtle shadow
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius:  12,
    elevation:     6,
  },

  tileIcon: {
    width: 48, height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  tileLabel: {
    fontSize:   15,
    fontWeight: '800',
    color:      '#FFFFFF',
    lineHeight: 20,
  },
  tileSub: {
    fontSize:   10,
    color:      'rgba(255,255,255,0.6)',
    marginTop:  4,
    lineHeight: 14,
  },
  tileArrow: {
    alignSelf:   'flex-end',
    marginTop:   8,
  },
});
