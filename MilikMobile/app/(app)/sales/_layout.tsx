import { Stack } from 'expo-router';
import { useSaleSettings } from '../../../hooks/useSaleSettings';
import { SC } from '../../../utils/sales';

export default function SalesLayout() {
  // Screen titles use the company's own words (Deal / Buyer / Listing can be renamed on the web)
  const { terms: T } = useSaleSettings();
  return (
    <Stack
      screenOptions={{
        headerStyle:      { backgroundColor: SC },
        headerTintColor:  '#fff',
        headerTitleStyle: { fontWeight: '800', fontSize: 16 },
        headerBackTitle:  '',
      }}
    >
      <Stack.Screen name="index"          options={{ title: T.saleModule }} />
      <Stack.Screen name="leads/index"    options={{ title: T.saleLeads }} />
      <Stack.Screen name="leads/new"      options={{ title: `New ${T.saleLead}` }} />
      <Stack.Screen name="leads/[id]"     options={{ title: T.saleLead }} />
      <Stack.Screen name="deals/index"    options={{ title: T.saleDeals }} />
      <Stack.Screen name="deals/[id]"     options={{ title: T.saleDeal }} />
      <Stack.Screen name="listings/index" options={{ title: T.saleListings }} />
      <Stack.Screen name="listings/[id]"  options={{ title: T.saleListing }} />
    </Stack>
  );
}
