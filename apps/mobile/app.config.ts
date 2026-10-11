// Extends app.json with settings that come from the environment:
//   APP_DOMAIN   the site's domain (e.g. b4news.co.il). Enables universal links / app links,
//                so links to https://<domain>/a/<id> and /article/<slug> open in the app.
//   EAS_PROJECT_ID  required for push notifications (from `npx eas-cli@latest init`).
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const domain = process.env.APP_DOMAIN;
  const projectId = process.env.EAS_PROJECT_ID;

  return {
    ...(config as ExpoConfig),
    ios: {
      ...config.ios,
      ...(domain ? { associatedDomains: [`applinks:${domain}`] } : {}),
    },
    android: {
      ...config.android,
      ...(domain
        ? {
            intentFilters: [
              {
                action: 'VIEW',
                autoVerify: true,
                data: [
                  { scheme: 'https', host: domain, pathPrefix: '/a/' },
                  { scheme: 'https', host: domain, pathPrefix: '/article/' },
                ],
                category: ['BROWSABLE', 'DEFAULT'],
              },
            ],
          }
        : {}),
    },
    extra: {
      ...config.extra,
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
