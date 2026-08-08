import { Stack } from 'expo-router';
import { Colors } from '../../../constants/colors';

export default function PMSLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown:      true,
        headerStyle:      { backgroundColor: Colors.primary },
        headerTintColor:  Colors.white,
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
        headerBackTitle:  'Back',
      }}
    >
      <Stack.Screen name="index"                  options={{ title: 'Property Management' }} />
      <Stack.Screen name="tenants/index"          options={{ title: 'Tenants' }} />
      <Stack.Screen name="tenants/[id]"           options={{ title: 'Tenant Profile' }} />
      <Stack.Screen name="tenants/[id]/statement" options={{ title: 'Statement' }} />
      <Stack.Screen name="invoices/index"         options={{ title: 'Invoices' }} />
      <Stack.Screen name="invoices/new"           options={{ title: 'Book Invoice' }} />
      <Stack.Screen name="invoices/[id]"          options={{ title: 'Invoice' }} />
      <Stack.Screen name="receipts/index"         options={{ title: 'Receipts' }} />
      <Stack.Screen name="receipts/new"           options={{ title: 'Record Payment' }} />
      <Stack.Screen name="receipts/[id]"          options={{ title: 'Receipt' }} />
      <Stack.Screen name="penalties/index"        options={{ title: 'Late Penalties' }} />
      <Stack.Screen name="maintenance/index"      options={{ title: 'Maintenance' }} />
      <Stack.Screen name="maintenance/[id]"       options={{ title: 'Maintenance Request' }} />
      <Stack.Screen name="meters/index"           options={{ title: 'Meter Readings' }} />
      <Stack.Screen name="meters/new"             options={{ title: 'New Reading' }} />
      <Stack.Screen name="mpesa/index"            options={{ title: 'M-Pesa Notifications' }} />
      <Stack.Screen name="delinquency/index"      options={{ title: 'Delinquency Report' }} />
    </Stack>
  );
}
