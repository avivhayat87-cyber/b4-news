import AppTabs from '@/components/app-tabs';
import { usePushNotifications } from '@/lib/push';

export default function TabsLayout() {
  usePushNotifications();
  return <AppTabs />;
}
