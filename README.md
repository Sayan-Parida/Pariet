# Pariet — Your research, remembered.

**So you don't have to start over.**

Pariet is a local-first browser research tracker. Start a research session, do your normal research in the browser, then stop. Later — days or weeks after — open Pariet to see exactly where you stopped, how you got there, and pick up where you left off instead of reconstructing everything from browser history, forgotten tabs, and memory.

## The problem

Research gets interrupted. When you come back to it, you face a pile of open tabs, a generic browser history, and no memory of which pages mattered or what question you were chasing. Rebuilding that context can take longer than the research itself.

Pariet preserves the research path as it happens: the searches you ran, the pages you opened, how you navigated between them, and the page you stopped on. Returning to old research feels like resuming, not restarting.

## What Pariet does

- **Research Sessions** — Start a named session from the browser extension popup, research normally, then end it. Sessions are listed in a searchable archive with status, dates, and page/search counts.
- **Browser extension** — A Manifest V3 extension that records research activity (tab opens, page visits, tab switches, tab closes) and sends it to the local backend as session-scoped events. It queues events locally when the backend is unreachable and syncs when it returns.
- **Research Map** — A visual graph of a session: Session → Searches → Pages → Domains. Nodes can be selected for details, the layout is deterministic, and node positions you set are remembered per session.
- **Timeline** — A chronological activity record of the session: what happened, what was researched, and when.
- **Sources** — A per-session source list (title + domain) with text search, domain filtering, and a reader view that opens the original page.
- **Resume Research** — Every session shows where you stopped: the last meaningful page, its domain and last activity, the query context when available, and how many pages are ready to restore.
- **Restore Research Workspace** — One click reopens a session's pages as browser tabs (via the extension), focused on the stopping point.
- **Session search** — Press `Ctrl/⌘+K` (FIND) to search within the active session's pages and queries; the session archive has its own title search that never disturbs the open session.
- **Session management** — Rename, track, and delete sessions from the archive.
- **Local-first behavior** — The backend, database, and extension all run on your machine. The frontend keeps working from locally stored data when the backend is down, and the extension retries queued events until they are delivered.

## The Research Map, simply

```
Session → Searches → Pages → Domains
```

Each session becomes a graph: the session node connects to the searches run during it; searches connect to the pages they led to; pages group under their domains; navigation between pages is preserved as relationships. Everything on the map is something actually observed during research — Pariet records the journey, it does not invent conclusions about it.

## Privacy

The research backend, database, and browser extension run locally on your machine. The extension talks only to `http://localhost:8080`, and all data lives in a local SQLite file. There is no cloud account, no sync server, no analytics, and no third-party request of any kind — the UI uses locally installed system fonts rather than loading webfonts.

**Network exposure:** the backend binds to `127.0.0.1` only (`server.address` in `application.properties`), so it is unreachable from other devices on your network. It has no authentication, so treat the port as trusted-local: do not change that bind address or expose the port by forwarding.

What Pariet captures (only while a session is active — nothing is recorded outside a session):

- Tab opened, page visited, tab switched to, tab closed
- For each: event type, URL, page title, tab/window identifiers, timestamp
- Search queries, detected from search-engine navigation
- Per-URL dwell time, inferred from tab activation deltas
- A session belongs to the browser window it was started in; activity in other windows is never attributed to it

What Pariet deliberately does **not** capture:

- Incognito tabs — skipped entirely
- Browser-internal pages (`chrome://`, `chrome-extension://`, `about:`, `edge://`, `devtools://`, `view-source:`, `file:`, `data:`)
- Page body content, keystrokes, form inputs, or passwords
- Screenshots, cookies, or full browsing history imports

**Retention and erasure:**

- Events, pages and searches are pruned after 90 days; finished sessions after 365 days (`app.retention.*`). The sweep runs daily; active sessions are never pruned.
- **Delete all data** in the sidebar erases every session, URL, search and event, and also clears the browser's localStorage mirror. Deleted rows are zeroed (`PRAGMA secure_delete`) and the file is compacted, so the data is not merely unlinked.
- The database is **not encrypted at rest**. Anyone with filesystem, backup or sync access to `backend/data/` can read the history in cleartext. Use full-disk encryption (BitLocker/FileVault) for that.
- The history is stored twice on disk: in SQLite and, as an offline fallback, in the browser's localStorage. Deleting all data clears both.

## Architecture

```
Browser Extension (capture: tabs, navigation, searches)
        ↓  POST /api/events (queued locally when offline)
Research Session (SQLite)
        ↓  ingestion + graph building
Searches / Pages / Navigation
        ↓
Research Graph (deterministic layout)
        ↓
Map / Timeline / Sources (React frontend)
        ↓
Resume ("you stopped here") / Restore (reopen tabs)
```

## Tech stack

- **Backend** — Java 17, Spring Boot 3, Spring Data JPA, SQLite (file database), Maven, JUnit test suite
- **Frontend** — React 18, TypeScript, Vite 6, Tailwind CSS 4, React Flow (XYFlow) + Dagre for the graph canvas
- **Extension** — Manifest V3, TypeScript, webpack; service-worker background capture, popup session controls, content-script bridge to the web app

## Project structure

```
backend/     Spring Boot API + SQLite persistence (port 8080)
frontend/    React + Vite web app (port 5173, proxies /api to the backend)
extension/   Manifest V3 browser extension (TypeScript, built with webpack)
```

## Local setup

Requirements: Java 17 and Maven for the backend; Node.js for the frontend and extension; Chrome or Edge for the extension.

**1. Start the backend** (from the repo root):

```bash
cd backend
mvn spring-boot:run
```

This starts the API on `http://localhost:8080` using the SQLite file at `backend/data/trak.db`.

**2. Start the frontend** (new terminal, from the repo root):

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. API calls are proxied to the backend automatically.

**3. Build and load the extension:**

```bash
cd extension
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose "Load unpacked", and select the `extension/dist` folder. Use the extension popup to start and end research sessions.

**4. Run the tests:**

```bash
cd backend
mvn test
```

## Design principles

- Simple to use.
- Difficult to break.
- Easy to trust.

## Status

Pariet is actively developed. Current work is focused on reliable session capture and research continuity, with the Research Map as the primary surface.
