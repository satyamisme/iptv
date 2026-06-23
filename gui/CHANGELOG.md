# Changelog

All notable changes to this project will be documented in this file.

## [1.6.0] - 2026-06-17

### Added
- **Three-Tier Fuzzy Stream Checking**: Sequential verification layers: Layer 1 (fast HEAD connection test) -> Layer 2 (GET manifest/header check) -> Layer 3 (first 1024-byte fragment chunk streaming).
- **Multi-Source Loading & Swapping**: Added support to check multiple playlist checkbox entries and load/merge their channels concurrently.
- **Bulk Playlist Additions**: Add multiple M3U URLs at once (comma/newline separated) or upload multiple local files concurrently in the Settings view.
- **Preconfigured Official Sources**: Pre-populated settings with all official `iptv-org` sources (Index, Index NSFW, Country, Language, Category lists) containing 38,000+ channels.
- **Save State Preservation (Anti-Deletion)**: Merges status check updates into the database cache rather than overwriting the entire file, preserving verified states across playlist changes.
- **Safe Cache Clearing**: `/api/cache/clear` endpoint to remove raw API caches without deleting user-created custom channels, favorites, presets, or check results.
- **Auto-Collapse Navigation Sidebar**: Collapses sidebar automatically after selection to maximize the channel table layout.
- **Test Sandboxing**: Added automated settings backups during test runs to prevent test suites from overwriting user configuration states.

## [1.5.0] - 2026-06-17

### Added
- **StreamControl Pro Web Interface:** Migrated the legacy Tkinter GUI model to a Single Page Web Application (SPA) served by a local Flask server (`http://localhost:5000`).
- **Media Chunk Play-to-Verify:** Integrated HLS manifests and direct stream segment data verification. The stream checker now downloads and streams the first 1024 bytes of the video data before classifying status, ensuring actual media flow.
- **Persistent Database Caching:** Added `playlist_state.json` cache serialization which caches the parsed playlist and verified statuses. The console reloads the cached state directly on startup to prevent repeated scanning.
- **Manual Database Save:** Added a **Save Database State** button in the list actions panel.
- **Autosave Actions:** Duplicates removal, dead streams removal, and status updates trigger automatic checkpointing.
- **Autoplay Real-Time Status Updates:** Configured Successful playing/error events in the browser player to automatically update database and UI badges in real-time.
- **Hamburger Sidebar Toggle**: Added a manual toggle button in the top header bar to expand/collapse navigation sidebar.
- **Collapsible Grid Sections**: Configured collapsible CSS layout logic for filters panel and inspector sidebar to maximize main workspace.
- **Multi-Select Checkboxes**: Enhanced listbox elements for categories, countries, and languages filters with native checkboxes.
- **Edit & Add Streams Modals**: Created pop-up modal interfaces to add new stream listings manually and update existing stream headers/URLs.
- **Speed Optimization**: Upgraded Stream Checker execution worker pools to 150 threads and reduced link connection check timeouts to 3s.

### Fixed
- Fixed preset loading bug that incorrectly polled standard statistics instead of checking cached preset structures.
- Added query string stripping for HLS manifests to verify links that append tokens.
- Addressed table column squishing by enabling horizontal overflow.
- Resolved false-negative stream checker dead reports by defaulting header to standard Chrome User-Agent.

## [1.0.0] - 2026-06-16

### Added
- **MVC Architecture:**
  - `models`: Created classes for `Channel`, `Feed`, `Stream`, and `Playlist` to manage standard application state.
  - `controllers`: Created business logic controllers (`ApiClient`, `CacheManager`, `ExportManager`, `FilterEngine`, `DataProcessor`).
  - `views`: Created modular GUI components using Tkinter (`MainWindow`, `FilterPanel`, `ChannelTree`, `StatusBar`).
  - `utils`: Added helper functions for JSON loading/saving and API constants mapping.
- **Core MVP Features (Phase 1):**
  - Designed a basic UI split-panel interface with filters on the left and treeview results on the right.
  - Developed multi-threading data loader to fetch endpoints from `iptv-org.github.io/api`.
  - Added JSON caching logic with a 24-hour expiration threshold to reduce API request volume.
  - Formatted a Listbox-based filtering panel containing:
    - Search text filtering (real-time).
    - Languages selection.
    - Categories selection.
    - Countries selection (with dynamic channel counts formatted as `Country Name (count)`).
    - Checkboxes for NSFW toggling and excluding closed channels.
  - Wrote a parser module supporting internal JSON API models, raw M3U files, and raw M3U URLs.
  - Engineered the `FilterEngine` to provide quick set-based intersections matching selected criteria.
  - Implemented the `ExportManager` allowing users to save filtered channel records directly as `.m3u` playlists.
- **User Interface Extras:**
  - Implemented a right-click context menu within the channel treeview for direct copy-pasting of stream URLs to the clipboard.
- **Project Configuration:**
  - Generated `requirements.txt` listing `requests`, `typing-extensions`, and `python-dateutil`.
  - Configured `.gitignore` to keep runtime components (`__pycache__`, `cache/`, `logs.txt`) out of the repository.
  - Developed an automated Windows launch script `start.bat` that builds a virtual environment, installs PIP modules, and runs the UI automatically.
