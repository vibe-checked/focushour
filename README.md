# Focus Hour

A quiet, ad-free Pomodoro timer for iPhone. Local notifications, simple stats, no account, no tracking.

- **Support / FAQ:** https://focushour.vibecode.review/#support
- **Privacy Policy:** https://focushour.vibecode.review/#privacy

## Stack

- Expo SDK 54, React 19.1.0, React Native 0.81, TypeScript
- `expo-notifications` (local), `expo-haptics`, `expo-keep-awake`, AsyncStorage

## Local dev

```sh
npm install
npx expo start --tunnel
```

## App Store submission checklist

- [done] App display name `Focus Hour`, bundle id `com.markutilitylabs.focushour`, version, build number — `app.json`
- [done] `expo-notifications` plugin configured
- [done] Privacy + Support URLs live on Vercel at focushour.vibecode.review (see top)
- [you] Apple Developer enrollment, Xcode 17+ or EAS, App Store Connect listing, "Data Not Collected" nutrition label

## License

MIT — see `LICENSE`.
