# PixxTechnologiees Task Manager

A professional, user-friendly internal task-management SaaS platform designed for PixxTechnologiees managers and team members, inspired by the intuitive workflow clarity of monday.com.

---

## Architecture & Project Structure

The project maintains a clean separation between the user-facing web interface and the server API:

```text
Task-Manager/
├── frontend/                     # React + Vite Client Application
│   ├── public/                   # Static public assets
│   ├── src/
│   │   ├── assets/               # Branding assets and icons
│   │   ├── components/
│   │   │   ├── kanban/           # KanbanBoard with HTML5 drag-and-drop and accessible status select
│   │   │   ├── timeline/         # TimelineView Gantt-style sliding-window visualization
│   │   │   ├── layout/           # PageContainer layout shells
│   │   │   ├── navigation/       # Collapsible Sidebar, TopNav, ProtectedRoute
│   │   │   └── ui/               # Reusable Button, StatCard, EmptyState, Modal, Toast, etc.
│   │   ├── context/              # ToastContext and AuthContext
│   │   ├── hooks/                # Custom React hooks (useToast, useAuth)
│   │   ├── layouts/              # MainLayout application shell
│   │   ├── pages/                # Login, Unauthorized, Dashboard, All Tasks, My Work, Projects, Team, etc.
│   │   ├── services/             # Centralized API client (auth, users, projects, tasks, health)
│   │   ├── styles/               # Global CSS variables, reset, and responsive rules
│   │   ├── utils/                # Date helpers and formatting
│   │   ├── App.jsx               # Route tree with session guards
│   │   └── main.jsx              # React root entry point
│   ├── .env                      # Frontend environment configuration (git-ignored)
│   ├── package.json              # Client scripts and dependencies
│   └── vite.config.js            # Vite build configuration
│
├── backend/                      # Node.js + Express + Mongoose REST API
│   ├── src/
│   │   ├── config/               # Environment validation, MongoDB connection, Cloudinary init
│   │   ├── controllers/          # API controllers (auth, user, project, task, health, report)
│   │   ├── middleware/           # Auth/role guards, error handler, notFound, rateLimiter
│   │   ├── models/               # Mongoose models (User, Project, Task, TaskEvent, Notification, NotificationOutbox)
│   │   ├── routes/               # Modular API routes (/api/auth, /api/users, /api/projects, /api/tasks, /api/reports, etc.)
│   │   ├── scripts/              # Initial administrator setup script (createAdmin.js)
│   │   ├── services/             # Cloudinary, email (Nodemailer outbox), scheduler services
│   │   ├── utils/                # JWT helpers, structured logger, CSV builder with formula-injection defense
│   │   ├── app.js                # Express application configuration
│   │   └── server.js             # HTTP server listener and graceful shutdown
│   ├── test/                     # Node.js native test suite
│   ├── .env                      # Backend environment configuration (git-ignored)
│   └── package.json              # Server scripts and dependencies
├── Dockerfile                    # Production backend/frontend multi-stage images
├── docker-compose.yml            # Nginx, API, MongoDB, and Redis services
├── deploy/nginx.conf             # HTTPS reverse proxy and Socket.IO upgrade config
└── ecosystem.config.cjs          # PM2 clustered fallback
│
├── .gitignore                    # Root repository ignore rules
└── README.md                     # Master documentation
```

## Contacts & WhatsApp Task Assignment

The workspace owner manages external task recipients from **Contacts**. Contacts are not application users and do not need accounts or passwords. A contact requires a name and WhatsApp number; numbers are normalized to international form and duplicate numbers are rejected. Deleting a contact from the UI deactivates it, preserving task assignments and notification history.

Tasks created from the All Tasks form require an active contact. Reassigning a task to a different contact creates a separate WhatsApp assignment notification; edits to other task fields do not resend it. Notification attempts are tracked in the backend outbox and can be retried from Task Details after a failure. `Sent` indicates Baileys accepted the send request; it is not a WhatsApp delivery receipt.

### Manual WhatsApp delivery check

1. Start the persistent backend (`cd backend && npm run dev`) and make sure its Baileys session is authenticated and connected. The serverless deployment does not run the persistent Baileys listener.
2. Sign in as the workspace owner, add a contact whose number is opted in to receive the task assignment, and create a task assigned to that contact.
3. Confirm the task remains saved and the Task Details panel records `Pending`, then `Sent` after Baileys accepts the request. Verify receipt on the recipient device separately; the application does not claim delivery without a supported receipt.
4. To test failure handling, temporarily disconnect Baileys, create an assignment, confirm a `Failed` record and failure reason, restore the connection, and use **Retry WhatsApp notification** in Task Details.
5. Do not use business-initiated messaging for recipients who have not consented. Baileys Web does not provide WhatsApp Business Cloud API template enforcement; comply with WhatsApp policies and applicable local laws.

---

## WhatsApp Group Messages → AI Task Drafts → Manual Approval

The system captures incoming task and work instructions from selected WhatsApp groups and generates structured task drafts.

### Core Architecture & Guiding Principle
- **Zero Automatic Task Creation:** A task is **never** created directly from an incoming WhatsApp message. Every detected instruction is stored as a draft that requires explicit owner review and approval via **"Approve & Create Task"**.
- **Single-User Workspace:** Group participants are external contacts, not system users. All drafts and approvals are managed solely by the authenticated workspace owner.

### 1. How to Configure the AI Provider (Google Gemini API & Heuristics)
The system includes a production-ready extraction pipeline:
- **Google Gemini API (Official REST Integration):**
  - Uses the official REST endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
  - Authentication header: `x-goog-api-key: <GEMINI_API_KEY>`
  - Google Cloud Project Number: `1061431060123` (`GOOGLE_CLOUD_PROJECT_NUMBER`)
  - Configurable in `backend/.env`:
    ```bash
    AI_PROVIDER=gemini
    GEMINI_API_KEY=your_gemini_api_key_here
    GEMINI_MODEL=gemini-2.5-flash
    GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
    GOOGLE_CLOUD_PROJECT_NUMBER=1061431060123
    ```
  - **Dynamic Model Fallback:** If `gemini-2.5-flash` returns HTTP 404 on accounts where it is not yet provisioned, the backend automatically falls back to `gemini-1.5-flash` and `gemini-2.0-flash`.
  - **Bounded Exponential Backoff:** Automatically retries transient HTTP 429 and 503 errors while fast-failing on 400/401/403 errors.
  - **Interactive Testing in UI:** Use the **"Test Gemini API"** button in **Settings** -> **WhatsApp Task Capture** to verify connectivity, or use **"Test Sample Message"** to test structured extraction without waiting for live WhatsApp messages.
- **OpenAI:** Set `AI_PROVIDER=openai`, `OPENAI_API_KEY=your_key`, and optionally `OPENAI_MODEL=gpt-4o-mini` in `backend/.env`.
- **Heuristic Rule-Based Extractor (Fallback):** Functions immediately with zero external credentials or API keys. Uses pattern matching, relative date parsing (e.g. "by Monday", "tomorrow"), priority detection, and project name matching against existing workspace projects. If an external AI provider fails or credentials are omitted, the pipeline falls back automatically to heuristic extraction without halting the Baileys listener.

### 2. How to Select and Monitor WhatsApp Groups
1. Navigate to **Settings** -> **WhatsApp Task Capture (Group Monitoring)**.
2. Click **Refresh Groups** to retrieve all group chats accessible to your connected Baileys multi-device session.
3. Toggle the monitoring switch on the groups you wish to monitor. Only explicitly enabled groups (`isMonitored: true`) are processed. Non-group messages, private chats, status broadcasts, and outgoing messages are ignored.
4. Configuration is stored in MongoDB and persists across backend restarts.

### 3. How to Review and Approve Drafts
1. Navigate to the sidebar page: **WhatsApp Task Inbox** (`/whatsapp-inbox`).
2. Drafts are displayed with status pills: `Awaiting Review`, `Needs Clarification`, `Approved`, `Rejected`, `Failed`.
3. Click **Review & Approve** on any draft card to inspect the original WhatsApp message, copy message text, or redact raw message text for privacy compliance.
4. Modify any candidate fields: Title, Description, Project, Priority, Start Date, and Due Date.
5. Click **Approve & Create Task**: Atomically creates the task in the database, transitions the draft status to `Approved`, links the created task, and emits real-time updates via Socket.IO.
6. Alternatively, click **Reject Draft** to discard unwanted messages without creating a task.

### 4. How Duplicate Prevention Works
- **Unique Compound Index:** MongoDB enforces a unique index on `{ groupJid: 1, messageId: 1 }` in the `TaskDraft` collection. Repeated deliveries of the same message event cannot create duplicate drafts.
- **Durable Processing Record:** The draft record is stored in MongoDB *before* initiating AI analysis, ensuring recovery even if the server restarts.
- **Atomic Approval Transition:** Approving a draft uses `TaskDraft.findOneAndUpdate({ _id, status: { $ne: 'approved' } })`. Double-clicking or retrying returns the existing created task and guarantees duplicate tasks are never created.

### 5. Troubleshooting Disconnected WhatsApp Sessions
- In **Settings**, check the WhatsApp connection status badge.
- If disconnected, Baileys will attempt automatic exponential reconnects.
- If the session was logged out on your phone, restart the backend and scan the terminal QR code to re-pair.
- Authentication credentials persist in `./auth_info_baileys`. Never commit or delete these session files.

### 6. Known Baileys Multi-Device Limitations
- **Real-time Event Stream:** Messages are received while the Baileys socket is connected. Messages sent during extended offline periods depend on WhatsApp multi-device offline sync buffers.
- **Group Metadata:** Baileys fetches participating groups on socket open; newly created WhatsApp groups will appear after clicking "Refresh Groups".
- **Message Edits & Revocations:** Incoming messages capture the text sent at delivery. Message deletions ("Delete for Everyone") do not automatically delete already generated drafts.
- **Privacy & Compliance:** Only monitor groups where members have consented to automated task extraction. Use the "Redact" button in the review modal to remove sensitive raw message text while keeping audit metadata.

### 7. How to Test Safely
1. Create a consenting WhatsApp test group containing your connected WhatsApp number.
2. Enable the test group in **Settings** -> **WhatsApp Task Capture**.
3. Send a sample instruction: `"Rizwan, please update the UK property expense tracker and finish the service charge report by Monday."`
4. Verify the draft appears in `/whatsapp-inbox` with interpreted dates and suggested project.
5. Review and approve the draft to verify task creation on your board.


---

## User Roles & Permissions

The platform enforces strict role-based access control (RBAC) across backend endpoints and frontend interfaces:

- **`Admin` (Full Administrator)**:
  - Full system administration across all company projects and tasks.
  - Can provision accounts with any supported role.
- **`Manager` (Project Lead)**:
  - Full board, project, group/column, and task management, including task assignment.
  - Access the active workspace user directory and provision Member accounts.
- **`Member` (Team Contributor)**:
  - View boards they are added to and tasks directly assigned to them.
  - Update status, dates, and task column values on assigned tasks; post task updates and attach files.
  - Cannot create tasks, change assignees, archive/delete items, or change board columns.

Legacy `ADMIN`, `MANAGER`, and `EMPLOYEE` records are normalized to `Admin`, `Manager`, and `Member` when loaded.

**Board schema note:** Existing projects act as boards, with groups derived from the selected project/status/priority view. Custom column definitions are currently browser-local, not shared through MongoDB; role checks hide schema controls from Members, but shared Group/Column administration requires a persisted board schema.

---

## Prerequisites

Before running the application, ensure the following runtimes and services are available:

- **Node.js**: v18.11.0 or higher (v24.x tested)
- **npm**: v9.0.0 or higher
- **MongoDB**: Local MongoDB instance (default port 27017) or MongoDB Atlas connection URI
- **Cloudinary Account**: (Configured for future task attachments and media)

---

## Installation

Install dependencies for both projects independently:

### 1. Backend Installation
```bash
cd backend
npm install
```

### 2. Frontend Installation
```bash
cd frontend
npm install
```

---

## Environment Configuration

### Backend Configuration
Configure environment variables in `backend/.env` (kept private and git-ignored):

```bash
# Edit backend/.env directly
```

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | Port for the Express server | `5000` |
| `NODE_ENV` | Runtime environment (`development`, `production`, `test`) | `development` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/pixx_task_manager` |
| `FRONTEND_URL` | Allowed origin for Cross-Origin Resource Sharing (CORS) | `http://localhost:5173` |
| `JWT_ACCESS_SECRET` | Secret key used for signing short-lived access tokens (min. 32 chars) | Secure random string |
| `JWT_REFRESH_SECRET` | Secret key used for signing refresh tokens (min. 32 chars) | Secure random string |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifespan | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifespan | `7d` |
| `COOKIE_SECURE` | Set to `true` in production with HTTPS | `false` |
| `INITIAL_ADMIN_EMAIL` | Default administrator email for initial seeding | `admin@pixxtechnologiees.com` |
| `INITIAL_ADMIN_PASSWORD` | Default administrator password for seeding (min. 8 chars) | `AdminSecret123!` |
| `INITIAL_ADMIN_NAME` | Default administrator display name | `System Administrator` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary Cloud Name (backend only) | `your_cloud_name` |
| `CLOUDINARY_API_KEY` | Cloudinary API Key (backend only) | `your_api_key` |
| `CLOUDINARY_API_SECRET` | Cloudinary Secret (never expose to client) | `your_api_secret` |
| `EMAIL_USER` | Gmail mailbox used to send notifications | `""` |
| `OAUTH_CLIENT_ID` | Google OAuth2 client ID | `""` |
| `OAUTH_CLIENT_SECRET` | Google OAuth2 client secret (backend only) | `""` |
| `OAUTH_REFRESH_TOKEN` | Google OAuth2 refresh token (backend only) | `""` |
| `SMTP_HOST` | Optional outgoing SMTP host (e.g., smtp.sendgrid.net, smtp.mailtrap.io) | `""` (safe fallback) |
| `SMTP_PORT` | Outgoing SMTP port (587 for TLS, 465 for SSL) | `587` |
| `SMTP_SECURE` | Set `true` if port 465 SSL | `false` |
| `SMTP_USER` | SMTP username | `""` |
| `SMTP_PASS` | SMTP password / API token | `""` |
| `EMAIL_FROM` | Sender email address header | `no-reply@pixxtechnologiees.com` |
| `SCHEDULER_ENABLED` | Enable recurring background reminder worker | `true` |
| `REMINDER_INTERVAL_MINUTES` | Frequency of scheduled overdue and deadline scans | `60` |
| `WHATSAPP_PROVIDER` | Payload provider (`auto`, `meta`, `twilio`, or `baileys`) | `auto` |
| `WHATSAPP_VERIFY_TOKEN` | Secret token configured for Meta webhook verification | `""` |
| `WHATSAPP_APP_SECRET` | Meta app secret used to validate webhook signatures | `""` |
| `WHATSAPP_GROUP_ID` | Exact WhatsApp group/chat ID allowed to create tasks | `""` |
| `PIXX_WHATSAPP_GROUP_ID` | Baileys WhatsApp group ID (preferred alias) | `""` |
| `AUTH_INFO_PATH` | Private Baileys multi-device credentials directory | `./auth_info_baileys` |
| `WHATSAPP_ACCESS_TOKEN` | Meta Cloud API token used to download media | `""` |
| `WHATSAPP_GRAPH_API_VERSION` | Meta Graph API version for media downloads | `v22.0` |
| `WHATSAPP_WEBHOOK_SECRET` | Shared secret header for non-Meta, non-Twilio gateways | `""` |
| `TWILIO_ACCOUNT_SID` | Twilio account ID used to fetch inbound media | `""` |
| `TWILIO_AUTH_TOKEN` | Twilio auth token used to validate webhook signatures and fetch media | `""` |
| `WHATSAPP_MAX_MEDIA_BYTES` | Maximum inbound media size | `10485760` |
| `WHATSAPP_DEFAULT_PROJECT_ID` | MongoDB ID of the project receiving WhatsApp-created tasks | `""` |
| `WHATSAPP_DEFAULT_ASSIGNEE_ID` | MongoDB ID of an active project member assigned to WhatsApp-created tasks | `""` |

### WhatsApp Task Intake
The callback supports both `GET/POST /api/webhook/whatsapp` (preferred) and the legacy `GET/POST /api/webhooks/whatsapp` path. Meta callbacks use `WHATSAPP_VERIFY_TOKEN` for GET verification and must provide a valid `X-Hub-Signature-256` signature checked against `WHATSAPP_APP_SECRET`. Twilio requests use `TWILIO_AUTH_TOKEN` for signature checks and media downloads. Baileys or other trusted gateways must send `X-WhatsApp-Webhook-Secret`, matching `WHATSAPP_WEBHOOK_SECRET`. Configure `PIXX_WHATSAPP_GROUP_ID` (or legacy `WHATSAPP_GROUP_ID`) with the exact group ID; all other chats are acknowledged and ignored.

The backend can also connect directly to WhatsApp using Baileys. Set `PIXX_WHATSAPP_GROUP_ID`, start the backend with MongoDB available, and scan the one-time QR code shown in the backend terminal. Multi-device credentials are persisted under `AUTH_INFO_PATH` (defaults to `./auth_info_baileys`) and must be kept private; the directory is git-ignored. Docker Compose persists the auth directory in a named volume. Only the first PM2 cluster worker starts the listener. The matching board project must exist (for example `Penalty Charge Notice`, `Urgent Matters`, or `General Tasks`); configure `WHATSAPP_DEFAULT_PROJECT_ID` as a fallback. Incoming images are streamed to Cloudinary's `pixx_tasks/whatsapp` folder and task attachments store their secure URL and public ID.

The webhook responds with HTTP 200 after signature, payload, and group checks, then processes accepted messages asynchronously. Ensure the Node process remains running to finish queued in-process work. Message IDs are stored in a unique sparse index to suppress retries. The parser routes penalty/PCN messages to the `Penalty Charge Notice` board, bridging and stamp-duty messages to the `Urgent Matters` board and corresponding group, then uses `General Tasks` or `WHATSAPP_DEFAULT_PROJECT_ID` as fallback. It uses the first sentence (up to 80 characters) as the title, maps `@Name` to active board members, and otherwise assigns `WHATSAPP_DEFAULT_ASSIGNEE_ID` or the board manager. Sender metadata, group, task activity, and media are saved with the task. Images/documents are downloaded from the provider and uploaded to `pixx_tasks/whatsapp`; the first image is also attached to the task's preview and Updates thread. Active Admins/Managers, the board manager, and assignees receive in-app/socket and email notifications. If MongoDB automatic index creation is disabled, create the index before enabling intake with `db.tasks.createIndex({ whatsappMessageId: 1 }, { unique: true, sparse: true })`.

### Frontend Configuration
Configure environment variables in `frontend/.env` (kept private and git-ignored):

```bash
# Edit frontend/.env directly
```

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VITE_API_URL` | Base URL for the Express API | `http://localhost:5000/api` |
| `VITE_WS_URL` | Base URL for Socket.IO connection (optional; defaults to host root) | `http://localhost:5000` |

---

## Creating the First Administrator

Public account registration is intentionally disabled. To bootstrap the system, initialize the primary administrator via the secure CLI script:

```bash
cd backend

# Option A: Seed using parameters from .env
npm run seed:admin

# Option B: Pass explicit credentials directly via CLI flags
node src/scripts/createAdmin.js --email=admin@pixxtechnologiees.com --password=YourSecurePassword123! --name="System Administrator"
```

> [!NOTE]
> If MongoDB is unreachable, the setup script aborts with a clear configuration message rather than pretending setup succeeded.

---

## Running the Application

### Starting the Backend Server

```bash
cd backend

# Development mode (native Node.js watch mode + Socket.IO + background scheduler)
npm run dev

# Production mode
npm start

# Automated test suite (39 native Node.js tests across all phases 1–6 and RBAC)
npm test

# Syntax verification
npm run lint
```

### Starting the Frontend Client

```bash
cd frontend

# Development server (Vite with HMR and Socket.IO client)
npm run dev

# Production build
npm run build

# Oxlint check
npm run lint
```

---

## API Endpoints Reference

### Authentication (`/api/auth`)
- `POST /api/auth/login`: Authenticate with email and password. Issues short-lived access token and sets HTTP-only cookies. (Protected by `authLimiter`).
- `POST /api/auth/logout`: Clears authentication cookies and invalidates session.
- `POST /api/auth/refresh`: Issues a refreshed access token using HTTP-only refresh cookie.
- `GET /api/auth/me`: Returns profile of currently authenticated user.

### Users (`/api/users`)
- `GET /api/users`: List/search users with role and status filters for Admins/Managers; Members receive only their own profile.
- `POST /api/users`: Provision an account (Managers can create Members; Admins can create any supported role).
- `GET /api/users/:id`: Get a user profile; Members can view only their own.
- `PUT /api/users/:id`: Update your own profile; role and password changes are not accepted.
- `PATCH /api/users/:id/status`: Disabled; account deactivation is not currently exposed.
- `POST /api/users/:id/reset-password`: Change your own password.

### Projects (`/api/projects`)
- `GET /api/projects`: List projects accessible to user with search, status filters, and pagination.
- `POST /api/projects`: Create project (`ADMIN` and `MANAGER`).
- `GET /api/projects/:id`: Get project details and members.
- `PUT /api/projects/:id`: Update project details (`ADMIN` or assigned Project Manager).
- `PATCH /api/projects/:id/archive`: Archive or restore project while preserving history (`ADMIN` or Project Manager).

### Tasks (`/api/tasks`)
- `GET /api/tasks`: Filter tasks by project, assignee (`me` or ID), status, priority, search, sort (`sortBy`, `sortOrder`), date ranges (`dueDateFrom`, `dueDateTo`, `startDateFrom`, `startDateTo`), and server-side pagination (`page`, `limit`).
- `POST /api/tasks`: Create task within an accessible project (Admin/Manager only; automatically records `TASK_CREATED` audit event).
- `GET /api/tasks/export/csv`: Export the current filtered task list as a formula-injection-safe CSV file (capped at 5 000 rows; role-scoped; must be mounted before `/:id` in router).
- `GET /api/tasks/:id`: Get task details.
- `PUT /api/tasks/:id`: Admins/Managers can update task details; Members may update status, dates, and existing custom-column values only on tasks assigned to them.
- `PATCH /api/tasks/:id/status`: Fast status transition (Backlog, To Do, In Progress, Blocked, In Review, Done) with audit logging & notification triggers.
- `PATCH /api/tasks/:id/archive`: Archive or restore task with audit logging.

### Task Activity History (`/api/tasks/:id/activity`)
- `GET /api/tasks/:id/activity`: Returns chronological audit trail of trusted server-generated events (creation, edits, status transitions, priority changes, due dates, assignees, comments, attachments, time logs).

### Task Comments (`/api/tasks/:id/comments`)
- `GET /api/tasks/:id/comments`: Fetch chronological task discussion feed with author details.
- `POST /api/tasks/:id/comments`: Post a new discussion comment (triggers notifications & records `COMMENT_ADDED` audit event).
- `DELETE /api/tasks/:id/comments/:commentId`: Delete your own comment or any comment as an Admin/Manager (records `COMMENT_DELETED` audit event).

### Task Attachments (`/api/tasks/:id/attachments`)
- `POST /api/tasks/:id/attachments`: Upload an attachment via Multer memory streaming to Cloudinary (10MB limit; image, PDF, doc, sheet, zip; records `ATTACHMENT_ADDED` audit event).
- `DELETE /api/tasks/:id/attachments/:attachmentId`: Remove your own attachment or any attachment as an Admin/Manager (records `ATTACHMENT_REMOVED` audit event).

### Task Time Tracking (`/api/tasks/:id/time-entries`)
- `GET /api/tasks/:id/time-entries`: Fetch logged work entries for task with aggregate hours and minutes summary.
- `POST /api/tasks/:id/time-entries`: Log time (1 to 1440 minutes, description, date; updates `task.totalTimeSpentMinutes` and records `TIME_LOGGED` audit event).
- `DELETE /api/tasks/:id/time-entries/:entryId`: Remove your own time entry or any entry as an Admin/Manager (recalculates task total time and records `TIME_DELETED` audit event).

### Notifications (`/api/notifications`)
- `GET /api/notifications`: Retrieve current user's notifications (paginated, filterable by read/unread status; strictly scoped to requesting user).
- `GET /api/notifications/unread-count`: Fast unread notification counter for badges and navigation.
- `PATCH /api/notifications/:id/read`: Mark an individual notification as read.
- `PATCH /api/notifications/mark-all-read`: Mark all notifications for the current user as read.
- `DELETE /api/notifications/:id`: Dismiss/delete an individual notification.
- `GET /api/notifications/preferences`: Get current user's notification preferences (email and category toggles).
- `PUT /api/notifications/preferences`: Update user notification preferences.

### Dashboard (`/api/dashboard`)
- `GET /api/dashboard/stats`: Computes real database aggregations (active projects, total tasks, pending, in-progress, completed, overdue, status distribution, upcoming deadlines, and recent activity).

### Management Reports (`/api/reports`)
- `GET /api/reports/summary`: Returns aggregated KPI data: completion rate, project progress, employee workload, time-logged summary, and overdue task attention list. Admin sees all data; Manager sees their projects; Member sees only their own tasks. Supports `startDate`, `endDate`, `projectId` query params.
- `GET /api/reports/export/csv`: Exports a formula-injection-safe CSV file. Supports `type=workload` (project/assignee task counts) or `type=time` (time-log entries). Role-scoped identically to summary endpoint (capped at 2 000 rows for time-log exports).

### System Diagnostics (`/api/health`)
- `GET /api/health`: Live connectivity and operational status for Express API, MongoDB database driver, Cloudinary storage, Nodemailer SMTP service, and background Scheduler worker.

---

## Testing & Quality Assurance

Run the automated test suites:

```bash
# Backend automated tests (Node.js native test runner — run from backend/)
npm test
```

### Verified Test Cases (39/39 Passing)
1. `GET /api/health`: Accurately reports connection state when MongoDB is disconnected, validates Cloudinary, SMTP, and Scheduler statuses.
2. `GET /api`: Returns 200 with service descriptor and mounted route endpoints.
3. `GET /api/non-existent-route`: Returns 404 with structured JSON error.
4. Password hashing: Verifies salt generation, bcrypt hashing format, and raw password verification.
5. Token lifecycle: Tests JWT generation and decoding for access and refresh tokens.
6. Phase 2 Route protection: Validates that unauthenticated requests to `/api/auth/me`, `/api/users`, `/api/projects`, `/api/tasks`, and `/api/dashboard/stats` are rejected with HTTP 401.
7. Database offline resilience: Validates that `/api/auth/login` fails gracefully with HTTP 503 when MongoDB is unreachable.
8. Schema & Enum integrity: Validates User roles, Project statuses, and Task priorities.
9. Phase 3 Schema & Constant validation: Validates `TASK_EVENT_ACTIONS`, `TimeEntry` constraints (1-1440 min), `Comment` validations, and `Task` attachments array.
10. Phase 3 Error resilience: Validates `TaskEvent.logEvent` handles DB disconnection gracefully without throwing or crashing business transactions.
11. Phase 3 Route protection: Validates that unauthenticated requests to activity, comments, time entries, and attachment endpoints are rejected with HTTP 401.
12. Phase 4 Schema validation: Verifies `Notification` schema structure, required fields, and index constraints (`recipient + dedupKey`).
13. Phase 4 Outbox schema: Verifies `NotificationOutbox` statuses (`pending`, `sent`, `failed`), retry backoff properties, and deduplication logic.
14. Phase 4 User notification preferences: Verifies default preference fields on User model (`emailNotifications`, `taskAssigned`, `taskStatusChanged`, `taskDueDate`, `taskComments`, `overdueReminders`).
15. Phase 4 Notification route protection: Validates that unauthenticated requests to `/api/notifications`, `/unread-count`, `/mark-all-read`, and `/preferences` return HTTP 401.
16. Phase 4 Outbox resilient dispatch: Verifies `emailService.sendEmail` suppresses errors safely when SMTP credentials are unconfigured without crashing caller.
17. Phase 4 Scheduler task filters: Validates that `schedulerService` excludes completed tasks (`Done`), archived tasks, and dateless tasks from overdue/upcoming deadline scans.
18. Phase 4 Notification privacy enforcement: Validates that notification query filters strictly isolate the authenticated user's ID, preventing arbitrary cross-user access even for admins.
19. Phase 5 CSV formula-injection defense: Verifies that cells starting with `=`, `+`, `-`, `@`, `\t`, `\n` are prepended with `'` to prevent spreadsheet formula execution.
20. Phase 5 Kanban task statuses: Validates all six valid Kanban column statuses (`Backlog`, `To Do`, `In Progress`, `Blocked`, `In Review`, `Done`) and rejects undefined transitions.
21. Phase 5 Task date range validation: Validates `dueDateFrom`/`dueDateTo`/`startDateFrom`/`startDateTo` filter logic and that malformed date strings are handled gracefully.
22. Phase 5 Management report metrics: Verifies completion rate formula `(completedTasks / totalTasks) × 100` and role-scoped aggregation behaviour.
23. Phase 5 Protected report & export routes: Confirms that `GET /api/reports/summary`, `GET /api/reports/export/csv`, `GET /api/tasks/export/csv`, and `PATCH /api/tasks/:id/status` return HTTP 401 when unauthenticated.
24. **Phase 6 Public Registration Defense**: Confirms that `/api/auth/register` returns 404 (strictly preventing unauthorized public account creation).
25. **Phase 6 RBAC & IDOR Object-Level Access Control**: Validates user role enums, project date validation ordering, and incremental taskKey generator (`PROJECTKEY-N`).
26. **Phase 6 Task, Kanban & Calendar Lifecycle Validation**: Verifies complete 6-state workflow, priority rules, and automatic `completedAt` timestamp assignment.
27. **Phase 6 Comments, Attachments, Time Tracking & Audit Events**: Enforces duration limits (1–1440 min) and validates non-blocking `TaskEvent.logEvent` offline resilience.
28. **Phase 6 Notifications, Sockets, Scheduler & Email Outbox**: Confirms scheduler single-instance guard, outbox lifecycle statuses, and notification deduplication keys.
29. **Phase 6 CSV Export Security & Formula-Injection Defense**: Validates comprehensive defense against all spreadsheet formula trigger characters (`=`, `+`, `-`, `@`, `\t`, `\n`).
30. **Phase 6 Centralized Error Handler Normalization**: Verifies that 404 routes and operational health endpoints produce safe, standardized JSON responses without leaking internal server details.

> [!NOTE]
> Frontend production build (`npm run build` inside `frontend/`) and `npm run lint` in both workspaces are additional quality gates that must also pass before any deployment.

---

## Phase 6 Implementation Summary: End-to-End Integration, Security & Production Readiness

- **End-to-End Object-Level Access Control (IDOR Defense)**:
  - Strict role scoping across entity controllers: `Admin` and `Manager` have full board/task management access; `Member` is scoped to joined boards and assigned-task writes.
  - Closed project query parameter leakage in `task.controller.js` and `exportTasksCsv`: non-admins filtering by `?project=<id>` cannot inspect deliverables from unaffiliated projects; the query automatically restricts results to tasks assigned directly to the requester.
  - Object-level ownership validation on comments and time tracking: members cannot delete another user's records.
  - Members cannot archive/delete projects or tasks; only managers and admins can do so.
- **Role Elevation Prevention & Administrative Integrity**:
  - Profile updates are self-only and do not accept role changes; account provisioning is restricted to Admins and Managers.
  - Public registration is disabled; initial administrator setup uses the server CLI seed script (`npm run seed:admin`).
- **Production Error Normalization**:
  - Centralized error handler (`errorHandler.js`) normalizes Mongoose `CastError` (invalid ObjectId -> 400 Bad Request), `ValidationError` (400 Bad Request with field error map), duplicate key `code 11000` (409 Conflict), and Multer `LIMIT_FILE_SIZE` (400 Bad Request).
  - Internal server errors do not leak stack traces or file system paths when running in production mode (`NODE_ENV=production`).
- **Distributed Scheduler & Single-Instance Lock**:
  - Background cron worker (`scheduler.service.js`) incorporates an in-process active lock (`isRunning()`) to prevent duplicate instances from starting simultaneously in the same process.
  - Compound unique indexes on `Notification` (`{ recipient: 1, dedupKey: 1 }`) and `NotificationOutbox` (`{ recipient: 1, dedupKey: 1 }`) guarantee idempotent reminder delivery even when multiple server replicas run concurrently in a cluster.
- **WebSocket & Real-Time Isolation**:
  - `socketService` strictly enforces user room boundaries; client attempts to join arbitrary rooms matching `user:*` for another user ID are rejected and logged.
  - Socket handshakes authenticate via JWT tokens extracted from HTTP-only cookies or authentication headers.
- **Audit Logging Reliability**:
  - `TaskEvent.logEvent` verifies database connectivity readiness prior to query dispatch, immediately returning `null` when offline rather than stalling business requests for the 10-second Mongoose driver buffer timeout.

---

## Production & Deployment Readiness Guide

### Container deployment (Docker Compose)

1. Create `.env.production` (kept private and git-ignored). Set distinct strong `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values, the MongoDB and Redis passwords/URLs, SMTP, Cloudinary, WhatsApp, and the real `FRONTEND_URL`.
2. Place the TLS certificate and private key at `deploy/certs/fullchain.pem` and `deploy/certs/privkey.pem`. The Nginx frontend redirects HTTP to HTTPS and listens on both ports; use certificates trusted by your clients.
3. Build and start the services from the project root:

   ```bash
   docker compose --env-file .env.production up -d --build
   docker compose --env-file .env.production ps
   docker compose --env-file .env.production logs -f backend frontend
   ```

   Nginx proxies `/api` and `/socket.io` to the API. MongoDB and Redis are on the private Compose network; persistent data lives in named volumes.
4. Seed the first administrator once, then remove `OWNER_PASSWORD` from the production environment:

   ```bash
   docker compose --env-file .env.production run --rm backend node src/scripts/initOwner.js
   ```

### PM2 fallback

`ecosystem.config.cjs` loads the root `.env.production` and starts the backend in cluster mode with one reminder scheduler process and Redis-backed Socket.IO fan-out. On the host, configure `MONGO_URI` and `REDIS_URL` for reachable external services (the sample defaults to Compose hostnames), install backend production dependencies, provision TLS at the reverse proxy, seed the owner once with `npm run seed:owner`, then remove its bootstrap password and run:

```bash
cd backend
npm ci --omit=dev
cd ..
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### Post-deployment smoke checklist

1. **Health and login:** `curl -i https://tasks.example.com/api/health`. Sign in with separate Manager and Member accounts; confirm each profile displays its role badge.
2. **RBAC:** As a Member, confirm board schema/add-task/archive controls are absent. Updating status/date/custom values on an assigned task should succeed; attempting `POST /api/tasks` or changing title/assignees should return `403`. Repeat as a Manager and verify those operations succeed.
3. **Socket.IO:** Open the same board in two authenticated browser sessions. Change an assigned task’s status in one session and verify the other session receives the live update without a reload. Confirm `/socket.io/` is proxied through Nginx and Redis is healthy.
4. **WhatsApp intake:** Configure the provider, group ID, verification token, and signing secret. Send a provider-valid mock message for the configured group; verify one task is created on the expected board, a retry with the same message ID creates no duplicate, and an unrelated group is ignored.
5. **Email delivery:** Trigger a task assignment and a deadline reminder with valid SMTP settings. Confirm the recipient receives the email and the backend logs report successful delivery; check the outbox/notification delivery status if a message is not received.

### 1. Environment Configuration Checklist
Ensure the following variables are defined in your production environment:

| Variable | Recommended Production Value | Notes |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables strict cookie flags and disables debug stack traces |
| `PORT` | e.g. `5000` (or host-assigned) | Node.js listener port |
| `FRONTEND_URL` | `https://tasks.pixxtechnologiees.com` | Production web application origin for CORS |
| `MONGODB_URI` | `mongodb+srv://...` | Secure connection string to MongoDB Atlas replica set |
| `MONGO_URI` | `mongodb+srv://...` | Alias accepted by the backend for `MONGODB_URI` |
| `JWT_ACCESS_SECRET` | 64+ random hex/base64 string | Cryptographically strong access-token secret |
| `JWT_REFRESH_SECRET` | 64+ random hex/base64 string | Distinct cryptographically strong secret |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Legacy aliases | Prefer `JWT_ACCESS_SECRET` and `JWT_ACCESS_EXPIRES_IN` |
| `REDIS_URL` | `redis://...` | Required for Socket.IO fan-out across PM2 cluster workers |
| `COOKIE_SECURE` | `true` | Requires HTTPS; sets `Secure` attribute on auth cookies |
| `ENABLE_SCHEDULER` | `true` | Runs background deadline and overdue reminder worker |
| `CLOUDINARY_*` | Cloud Name, API Key, Secret | Required for task file attachments and media storage |
| `SMTP_*` | Host, Port, User, Pass, Secure, From | Required for transactional outbound notification emails |

### 2. Cookie & CORS Security Policy
- In production (`NODE_ENV=production` or `COOKIE_SECURE=true`), `setAuthCookies` automatically activates:
  - `Secure`: Requires HTTPS transport.
  - `HttpOnly`: Prevents client-side JavaScript access via `document.cookie` (XSS mitigation).
  - `SameSite=strict`: Prevents cross-site cookie transmission (CSRF mitigation).
  - `Path=/api/auth`: Scopes the long-lived refresh token exclusively to authentication endpoints.

### 3. Hosting & Infrastructure Topology
- **Backend API & Real-Time Engine**:
  - Because the platform utilizes persistent WebSocket connections (`Socket.IO`) and a background cron scheduler (`node-cron`), the backend must be hosted on a persistent container or Node.js runtime (e.g. AWS ECS, Render, Railway, DigitalOcean App Platform, or Linux VPS).
  - *Serverless platforms (e.g. Vercel Serverless Functions, AWS Lambda)* are **not** recommended for the backend server due to connection timeouts, stateless execution, and inability to maintain persistent WebSocket streams or recurring cron intervals.
- **Frontend Client**:
  - Can be deployed to any static host or CDN (e.g. Cloudflare Pages, Vercel, AWS S3 + CloudFront).
  - Ensure client environment variable `VITE_API_URL` points to your production backend API domain.
- **Reverse Proxy (Nginx / Cloudflare / Traefik)**:
  - Ensure the reverse proxy forwards `X-Forwarded-For` and `X-Forwarded-Proto` headers.
  - Configure WebSocket upgrade headers:
    ```nginx
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_http_version 1.1;
    ```

### 4. Database Backup & Disaster Recovery
- **MongoDB Atlas**:
  - Enable Continuous Cloud Backups with Point-in-Time Restore (PITR) enabled (7–35 days retention).
  - Ensure M0/M10+ tier IP Access Lists restrict database access exclusively to your backend server IPs.
- **Cloudinary Storage**:
  - All uploaded file buffers stream directly to Cloudinary folder `pixx_tasks/<taskId>`.
  - Enable Cloudinary asset backup / secondary cloud storage sync to preserve uploaded deliverables and receipts.

---

## Phase 5 Implementation Summary

- **Advanced Task Workspace (All Tasks & My Work)**: Three switchable view modes — Table, Kanban, and Timeline — with persistent view preference stored in `localStorage`. Server-side pagination, dynamic column sorting, grouping by status/priority/project, and configurable visible columns (also persisted). Full filter bar: search, project, assignee, status, priority, and date range. One-click clear-all-filters action. Permission-aware CSV export of currently filtered tasks.
- **Kanban Board** (`KanbanBoard.jsx`): Six status columns matching the task model. HTML5 native drag-and-drop (no unmaintained third-party DnD library). Optimistic UI updates with automatic rollback and `toast.error` on API failure. Accessible `<select>` status changer as keyboard/screen-reader alternative. Overdue card highlighting. Opens existing `TaskDetailsModal` on card click.
- **Timeline / Gantt View** (`TimelineView.jsx`): Sliding 14-day window with prev/next navigation. Task bars positioned by proportional start-to-due-date percentage within the visible window. Unscheduled tasks shown in a separate section with a "Set Dates" shortcut. No fabricated dependency bars (dependency tracking not yet implemented).
- **Calendar Page** (`CalendarPage.jsx`): Month, Week, and List view modes with prev/next/today navigation. Task pills on calendar cells with overdue/done/in-progress colour coding. Unscheduled tasks panel. Quick Reschedule modal calls `PUT /api/tasks/:id` and generates a `DUE_DATE_CHANGED` audit event. Project filter. Opens `TaskDetailsModal` on task click.
- **Management Reports Page** (`ReportsPage.jsx`): Completion rate KPI (formula documented in UI), 5 stat cards, project progress table with animated progress bars, employee workload table, logged-time summary, and overdue task attention list. Date presets (Last 7 / 30 / 90 days, All Time) and project filter. Dual CSV exports (workload breakdown + time-log detail). Role-scoped to requesting user's accessible data.
- **CSV Export Security**: All CSV generation is backend-only. Cells are sanitised via `sanitizeCsvCell` (prepends `'` to formula-trigger characters `=`, `+`, `-`, `@`, `\t`, `\n`) using `buildCsvString` in `backend/src/utils/csv.js`. Raw user content is never written directly to spreadsheet cells.
- **Silent Token Refresh**: The Axios instance in `api.js` intercepts any 401 from a non-auth endpoint, queues concurrent requests, and auto-calls `POST /api/auth/refresh`. On refresh failure it dispatches a global `auth:session-expired` window event that `AuthContext` uses to clear state and redirect to `/login`.
- **Timezone handling**: All dates stored in UTC in MongoDB. Calendar display uses the browser's native `toLocaleDateString()` for automatic local-timezone conversion — no third-party timezone library required.

---

## Phase 4 Implementation Summary

- **In-App Persistent Notifications**: Complete `Notification` model with deduplication keys, read tracking, and user-isolated query boundaries.
- **Real-Time Live Updates**: WebSocket layer via `Socket.IO` sharing the primary HTTP port, authenticated via JWT cookies/handshake, joining isolated user rooms (`user:${userId}`).
- **Durable Outbox Pattern**: Asynchronous email delivery via `NotificationOutbox` with automatic retry backoff, ensuring business operations (task edits, comments) never block or fail due to email downtime.
- **Email Service Abstraction**: Professional branded HTML & text notifications with Nodemailer, complete with graceful unconfigured fallback.
- **Scheduled Reminder Worker**: Recurring cron jobs scanning for overdue deliverables and upcoming 24-hour deadlines with deduplication keys to prevent spam.
- **User Preference Center**: Granular notification toggles for email delivery and notification types in User Settings.
- **UI Notifications Hub & TopNav Dropdown**: Dynamic badge counter, floating popover with one-click read actions, and dedicated full-page notifications management with filters and direct task navigation.
#   T a s k - M a n a g e r  
 