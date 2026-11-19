# Local Lakex Notes

[![中文](https://img.shields.io/badge/-%E4%B8%AD%E6%96%87-red?style=flat-square)](README.md)
[![English](https://img.shields.io/badge/-English-blue?style=flat-square)](README.en.md)

[![release](https://img.shields.io/github/v/release/gtycoder/lakex-local-notes?label=release&color=2ea44f&style=flat-square)](https://github.com/gtycoder/lakex-local-notes/releases)
[![license 许可](https://img.shields.io/github/license/gtycoder/lakex-local-notes?style=flat-square)](LICENSE)
[![内核 kernel](https://img.shields.io/badge/%E5%86%85%E6%A0%B8%20kernel-Lakex%20v1.99.0%20vendored%20%E9%97%AD%E6%BA%90-orange?style=flat-square)](NOTICE)
[![platforms 平台](https://img.shields.io/badge/platforms%20%E5%B9%B3%E5%8F%B0-macOS%20%C2%B7%20Android-lightgrey?style=flat-square)](guide/README.md)
[![node 环境](https://img.shields.io/badge/node%20%E7%8E%AF%E5%A2%83-%E2%89%A5%2024-brightgreen?style=flat-square)](#environment-requirements)
[![downloads 下载](https://img.shields.io/github/downloads/gtycoder/lakex-local-notes/total?style=flat-square&label=downloads%20%E4%B8%8B%E8%BD%BD)](https://github.com/gtycoder/lakex-local-notes/releases)

[![editor 编辑器](https://img.shields.io/badge/editor%20%E7%BC%96%E8%BE%91%E5%99%A8-Lakex%20v1.99.0%20pinned-blue?style=flat-square)](docs/lakexEditor-developer-docs/)
[![sync 同步](https://img.shields.io/badge/sync%20%E5%90%8C%E6%AD%A5-S3%20%E5%85%BC%E5%AE%B9%20%C2%B7%20%E5%8D%8F%E8%AE%AE%20v3-blue?style=flat-square)](docs/SYNC-PROTOCOL.md)
[![guide 手册](https://img.shields.io/badge/guide%20%E6%89%8B%E5%86%8C-19%20%E7%AB%A0%20%C2%B7%2019%20chapters-informational?style=flat-square)](guide/README.md)
[![update 更新](https://img.shields.io/badge/update%20%E6%9B%B4%E6%96%B0-%E5%86%85%E7%BD%AE%E6%9B%B4%E6%96%B0%E4%B8%AD%E5%BF%83-informational?style=flat-square)](docs/UPDATE-CENTER.md)

> This English README is a translation of the Chinese README.md; the Chinese version is the source of truth and this file follows its updates. The user manual and docs are in Chinese.

**Local-first notes app built on the Yuque Lakex editor kernel (unofficial)** — macOS + Android; your local data is the single source of truth, S3 is only a multi-device mirror.

> Unofficial project, **not affiliated with Yuque / Ant Group**. The closed-source Lakex kernel is vendored and redistributed without authorization — use at your own risk, see `NOTICE`.

## 📖 User Manual

> **First time here? Start with the user manual → [guide/README.md](guide/README.md)** (5-minute quick start · UI overview · Lake documents / Sheets / Bitables / Boards / Quick notes / Diaries / AI assistant & AI Writing / cloud sync (including **the correct behavior of multi-device sync**) · moving to a new device & the portable package · update center · settings item by item · FAQ, with step-by-step screenshots for desktop and Android).

- Read online (GitHub): <https://github.com/gtycoder/lakex-local-notes/blob/master/guide/README.md>
- Read online (Gitee): <https://gitee.com/gtycoder/lakex-local-notes/blob/master/guide/README.md> (mirror repository; log in first if it is a private repo)
- In the app: the "Welcome" quick note / welcome document shown on first launch also links to it

## Project Introduction

Local Lakex Notes is a personal notes app that keeps its data with you: notes, Sheets, Bitables, Boards, and Quick notes are all stored locally (SQLite + files), while S3 (Qiniu Kodo / S3-compatible) is used only for multi-device backup and sync. There is no account system, no team collaboration, and no cloud dependency; writing and search work fully without a network.

**Five top-level spaces** (same names on both ends; switch on desktop with `⌘1`–`⌘5`): Knowledge base, Quick note, Tags, AI Writing, Diary (the closable AI Writing / Diary come last).

- Desktop: Electron 44 + React 18, macOS first
- Mobile: Vite + Capacitor, with Android as a production target
- Editors: Yuque Lakex (rich text), Univer (Sheets), in-house Bitable, Drawnix (Board), Ink pad
- Sync: local-first + tombstone-authoritative deletion (deletion overrides edits) + pull before push; conflicts are not merged — the overwritten side keeps a history snapshot

## Current Capabilities

**Editing & Documents**
- Notebooks / groups / document tree with drag-and-drop reordering and reparenting; **batch multi-select** (desktop ⌘/Ctrl + Shift, mobile long-press / selection mode): move (SiYuan-style folder tree dialog), move to Trash, apply tags
- Lakex rich text: headings, lists, to-dos, quotes, code blocks, formulas, columns, collapsible blocks, images, attachments, document references, Yuque bookmark cards (paste to import + card toolbar); images / videos can be resized by dragging edges and aligned
- Sheets (Univer): formula library, number formats, borders, merge, alignment, wrapping, freeze, sort, filter, find & replace, hyperlinks, cell notes, crosshair highlight
- Bitable (in-house): five views — table / kanban / gallery / calendar / form; field types, filter, sort, search, form draft staging, attachments and body detail
- Board (Drawnix, with a **custom material library** — you place files yourself in the data directory's `materials/` folder) and Ink pad (multi-page A4, page tab marks, in-page images / text blocks, pen / highlighter / eraser, undo & redo; **image page backgrounds**, **insert images / PDF** while editing, handwriting annotations, **PDF export**; on Android you can create one directly from the system share sheet and import a PDF)
- Quick notes: standalone timeline, tags, fast-path preview + read-only kernel fallback, convert to Lake document (**tags inherited**), per-item "Save and sync"
- **Diary**: standalone space (desktop ⌘5 / fifth slot in the mobile home Dock) — the data is still ordinary Lake documents ("Diary" notebook + title is the date + automatic year/month grouping); write today, browse history, search within the space; the Diary notebook is fixed and immutable, and single entries can be "converted to a Lake document / converted to a Quick note"; no tags, no missing-day reminders
- **AI Writing** (desktop ⌘4): standalone space — conversations / multi-document reasoning / prompt library / deep thinking; answers render in the kernel read-only view and can be generated into a Notebook or saved to Quick notes; conversations stay on the local machine only and are not synced
- **Space switching shortcuts**: ⌘1 Knowledge base · ⌘2 Quick note · ⌘3 Tags · ⌘4 AI Writing · ⌘5 Diary; Diary / AI Writing can be turned off (hides the top-level entry, does not delete data, does not block internal navigation)
- Document tags: tag from the properties panel, Tags space (read-only aggregation + tag management + jump), sidebar filtering by tag; mobile "Tags" top-level page (Tags space + management: create / rename / merge / delete / drag) + view and remove document tags
- **Import / export**: on desktop, "+ → Import" lists items by type — Markdown / Word (.docx) / Excel (.xlsx) / CSV (multi-select; Markdown images are materialized, frontmatter and remote images are downgraded, Word converts to Lake documents, Excel/CSV convert to Sheets); mobile system share accepts Markdown only (into the "Default Notebook"); batch export defaults to editable formats in one directory — Lake documents → Markdown bundle, Sheets → CSV, Bitables → CSV, Ink pads → PDF, Boards → PDF
- Sync log: a ledger of recent "overwritten / deleted on another device / disk changed during save" events (badge + list + one-click restore of the local version)
- Outline, history snapshots, Trash (soft delete + tombstone + restore marker), attachment and image management, full-text search (FTS5), edit locks (read-only, propagate with sync), an immediate read-only banner when a document open in an editor is deleted
- AI assistant: selection popover / top bar / block menu entries, text and images, PDF text extraction (the key stays in the main process)

**Sync & Storage**
- Local-first: SQLite + files are the single source of truth; S3 is only a mirror
- Tombstone-authoritative deletion: a deletion must propagate to every device; restore is the only explicit exception
- In conflicts the first committed version wins; the overwritten side automatically keeps a history snapshot; no merging
- Assets sync as a diff against the remote manifest; per-object probing is forbidden; concurrency is capped at 12
- S3 configuration can be exported on desktop and imported on the phone (encrypted transfer code `LLN1.`, a fallback measure only)

**UI & Engineering**
- In-house design system: `--lake-*` tokens, `ln-*` primitives, CSS `@layer` ordering, WCAG contrast gates
- Two independent UI layers for desktop / mobile, sharing `src/core` domain logic
- Repo-wide vitest + type checking + UI / style / build gates

## Tech Stack

- Desktop: Electron 44.9, React 18.3, TypeScript 5.9, Vite 8, better-sqlite3 13
- Mobile: Capacitor 8 (Android), Vite, native Kotlin plugins (files / secure storage / shortcuts / share / camera)
- Editors: `@dlient/lakex-doc-react` (imported privately in-repo; contains the Yuque Lakex kernel v1.99.0, included with the repository and build artifacts in vendored form), `@univerjs/*` 1.0.3 (exact pin), Drawnix, perfect-freehand
- Sync: `@aws-sdk/client-s3`, Qiniu Kodo (S3-compatible)
- Others: sharp (image conversion), unpdf (PDF text), write-excel-file (Excel export)

## Directory Structure

```text
.
├── electron/                 # Main process: windows / protocol / IPC / S3 / sync orchestration / AI / asset server
├── src/
│   ├── core/                 # Domain logic shared by both ends (no `node:` imports allowed)
│   ├── components/           # Desktop React components
│   ├── features/             # Editor, Sheets, Bitable, Board, Quick notes, AI…
│   ├── desktop/              # Desktop shell
│   ├── mobile/               # Android / Capacitor end (mb-* independent UI layer)
│   ├── hooks/ · lib/ · styles/
│   └── ...
├── android/                  # Capacitor Android project (Kotlin plugins)
├── vendor/lakex-doc-react/   # Lakex editor and its wrapper layer (vendored; distribution notice in NOTICE)
├── scripts/                  # Build, gates, e2e, style / mobile audits, sync tools
├── docs/                     # Handoff and specs (see "Documentation" below)
└── build/ · public/          # Icons, launch assets, fonts
```

## Data & Storage

**App Identity**

- Desktop appId: `com.lakexlocalnotes.desktop`
- Android applicationId / package name: `com.lakexlocalnotes.android`

**Local Data Directories**

| Purpose | Path |
| --- | --- |
| Development data | `~/Library/Application Support/lakex-local-notes-dev` |
| Production data | `~/Library/Application Support/lakex-local-notes` |
| Logs | `logs/lakex-local-notes.log` under the corresponding data directory |
| Android data | App-private directory (SQLite + body files) |

> ⚠️ The production data directory belongs to you alone; for development and testing, override it with `LAKE_USER_DATA` to a separate directory and **do not touch the production data**.

**Data Safety**

- Automatic backup: one copy per day by default (weekly optional), keep 7 copies / 300MB cap, `VACUUM INTO` + `quick_check` verification; entry at Settings → Backup & Restore (database only, no note bodies or assets)
- Restore from backup: verify the backup → quarantine the original database (not deleted) → replace → restart; when the database is corrupt, the startup recovery page offers "Back up and retry / Restore from cloud / Restore from backup / Open directory"
- Save version guard: when the on-disk body has been changed externally it **does not write to disk**, and shows a three-way dialog (Save a copy / Overwrite / Load the disk version)
- Crash loop → safe mode (skips auto sync and tab restore); the data health check can verify consistency, plus a manual "Rebuild data" (read-only scan → confirm rebuild)

**S3 Sync**

- Default object prefix `lakex-local-notes`; indexes are immutable content-addressed files, and assets sync as a diff against each document's asset declaration
- Sync order: pull the remote first (with conflict resolution) → then push the merged local state
- Turning cloud sync off = nothing is configured (no path touches the network)

**Two Ways to Move to a New Device**

- **Portable package** (offline full copy): desktop "Settings → Backup & Restore → Export portable package" produces a `.zip.lln` (≤4GiB, without history snapshots); on the phone use "Import from portable package (overwrite this device)", and the phone can also "Export portable package to a file" (into the system downloads directory, kept after uninstall); after that S3 only does incremental sync; works without S3 configured
- **S3 sync** (incremental): configure the same private bucket on both ends and turn on cloud sync on the new device to pull; if the database is corrupt, use "Restore from cloud" (does not upload local data)
- **Keeping data on Android uninstall**: on Android 10+ the system uninstall dialog offers "Keep app data" (`hasFragileUserData`; reinstalling requires the same signature and the same source)
- How to choose, and each option's boundaries and failure modes: [guide/18 Moving to a new device, portable package & migration](guide/18-portable-and-migrate.md) · spec [docs/PORTABLE-TRANSFER.md](docs/PORTABLE-TRANSFER.md)

## Environment Requirements

- **Node.js 24** (required; Vite 8 fails on older versions)
- npm, macOS (desktop), Android SDK + JDK 21 (mobile)
- Xcode Command Line Tools is recommended for macOS packaging

> ⚠️ This repository **contains** the closed-source Yuque Lakex kernel (`vendor/lakex-doc-react/`, `public/vendor/lakex-doc/`, `public/vendor/lakex/`, vendored). This project has **not obtained** authorization from Yuque / Ant Group; public distribution is at your own risk. If the rights holder requests it, distribution will stop and the related resources will be removed. See `NOTICE` for details.

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
node -v   # v24.x
```

## Install Dependencies

This repository already includes the closed-source Yuque Lakex kernel (vendored at `vendor/lakex-doc-react/`, `public/vendor/lakex-doc/`, `public/vendor/lakex/`), so just install:

```bash
cd <repo>
npm install
```

**Run `npm run setup:remotes` once after the first clone**: git remote configuration lives in each clone's own `.git/config` (**not committed and not carried over by cloning**). The script points `origin` to Gitee and `github` to GitHub, and makes `git push origin` push to both at once (the URLs are hardcoded in `scripts/setup-remotes.mjs`; change them there if the repos move).

Maintainers can use `npm run backup:lakex` to export the three sets of kernel artifacts as an archive outside the repository (default `../private/lakex-private-<stamp>.tar.gz` + `.json` metadata) for backup or device migration; `npm run setup:lakex` can restore from that archive.

## Local Development

```bash
npm run dev          # Vite(1421) + Electron (CDP 9222)
```

- Local asset server: dev `http://127.0.0.1:19877` / packaged `http://127.0.0.1:19876` (ports are fixed per build flavor with no fallback; `LAKE_ASSET_PORT` can override); web client (Settings → Web client): packaged `19880` / dev `19881`
- Mobile browser preview (UI / pure DOM logic only; the native bridge degrades):

```bash
bash scripts/mobile-preview.sh          # http://127.0.0.1:1422/preview.html
```

For Android (build / install / AVD / CDP / gates / tap conventions) see `docs/MOBILE-OPS.md`; device-level screenshots must use `adb exec-out screencap -p`.

## Tests & Gates

Run at least these for every change (the full vitest run includes perf gates; heavier perf tiers use manual scripts):

```bash
npx tsc --noEmit
npx vitest run
git diff --check
```

Style / build gates:

```bash
node scripts/ui-metrics.mjs
npm run check:core
npm run check:mobileui
npm run check:bundle
```

Visual and mobile device gates run in a targeted way depending on what changed (full conventions in `AGENTS.md` §3#21; current baselines in `docs/HANDOFF.md` §1).

## Build

### Desktop (macOS)

```bash
npx vite build
./node_modules/.bin/electron-builder --mac   # release/*.dmg / *.zip / *.app
```

Current builds are local, **unsigned and unnotarized**; distributing to others requires Apple Developer signing + notarization (see `docs/RELEASE.md`).

### Android

```bash
bash scripts/android-build.sh --sync           # Build debug APK
bash scripts/android-build.sh --sync --install # Build and install to a connected device
```

CI releases produce `assembleRelease` APKs **signed with the release keystore** (since v1.0.2): GitHub Secrets must define `ANDROID_KEYSTORE_BASE64` (base64 of the keystore; CI decodes it, then the workflow derives `ANDROID_KEYSTORE_PATH` and passes it to gradle — the PATH itself is not a secret name) / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`; if any is missing the build falls back to the debug keystore and is turned red by CI's signature check; for local release builds, inject the environment variables "`ANDROID_KEYSTORE_PATH` + the three passwords" directly (falls back to debug signing when not injected). The `debug` variant stays `debuggable=true` (for WebView debugging).

## Packaging & Release

- **GitHub Actions** is the recommended release path: **only pushing a tag** (e.g. `vX.Y.Z`) triggers packaging (ordinary pushes do not build and do not consume a macOS runner); it automatically publishes macOS `.dmg/.zip`, Windows `.exe`, and Android `.apk` to GitHub Releases; with `GITEE_TOKEN` configured it also uploads to Gitee releases
- You can also package locally: `npx vite build && npx electron-builder --mac` (for Windows packages prefer CI's `windows-latest`; the Linux target is not configured yet)
- ⚠️ Build artifacts **include the closed-source Lakex kernel** (already vendored in the repository); before public distribution (Release attachments), make sure you accept the corresponding risks — see `NOTICE`
- macOS packages produced by CI releases are **ad-hoc signed and unnotarized** (`mac.identity=-`); first launch needs right-click → Open; Windows shows a SmartScreen prompt, where you need "More info → Run anyway"
- Signing / notarization steps and the Actions release guide are in `docs/RELEASE.md`; release notes and the changelog share one source, [docs/RELEASE-NOTES.md](docs/RELEASE-NOTES.md) (a reverse-chronological collection of all versions; the top section = the current release notes)
- Built-in update center (check for updates / changelog / automatic check and download; stable releases only, **no silent install** — the user opens the installer after download; downloads are verified with sha256, and Android additionally verifies the signature)

## Documentation

| Entry | Content |
| --- | --- |
| [README.md](README.md) | Project overview (Chinese original of this file) |
| [docs/HANDOFF.md](docs/HANDOFF.md) | **The single handoff document**: current status / baselines / to-dos / pitfalls |
| [AGENTS.md](AGENTS.md) | **Long-term red lines and mechanisms** (must-read at session start) |
| [guide/README.md](guide/README.md) | **Chinese user manual** (step-by-step for desktop and Android, with screenshots) |

> **There is only one documentation index**: every explanatory document (architecture / sync / storage / kernel / Sheets / mobile / release / update center / portable package / Diary / AI Writing / troubleshooting…) is registered in [docs/HANDOFF.md §1 documentation map](docs/HANDOFF.md). Register new documents in that map first; do not maintain a second list here.

## Data & Privacy

- No accounts and no cloud login; data stays on the local machine by default
- S3 credentials are kept on the local machine (desktop safeStorage / Android Keystore) and are never written into note bodies or logs
- The inner encryption of the transfer code only guards against misreading and is **not a security boundary**; do not share it
- The repository contains no real note data or keys

## License & Acknowledgements

- This project's own code is **AGPL-3.0-only** (see `LICENSE` in the repository root); third-party components and exceptions are listed in `NOTICE`
- The Yuque Lakex editor kernel is a closed-source third-party artifact **included in this repository in vendored form**; the kernel is not covered by this project's copyright and cannot be relicensed by this project under AGPL. This project has not obtained authorization from Yuque / Ant Group; public distribution is at the distributor's risk, and the resources will be removed at the rights holder's request (see `NOTICE`)
- Some interface layouts and theme tokens were adapted from **SiYuan (AGPL-3.0)**; the related rules are folded into `src/styles/compat.css` / `kit.css`, and the attribution is kept in the app's Settings → About and in file headers
- Sheets: [Univer](https://github.com/dream-num/univer) (Apache-2.0, exact pin 1.0.3)
- Board: [Drawnix](https://github.com/plait-board/drawnix)
- Icons: [Lucide](https://lucide.dev) (ISC); a few icons come from IconPark (Apache-2.0, see `NOTICE` / `LICENSES`)
- Fonts: MiSans (Xiaomi, MiSans font license) · JetBrains Mono (SIL OFL 1.1)
- Reference: local mirror of the official Yuque Lakex editor documentation ([docs/lakexEditor-developer-docs/](docs/lakexEditor-developer-docs/))

## Disclaimer

This project is an unofficial tool for personal use, unaffiliated with Yuque / Ant Group; it provides no guarantees of service availability, data safety, or compatibility. Back up important data yourself before use.
