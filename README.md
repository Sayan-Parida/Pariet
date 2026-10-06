# Pariet

A browser extension that remembers your research trail, so you can pick up where you left off days later instead of starting over.

It records the pages you visit and searches you run while a session is open, then draws them as a map showing how you got from one to the next — and where you stopped.

## Setup

Both browsers install from the same codebase. There are no servers to run and nothing to configure.

### Option A — install the zip (no Node.js needed)

**Chrome/Edge:** grab `pariet-<version>.zip`, unpack it into a folder you won't delete (Chrome loads from that folder, so moving or deleting it breaks the install), then:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Pick the folder you unpacked

Chrome will keep pointing at that folder, so don't move it later. To update, unpack the newer zip and click the reload arrow on the extension card. Chrome also nags about developer-mode extensions on every restart — one dismiss and it works normally.

**Firefox:** Pariet has been submitted to [Firefox Add-ons](https://addons.mozilla.org/firefox/) and is currently under review — once approved, it installs straight from the store listing with no zip needed. Until then, load `pariet-<version>-firefox.zip` temporarily via `about:debugging` → This Firefox → Load Temporary Add-on. Note that temporary add-ons are removed when Firefox closes; the signed AMO install persists.

### Option B — build from source

If you want to read the code, change it, or build a specific commit.

#### 1. Prerequisites

- **Node.js 18 or newer** — tested with Node 24 and npm 11. Install from [nodejs.org](https://nodejs.org) or with [nvm](https://github.com/nvm-sh/nvm) (`nvm install 24`); npm ships with Node, so there is nothing else to install.
- **Any OS** — Windows, macOS, or Linux. The build is pure Node.js: no system packages, compilers, or services.
- Chrome, Edge, or Firefox (to run the result)
- Only if you zip the result on macOS/Linux: the `zip` command (`brew install zip` or your package manager). Building itself never needs it — Windows zipping uses the built-in `tar.exe`.

#### 2. Build it

```bash
git clone https://github.com/Sayan-Parida/Pariet.git
cd Pariet
npm install
npm run build
```

This produces `extension/dist/`, which is the extension itself. There is no server to run and nothing to configure.

To produce a zip to hand to someone else:

```bash
npm run package            # Chrome/Edge -> pariet-<version>.zip
npm run package:firefox    # Firefox     -> pariet-<version>-firefox.zip
```

Both write at the repo root. The Firefox build rewrites `dist/manifest.json` for AMO, so package the Chrome zip first if you run both — or just rebuild in between. `npm run package` never touches the manifest.

#### 3. Load it into your browser

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Pick the `extension/dist` folder

Pariet now appears in your toolbar.

#### Reproducing a release build (for add-on reviewers)

Store packages are the output of these commands run at a specific commit (the commit is named in the submission's reviewer notes):

```bash
git clone https://github.com/Sayan-Parida/Pariet.git
cd Pariet
git checkout <commit>
npm ci
npm run build
node scripts/firefox-manifest.mjs   # Firefox only; skip for the Chrome build
```

- `npm ci` installs the exact dependency versions pinned in `package-lock.json`.
- `npm run build` **is the build script**: it runs the dashboard build (Vite, `frontend/`) and the extension build (webpack, `extension/`), which together generate everything in `extension/dist/`.
- The last step rewrites `extension/dist/manifest.json` for Firefox (`background.scripts`, the `browser_specific_settings.gecko` block, and `data_collection_permissions`).
- `npm run package:firefox` runs all three steps and produces `pariet-<version>-firefox.zip` in one command; `npm run package` does the same for Chrome without the manifest rewrite.

Only files tracked in git are source. `extension/dist/`, `extension/dashboard/`, `node_modules/`, and `*.zip` are git-ignored build output and are never part of a source archive.

### Using it

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

## Browser support

Pariet works in **Chrome** (and other Chromium browsers like Edge) and **Firefox**.

- **Chrome/Edge** — Manifest V3 with a background service worker. Unzip `pariet-<version>.zip`, open `chrome://extensions`, turn on Developer mode, and use **Load unpacked**.
- **Firefox** — same code, packaged with `background.scripts` plus the required `browser_specific_settings.gecko` block (added automatically by `npm run package:firefox`, which writes `pariet-<version>-firefox.zip`). Submitted to Firefox Add-ons and under review; until it is approved, load it temporarily via `about:debugging` → This Firefox → Load Temporary Add-on.

The code makes no browser-specific assumptions: every API Pariet uses (`runtime`, `tabs`, `webNavigation`, `windows`, `storage`, IndexedDB) works in both.

## Note

Safari is not supported: it cannot load an unpacked extension from a zip, and distributing there requires Xcode plus an Apple Developer account.
