# LEDGER Scan (iOS)

A small SwiftUI app (iOS 17+), written at the event. It scans a room with Apple's **RoomPlan** and sends the result to the LEDGER API on the laptop.

1. **Scan room** opens Apple's live scan UI (`RoomCaptureView` and its `RoomCaptureSession`). **Done** stops the capture.
2. The raw `CapturedRoomData` goes through `RoomBuilder(options: [.beautifyObjects])` to produce a `CapturedRoom`.
3. The app exports `room.json` (the `CapturedRoom`, which is `Codable`) and `room.usdz` (`export(to:exportOptions: .parametric)`) to the app's Documents folder.
4. **Upload to laptop** sends both files as multipart to `POST <API_BASE>/units/<unitId>/scan` and then shows the returned unitId. **Share (AirDrop)** is the fallback.

The app needs a device with a **LiDAR Scanner** (iPhone 12 Pro or a later Pro, or an iPad Pro). Otherwise it shows a warning and the Scan button stays disabled. The iOS Simulator can't scan.

## Files

| File | What |
|---|---|
| `LedgerScanner/LedgerScannerApp.swift` | App entry, `ScanModel` (state, RoomBuilder, upload), main screen |
| `LedgerScanner/RoomScanner.swift` | `RoomCaptureView` wrapper and its delegate (Done / Cancel) |
| `LedgerScanner/ScanUploader.swift` | JSON + USDZ export, multipart upload, `/health` check |
| `LedgerScanner/Info.plist` | Camera and local-network usage text, HTTP allowed for the LAN laptop |
| `project.yml` | XcodeGen spec. The generated `LedgerScanner.xcodeproj` is committed. |

## Run it on your iPhone (free Apple ID)

1. **Mac:** install Xcode 15 or later. In Xcode → Settings → Accounts, click **+** → Apple ID and sign in. A free account gives you a "Personal Team".
2. Open `apps/scanner/LedgerScanner.xcodeproj`.
3. Click the **LedgerScanner** target → **Signing & Capabilities**. Tick *Automatically manage signing* and set **Team** to *<your name> (Personal Team)*. If Xcode says the bundle ID is taken, change `dev.ledger.scanner` to something unique, e.g. `dev.ledger.scanner.rahim`.
4. **iPhone:** plug it in with a cable and tap *Trust This Computer*. Turn on **Settings → Privacy & Security → Developer Mode** (iOS 16+); the phone restarts.
5. In Xcode, pick your iPhone as the run destination at the top and press **⌘R**.
6. The first launch fails with "Untrusted Developer". On the phone, go to **Settings → General → VPN & Device Management**, tap your Apple ID and then **Trust**. Press ⌘R again.
7. When asked, allow Camera and **Local Network**. If you denied Local Network, re-enable it under Settings → LEDGER Scan.

A free-team build expires after 7 days. Press ⌘R again to reinstall.

Command-line build check (no signing): `xcodebuild -project apps/scanner/LedgerScanner.xcodeproj -scheme LedgerScanner -sdk iphoneos CODE_SIGNING_ALLOWED=NO build`

## Use it with the laptop

1. Start the API on the Mac: `pnpm --filter @ledger/api dev` (port `PORT`, default 3001). It listens on all interfaces.
2. Put the phone on the **same Wi-Fi** as the Mac. Get the Mac's IP with `ipconfig getifaddr en0`.
3. In the app, set the address to `http://<mac-ip>:3001` and tap **Test connection**. You should see `HTTP 200 {"ok":true,...}`. If it times out, check the macOS firewall (System Settings → Network → Firewall) and whether the venue Wi-Fi blocks devices from reaching each other. In that case, use a phone hotspot or AirDrop.
4. Enter a unit ID, or leave it blank to get `scan-xxxxxxxx`. Scan, tap Done, then **Upload to laptop**.
5. The app shows the unitId and the hint `Open on laptop: http://<mac-ip>:3000/units/<unitId>` (on the Mac itself, `http://localhost:3000/units/<unitId>`).

## Upload contract (for `apps/api`)

`POST /units/:id/scan`, `multipart/form-data`:

| Field | Content |
|---|---|
| `room` | `room.json` (`application/json`): RoomPlan `CapturedRoom` as JSON (walls, doors, windows, openings, objects, floors with `dimensions` and 4×4 `transform`s, in meters) |
| `usdz` | `room.usdz` (`model/vnd.usdz+zip`), parametric export |
| `unitId` | the same id as in the path, as text |

Respond with `2xx` and JSON `{ "unitId": "..." }` or `{ "unit": { "unitId": "..." } }`. If neither is present, the app shows the id it sent. **The route does not exist yet in `apps/api` (Alex's lane), so until it does, uploads get HTTP 404. Use Share → AirDrop in the meantime.**
