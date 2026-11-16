# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Files inside Keychains, Preferences, Mail, Messages, Safari and the other protected folders could be moved to the Trash; only the folders themselves were protected. Everything inside them is now off-limits, as are `~/.ssh`, `~/.gnupg`, and the containers where Safari, Mail, Contacts and Notes keep their data.
- A Photos library could be moved to the Trash in two keypresses, and then deleted for good by emptying the Trash. Photos libraries and their contents are now blocked; delete photos in the Photos app instead.
- Items labeled `system` (Docker's disk, Ollama models, Homebrew) could be removed despite the label; they are now blocked, with the command to use instead. Tool-owned paths are recognized before other rules, so `/opt/homebrew/lib/node_modules` is no longer labeled `junk`, and `~/.ollama` itself is covered.

### Added

- Unit tests (`npm test`), run in CI.

## [0.1.0] - 2026-11-14

### Added

- Interactive disk view with a live dot-matrix meter, a category list and a folder browser you can dive into at any depth.
- Culprit finder: shows which nested folder or file holds most of a folder's space; `g` jumps straight to it.
- Labels on every item (`junk`, `unused`, `system`) with a one-line reason, plus a filter (`f`) to show only junk and unused.
- Last-used ages from Spotlight's last-opened dates, falling back to modification time.
- Reveal in Finder, move to Trash, and delete for good (caches and Trash only), each behind a second keypress.
- One-step clearing of caches and emptying the Trash.
- `--dry-run`, `--demo`, `--plain` and `--json` modes.
- `curl | sh` installer with `--version` and `--uninstall`.

[Unreleased]: https://github.com/govijr/fix-storage/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/govijr/fix-storage/releases/tag/v0.1.0
