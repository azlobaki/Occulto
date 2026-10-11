# Occulto

**Hide, scramble or replace sensitive data on screen — before anyone sees it.**

Occulto is a browser extension for people who demo, present or share their screen with live data. It detects emails, IP addresses, phone numbers, IBANs, API keys and anything else you define, and hides them on every page in real time: blurred, covered with a black bar, replaced with realistic fake values, or rewritten with your own substitutions.

Everything runs locally. No account, no telemetry, no network calls.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Manifest V3](https://img.shields.io/badge/manifest-v3-5b6cf0.svg)
![Chrome / Edge / Brave](https://img.shields.io/badge/Chromium-supported-4285F4.svg)
![Firefox 128+](https://img.shields.io/badge/Firefox-128%2B-FF7139.svg)
![Languages](https://img.shields.io/badge/UI-English%20%7C%20Fran%C3%A7ais-lightgrey.svg)

---

## Contents

- [Highlights](#highlights)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Features](#features)
- [Security and privacy](#security-and-privacy)
- [Configuration reference](#configuration-reference)
- [Development](#development)
- [Limitations](#limitations)
- [Credits and license](#credits-and-license)

---

## Highlights

| | |
|---|---|
| **Four ways to hide** | Blur, solid black bar, keyed scramble (realistic fake values) and find → replace rules |
| **Pattern library** | 29 ready-made detectors (contact, network, finance, French identity numbers, secrets & tokens, crypto) with checksum validation |
| **Safe by design** | Never rewrites editable areas or form values, no flash of data on page load, covers iframes, tab titles and tooltips |
| **Built for demos** | Toolbar badge, audit mode that flags leaks, panic cover shortcut, per-site pause, profiles per client |
| **Text sandbox** | Paste any text and see exactly what a page would show, with an explanation for every change |
| **Private** | All settings stay in `chrome.storage.local`; the scramble key never leaves the browser |
| **Cross-browser** | One build produces Chrome (Chromium) and Firefox packages; English and French UI |

---

## Installation

Occulto is not yet published on extension stores. Build it from source (Node.js 22 or later):

```bash
git clone https://github.com/azlobaki/Occulto.git
cd Occulto
npm install
npm run build
```

The build produces:

| Output | Use |
|---|---|
| `dist/` | Chrome, Edge, Brave, Opera and other Chromium browsers |
| `dist-firefox/` | Firefox (unpacked) |
| `occulto-firefox.zip` | Firefox package (for signing or temporary install) |

**Chromium browsers** — open `chrome://extensions`, enable *Developer mode*, click *Load unpacked* and select `dist/`.

**Firefox 128+** — open `about:debugging#/runtime/this-firefox`, click *Load Temporary Add-on…* and select `dist-firefox/manifest.json`. Temporary add-ons are removed when Firefox restarts; for a permanent install, sign `occulto-firefox.zip` as an unlisted add-on on [addons.mozilla.org](https://addons.mozilla.org/developers/) (free), or use Firefox Developer Edition / Nightly with `xpinstall.signatures.required` set to `false`.

---

## Quick start

1. **Pin the extension** and click its icon: Occulto is active on every page by default and blurs detected emails and IP addresses.
2. **Add a replace rule** in the popup — e.g. `Acme` → `Contoso` with *Word* enabled — to rename a client everywhere.
3. **Open Full settings → Detection → Pattern library** and switch on what you need (phone numbers, IBANs, API keys…).
4. Before sharing your screen, click **Audit page** in the popup: anything that looks sensitive but is not hidden yet is highlighted in red, with a one-click fix.

Keyboard shortcuts (configurable in `chrome://extensions/shortcuts` or Firefox's *Manage Extension Shortcuts*):

| Shortcut | Action |
|---|---|
| `Alt+Shift+O` | Turn Occulto on / off |
| `Alt+Shift+H` | Cover the whole page instantly (press again to uncover) |

---

## Features

### Hiding modes

| Mode | What viewers see | Best for |
|---|---|---|
| **Blur** | The original text, blurred (strength scales with font size) | Quick, low-effort masking |
| **Black bar** | A solid block | Highest safety — short blurred strings can sometimes be reconstructed |
| **Scramble** | Realistic fake values derived from a secret key | Demos that must look real |
| **Replace rules** | Your own substitutions (`Acme` → `Contoso`) | Renaming clients, projects, people |

Choose Blur or Scramble in the popup and the hiding style (Blur / Black bar) in *Settings → General*. Replace rules always apply, in either mode.

**Type-aware scramble.** Emails become plausible addresses, IPv4/IPv6 stay valid addresses with the same structure, MAC addresses stay hexadecimal, card numbers stay Luhn-valid (same network digit and layout), IBANs keep their country and a valid checksum, phone numbers keep their `+33` / `06` prefix, domains and URLs keep their TLD, scheme and port. Generic text keeps its length, letter case and punctuation. The same input always gives the same output for a given key, so a page stays consistent across reloads and browser restarts.

**IP toggles.** *Always scramble IPv4 / IPv6* shows fake addresses even in Blur mode.

### Replace rules

Each rule has a *find* text, a replacement and three options:

| Option | Effect |
|---|---|
| **Aa** — Case sensitive | `Acme` no longer matches `acme` |
| **Word** — Whole word | Unicode-aware: `café` does not match inside `cafés` |
| **.\*** — Regular expression | Replacement may use `$1`…`$99`, `$&`, `$<name>`, `$$` |

Rules run top to bottom and the first match wins; the settings page warns when a rule can never match because an earlier one has the same search. If a replacement overlaps detected sensitive data (e.g. inside an email address), the stronger protection — blur or scramble — wins. Rules can be reordered by drag and drop, filtered, enabled/disabled/deleted in bulk, imported and exported as JSON.

### Pattern library

Switch detectors on in *Settings → Detection*. Patterns tagged **checksum** only hide values that pass a validity check; patterns tagged **may over-match** can also hide harmless text and are off by default.

| Category | Patterns |
|---|---|
| Contact | Email *(on by default)*, phone (France), phone (international) |
| Network | IPv4 and IPv6 *(on by default)*, MAC address, internal hostnames (`.local`, `.lan`, `.internal`, `.corp`…), domain names, URLs |
| Finance | IBAN *(mod-97 checksum)*, payment card *(Luhn checksum)* |
| Identity (FR) | Social security number — NIR *(key checksum)*, SIREN / SIRET *(Luhn)*, licence plate, dates |
| Secrets | Password in URL, JWT, Bearer token, AWS access key and ARN, GitHub / Slack / Stripe / Google API keys, private-key header, hashes, UUIDs |
| Crypto | Ethereum and Bitcoin addresses |

Custom patterns (name, regular expression, plain-language options *Match case / Multiline / Dot = newline / Unicode*), sensitive CSS selectors and exceptions are edited in the same section, with live validation. A raw JSON editor is available under *Advanced*.

### During a demo

- **Toolbar badge** — number of items hidden on the current tab; `II` when the site is paused, `OFF` when Occulto is off.
- **Audit page** — outlines everything hidden (blue = blurred, purple = scrambled, green = replaced) and highlights in red the data a library pattern would catch but that is not enabled, without modifying the page. *Hide these* enables the matching pattern. Run it before sharing: the highlights are visible to viewers.
- **Cover screen** — `Alt+Shift+H` or the popup button covers the whole page instantly.
- **Pause here** — disables Occulto on the current domain only (its iframes included); paused domains are managed in *Settings → General*.
- **Right-click menu** — on selected text: *always hide* it or *replace* it; anywhere on a page: *hide this element* (adds a CSS selector).
- **Profiles** — save rules, detection and display settings as named profiles (one per client or demo) and switch from the popup. Switching first saves the current settings into the active profile.

### Text sandbox

*Settings → Text sandbox* renders pasted text exactly as a page would — same detection, mode, IP toggles and replace rules, processed line by line like page text nodes. Counters show how many fragments were blurred, scrambled and replaced, each rule shows how many times it matched, and clicking a highlighted fragment explains it (which rule, which named pattern, or which IP toggle forced a scramble). *Copy result* copies the output with blurred parts turned into `█`. CSS selector rules do not apply in the sandbox (plain text has no elements).

---

## Security and privacy

### Data handling

- **No network access.** Occulto never sends data anywhere; it has no analytics and no remote configuration.
- **Local storage only.** Settings live in `chrome.storage.local`. Settings written to `chrome.storage.sync` by versions up to 1.1.0 are migrated once and removed from sync.
- **Secret scramble key.** 32 random bytes from `crypto.getRandomValues`, stored locally, never displayed (only an 8-character fingerprint), never exported. *Reset key* creates a new one; *Generate a new key on every browser start* is optional. The key is lost if the extension is uninstalled.

### Threat model

Scrambled values are derived with HMAC-SHA256 from the secret key. Without the key, a viewer — or anyone with a screenshot — cannot link a fake value back to the original by guessing candidates. What remains visible by design:

- generic text keeps its length, letter case and punctuation (word shape);
- type-aware scrambles keep their format (IPv6 group structure, card network digit, IBAN country, phone prefix, TLD).

Blurred text can sometimes be reconstructed when it is short and the font is known; prefer **Black bar** for short secrets.

### What Occulto never modifies

- **Editable areas** (Gmail compose, Notion, chat inputs, any `contenteditable`): their text is never rewritten, because it could be saved or sent. Sensitive words are covered by boxes drawn in a separate overlay layer instead.
- **Form values**: a field containing something to hide is blurred, never changed, and re-checked as you type.
- Text inside `<script>`, `<style>`, `<textarea>` and `<template>`.

Also covered: the tab title and the `title`, `alt`, `placeholder` and `aria-label` attributes, iframes (including `about:blank` / `srcdoc`), open shadow DOM, values split across inline formatting (`john@<b>acme</b>.com`), and content added dynamically by single-page apps. The page stays invisible until the first pass so nothing flashes while it loads (1.5 s failsafe).

### Permissions

| Permission | Why |
|---|---|
| `storage` | Save settings locally |
| `activeTab` | Let the popup read the current site (pause, counts, audit) |
| `contextMenus` | Right-click actions |
| Host access to all sites | Detect and hide data on the pages you visit |

---

## Configuration reference

Detection settings can be edited visually or as JSON (*Settings → Detection → Advanced*), and imported/exported:

```json
{
  "version": "1",
  "selectors": ["[data-sensitive='true']", ".ssn", ".credit-card"],
  "regex": [
    { "name": "Email", "pattern": "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", "flags": "gi", "preset": "email" },
    { "name": "Card", "pattern": "\\b(?:\\d{4}[ -]?){3}\\d{1,4}\\b", "flags": "g", "validator": "luhn" }
  ],
  "ignore": {
    "selectors": [".public-data"],
    "regex": [{ "pattern": "support@mycompany\\.com", "flags": "i" }]
  }
}
```

| Field | Description |
|---|---|
| `selectors` | CSS selectors whose whole element is hidden |
| `regex[]` | Text patterns: `pattern`, `flags` (`g` is always added), optional `name`, `validator` (`luhn`, `iban`, `nir`) and `preset` (library id) |
| `ignore.selectors` | Nothing inside matching elements is hidden |
| `ignore.regex` | Matching text is never hidden (only the matched part — the rest of the text is still checked) |

Ready-to-import examples are in [`examples/`](examples/) (financial, healthcare, SaaS/CRM).

> **Regex performance.** Patterns run on every text node of every page. A catastrophic expression such as `(a+)+$` can freeze tabs — test new patterns in the sandbox first.

---

## Development

```bash
npm install        # dev dependencies (TypeScript, ESLint, Prettier)
npm run build      # tsc + build.js → dist/, dist-firefox/, occulto-firefox.zip, _locales/
npm test           # build + unit tests (node:test, no extra dependencies)
npm run lint       # ESLint
npm run watch      # tsc --watch
```

### Architecture

TypeScript compiled as classic scripts (`module: None`) sharing one global scope — no bundler, no runtime dependencies. The content script and the settings sandbox render text through the same pipeline:

```
page text ──► OccultoPipeline (src/pipeline.ts)
               ├─ detection regexes + checksum validators ─► censor ranges
               ├─ exceptions (range-based)                 ─► drop exempted ranges
               ├─ replace rules (src/replacer.ts)          ─► replacement matches
               └─ buildFragments (src/fragments.ts)        ─► plain | blurred | scrambled | replaced
                                                                  │
                   content script (DOM spans, overlays) ◄─────────┴─────► sandbox (settings page)
```

| Path | Responsibility |
|---|---|
| `src/content.ts` | DOM integration: observers, shadow DOM, iframes, overlays, title/attributes, audit, panic cover |
| `src/pipeline.ts`, `src/fragments.ts` | Shared text pipeline |
| `src/replacer.ts` | Replace-rule compilation and matching |
| `src/scrambler.ts`, `src/crypto.ts` | Keyed, type-aware scramble (SHA-256 / HMAC-SHA256 in pure TypeScript) |
| `src/validators.ts` | Luhn, IBAN mod-97, NIR key |
| `src/library.ts` | Pattern library and leak scan |
| `src/storage.ts` | Local storage, migration, profiles |
| `src/background.ts` | Key management, shortcuts, context menus, toolbar badge |
| `src/popup.ts`, `src/options*.ts` | Popup and settings page |
| `src/i18n.ts`, `i18n/fr.json`, `tools/i18n.js` | Localization |
| `tools/manifest.js`, `tools/zip.js` | Firefox manifest and package generation |
| `test/unit/` | Unit tests; `test/demo.html` is a manual test page covering every feature |

### Localization

UI strings are written in English in the code (`OccultoI18n.t('…')`) and HTML (`data-i18n`). Translations live in `i18n/<lang>.json` as `{ "English text": "Translation" }`; `npm run build` generates `_locales/`, and `npm test` fails if a string is untranslated. To add a language, create `i18n/<lang>.json` with the same keys as `i18n/fr.json`.

---

## Limitations

- Content drawn on `<canvas>`, in images, videos or PDFs is not analysed.
- Closed shadow roots are not reachable by extensions.
- The browser address bar, tab favicons and native dialogs cannot be modified.
- Values split across block elements (e.g. two table cells) are not joined.
- Pages opened before installing or updating the extension must be reloaded.

---

## Credits and license

Occulto is a fork of [**Obscuro**](https://github.com/intezer/obscuro) by Intezer Labs, which introduced selector- and regex-based blurring and the first scramble mode. Occulto extends it with replace rules, keyed and type-aware scrambling, the pattern library, demo tooling, Firefox support and a redesigned interface.

Released under the [MIT License](LICENSE) — © 2025 Intezer Labs Inc. (original Obscuro project), © 2026 azlobaki (Occulto).

See [CHANGELOG.md](CHANGELOG.md) for the release history.
