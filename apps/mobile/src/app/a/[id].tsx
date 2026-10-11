// Deep link target for social posts and push: /a/<id> resolves to the article.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CenterMessage, Loading } from '@/components/ui';
import { api } from '@/lib/api';

export default function ShortLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .resolveId(id)
      .then(({ slug }) => router.replace({ pathname: '/article/[slug]', params: { slug } }))
      .catch(() => setFailed(true));
  }, [id]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {failed ? <CenterMessage title="הכתבה לא נמצאה" action="לדף הבית" onAction={() => router.replace('/')} /> : <Loading />}
    </SafeAreaView>
  );
}
