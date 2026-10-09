# Architecture and Technical Stack

## 1. System Flow
Yantri AI operates on a client-server-agent architecture to separate the UI, the AI reasoning engine, and the dangerous OS-level capabilities.

1. **Frontend (Overlay UI):** Renders the transparent, glassmorphic UI overlay on the desktop. Captures user audio and text inputs.
2. **Backend Node Server (`server.ts`):** Handles communication with the Google Gemini API, manages configuration (like API keys), and orchestrates requests between the UI and the Python Agent.
3. **Desktop Agent (`agent/`):** A privileged Python FastAPI service running locally that provides 70+ OS-level capabilities — browser automation, terminal execution, file management, desktop control — securely to the Node server via HTTP.

## 2. Directory Structure
```text
/
├── src/                  # React Frontend source code
│   ├── components/       # UI Components (Visualizer, Settings, Dashboard)
│   ├── lib/              # Utility functions, stores, and API wrappers
│   └── index.css         # Global Tailwind and animation styles
├── agent/        # Python OS-level Agent (FastAPI)
│   ├── backends/         # OS-specific implementations (linux_wayland.py, windows.py)
│   │   ├── base.py       # Abstract base classes
│   │   ├── factory.py    # Platform-aware backend selection
│   │   ├── linux_wayland.py  # Hyprland/Wayland implementation
│   │   └── windows.py    # Windows implementation
│   ├── tools_*.py        # Tool handlers (browser, terminal, files, etc.)
│   ├── registry.py       # Central tool registry + shared state
│   └── main.py           # FastAPI entrypoint
├── server.ts             # Express backend for Gemini AI and system orchestration
├── server_memory.ts      # Memory consolidation engine
├── server_profile.ts     # Role-based onboarding profile store + persona builder
├── server_userdata.ts    # Flexible user-data records (deadlines, notes, inventory...)
├── run_agent.py          # Agent bootstrap (loads .env, starts uvicorn)
└── public/assets/        # Cinematic video backgrounds and character webm files
```

## 3. Technical Stack
- **Frontend:** React, TypeScript, Vite, Tailwind CSS (v4), Framer Motion, Lucide React.
- **Backend:** Node.js, Express, Google GenAI SDK, WebSocket.
- **OS Agent:** Python 3, FastAPI/Uvicorn, Playwright (browser automation), Tesseract (OCR).
- **AI:** Gemini 3.1 Flash Live Preview (real-time voice + function calling).

## 4. Role-Based Onboarding & Feature Gating (V4)

First-run onboarding (`OnboardingGate.tsx`) collects: **email → role → features**.

- **Roles:** student / working professional / business owner.
- **Feature catalog:** `src/lib/profileTypes.ts` maps each role to selectable
  feature modules, and each module to the tools it unlocks.
- **Persona injection:** `server_profile.ts` appends a role-specific persona
  block (listing ONLY the selected modules) to the Gemini system instruction.
- **Tool gating:** the live-session function declarations are filtered to the
  tools allowed by the profile, so the model can only offer what the user chose.
- **User data records:** `server_userdata.ts` persists role-feature data
  (deadlines, notes, flashcards, attendance, meeting notes, inventory entries,
  supplier dues, feedback) to `userdata.json`, scoped by the onboarded email.
  Exposed to Gemini via `saveUserRecord` / `getUserRecords` /
  `updateUserRecord` / `deleteUserRecord`.
- **New agent tools:** `agent/tools/study.py` (startPomodoro, startFocusMode,
  stopFocusMode, getFocusStatus, extractDocumentText) and
  `agent/tools/spreadsheets.py` (writeSpreadsheet, appendSpreadsheetRows,
  readSpreadsheet, summarizeSpreadsheet, logInventoryEntry).

## 5. Automation Engines (V4)

Background sync engines react to user-data record mutations (`setOnRecordMutated`)
and run periodic sweeps on boot:

- **Deadline reminders** (`server_deadline_sync.ts`): every reminder-worthy
  record (deadline/exam/meeting/supplier/custom_reminder) gets EXACTLY ONE
  reminder (`dl-<recordId>`) that fires 24h before its due date (or immediately
  when already inside the window). Reschedules when the due date changes,
  cancels when the record is deleted. Inventory/notes are excluded.
- **Exam/Meeting/Deadline → Google Calendar** (`server_calendar_sync.ts`):
  saving a record of type `exam`, `meeting`, or `deadline` with a due date
  creates a matching Calendar event through the desktop agent (`[Exam] …` 3h /
  `[Meeting] …` 1h / `[Deadline] …` 1h; date-only dues become all-day events);
  updates patch the event, deletes remove it. INBOUND: exam-like events
  already on the user's calendar (keyword-matched titles) are imported into
  the Data Vault on WS connect and every 15 min — deduped by event id, with
  durable dismissal tombstones (`calendar_tombstones.json`) so dismissed
  imports never resurrect.
  The event id is stamped into the record payload (`calendarEventId`,
  `calendarSynced`) making sync idempotent; failures are recorded in
  `calendarSyncError` and retried by the 10-minute sweep (e.g. after the user
  completes Google OAuth setup).
- **Desktop-agent bridge** (`server_bridge.ts`): shared HTTP client for the
  Python agent (health probe, auto-spawn, 25s timeout, command logging) used
  by both the WS tool dispatch and the sync engines.
- **Voice email flow** (`server_email_draft.ts`): one spoken command →
  `draftEmail` parses the recipient (incl. spoken forms like "ravi at gmail dot
  com"), infers a subject and composes a body (Gemini, skeleton fallback);
  the user approves; `sendEmail` with no args sends the stored per-connection
  draft (single-use, 10-min TTL).
