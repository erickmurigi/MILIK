import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider, useDispatch } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../redux/store';
import { setCredentials, clearCredentials } from '../redux/slices/authSlice';
import { STORAGE_KEYS } from '../constants';
import { Colors } from '../constants/colors';

function AuthRestorer() {
  const dispatch = useDispatch();

  useEffect(() => {
    (async () => {
      try {
        const [token, userRaw, companyRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN),
          AsyncStorage.getItem(STORAGE_KEYS.USER),
          AsyncStorage.getItem(STORAGE_KEYS.COMPANY),
        ]);

        if (token && userRaw && companyRaw) {
          dispatch(setCredentials({
            token,
            user:    JSON.parse(userRaw),
            company: JSON.parse(companyRaw),
          }));
        } else {
          dispatch(clearCredentials());
        }
      } catch {
        dispatch(clearCredentials());
      }
    })();
  }, []);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <AuthRestorer />
        <StatusBar style="light" backgroundColor={Colors.primary} />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </Provider>
    </GestureHandlerRootView>
  );
}
