# XERAVION Admin for Android

Native Android WebView shell for the existing private XERAVION Admin Control Center.

## App details

- App name: XERAVION Admin
- Package: `id.my.xeravion.admin`
- Admin URL: `https://xeravion.my.id/?admin-portal=xr-admin-7f3c9a`
- Authentication remains on the existing Supabase admin sign-in and authorization flow.
- Uses the live Cloudflare Pages website; it does not copy or fork the store backend.

## Build a debug APK

Requirements: JDK 17, Android SDK platform 35 and build tools installed, Gradle 8.9.

From this directory:

```bash
gradle assembleDebug
```

APK output:

```
app/build/outputs/apk/debug/app-debug.apk
```

The GitHub Actions workflow `.github/workflows/build-xeravion-admin-apk.yml` builds this APK and uploads it as an artifact after changes to this Android project or when manually dispatched.

## Security notes

- Admin access is still enforced by Supabase authentication and the existing `is_admin()` server-side check.
- The app does not embed an admin email, password, Supabase service-role key, or other privileged secret.
- HTTPS is required. External links are handed to Android rather than loaded inside the admin WebView.
- A debug APK is suitable for installation/testing. A signed release APK/AAB requires a private signing key managed outside the repository (for example, GitHub Actions secrets).
