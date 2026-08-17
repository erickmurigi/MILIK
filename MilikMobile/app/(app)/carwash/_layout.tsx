import { Stack } from 'expo-router';

const CW_GREEN = '#1E3A8A'; // carwash brand colour (navy blue used in home tile)

export default function CarWashLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown:      true,
        headerStyle:      { backgroundColor: CW_GREEN },
        headerTintColor:  '#FFFFFF',
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
        headerBackTitle:  'Back',
      }}
    >
      <Stack.Screen name="index"        options={{ title: 'Car Wash' }} />
      <Stack.Screen name="jobs/index"   options={{ title: 'Jobs Queue' }} />
      <Stack.Screen name="jobs/new"     options={{ title: 'New Job' }} />
      <Stack.Screen name="jobs/[id]"    options={{ title: 'Job Detail' }} />
      <Stack.Screen name="mpesa/index"  options={{ title: 'M-Pesa Notifications' }} />
    </Stack>
  );
}
