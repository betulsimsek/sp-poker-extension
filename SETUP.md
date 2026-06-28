# SP Poker — Setup

## 1. Create a Firebase Project

1. https://console.firebase.google.com → **Add project**
2. Project name: `sp-poker` (or whatever you like)
3. Analytics: you can skip it
4. Left menu → **Build → Realtime Database → Create database**
   - Location: Europe-west1 (or closest to you)
   - Rules: **Start in test mode** (open for 30 days, update afterwards)
5. Left menu → **Project Settings (⚙️) → Your apps → Web (</>)**
   - Register app → App nickname: `sp-poker-ext`
   - Copy the values from **Firebase SDK snippet → Config**

## 2. Fill In the Firebase Config

Copy `firebase-config.example.js` to `firebase-config.js` and replace the `YOUR_*` placeholders with the values from Firebase:

```bash
cp firebase-config.example.js firebase-config.js
```

```js
const FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "sp-poker-xxxxx.firebaseapp.com",
  databaseURL: "https://sp-poker-xxxxx-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "sp-poker-xxxxx",
  ...
};
```

> `firebase-config.js` is in `.gitignore` — your own Firebase credentials never get committed.
> For this kind of personal-use app, Firebase security comes from **Realtime Database Rules**, not from hiding the API key (see step 3 below).

## 3. Realtime Database Rules (update after 30 days)

Firebase Console → Realtime Database → Rules:

```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

## 4. Load the Chrome Extension

1. Chrome → `chrome://extensions/`
2. Top right: **Developer mode** → ON
3. **Load unpacked** → select this folder (`sp-poker-extension/`)
4. The extension is now loaded and visible in the toolbar

## Usage

### Room Creator (Host)
1. **Create Room** → get a 6-character code → share it with your team
2. Enter a Task ID (e.g. `MB-1234`) → **Start** → voting begins
3. Once everyone has voted → **Reveal Votes** → results are shown
4. Pick the SP (the most-voted value is preselected) → **Confirm & Next Task**

### Participant
1. Join a room: enter the code + your name → **Join Room**
2. Once a task is active, pick your vote from the Fibonacci cards
3. No one sees anyone else's vote until the host reveals
4. After reveal, the host sets the SP and moves to the next task

## Notes

- Room codes use uppercase letters + digits (no easily confused characters — no 0/O/I/1)
- Closing and reopening the popup keeps your session (via `chrome.storage`)
- Only one active task at a time
- The History section shows completed tasks and their SP values

## CI/CD: Auto-publish to Chrome Web Store

This repo includes a GitHub Actions workflow (`.github/workflows/publish.yml`) that builds and publishes the extension to the Chrome Web Store on every push to `main`.

To set it up for your own fork, add these repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Description |
|---|---|
| `FIREBASE_CONFIG_JS` | Base64-encoded contents of your real `firebase-config.js` |
| `CHROME_CLIENT_ID` | OAuth client ID (Google Cloud Console, "Desktop app" type) |
| `CHROME_CLIENT_SECRET` | OAuth client secret |
| `CHROME_REFRESH_TOKEN` | OAuth refresh token for the `chromewebstore` scope |
| `CHROME_EXTENSION_ID` | Your extension's ID from the Chrome Web Store Developer Console |

The Chrome Web Store API will reject publish attempts while your first submission is still `Pending review` — the workflow only works for updates after the initial manual approval.

### Troubleshooting a 403 from the publish step

A `403 Forbidden` from `chrome-extension-upload` can come from several unrelated causes — check in this order:

1. **Chrome Web Store API not enabled on the Google Cloud project.** This is the most likely cause for a *brand new* OAuth client/project, and the GitHub Action's error message doesn't surface it (`Response code 403 (Forbidden)` with no detail). Calling the API directly with the access token reveals the real reason (`SERVICE_DISABLED` / `accessNotConfigured`). Fix: enable it at `https://console.developers.google.com/apis/api/chromewebstore.googleapis.com/overview?project=<PROJECT_NUMBER>`, then wait ~1–2 minutes for it to propagate before retrying.
2. **Refresh token expired or revoked.** OAuth consent screens left in "Testing" mode can invalidate tokens; regenerate via the OAuth flow (Desktop-type client, `redirect_uri=http://localhost:<port>`, scope `https://www.googleapis.com/auth/chromewebstore`) and update the `CHROME_REFRESH_TOKEN` secret.
3. **Client ID/secret/extension ID mismatch** between what's in GitHub secrets and the actual values in Google Cloud Console / Chrome Web Store Developer Dashboard — GitHub never shows you the current secret value, so when in doubt, just re-set it rather than trying to verify it.

### Troubleshooting `PKG_DEFAULT_LOCALE_MISSING`

If the upload step succeeds in reaching the API but fails with `error_code: 'PKG_DEFAULT_LOCALE_MISSING'`, the zipped package is missing the `_locales/` directory even though `manifest.json` declares `default_locale`. Make sure the `zip` command in the workflow's "Zip extension" step explicitly includes `_locales` — it won't be picked up automatically.
