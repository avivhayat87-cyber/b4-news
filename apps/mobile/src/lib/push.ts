// Breaking-news push: permission, device registration with the API, and opening
// the article when a notification is tapped (the CMS sends { url: "/a/<id>" }).
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function register(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return; // simulators and the web build have no push
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return; // set EAS_PROJECT_ID to enable push

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('breaking', {
      name: 'מבזקים',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#D9121F',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const status = current.status === 'granted' ? current.status : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api.registerDevice(Platform.OS === 'ios' ? 'ios' : 'android', token, Constants.expoConfig?.version);
}

function openFromNotification(response: Notifications.NotificationResponse | null) {
  const url = response?.notification.request.content.data?.url;
  if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
}

/** Call once from the root layout. */
export function usePushNotifications() {
  useEffect(() => {
    if (Platform.OS === 'web') return; // no push in the web build
    register().catch(() => undefined);
    openFromNotification(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    return () => sub.remove();
  }, []);
}
