import { Stack } from 'expo-router';

const INV = '#92400E';

export default function InventoryLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle:      { backgroundColor: INV },
        headerTintColor:  '#fff',
        headerTitleStyle: { fontWeight: '800', fontSize: 16 },
        headerBackTitle:  '',
      }}
    >
      <Stack.Screen name="index"                  options={{ title: 'Inventory'        }} />
      <Stack.Screen name="products/index"         options={{ title: 'Products'         }} />
      <Stack.Screen name="products/[id]"          options={{ title: 'Product'          }} />
      <Stack.Screen name="purchase-orders/index"  options={{ title: 'Purchase Orders'  }} />
      <Stack.Screen name="purchase-orders/[id]"   options={{ title: 'Purchase Order'   }} />
      <Stack.Screen name="stock-movements/index"  options={{ title: 'Stock Movements'  }} />
      <Stack.Screen name="pos-sales/index"        options={{ title: 'POS Sales'        }} />
    </Stack>
  );
}
