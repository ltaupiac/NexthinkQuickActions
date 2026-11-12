# Nexthink Quick Actions

Nexthink Quick Actions is a Chrome/Edge extension that augments the Nexthink web console with configurable shortcuts. It lets support teams open downstream tools (ServiceNow, JAMF, Workday, etc.) straight from a device or user row, while keeping the configuration manageable through both an options UI and enterprise policies.

## What the extension delivers
- **Context menu quick actions** – injects a "Quick Actions" submenu in Nexthink kebab menus (Device View and Investigations). Entries open new tabs using placeholders that are resolved from the selected row.
- **Browser action popup** – provides a compact launcher that jumps directly to Device View for a device name, with a shortcut to the settings page when the instance is not yet configured.
- **Cheat-sheet toggle** – adds a QuickActions icon to the Nexthink top menubar that reveals a panel listing all detected column placeholders, with one-click copy to help authors build URLs.
- **Friendly configuration surface** – an options page to maintain the Nexthink instance URL, manage quick action rows, reorder entries, tune export preferences, and import/export JSON bundles.
- **Investigation export helpers** – augments the bulk-selection toolbar with NQA-branded actions to copy selected rows (Markdown, ASCII, or HTML) or download a CSV using your preferred separator.
- **Policy-driven deployment** – supports Chrome managed storage, including overlay vs seed modes, so administrators can pre-load and lock tenant settings and menu entries. In overlay mode, they can also provide default export preferences that users can override. Sample payloads and deployment scripts are available in `docs/MDM-samples/`.

## Configuration workflow
### Accessing the options page
- From the browser toolbar popup, click the cog icon (or `Add Nexthink instance`) to open `option/options.html`.
- The first section stores the Nexthink **Instance** via a guided builder: provide the tenant prefix and select the Nexthink region, and the UI composes `https://<tenant>.<region>.nexthink.cloud`. The preview also shows `{instance_name}` alongside the resolved prefix so authors can copy both pieces easily.
- The **Quick Actions** section maintains the menu entries consumed by the content script. Each entry is a name and a URL template that must contain at least one placeholder such as `{devices_name}`, `{*full_name}` or the tenant token `{instance_name}`.

### Editing quick actions
- Click **Add entry** to create a new row or the pencil icon to edit an existing one. Rows can be reordered with the up/down arrows; managed entries show the lock state and disable editing when policies require it.
- URL templates accept multi-line input for readability; line breaks are stripped before injection.
- The helper text explains the placeholder syntax. Validation ensures the template is `http(s)://` and contains at least one `{placeholder}` token. Wildcards (`*`) inside placeholders act as glob-like patterns matched against captured column keys.

### Export settings, import/export, and JSON format
- Use the *Export settings* card to choose the CSV separator used during downloads and the clipboard format (`HTML table`, `Markdown`, `ASCII table`, or `TSV`) applied when copying selections from Investigations. The *Quick toggles* hint shows which formats `Alt` and `Shift` select temporarily. Each copy action also has a format selector for a one-time override; TSV uses tab-separated text for spreadsheet pasting.
- Use the toolbar buttons to export the current configuration to `NQA_Configuration.json` or import another JSON document. The modal lets you **Add** (append) or **Replace** the existing menu, and optionally override the instance when provided. Imported export preferences are restored with either choice when present; older files without `exportPrefs` leave the current preferences unchanged. User preferences and imported values take priority over administrator-provided export defaults.
- The expected structure matches `debug/NQA_Configuration+wildcard.json`:
  ```json
  {
    "menu": [{ "name": "Open in ServiceNow", "url": "https://…{devices_name}…" }],
    "instance": { "name": "PROD", "url": "https://corp.eu.nexthink.cloud" },
    "exportPrefs": { "csvDelimiter": ",", "clipboardFormat": "html" }
  }
  ```

### Chrome managed policies
- The storage layer (`option/lib/config-store.js`) reads both `chrome.storage.sync` (user data) and `chrome.storage.managed` (enterprise policy).
- Policies accept two modes:
  - **Overlay** (default): managed entries are merged into the user list. Flags `allowUserEntries` and `lockManagedEntries` control whether users may add/edit their own entries.
  - **Seed**: managed data seeds the user profile once. With `seedReplace=true`, it overwrites any existing configuration on first load.
- For Chrome Enterprise or macOS deployment, adapt `docs/MDM-samples/Chrome_Work1.mobileconfig` by replacing the placeholder extension ID (`XXXXXXXX`). The managed payload sets the instance, menu, and export preferences under `ExtensionSettings`.
- The same directory also contains Intune remediation/compliance scripts (`NQARemediation.ps1`, `NQAChecking.ps1`) that align with the managed schema.
- See the [managed policy behaviour matrix](docs/managed-policy-matrix.md) for detailed combinations and their impact on end users.

## Runtime behaviour in Nexthink
### Quick Actions submenu
- The content script (`content.js`) observes Nexthink menus to locate kebab action panels on Device View and Investigations screens.
- When a menu opens, the script resolves the controlling row/button, extracts the currently selected column (`window.nqaPlaceHolder.columnName`), filters configured entries for matching placeholders, and injects a native-looking submenu.
- Clicking a quick action opens the resolved URL in a new tab. The submenu closes automatically and tracks focus state so multiple menus cannot overlap.
- The submenu header now displays the Nexthink Spark icon between separators to clearly distinguish native actions from extension-provided entries.

- When rows are selected in Investigations, the Nexthink selection toolbar is enhanced with the Spark icon followed by **Copy selection** and **Download CSV**.
- The copy action respects the clipboard format defined in the options page; hold `Alt` or `Shift` while clicking to temporarily switch to the alternate formats shown in the options card. Use the adjacent format selector to copy once in any of the four formats without changing the default. A small indicator appears next to the button when a modifier is active.
- The CSV action always uses the configured delimiter.
- Toast notifications confirm the number of exported rows and now mention the clipboard format when a modifier override is used. They also signal when the limit (default 200) truncates the selection.
- When using the ASCII clipboard format, paste into a monospaced font (Courier, Consolas, Monaco, Menlo, etc.) to preserve the table grid. TSV is suited to spreadsheet pasting; choose HTML when pasting into rich-text clients such as Outlook.

### Placeholder resolution
- During injection, placeholders such as `{devices_name}` or wildcard forms like `{*full_name}` are replaced with the values exposed by `window.nqaPlaceHolder.rawValues`.
- Placeholders without a matching key remain untouched, which keeps URLs predictable during troubleshooting.

### Cheat-sheet toggle and panel
- `content-cheatsheet.js` watches for the Investigations context. Once active, it clones the Nexthink menubar structure to append a **QuickActions** icon with a toggle state.
- The floating panel lists every column detected in the current table along with its normalized placeholder (e.g. `{devices_name}`). Copy buttons and toast notifications simplify building URLs for new actions.
- A dark-mode friendly stylesheet (`#nqa-cheatsheet-style`) keeps the panel visually aligned with the Nexthink UI.

## Browser action popup
- `popup/popup.js` loads the shared store, checks whether an instance exists, and adjusts the UI accordingly:
  - When configured, the form accepts a device name and opens Device View at `/sup/device/search/{query}` in a new tab.
  - When no instance is found, the popup shows a call-to-action that opens the options page.
- Storage listeners update the popup live after changes in the options page.
- A global shortcut (`Alt+Shift+Q` by défaut sur Windows et macOS) ouvre aussi le popup et peut être ajusté via `chrome://extensions/shortcuts`.

## Project layout
- `manifest.json` – entry point (MV3) declaring content scripts, popup, options page, and managed schema.
- `option/` – options experience assets (HTML, CSS, dialogs)
- `option/lib/` – reusable controllers for the options UI (`config-store`, `menu-entries-controller`, `instance-section`, `import-export-toolbar`).
- `content.js` – main injector for row menus and submenu creation.
- `content-cheatsheet.js` – Investigations placeholder helper + menu toggle.
- `popup/` – browser action markup, styles, and logic.
- `icons/` – Spark logos and extension icons referenced by the manifest and injected menus.
- `docs/` – supplementary documentation (policy behaviour matrix, MDM deployment samples in `MDM-samples/`, etc.).

## Getting started
1. Load the folder as an unpacked extension in Chrome/Edge (`chrome://extensions` → Developer mode → Load unpacked).
2. Configure the Nexthink instance and quick actions via the options page, or use the **Templates** button to bootstrap a few example entries.
3. Open a Nexthink Device View or Investigation, trigger the kebab menu, and use the "Quick Actions" submenu to launch downstream tools.
4. Use the QuickActions toggle in the menubar to review available placeholders while authoring new links.

## Troubleshooting tips
- If the submenu does not appear, confirm that the column you are using has a matching placeholder in your URL template. The cheat-sheet panel shows the exact keys the script detects.
- Managed policies override user settings depending on the chosen mode. Inspect `chrome://policy` to verify the payload applied by your organization.
- The options page surfaces validation errors inline (invalid URLs, missing placeholders). Correct them before saving.
