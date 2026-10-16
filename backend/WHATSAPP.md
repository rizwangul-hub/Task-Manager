# WhatsApp integration

The backend uses Baileys Web to send assignment notifications and, for selected
groups, turn new incoming messages into task drafts. A draft is never saved as a
task until an administrator approves it in the WhatsApp Task Inbox. Incoming
messages must be real-time `notify` events, include a provider timestamp, and
belong to an enabled, unpaused group. The legacy webhook aliases return HTTP 410
and do not inspect or queue request bodies.

## Configure outbound sending

Set `AUTH_INFO_PATH` to a persistent writable location for Baileys credentials.
Keep this credential directory private and persistent across deployments. The
backend reuses an existing linked-device session; a task-history reset does not
change the authentication directory or credentials. If WhatsApp is offline,
Settings reports the actual connection state and offers a reconnect or QR
pairing option when needed. Contacts need a valid international WhatsApp number;
local Pakistan (`03...`) and UK (`07...`) mobile formats are normalized before
lookup.

## Reset WhatsApp task history

An administrator can use **Clear Old WhatsApp Tasks & Start Fresh** in Settings.
The confirmation preview counts tasks with explicit WhatsApp source metadata
and all records in the WhatsApp-only task-draft collection. On confirmation, the
backend stores a MongoDB processing checkpoint, removes only those WhatsApp
tasks, their directly related task activity/notification records, and message
drafts, and clears monitored-group last-activity timestamps. Users, projects,
group monitoring configuration, manually created tasks, and unrelated data are
not removed. The operation does not delete or move Baileys authentication
credentials.

Inbound processing is queued with the reset so in-flight message extraction
finishes before cleanup. Afterward, messages timestamped at or before the
checkpoint are ignored, even if Baileys emits them after a backend restart.
Messages without a valid provider timestamp are ignored. Full-history sync is
disabled (`syncFullHistory: false`) and only `notify` upserts are eligible.
Run one backend instance for the paired WhatsApp account, as documented below,
so the in-memory intake queue and reset operation have a single owner.

## Backend hosting requirement

Baileys must run inside the long-lived Node.js process started by `npm start`
(`src/server.js`). A serverless function deployment such as the backend's
`api/index.js` entry on Vercel only exports the Express app; it does not start
the Baileys connection, and function instances cannot reliably keep its
WebSocket alive. Deploy the backend API on an always-on Node.js host, configure
MongoDB and `AUTH_INFO_PATH`, and mount the existing authentication directory
as private persistent storage. Run a single backend instance for the paired
WhatsApp account. The frontend may remain on Vercel.

## Production configuration and diagnostics

Set the frontend build variable `VITE_API_URL` to the backend API base URL,
including `/api` (for example, `https://api.example.com/api`). If Socket.IO is
hosted separately from that URL, set `VITE_SOCKET_URL` to its origin.

Configure the backend with:

- `MONGODB_URI` for the existing MongoDB database.
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` as distinct, stable, private
  values of at least 32 characters. Keep them identical across backend
  processes; never use development/example values in production.
- `FRONTEND_URL` as the exact deployed frontend origin, and `FRONTEND_URLS`
  for any additional trusted origins. Do not include `/` or a path.
- `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=none` when the frontend and API
  are on different sites. The frontend also sends its stored access token as a
  bearer credential because browsers may block cross-site cookies.
- `AUTH_INFO_PATH` pointed at a private persistent volume mounted at the
  existing Baileys auth directory. Do not point separate instances at competing
  copies of this directory.
- `ENABLE_WHATSAPP=true` (or leave unset) to enable the connection. Set
  `NODE_ENV=production`.
- `GEMINI_API_KEY` and optionally `GEMINI_MODEL`/`AI_PROVIDER=gemini` if Gemini
  extraction is desired. Without an AI key, the existing rule-based extractor
  is used; transient Gemini failures are recorded on the resulting draft when
  that fallback succeeds.

`GET /api/whatsapp/diagnostics` requires a valid signed-in Admin or Manager
session. A 401 means the backend did not accept an access token; sign in again
if both the bearer token and cookie are expired or invalid. A 403 means the
session is valid but the account role cannot access WhatsApp settings. The
middleware prefers a valid bearer token and falls back to the access cookie,
so an old cookie no longer overrides a refreshed frontend token. Browser
storage is scoped to the frontend origin: users opening a newly deployed
Vercel hostname may need to sign in again.

Diagnostics are process-local by design. Only the designated
`NODE_APP_INSTANCE=0` worker starts Baileys when using a Node cluster, while
other workers serve API requests without that socket. A `non_owner_worker`
diagnostic means requests are reaching a worker that does not own the
connection. For this deployment, use one persistent backend process/replica;
do not scale it horizontally unless the WhatsApp socket and diagnostics are
moved into a dedicated shared worker service.

The status endpoint reports this process's live socket, not just the saved
credentials. A transient Baileys/libsignal decryption error affects the
individual message that could not be decrypted; it is not treated as proof of
logout and does not trigger auth-file changes. Incoming task capture accepts
only real-time `notify` upserts from monitored, unpaused groups; it does not
import history or create duplicate drafts for the same group/message key.

## Pair or reconnect from Settings

Open **System Settings → WhatsApp Assignment Sender**. Use **Reconnect WhatsApp**
to retry the existing saved session first. If Baileys emits a pairing QR, the
page shows a temporary code and the instruction to scan it from WhatsApp →
Linked devices → Link a device. The QR is available only through the authenticated,
non-cacheable diagnostics endpoint and is never written to application logs.

If WhatsApp explicitly reports the session logged out, the UI asks for
confirmation before starting a new pairing. On confirmation, the backend moves
the existing authentication directory to a timestamped sibling backup and
creates a fresh directory; it never silently deletes the old session. Keep the
backup until the new account connection is verified. If pairing fails, stop the
backend, move the new auth directory aside, then restore the backup to the
configured `AUTH_INFO_PATH` before restarting.

Repeated `Bad MAC` or message decryption errors are rate-limited and logged
without message contents or session data. They can affect individual messages
and do not by themselves trigger a credential reset. Try a normal reconnect
first; only use the confirmed re-pair flow when WhatsApp reports logout or
provides a new pairing QR.

Assignment notifications are recorded in the task WhatsApp outbox. `Sent` means
Baileys accepted the message, not that the recipient's device confirmed
delivery. Failed messages can be retried from the task's assignment history.

## Manual verification

1. Start the backend with MongoDB configured and connect Baileys by scanning the
   QR code.
2. Create or reassign a task to an active contact with a WhatsApp number.
3. Confirm the task is saved and its assignment history records the send result.
4. Confirm the recipient receives the message on WhatsApp.
5. Send an actionable text to a monitored group and confirm it creates a draft
   only; verify that approving the draft is required to create a task. Confirm
   private chats, unmonitored groups, and non-actionable messages do not create
   tasks.
6. POST a sample payload to `/api/webhook/whatsapp` and
   `/api/webhooks/whatsapp`; both should return HTTP 410 without creating work.
7. As an administrator, open Settings and verify the reset preview counts,
   confirmation, cleanup, and persisted processing checkpoint. Confirm an old
   message does not create a draft after restarting the backend, and a new
   monitored-group message creates one draft for approval.
