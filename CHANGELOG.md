# Changelog

All notable changes to this project will be documented in this file.

Occulto is a fork of [Obscuro](https://github.com/intezer/obscuro) by Intezer Labs. Versions up to 1.1.0 are the upstream releases; 1.2.0 and later are Occulto releases.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Project renamed from Obscuro to **Occulto** (extension name, Firefox add-on id `occulto@azlobaki`, package `occulto-firefox.zip`). Scrambled values are unchanged for an existing key
- New logo (an eye behind a redaction bar) for the toolbar icon, popup and settings page

### Planned
- Chrome Web Store / AMO publication
- Export/import multiple configs

## [1.7.0] - 2026-10-11

### Added
- French interface: popup, settings, pattern library, toasts and the extension name follow the browser language (English otherwise). Translations live in `i18n/fr.json`; `npm run build` generates `_locales/` and a unit test fails if a string is untranslated
- Overlay mode for editable areas: instead of blurring the whole editor, only the sensitive words are covered by boxes drawn in a separate layer (the editor's DOM and styles are never touched); boxes follow typing, scrolling and resizing
- Values split across inline formatting are detected (`john@<b>acme</b>.com`, `06 12 <em>34 56</em> 78`); each piece is hidden, and the original markup is restored exactly when disabled

### Changed
- Faster processing on busy pages: sensitive selectors run as a single query, subtrees inserted in one batch are processed once, and storage changes that don't affect the page (profiles list, internal flags, pausing another site) no longer trigger a full re-scan

### Fixed
- Popup: the profile row no longer shows when there are no profiles, and the footer no longer overflows at popup width

## [1.6.0] - 2026-10-11

### Added
- Toolbar badge per tab: number of hidden items, `II` when the site is paused, `OFF` when Occulto is off
- Audit mode (popup → Audit page): outlines everything hidden (blue = blurred, purple = scrambled, green = replaced) and highlights in red data that a library pattern would catch but that is not enabled, without modifying the page (CSS Custom Highlight API). Each finding has a "Hide these" button that enables the matching pattern
- Profiles: save rules, detection and display settings as named profiles (e.g. one per client demo) and switch from the popup or Settings → General. Switching saves the current settings into the active profile first
- Right-click menu: "always hide" the selected text (adds a literal detection pattern), "replace" it (adds a rule and opens the rules editor), or "hide this element" (adds a CSS selector for the clicked element)
- Panic cover: `Alt+Shift+H` (or popup → Cover screen) instantly covers the whole page; press again to uncover

### Changed
- New permission: `contextMenus` (right-click menu)

## [1.5.0] - 2026-10-11

### Added
- Pattern library (Settings → Detection): 29 ready-made patterns you switch on with one click, grouped by Contact, Network, Finance, Identity (FR), Secrets and Crypto — French and international phone numbers, MAC addresses, internal hostnames, domains, URLs, passwords in URLs, IBAN, payment cards, NIR, SIREN/SIRET, French licence plates, dates, JWT, Bearer tokens, AWS keys/ARNs, GitHub/Slack/Stripe/Google keys, private-key headers, hashes, UUIDs, Ethereum and Bitcoin addresses. Patterns that may over-match are flagged and off by default
- Checksum validators: a match is hidden only if it passes Luhn (cards, SIREN/SIRET), IBAN mod-97 or the NIR key — no more random 16-digit numbers treated as cards. Shown as a "Checksum" badge on the pattern
- Type-aware scramble: MAC addresses stay hexadecimal, cards stay Luhn-valid (same network digit and layout), IBANs keep their country and stay valid, phone numbers keep their +country / 0X prefix, domains and URLs keep their TLD, scheme and port
- Sandbox sample text now covers phone, MAC, IBAN and card

### Changed
- Default Email/IPv4/IPv6 patterns are tagged as library presets (`preset` field); `RegexPattern` gains optional `validator` and `preset`

## [1.4.0] - 2026-10-10

### Security
- Editable areas (contenteditable, designMode — Gmail compose, Notion, chat boxes) are never rewritten any more: replace/scramble could have changed text you were about to send. An editable area containing something to hide is hidden as a whole, with styling only
- Form fields: values are never modified; a field holding detected data or a replace-rule term is hidden, re-checked as you type
- Exceptions ("Never hide text matching") now exempt only their own match instead of the whole text node — `support@mycompany.com, bob@client.com` no longer leaves bob's address visible. Sensitive elements are skipped only if exceptions cover all of their text
- No flash of sensitive data on page load: the content script runs at `document_start` and keeps the page invisible until the first pass (1.5 s failsafe)
- Iframes (including `about:blank`/`srcdoc`) are processed; pausing a site also pauses its iframes
- The tab title and the `title`, `alt`, `placeholder` and `aria-label` attributes are masked/replaced (blurred parts become █) and restored when disabled

### Added
- Hiding style setting (Settings → General): Blur, or Black bar (safer — short blurred strings can sometimes be reconstructed). Blur strength now scales with the font size

### Changed
- Disabling restores each element's original inline style exactly
- The popup reads page stats from the top frame only

## [1.3.0] - 2026-10-10

### Added
- Firefox support: `npm run build` now also produces `dist-firefox/` and `occulto-firefox.zip` (background scripts instead of a service worker, gecko settings)
- Keyboard shortcut `Alt+Shift+O` to turn Occulto on/off
- Per-site pause ("Pause here" in the popup, paused-sites list in settings)
- Popup: master switch, Blur/Scramble segmented control, live counts of blurred/scrambled/replaced items on the page, shortcut hint
- Settings page redesign: sidebar navigation, toasts with Undo, save-state indicator
- Replace rules: drag & drop reordering, filter, bulk enable/disable/delete, per-rule match counts from the sandbox, duplicate-rule warnings
- Visual detection editor (named patterns, selectors and exceptions with live validation); raw JSON moved under "Advanced"
- Regex flags shown as toggles (Match case, Multiline, Dot = newline, Unicode) with explanations instead of a raw `gi` field
- Sandbox: sample text, fragment counters, click a fragment to see which rule or pattern produced it
- Shared design tokens (`ui-tokens.css`), inline SVG icons, polished dark mode

### Changed
- Manifest uses `options_ui` (open in tab) and requests `activeTab` so the popup can read the current site
- Default detection patterns are named (Email, IPv4, IPv6)
- Options page split into focused modules (`options-kit`, `options-rules`, `options-detection`, `options-sandbox`)

## [1.2.0] - 2026-10-09

### Added
- Replace rules: user-defined find → replace rules applied to page text, independent of Blur/Scramble mode
  - Case sensitive, whole word (Unicode-aware) and regex options
  - Regex replacements support `$1`…`$99`, `$&`, `$<name>` and `$$` templates
  - Rules are applied in list order; earlier rules win
- Keyed scramble: scrambled values are derived with HMAC-SHA256 from a locally generated secret key
  - "Reset key" button (with confirmation) and optional new key on every browser start
  - Key fingerprint shown in the UI; the key itself is never displayed or exported
- "Always scramble IPv4" and "Always scramble IPv6" toggles: detected IPs are scrambled even in Blur mode
- Options page (opened in a tab) with General, Replace rules (with import/export), Text sandbox, Scramble and Detection rules (advanced) sections
- Text sandbox on the options page: live preview of how text is obscured, including replace rules and IP toggles
- Popup replace-rule list with quick-add row and an "Open full settings" button

### Changed
- Detection config JSON editor moved from the popup to the options page
- Settings are stored in `chrome.storage.local` instead of `chrome.storage.sync`; existing values are migrated automatically on first run
- Scramble output now uses the keyed generator; the same input gives different output for a different key
- Fragment processing is shared between the content script and the text sandbox
- Replace matches that overlap detected sensitive data are dropped, so blur/scramble always wins

### Fixed
- Default IPv6 detection pattern matched compressed addresses only partially (for example `fe80::1` as `fe80::`), leaving trailing groups visible; existing installs are migrated automatically
- Zero-length regex matches with the `u` flag no longer hang the page on astral characters (emoji)
- Generic scramble now also replaces non-ASCII letters (any script) and digits instead of leaving them in clear
- A failed sync-storage migration no longer persists the default config over the user's synced settings
- Content script no longer re-processes the plain text nodes it creates itself

### Security
- Scrambled output can no longer be linked back to the original by brute force without the secret key
- All settings and the scramble key stay on the device (`chrome.storage.local`); nothing is synced
- No network calls, remote resources or runtime dependencies

## [1.0.1] - 2025-11-07

### Changed
- Removed unused `activeTab` permission from manifest to comply with Chrome Web Store policies

## [1.0.0] - 2024-10-26

### Added
- Initial release
- CSS selector-based element blurring
- Regex pattern matching for text content
- Ignore rules for selectors and regex
- MutationObserver for dynamic content support
- Popup UI for configuration management
- Import/Export configuration functionality
- Enable/Disable toggle
- TypeScript implementation
- ESLint and Prettier configuration
- Example configurations for SaaS/CRM, Healthcare, and Financial use cases
- Comprehensive documentation
- MIT License
- Security policy
- Privacy-first design (no data collection)

### Features
- **Content Script**: Intelligent blurring with MutationObserver
- **Popup Interface**: User-friendly configuration editor
- **Default Config**: Pre-configured email regex pattern
- **Idempotency**: Prevents re-wrapping of already censored content
- **Performance**: Efficient DOM traversal and text processing
- **Customizable**: Full control over blur targets via JSON config

### Technical Details
- Manifest V3 compliance
- TypeScript 5.4
- Chrome Extension APIs
- WeakSet for processed node tracking
- Regex compilation and caching
- Fragment-based text replacement

---

## Version History

### Version Numbering
- **Major** (1.x.x): Breaking changes or major feature additions
- **Minor** (x.1.x): New features, backwards compatible
- **Patch** (x.x.1): Bug fixes and minor improvements

### Support
- Each major version is supported for 1 year after release
- Security patches are backported to supported versions
- Latest version always recommended

---

## How to Update

### From Chrome Web Store
Updates are automatic! Chrome will update the extension in the background.

### Manual Installation
1. Pull the latest changes: `git pull origin main`
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Reload the extension in `chrome://extensions/`

---

## Migration Guides

### Migrating to 1.0.0
This is the initial release. No migration needed!

---

## Deprecation Notices

*No deprecations at this time.*

---

## Links

- [GitHub Repository](https://github.com/azlobaki/Occulto)
- [Issue Tracker](https://github.com/azlobaki/Occulto/issues)
- [Documentation](https://github.com/azlobaki/Occulto#readme)
- [Chrome Web Store](https://chrome.google.com/webstore) (coming soon)

---

**Note**: For security vulnerabilities, please see our [Security Policy](SECURITY.md) instead of creating a public issue.
