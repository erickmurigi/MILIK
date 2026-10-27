import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider, useDispatch } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../redux/store';
import { setCredentials, clearCredentials } from '../redux/slices/authSlice';
import { STORAGE_KEYS } from '../constants';
import { Colors } from '../constants/colors';
import { refreshAuthToken } from '../services/api';
import { registerForPushNotificationsAsync, attachNotificationResponseListener } from '../services/pushNotifications';

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
          refreshAuthToken();
          registerForPushNotificationsAsync();
        } else {
          dispatch(clearCredentials());
        }
      } catch {
        dispatch(clearCredentials());
      }
    })();

    // Keeps an active user's session alive indefinitely — re-check whenever they bring
    // the app back to the foreground, not just on a fresh launch (the common case for a
    // mobile app is resuming from background, not relaunching from a killed state).
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshAuthToken();
    });
    const removeNotificationListener = attachNotificationResponseListener();
    return () => {
      sub.remove();
      removeNotificationListener();
    };
  }, []);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <AuthRestorer />
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </Provider>
    </GestureHandlerRootView>
  );
}
