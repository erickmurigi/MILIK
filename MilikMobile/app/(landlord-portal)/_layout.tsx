import { useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootState } from '../../redux/store';
import { clearLandlordPortalCredentials } from '../../redux/slices/landlordPortalAuthSlice';
import { STORAGE_KEYS } from '../../constants';
import { Colors } from '../../constants/colors';

export default function LandlordPortalLayout() {
  const router   = useRouter();
  const dispatch = useDispatch();
  const token    = useSelector((s: RootState) => s.landlordPortalAuth.token);
  const loading  = useSelector((s: RootState) => s.landlordPortalAuth.loading);
  const landlord = useSelector((s: RootState) => s.landlordPortalAuth.landlord);
  const company  = useSelector((s: RootState) => s.landlordPortalAuth.company);

  useEffect(() => {
    if (!loading && !token) router.replace('/(auth)/login');
  }, [loading, token]);

  const handleLogout = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.LANDLORD_PORTAL_TOKEN);
    await AsyncStorage.removeItem(STORAGE_KEYS.LANDLORD_PORTAL_LANDLORD);
    await AsyncStorage.removeItem(STORAGE_KEYS.LANDLORD_PORTAL_COMPANY);
    dispatch(clearLandlordPortalCredentials());
    router.replace('/(auth)/login');
  }, [dispatch, router]);

  if (!token) return null;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <View>
          <Text style={styles.topbarName}>{landlord?.landlordName}</Text>
          <Text style={styles.topbarCompany}>{company?.companyName}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={22} color={Colors.white} />
        </TouchableOpacity>
      </View>

      <Tabs
        screenOptions={{
          headerShown:             false,
          tabBarActiveTintColor:   Colors.primary,
          tabBarInactiveTintColor: Colors.textMuted,
          tabBarStyle: {
            backgroundColor: Colors.white,
            borderTopColor:  Colors.border,
            borderTopWidth:  1,
            paddingBottom:   8,
            paddingTop:      6,
            height:          64,
          },
          tabBarLabelStyle: { fontSize: 10, fontWeight: '700', marginTop: 2 },
        }}
      >
        <Tabs.Screen
          name="statements"
          options={{
            title: 'Statements',
            tabBarIcon: ({ color, size }) => <Ionicons name="document-text-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="units"
          options={{
            title: 'Units',
            tabBarIcon: ({ color, size }) => <Ionicons name="business-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="tenants"
          options={{
            title: 'Tenants',
            tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topbar: {
    backgroundColor: Colors.primary,
    paddingTop: 50,
    paddingBottom: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topbarName:    { color: Colors.white, fontSize: 15, fontWeight: '700' },
  topbarCompany: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
});
