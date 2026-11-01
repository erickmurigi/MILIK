import { useEffect } from 'react';
import { Stack, useRouter, Href } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '../../redux/store';

export default function AppLayout() {
  const router  = useRouter();
  const token   = useSelector((s: RootState) => s.auth.token);
  const loading = useSelector((s: RootState) => s.auth.loading);
  const landlordPortalToken   = useSelector((s: RootState) => s.landlordPortalAuth.token);
  const landlordPortalLoading = useSelector((s: RootState) => s.landlordPortalAuth.loading);

  useEffect(() => {
    if (loading || landlordPortalLoading || token) return;
    // No staff session — a landlord who only ever logged into the portal must land back
    // in the landlord-portal tree on a cold launch, not get bounced to the staff login.
    router.replace((landlordPortalToken ? '/(landlord-portal)' : '/(auth)/login') as Href);
  }, [loading, token, landlordPortalLoading, landlordPortalToken]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)"   options={{ headerShown: false }} />
      <Stack.Screen name="pms"      options={{ headerShown: false }} />
      <Stack.Screen name="carwash"    options={{ headerShown: false }} />
      <Stack.Screen name="accounting" options={{ headerShown: false }} />
      <Stack.Screen name="hr"          options={{ headerShown: false }} />
      <Stack.Screen name="inventory"   options={{ headerShown: false }} />
      <Stack.Screen name="sales"       options={{ headerShown: false }} />
    </Stack>
  );
}
