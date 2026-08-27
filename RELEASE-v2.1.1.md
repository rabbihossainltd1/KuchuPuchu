# KuchuPuchu v2.1.1

**APK:** `KuchuPuchu-v2.1.1-debug.apk` (versionCode 24) · **Commit:** `6fa0b4d`
**Server:** kono worker change nai — `npx wrangler deploy` LAGBE NA ei bar (v2.1.0 er deploy e jodi already choley geche tahole thik ache).

## Ki fix holo

### 1. Profile design (apnar feedback onujayi)
- **⋮ menu ekhon app er ekdom corner e** — je khane age coins dekhato (player profile e).
- **Back button + username row pura remove** — profile e nam already hero te ache; system back gesture/button ei enough.
- **Add friend / Requested / Accept–Decline / Message button ekhon hero card er vitore** — "N friends" stats row er pashe, alada kore niche rkom na.
- **Nav icons boro** — 24dp → 28dp, pill o boro, label 12sp.

### 2. Call audio — "kotha shona jay na" fix
- Onek sosta device e (Infinix, Symphony, Tecno) hardware echo-canceller/noise-suppressor baje thake — WebRTC seta use korle audio silent hoye jay. Amra **hardware AEC/NS off kore WebRTC er software version on korechi**.
- Android 12+ e audio routing ekhon `setCommunicationDevice` diye hoy (earpiece vs speaker thik moto switch hoy), call shesh hole clean kore.

### 3. Message notification ashe na — fix
- Sync service ekhon **wake lock** dhore rakhe, tai Doze mode e CPU ghumiyе notification miss kore na.
- Screen off thakle poll interval ektu relaxed (battery banchate), screen on e fast.
- App open korle `onResume` e service restart hoy — OEM battery manager (Xiaomi/Oppo/Symphony er "battery saver") service kill kore dileo abar chole ase.
- **Device e check korar advice:** Settings → Battery → KuchuPuchu → **"No restrictions"** kore din, notification ensure hobe.

### 4. "Laggy" fix — 6 ta performance patch
| Fix | Age ki hoto | Ekhn |
|---|---|---|
| Image lookup | Prottek bubble prottek frame e disk check | Memory memo — disk touch ekbar |
| Chat poll (900ms) | Prottek bar sob message deep-copy + disk write | Server e kichu change na hole skip |
| Disk writes | Main thread e (UI freeze) | Sob IO thread e |
| Auto-scroll | Message list reorder holeo jump | Shudhu notun message ele scroll |
| Date parsing | Prottek call e notun SimpleDateFormat | Cache |
| App boot | 6 ta API call serial (ekta shesh hole notay) | /api/me chara sob parallel |

### 5. Notun "KuchuPuchu connected" notification keno?
Eita **Android er rule, bug na**. App closed thakle message/call notification pathate Google **foreground service** chhara allow kore na (Android 8+ theke). Foreground service cholate holei top bar e ekta persistent notification dekhate hoy — amra seta **silent + MIN priority** kore rakhi, battery khey na, notification list eo noise korche na. Ekmatro alternative **Firebase Cloud Messaging (FCM)** — tokhon permanent notification lagbe na, kintu apnar nijer Firebase project + `google-services.json` setup korte hobe (free, KuchuPuchu er worker e push endpoint add korte hobe). Chaile bolen, porer version e FCM migrate kore dei.

## Install
```
adb install -r KuchuPuchu-v2.1.1-debug.apk
```
Purano APK er upore install hobe (same signature), data loss hobe na.
