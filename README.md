# Pariet — Your research, remembered.

**So you don't have to start over.**

Pariet is a local-first browser research tracker. Start a research session, do your
normal research in the browser, then stop. Later — days or weeks after — open Pariet
to see exactly where you stopped, how you got there, and pick up where you left off
instead of reconstructing everything from browser history, forgotten tabs, and memory.

Install the extension and it works. There is no server to run, no account, and nothing
leaves your machine.

## The problem

Research gets interrupted. When you come back to it, you face a pile of open tabs, a
generic browser history, and no memory of which pages mattered or what question you
were chasing. Rebuilding that context can take longer than the research itself.

Pariet preserves the research path as it happens: the searches you ran, the pages you
opened, how you navigated between them, and the page you stopped on. Returning to old
research feels like resuming, not restarting.

## What Pariet does

- **Research Sessions** — Start a named session from the popup, research normally, then
  end it. Sessions are listed in a searchable archive with status, dates, and
  page/search counts. A session ends when you end it, or when you close its window.
- **Research Map** — A visual graph of a session: Session → Searches → Pages → Domains.
  Nodes are selectable, the layout is deterministic, and positions you set are
  remembered per session. Three edge types (search → source, search → search, page →
  page) can each be hidden, and the filter menu doubles as the colour key.
- **Timeline** — A chronological record of the session: what happened, what was
  researched, and when.
- **Sources** — A per-session source list with text search, domain filtering, and a
  reader view.
- **Resume Research** — Every session shows where you stopped: the last meaningful page,
  its domain and last activity, the query that led there, and how many pages are ready
  to restore.
- **Restore Research Workspace** — One click reopens a session's pages as browser tabs,
  focused on the stopping point.
- **Session search** — Press `Ctrl/⌘+K` to search within the active session's pages and
  queries; the archive has its own title search that never disturbs the open session.

## The Research Map, simply

```
Session → Searches → Pages → Domains
```

Each session becomes a graph: the session node connects to the searches run during it;
searches connect to the pages they led to; pages group under their domains; navigation
between pages is preserved as relationships. Everything on the map is something actually
observed during research — Pariet records the journey, it does not invent conclusions
about it.

## Privacy

All research data lives in your browser's IndexedDB, on your device. The extension makes
**no network requests** while capturing or storing. There is no cloud account, no sync
server, no analytics, and no third-party runtime call of any kind.

The single declared host permission is `mail.google.com`, used only by the "Report an
issue" button, which opens a pre-filled draft in a new tab. Nothing is sent
automatically, and the report contains only what you typed plus app diagnostics. The
UI also uses locally installed system fonts rather than loading webfonts.

What Pariet captures (only while a session is active — nothing is recorded outside one):

- Tab opened, page visited, tab switched to, tab closed
- For each: event type, URL, page title, tab/window identifiers, timestamp
- Search queries, detected from search-engine navigation
- Per-URL dwell time, inferred from tab activation deltas
- A session belongs to the browser window it started in; activity in other windows is
  never attributed to it

What Pariet deliberately does **not** capture:

- Incognito tabs — skipped entirely
- Browser-internal pages (`chrome://`, `chrome-extension://`, `about:`, `edge://`,
  `devtools://`, `view-source:`, `file:`, `data:`) and Pariet's own dashboard
- Page body content, keystrokes, form inputs, or passwords
- Screenshots, cookies, or full browsing history imports

**Retention and erasure:**

- There is **no automatic deletion**. Nothing is pruned on a schedule: the archive is
  your research record, and only you decide what to discard.
- **Delete all data** in the sidebar erases every session, URL, search, and event.
- The data is **not encrypted at rest**. Anyone with filesystem, backup, or sync access
  to the browser profile can read it in cleartext. Use full-disk encryption
  (BitLocker/FileVault) if that matters to you.

## Architecture

```
Chrome tabs / navigation  (Manifest V3 service worker)
        ↓  write directly to IndexedDB
Research store (sessions, events, page visits, searches)
        ↓  derived, never stored
Mind map · Timeline · Resume point · Restore plan
        ↓  chrome.runtime messaging
Dashboard (React), bundled inside the extension
```

The raw event log is the backbone: the mind map, the timeline, and dwell-time
estimation are all derived from it rather than from the aggregated tables. The service
worker is the only writer, and the dashboard is an extension page that reads through it
over `chrome.runtime` messaging. There is no HTTP layer.

## Tech stack

- **Extension** — Manifest V3, TypeScript, webpack 5. Service-worker capture, popup
  session controls, IndexedDB persistence, and the bundled dashboard.
- **Dashboard** — React 18, TypeScript, Vite 6, Tailwind CSS 4, React Flow (XYFlow) with
  a custom deterministic layout engine.

## Project structure

```
extension/   Manifest V3 extension: service worker, popup, IndexedDB store, dashboard
frontend/    Dashboard source (built into extension/dashboard, then shipped with it)
scripts/     One-off maintenance utilities
```

## Local setup

Requirements: Node.js 18+ and Chrome or Edge.

```bash
npm install                 # root tooling
npm run build               # builds the dashboard, then the extension
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select the `extension/dist` folder.

Open Pariet from the popup to use it. Nothing else is needed.

For dashboard UI work, `npm run dev:dashboard` serves it on `http://localhost:5173`.
That page has no access to your research — read it through the extension instead.

## Design principles

- Simple to use.
- Difficult to break.
- Easy to trust.

## Status

Pariet is actively developed. The Research Map is the primary surface, and current work
focuses on reliable session capture and research continuity.
