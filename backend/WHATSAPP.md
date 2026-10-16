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
