# Contributing to SP Poker

Thanks for considering a contribution! This is a small vanilla-JS Chrome extension, so the bar to contribute is low — no build tooling, no framework to learn.

## Getting started

1. Fork the repo and clone your fork
2. Follow [SETUP.md](SETUP.md) to create your own Firebase project and fill in `firebase-config.js` (copy from `firebase-config.example.js` — this file is gitignored, never commit your real credentials)
3. Load the extension unpacked in Chrome (`chrome://extensions` → Developer mode → Load unpacked)
4. Make your changes, reload the extension, test in the popup

## Guidelines

- Keep it dependency-free — no bundlers, no frameworks. Plain JS/HTML/CSS only.
- Match the existing code style (no semicolons-as-religion either way, just stay consistent with the file you're editing).
- Test the full flow manually before opening a PR: create a room, join from a second profile/incognito window, vote, reveal, confirm SP, check history.
- Don't commit `firebase-config.js`, `extension.zip`, or `.DS_Store`.

## Pull requests

- Keep PRs focused — one feature or fix per PR.
- Describe what you changed and why in the PR description.
- If your change affects the UI, include a before/after screenshot.

## Reporting bugs / suggesting features

Open a GitHub issue with steps to reproduce (for bugs) or a clear description of the use case (for feature requests).
