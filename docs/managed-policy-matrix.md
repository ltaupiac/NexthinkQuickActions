# Managed Policy Behaviour Matrix

The table below summarises how the extension behaves under each managed configuration scenario. Default values are noted where applicable.

| Mode    | allowUserEntries | lockManagedEntries | seedReplace | Initial user-facing state | Managed entries (actions) | User entries | Instance in UI | Notes |
|---------|------------------|--------------------|-------------|---------------------------|---------------------------|--------------|----------------|-------|
| overlay | `true` (default) | `true` (default)   | n/a         | Managed menu items plus any existing personal items (deduplicated). | Locked icon; no edit, delete, or reorder actions. | Visible and fully manageable (add/edit/delete). | Locked icon; read-only. | Most common deployment: administrators define a baseline while users keep their own shortcuts. |
| overlay | `true`           | `false`            | n/a         | Same as above. | Action buttons enabled; changes are overwritten on the next policy refresh. | Visible and fully manageable. | Normal icon; user edits are overwritten by policy. | Allows temporary overrides but they do not persist. |
| overlay | `false`          | `true` (default)   | n/a         | Only managed entries are shown. | Locked icon; no actions. | “Add” button disabled; existing personal entries stay hidden (still stored). | Locked icon; read-only. | Full lockdown: menu is entirely controlled by policy. |
| overlay | `false`          | `false`            | n/a         | Only managed entries are shown. | Action buttons enabled but changes are reverted by policy. | “Add” disabled; personal items hidden. | Normal icon; edits revert to managed value. | Rarely useful: user efforts are discarded. |
| seed    | n/a              | n/a                | `false` (default) | On first load, managed menu seeds the user profile only if it was empty. | After seeding, items become normal user entries (all actions allowed). | User manages everything afterwards. | Managed instance copied once; user can edit later. | One-time baseline without overwriting existing data. |
| seed    | n/a              | n/a                | `true`      | On first load, managed menu replaces the entire user list. | Items become user-owned and fully editable. | User manages everything. | Instance replaced then editable. | Useful for resetting all users to an admin-defined set. |

Managed `exportPrefs` are defaults, not locked settings. In overlay mode, user preferences stored in sync—including values restored from an imported backup—take precedence. `lockManagedEntries` applies to the tenant and managed menu entries, not export preferences.

