# WhatsApp assignment notifications

WhatsApp is outbound-only. The backend uses Baileys Web to send assignment
notifications to contacts selected in the task form. Incoming messages and media
are ignored; the legacy webhook aliases return HTTP 410 and do not inspect or
queue request bodies.

## Configure outbound sending

Set `AUTH_INFO_PATH` to a persistent writable location for Baileys credentials.
Start the backend and scan its QR code with the WhatsApp account that should send
assignment notifications. Keep this credential directory private and persistent
across deployments. Contacts need a valid international WhatsApp number; local
Pakistan (`03...`) and UK (`07...`) mobile formats are normalized before lookup.

Assignment notifications are recorded in the task WhatsApp outbox. `Sent` means
Baileys accepted the message, not that the recipient's device confirmed
delivery. Failed messages can be retried from the task's assignment history.

## Manual verification

1. Start the backend with MongoDB configured and connect Baileys by scanning the
   QR code.
2. Create or reassign a task to an active contact with a WhatsApp number.
3. Confirm the task is saved and its assignment history records the send result.
4. Confirm the recipient receives the message on WhatsApp.
5. Send a text and an image to the connected WhatsApp account. Confirm neither
   creates a task, comment, webhook job, or media upload.
6. POST a sample payload to `/api/webhook/whatsapp` and
   `/api/webhooks/whatsapp`; both should return HTTP 410 without creating work.
