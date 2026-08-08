import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '../../redux/store';

export default function AppLayout() {
  const router = useRouter();
  const token  = useSelector((s: RootState) => s.auth.token);

  useEffect(() => {
    if (!token) router.replace('/(auth)/login');
  }, [token]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Home tabs — no header (tabs handle their own chrome) */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* Module stacks — each module's _layout.tsx controls its own header */}
      <Stack.Screen name="pms"       options={{ headerShown: false }} />
      <Stack.Screen name="carwash"   options={{ headerShown: false }} />
      <Stack.Screen name="inventory" options={{ headerShown: false }} />
      <Stack.Screen name="hr"        options={{ headerShown: false }} />
      <Stack.Screen name="sales"     options={{ headerShown: false }} />
      <Stack.Screen name="accounts"  options={{ headerShown: false }} />
    </Stack>
  );
}
