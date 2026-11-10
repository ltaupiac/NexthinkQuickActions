# Changelog

## v1.0.7

- Fix: Restored selection NAQ menu in the new Nexthink Infinity interface introduced in 2026.9.
- Refactor: Refactored options management.

## v1.0.6

- Fix: Restore the cheatsheet toggle injection when the Nexthink Blue Bar navigation no longer exposes a menubar role.

## v1.0.5

- Feat: Copy selection now exposes quick toggles in the options UI, surfaces tooltips/badges, and supports Alt/Shift overrides to switch clipboard formats on the fly.
- Fix: CSV export now wraps values in quotes so embedded separators are handled correctly.
- Fix: Corrected pluralisation for the Quick Actions label in the UI.
- Fix: Removed the redundant floating “Add” button from the options page.
- Enhancement: Export preferences are now saved automatically as soon as you change the delimiter or clipboard format in the options page.
- Docs: README and Usage guide updated with modifier workflow details.
- docs: Managed configuration samples available in `docs/MDM-samples/`.

## v1.0.4

- Fix: Menu export buttons works with all tables.
- Fix: CSV/clipboard feedback messages are streamlined for better readability and reduced code complexity.
- Docs: README updated with the new `exportPrefs` options.
- Chore: Add some configuration profiles to in `managed-config-examples/`.

## v1.0.3

- Fix: Managed export preferences from policies now take precedence over sync defaults in the options UI.
- Fix: Tenant display names retain their original casing in the managed instance section.
- Fix: Some UI tweaks

## v1.0.2

- Feat: Added a selection export feature with two delivery modes: downloadable CSV (configurable delimiter) and clipboard copy (Markdown, ASCII, HTML).
- Fix: Limited Quick Actions menu injection to the Device View header kebabs to avoid duplicating entries elsewhere.
- Fix: Moved the "Add menu" button inside the Quick Action menu section so it aligns with the Nexthink instance layout.
- Docs: Expanded documentation (README/Usage) with extract feature details, project layout notes, ASCII font guidance, updated Workday example.

## v1.0.1

- Reworked instance editor with tenant prefix + region picker, live URL preview, and exposed `{instance_name}` token.
- `{instance_name}` is now validated, exported, and resolved across the app (menu filtering, placeholder replacement, docs).
- Added a template catalog with curated ServiceNow/Jamf/Workday actions and a selector modal.
- Introduced shared `instance-utils` helper to avoid duplicate prefix/region logic.
- Added global shortcut `Alt+Shift+Q` to open the popup.
- UI polish: stable two-column layout, green *Save* button, template button disabled when policies block edits.
- Documentation refreshed with new workflow details and ready-to-use URL samples.

## v1.0.0

- Initial public release.
