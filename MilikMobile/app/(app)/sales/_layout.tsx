import { Stack } from 'expo-router';

const SC = '#7C2D12';

export default function SalesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle:      { backgroundColor: SC },
        headerTintColor:  '#fff',
        headerTitleStyle: { fontWeight: '800', fontSize: 16 },
        headerBackTitle:  '',
      }}
    >
      <Stack.Screen name="index"          options={{ title: 'Property Sales'  }} />
      <Stack.Screen name="leads/index"    options={{ title: 'Leads'           }} />
      <Stack.Screen name="leads/new"      options={{ title: 'New Lead'        }} />
      <Stack.Screen name="leads/[id]"     options={{ title: 'Lead'            }} />
      <Stack.Screen name="deals/index"    options={{ title: 'Deals'           }} />
      <Stack.Screen name="deals/[id]"     options={{ title: 'Deal'            }} />
      <Stack.Screen name="listings/index" options={{ title: 'Listings'        }} />
      <Stack.Screen name="listings/[id]"  options={{ title: 'Listing'         }} />
    </Stack>
  );
}
