import { Stack } from 'expo-router';

const AC = '#064E3B';

export default function AccountingLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle:      { backgroundColor: AC },
        headerTintColor:  '#fff',
        headerTitleStyle: { fontWeight: '800', fontSize: 16 },
        headerBackTitle:  '',
      }}
    >
      <Stack.Screen name="index"                    options={{ title: 'Accounting'           }} />
      <Stack.Screen name="journals/index"           options={{ title: 'Journal Entries'      }} />
      <Stack.Screen name="journals/new"             options={{ title: 'New Journal Entry'    }} />
      <Stack.Screen name="journals/[id]"            options={{ title: 'Journal Entry'        }} />
      <Stack.Screen name="vouchers/index"           options={{ title: 'Payment Vouchers'     }} />
      <Stack.Screen name="vouchers/new"             options={{ title: 'New Voucher'          }} />
      <Stack.Screen name="vouchers/[id]"            options={{ title: 'Payment Voucher'      }} />
      <Stack.Screen name="requisitions/index"       options={{ title: 'Expense Requisitions' }} />
      <Stack.Screen name="requisitions/new"         options={{ title: 'New Requisition'      }} />
      <Stack.Screen name="requisitions/[id]"        options={{ title: 'Requisition'          }} />
      <Stack.Screen name="petty-cash/index"         options={{ title: 'Petty Cash'           }} />
      <Stack.Screen name="reports/index"            options={{ title: 'Financial Reports'    }} />
    </Stack>
  );
}
