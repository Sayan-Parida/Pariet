# Pariet

A browser extension that remembers your research trail, so you can pick up where you left off days later instead of starting over.

It records the pages you visit and searches you run while a session is open, then draws them as a map showing how you got from one to the next — and where you stopped.

<!-- Add a screenshot of the Research Map here. This is the first thing people see. -->

## Setup

### 1. Prerequisites

- Node.js 18 or newer
- Chrome or Edge

### 2. Build it

```bash
git clone https://github.com/Sayan-Parida/Pariet.git
cd Pariet
npm install
npm run build
```

This produces `extension/dist/`, which is the extension itself. There is no server to run and nothing to configure.

### 3. Load it into your browser

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Pick the `extension/dist` folder

Pariet now appears in your toolbar.

### 4. Using it

- Click the Pariet icon, type a topic if you like, and press **Start research**
- Browse normally. Everything you visit is recorded locally, and only while a session is open
- Press **End session** when you are done, or just close that window — the session ends on its own
- Press **Open Pariet** to see the map, timeline, and sources for that session
- The footer shows where you stopped, with a one-click **Restore research** to reopen every page you visited

## Features

- **Research map** — Session → Searches → Pages → Domains, as a graph you can click through. Three edge types (search → source, search → search, page → page) can each be hidden from the filter menu, which doubles as the colour key
- **Timeline** — everything that happened, in order, with times
- **Sources** — every page from the session, searchable and filterable by domain
- **Resume** — the page you stopped on, the search that led you there, and how many pages are ready to restore
- **Session archive** — all your past sessions, searchable by name, with page and search counts
- **Per-session layouts** — if you rearrange the map, it stays that way next time

## Your data stays on your machine

Everything is stored in your browser's local database. Pariet makes **no network requests** while recording — no account, no sync, no analytics, no third-party code. You can verify that in the source: the extension has no `fetch` calls at all.

What it records, and only while a session is open:

- Pages visited, searches run, and how you moved between them
- The time you spent on each page
- A session belongs to the browser window it started in, so your other windows are never mixed in

What it never records: incognito tabs, browser-internal pages, page content, form inputs, or anything you did outside a session.

To erase everything, use the trash icon in the sidebar.

## How it works

```
Chrome tabs  →  service worker  →  local database
                                     ↓
                            map · timeline · resume
                                     ↓
                              the dashboard
```

The raw event log is the source of truth; the map, timeline, and time-on-page figures are all derived from it. The service worker is the only thing that writes. The dashboard is bundled inside the extension and reads through it, so there is no server, no HTTP layer, and no configuration.

## Tech stack

- **Extension** — Manifest V3, TypeScript, webpack 5
- **Dashboard** — React 18, TypeScript, Vite 6, Tailwind CSS 4, React Flow with a custom deterministic layout

```
extension/   service worker, popup, local database, dashboard
frontend/    dashboard source (built into the extension)
```

## Contributing

Bug reports and pull requests are welcome. Open an issue on [GitHub](https://github.com/Sayan-Parida/Pariet/issues). If something looks wrong, a screenshot helps a lot.

## License

MIT — see [LICENSE](LICENSE).

## Note

Pariet is Chrome-only for now. Firefox does not support the Manifest V3 background service worker this extension relies on.
