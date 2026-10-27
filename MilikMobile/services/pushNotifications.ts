import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import api from './api';
import { STORAGE_KEYS } from '../constants';

// Must be set before any notification arrives, or Android/iOS silently drop it while the
// app is in the foreground (expo-notifications requires an explicit handler or it shows nothing).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Remote push is unavailable in Expo Go on Android (SDK 53+) — this silently returns null there
// and only actually registers in a development/preview/production build, which is how this app
// is distributed anyway (EAS builds, never Expo Go for real users).
export const registerForPushNotificationsAsync = async (): Promise<string | null> => {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return null;

    const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    const previousToken = await AsyncStorage.getItem(STORAGE_KEYS.PUSH_TOKEN);
    if (previousToken !== token) {
      await AsyncStorage.setItem(STORAGE_KEYS.PUSH_TOKEN, token);
    }

    // Always re-send on launch, even if unchanged — cheap upsert server-side, and it refreshes
    // lastSeenAt so a token doesn't look abandoned if the app ever needs to prune stale ones.
    await api.post('/push/register', { token, platform: Platform.OS }).catch(() => {});

    return token;
  } catch (_err) {
    return null;
  }
};

export const unregisterPushNotifications = async (): Promise<void> => {
  try {
    const token = await AsyncStorage.getItem(STORAGE_KEYS.PUSH_TOKEN);
    if (!token) return;
    await api.post('/push/unregister', { token }).catch(() => {});
    await AsyncStorage.removeItem(STORAGE_KEYS.PUSH_TOKEN);
  } catch (_err) {
    // Non-fatal — a leftover token just means this device won't be deleted from the
    // backend's list until its next failed delivery (handled server-side).
  }
};

// Routes a tapped notification to the relevant screen using its `data.type`. Falls back to
// doing nothing (just opens the app) for a type this version doesn't recognize yet, so an
// older client never crashes on a notification shape added later server-side.
const routeForNotificationData = (data: Record<string, any> | undefined): string | null => {
  switch (data?.type) {
    case 'rent_payment_received':
      return data.tenantId ? `/pms/tenants/${data.tenantId}` : '/pms/tenants';
    case 'carwash_payment_received':
      return data.jobId ? `/carwash/jobs/${data.jobId}` : '/carwash';
    case 'new_lead':
      return data.leadId ? `/sales/leads/${data.leadId}` : '/sales/leads';
    case 'deal_closed':
      return data.dealId ? `/sales/deals/${data.dealId}` : '/sales/deals';
    case 'lease_expiring':
      return '/pms/tenants';
    case 'low_stock':
      return '/inventory';
    default:
      return null;
  }
};

export const attachNotificationResponseListener = () => {
  const handleResponse = (response: Notifications.NotificationResponse) => {
    const route = routeForNotificationData(response.notification.request.content.data as any);
    if (route) {
      try { router.push(route as any); } catch (_err) {}
    }
  };

  const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);

  // Cold-launch tap: if the app was opened BY tapping a notification, the response above never
  // fires because the listener attaches after the tap already happened.
  Notifications.getLastNotificationResponseAsync?.()
    .then((response) => { if (response) handleResponse(response); })
    .catch(() => {});

  return () => sub.remove();
};
