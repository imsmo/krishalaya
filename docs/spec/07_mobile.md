# Mobile App

255 files. Each row: **path** → layer · what to implement · DB tables · laws · priority.


---
## `mobile`

### `apps/mobile/BUILD.md` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/README.md` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/app.json` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/eas.json` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/package.json` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/app/_layout.tsx` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/assets/README.md` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/assets/fonts/README.md` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/assets/illustrations/README.md` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/assets/lottie/README.md` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/core/analytics/events.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** Law4 outbox in same txn, Law8 partition pruning
- **Priority:** Wave 0/1

### `apps/mobile/src/core/api/client.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/api/interceptors.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/api/offline-queue.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/auth/auth.store.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/auth/otp.flow.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/auth/role-switcher.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/i18n/i18n.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/core/i18n/locales/en.json` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/core/i18n/locales/gu.json` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/core/i18n/locales/hi.json` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/core/i18n/numerals.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/core/i18n/useTranslation.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/core/location/geofence.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/location/gps.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/offline/cache-policies.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/offline/sqlite.store.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/offline/sync.engine.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/push/fcm.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/push/notification-router.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/voice/stt.client.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/voice/tts.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/core/voice/voice-listing.flow.ts` 
- **Layer:** Mobile Core
- **Implement:** Cross-cutting mobile plumbing: api client (tenant header, retry, offline-queue), auth+role-switcher, SQLite offline sync (server-wins), i18n+Indic numerals, STT voice flow, geofence, push, analytics. 
- **Laws:** general
- **Priority:** Wave 0/1

### `apps/mobile/src/features/ambassador/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/AepsWithdrawScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AepsWithdrawScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/AmbassadorHomeScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AmbassadorHomeScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/AmbassadorProfileScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AmbassadorProfileScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/AssistedConsentScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AssistedConsentScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/CommissionsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement CommissionsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/FaqDetailScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement FaqDetailScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/GoalSettingScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement GoalSettingScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/KioskModeScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement KioskModeScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/LeaderboardScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement LeaderboardScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/OnboardFarmerFlow.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement OnboardFarmerFlow: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/TrainingVideoScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement TrainingVideoScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/screens/WithdrawScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement WithdrawScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/ambassador/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/auctions/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/auctions/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/auctions/screens/AuctionDetailScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AuctionDetailScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/auctions/screens/AuctionEndedScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AuctionEndedScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/auctions/screens/CreateAuctionScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement CreateAuctionScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/auctions/screens/MyBidsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MyBidsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/auctions/screens/OutbidAlertSheet.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement OutbidAlertSheet: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/auctions/screens/PlaceBidSheet.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement PlaceBidSheet: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/auctions/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-browse/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-browse/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-browse/screens/BuyerChatScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BuyerChatScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-browse/screens/BuyerHomeScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BuyerHomeScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-browse/screens/ListingDetailScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement ListingDetailScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-browse/screens/SavedListingsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement SavedListingsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-browse/screens/SavedSearchesScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement SavedSearchesScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-browse/screens/VoiceSearchScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement VoiceSearchScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-browse/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-checkout/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-checkout/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-checkout/screens/BuyerKycScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BuyerKycScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-checkout/screens/BuyerProfileScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BuyerProfileScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-checkout/screens/CheckoutScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement CheckoutScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-checkout/screens/MakeOfferSheet.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MakeOfferSheet: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/buyer-checkout/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/dairy/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/dairy/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/dairy/screens/D2cSubscriptionScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement D2cSubscriptionScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/dairy/screens/MccSlipScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MccSlipScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/dairy/screens/MilkBillScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MilkBillScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/dairy/screens/MilkDiaryScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MilkDiaryScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/dairy/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/delivery-partner/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/delivery-partner/screens/DeliveryPodScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement DeliveryPodScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/delivery-partner/screens/EarningsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement EarningsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/delivery-partner/screens/PickupOtpScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement PickupOtpScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/delivery-partner/screens/RouteMapScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement RouteMapScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/delivery-partner/screens/TasksTodayScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement TasksTodayScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/delivery-partner/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/education/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/education/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/education/screens/CertificateScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement CertificateScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/education/screens/CoursesScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement CoursesScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/education/screens/LessonPlayerScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement LessonPlayerScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/education/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/farmer-home/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/farmer-home/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/farmer-home/screens/AiChatScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AiChatScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/farmer-home/screens/CropHubScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement CropHubScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/farmer-home/screens/FarmerHomeScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement FarmerHomeScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/farmer-home/screens/MandiAlertsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MandiAlertsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/farmer-home/screens/MandiDetailScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MandiDetailScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/farmer-home/screens/MandiPricesScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MandiPricesScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/farmer-home/screens/TipDetailScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement TipDetailScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/farmer-home/screens/TipsLibraryScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement TipsLibraryScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/farmer-home/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/fintech/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/fintech/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/fintech/screens/CreditScoreScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement CreditScoreScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/fintech/screens/InsuranceScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement InsuranceScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/fintech/screens/LoanApplicationScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement LoanApplicationScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/fintech/screens/LoanProductsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement LoanProductsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/fintech/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/fpo-coordinator/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/fpo-coordinator/screens/CreateGroupLotScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement CreateGroupLotScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/fpo-coordinator/screens/GroupLotsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement GroupLotsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/fpo-coordinator/screens/GroupSettlementScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement GroupSettlementScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/fpo-coordinator/screens/MemberPledgesScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MemberPledgesScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/fpo-coordinator/screens/MembersScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MembersScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/fpo-coordinator/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/labour-farmer/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/labour-farmer/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/labour-farmer/screens/BookStepConfirm.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BookStepConfirm: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-farmer/screens/BookStepDatetime.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BookStepDatetime: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-farmer/screens/BookStepLocation.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BookStepLocation: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-farmer/screens/BookWorkerScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BookWorkerScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-farmer/screens/BookingConfirmScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BookingConfirmScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-farmer/screens/BookingDetailScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BookingDetailScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-farmer/screens/FilterWorkersSheet.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement FilterWorkersSheet: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-farmer/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/ActiveJobScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement ActiveJobScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/AddSkillScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AddSkillScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/BrowseJobsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BrowseJobsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/DeclineJobSheet.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement DeclineJobSheet: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/JobOfferScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement JobOfferScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/MyJobsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MyJobsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/WorkerClaimScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement WorkerClaimScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/WorkerDisputeScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement WorkerDisputeScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/WorkerEarningsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement WorkerEarningsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/WorkerInsuranceScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement WorkerInsuranceScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/WorkerProfileScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement WorkerProfileScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/screens/WorkerWithdrawScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement WorkerWithdrawScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/labour-worker/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/listings-create/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/listings-create/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/listings-create/screens/CreateListingScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement CreateListingScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/listings-create/screens/ListingPreviewScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement ListingPreviewScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/listings-create/screens/PhotoCaptureSheet.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement PhotoCaptureSheet: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/listings-create/screens/VoiceListingSheet.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement VoiceListingSheet: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/listings-create/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/listings-manage/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/listings-manage/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/listings-manage/screens/EditListingScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement EditListingScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/listings-manage/screens/ListingAnalyticsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement ListingAnalyticsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/listings-manage/screens/MyListingsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MyListingsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/listings-manage/screens/RepostListingScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement RepostListingScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/listings-manage/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/livestock/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/livestock/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/livestock/screens/AnimalDetailScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AnimalDetailScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/livestock/screens/AnimalListScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AnimalListScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/livestock/screens/HealthRecordScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement HealthRecordScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/livestock/screens/VetBookingScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement VetBookingScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/livestock/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/mcc-operator/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/mcc-operator/screens/BmcStatusScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BmcStatusScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/mcc-operator/screens/CollectionSlipScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement CollectionSlipScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/mcc-operator/screens/MemberLookupScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MemberLookupScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/mcc-operator/screens/ShiftCloseScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement ShiftCloseScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/mcc-operator/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/notifications/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/notifications/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/notifications/screens/InboxAllScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement InboxAllScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/notifications/screens/NotificationsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement NotificationsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/notifications/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/offers/README.md` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/offers/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/offers/screens/OfferInboxScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement OfferInboxScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/onboarding/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/onboarding/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/onboarding/screens/LanguageScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement LanguageScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/onboarding/screens/OtpScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement OtpScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/onboarding/screens/ProfileSetupScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement ProfileSetupScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/onboarding/screens/RoleScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement RoleScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/onboarding/screens/WelcomeScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement WelcomeScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/onboarding/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/orders/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** Law2 BIGINT money, Law8 partition pruning
- **Priority:** see build plan

### `apps/mobile/src/features/orders/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** Law2 BIGINT money, Law8 partition pruning
- **Priority:** see build plan

### `apps/mobile/src/features/orders/screens/FarmerOrdersScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement FarmerOrdersScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law2 BIGINT money, Law7 i18n keys, Law8 partition pruning
- **Priority:** see build plan

### `apps/mobile/src/features/orders/screens/MyOrdersScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MyOrdersScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law2 BIGINT money, Law7 i18n keys, Law8 partition pruning
- **Priority:** see build plan

### `apps/mobile/src/features/orders/screens/OrderDetailScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement OrderDetailScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law2 BIGINT money, Law7 i18n keys, Law8 partition pruning
- **Priority:** see build plan

### `apps/mobile/src/features/orders/screens/OrderReviewScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement OrderReviewScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law2 BIGINT money, Law7 i18n keys, Law8 partition pruning
- **Priority:** see build plan

### `apps/mobile/src/features/orders/screens/TransactionDetailScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement TransactionDetailScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law2 BIGINT money, Law7 i18n keys, Law8 partition pruning
- **Priority:** see build plan

### `apps/mobile/src/features/orders/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** Law2 BIGINT money, Law8 partition pruning
- **Priority:** see build plan

### `apps/mobile/src/features/profile/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/profile/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/profile/screens/AboutScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AboutScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/profile/screens/DataDownloadScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement DataDownloadScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/profile/screens/MyProfileScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MyProfileScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/profile/screens/PrivacySettingsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement PrivacySettingsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/profile/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/schemes/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/schemes/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/schemes/screens/SchemeApplyScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement SchemeApplyScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/schemes/screens/SchemeStatusScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement SchemeStatusScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/schemes/screens/SchemesScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement SchemesScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/schemes/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/settings/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/settings/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/settings/screens/AppUpdateScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AppUpdateScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/settings/screens/LanguageSwitchSheet.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement LanguageSwitchSheet: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/settings/screens/SettingsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement SettingsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/settings/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/store-owner/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/store-owner/screens/BatchesExpiryScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BatchesExpiryScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/store-owner/screens/LicenceRenewalScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement LicenceRenewalScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/store-owner/screens/StoreInventoryScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement StoreInventoryScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/store-owner/screens/StoreOrdersScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement StoreOrdersScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/store-owner/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/support/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/support/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/support/screens/FeedbackSheet.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement FeedbackSheet: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/support/screens/HelpScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement HelpScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/support/screens/TicketScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement TicketScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/support/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/tenant-admin-lite/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/tenant-admin-lite/screens/ApprovalsQueueScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement ApprovalsQueueScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/tenant-admin-lite/screens/TenantDashboardScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement TenantDashboardScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/tenant-admin-lite/screens/TodayOrdersScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement TodayOrdersScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/tenant-admin-lite/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/vet/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/vet/screens/BookingDetailScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BookingDetailScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/vet/screens/EarningsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement EarningsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/vet/screens/PrescriptionWriterScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement PrescriptionWriterScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/vet/screens/VetBookingsCalendarScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement VetBookingsCalendarScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/vet/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/vyapari-home/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/vyapari-home/screens/MarketDashboardScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement MarketDashboardScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/vyapari-home/screens/RequirementsInboxScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement RequirementsInboxScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/vyapari-home/screens/SupplierShortlistScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement SupplierShortlistScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/vyapari-home/screens/VyapariHomeScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement VyapariHomeScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law7 i18n keys
- **Priority:** see build plan

### `apps/mobile/src/features/vyapari-home/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/src/features/wallet/api.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** Law1 tenant-scope, Law2 BIGINT money
- **Priority:** Wave 0/1

### `apps/mobile/src/features/wallet/components/index.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** Law1 tenant-scope, Law2 BIGINT money
- **Priority:** Wave 0/1

### `apps/mobile/src/features/wallet/screens/AddMoneyScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AddMoneyScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law1 tenant-scope, Law2 BIGINT money, Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/features/wallet/screens/AutopayScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement AutopayScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law1 tenant-scope, Law2 BIGINT money, Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/features/wallet/screens/BankAccountsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement BankAccountsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law1 tenant-scope, Law2 BIGINT money, Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/features/wallet/screens/FarmerEarningsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement FarmerEarningsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law1 tenant-scope, Law2 BIGINT money, Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/features/wallet/screens/HistoryScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement HistoryScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law1 tenant-scope, Law2 BIGINT money, Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/features/wallet/screens/SpendingInsightsScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement SpendingInsightsScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law1 tenant-scope, Law2 BIGINT money, Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/features/wallet/screens/WalletHomeScreen.tsx` 
- **Layer:** Mobile Screen
- **Implement:** Implement WalletHomeScreen: react-query data hooks (offline-aware), packages/ui-native components, i18n + voice where relevant, optimistic UI, <30MB budget, works on 2GB Android. Maps to its design-system screen number. 
- **Laws:** Law1 tenant-scope, Law2 BIGINT money, Law7 i18n keys
- **Priority:** Wave 0/1

### `apps/mobile/src/features/wallet/store.ts` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** Law1 tenant-scope, Law2 BIGINT money
- **Priority:** Wave 0/1

### `apps/mobile/src/navigation/role-tabs.tsx` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** see build plan

### `apps/mobile/tsconfig.json` 
- **Layer:** Mobile File
- **Implement:** api hooks / store (zustand) / components / navigation / assets / build config. 
- **Laws:** general
- **Priority:** Wave 0/1
