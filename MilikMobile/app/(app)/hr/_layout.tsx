import { Stack } from 'expo-router';

const HC = '#4C1D95';

export default function HRLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle:      { backgroundColor: HC },
        headerTintColor:  '#fff',
        headerTitleStyle: { fontWeight: '800', fontSize: 16 },
        headerBackTitle:  '',
      }}
    >
      <Stack.Screen name="index"              options={{ title: 'Human Resources'   }} />
      <Stack.Screen name="employees/index"    options={{ title: 'Employees'         }} />
      <Stack.Screen name="employees/[id]"     options={{ title: 'Employee Profile'  }} />
      <Stack.Screen name="leave/index"        options={{ title: 'Leave Applications'}} />
      <Stack.Screen name="leave/new"          options={{ title: 'New Leave Application'}} />
      <Stack.Screen name="attendance/index"   options={{ title: 'Attendance'        }} />
    </Stack>
  );
}
