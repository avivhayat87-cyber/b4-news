// Breaking-news push: permission, device registration with the API, and opening
// the article when a notification is tapped (the CMS sends { url: "/a/<id>" }).
// The system permission prompt is never shown on launch: the welcome screen
// explains what the notifications are first, and asks only if the reader agrees.
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

const supported = () => Platform.OS !== 'web' && Device.isDevice; // simulators and the web build have no push
const projectId = () => Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

/** "undetermined" until the reader is asked; "unsupported" where push can't work. */
export async function pushPermission(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
  if (!supported() || !projectId()) return 'unsupported';
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

async function register(prompt: boolean): Promise<boolean> {
  if (!supported()) return false;
  const id = projectId();
  if (!id) return false; // set EAS_PROJECT_ID to enable push

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('breaking', {
      name: 'מבזקים',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#D9121F',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted' && prompt && current.canAskAgain) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return false;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  await api.registerDevice(Platform.OS === 'ios' ? 'ios' : 'android', token, Constants.expoConfig?.version);
  return true;
}

/** After the reader said yes on the welcome screen: shows the system prompt. */
export function enablePush(): Promise<boolean> {
  return register(true).catch(() => false);
}

function openFromNotification(response: Notifications.NotificationResponse | null) {
  const url = response?.notification.request.content.data?.url;
  if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
}

/** Call once from the tabs layout. Registers silently only if permission was already given. */
export function usePushNotifications() {
  useEffect(() => {
    if (Platform.OS === 'web') return; // no push in the web build
    register(false).catch(() => undefined);
    openFromNotification(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    return () => sub.remove();
  }, []);
}
