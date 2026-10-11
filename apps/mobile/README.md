# B4 NEW'S — mobile app

Expo SDK 57 + Expo Router (routes in `src/app`). Hebrew, right-to-left on every platform.

- **Tabs:** בית (7-article carousel, 14 trending, endless feed) · קטגוריות · שמורים (offline) · חיפוש
- **Article:** offline fallback for saved articles, share, related, reader comments (email one-time code)
- **Push:** registers the device with the API; tapping a notification opens its `data.url`
- **Deep links:** `b4news://article/<slug>`, `https://<APP_DOMAIN>/article/<slug>` and `/a/<id>`

## Run

From the repo root, start the API first (`npm run dev:api`), then:

```bash
npm run start -w @b4/mobile
```

Scan the QR code with Expo Go, or press `w` for the web build (http://localhost:8081).
On a phone the app reaches the API at `<your computer's IP>:4000`; set `EXPO_PUBLIC_API_URL` to override.

## Configuration (`app.config.ts`)

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | API base, e.g. `https://api.b4news.co.il/api/v1` |
| `APP_DOMAIN` | Site domain for universal links / Android app links |
| `EAS_PROJECT_ID` | Needed for push tokens (EAS builds) |

## Layout

```
src/app/            routes: (tabs)/, article/[slug], category/[slug], a/[id]
src/components/     brand (logo), ui, article-body, comments, tabs (native + web)
src/lib/            api client, token (SecureStore), saved (AsyncStorage), push, theme
```

RTL note: devices resolve logical `start`/`end` to the right in Hebrew, but the web build does not.
Position things with the helpers in `src/lib/theme.ts` (`rtl.atStart`, `rtl.padStart`, …) rather than `left`/`right`.
