import { Heebo_400Regular, Heebo_600SemiBold, Heebo_700Bold, Heebo_800ExtraBold } from '@expo-google-fonts/heebo';
import { Rubik_700Bold, Rubik_800ExtraBold } from '@expo-google-fonts/rubik';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { colors } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync();

// Native builds are forced to RTL by the expo-localization plugin (app.json); the web build uses the document direction.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.documentElement.lang = 'he';
  document.documentElement.dir = 'rtl';
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, gcTime: 30 * 60_000, retry: 1 } },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Heebo_400Regular,
    Heebo_600SemiBold,
    Heebo_700Bold,
    Heebo_800ExtraBold,
    Rubik_700Bold,
    Rubik_800ExtraBold,
  });
  const ready = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.white } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="article/[slug]" />
        <Stack.Screen name="category/[slug]" />
        <Stack.Screen name="a/[id]" options={{ animation: 'none' }} />
      </Stack>
    </QueryClientProvider>
  );
}
