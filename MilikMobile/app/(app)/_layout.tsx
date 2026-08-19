import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '../../redux/store';

export default function AppLayout() {
  const router  = useRouter();
  const token   = useSelector((s: RootState) => s.auth.token);
  const loading = useSelector((s: RootState) => s.auth.loading);

  useEffect(() => {
    if (!loading && !token) router.replace('/(auth)/login');
  }, [loading, token]);

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
