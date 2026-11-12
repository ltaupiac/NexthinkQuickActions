// Configuration
const INJECTED_ATTR = "data-sn-injected-item";
const INJECTION_PENDING_ATTR = "data-sn-injection-pending";
const INVESTIGATION_COLUMN_SELECTOR = 'table[role="presentation"] th[rowspan="1"] div[class*="LinesEllipsis"]';
const INVESTIGATION_TABLE_SELECTOR = 'table[role="presentation"]';
const SELECTION_CHECKBOX_SELECTOR = "input[type='checkbox']";
const SELECTION_MENU_ATTR = 'data-nqa-export-menu';
const SELECTION_BUTTON_ATTR = 'data-nqa-export-action';
const SELECTION_HOVER_ATTR = 'data-nqa-export-hover';
const SELECTION_FALLBACK_ID = 'nqa-export-floating-bar';
const SELECTION_ACTION_STYLE_ID = 'nqa-export-action-style';
const SELECTION_VIEW_OVERLAY_ID = 'nqa-selected-row-view-overlay';
const SELECTION_VIEW_STYLE_ID = 'nqa-selected-row-view-style';
const SELECTION_ACTION_BAR_SELECTOR = 'div[data-insights="undefined_action-bar"]';
const COPY_FORMATS = ['html', 'markdown', 'ascii', 'tsv'];
let copyFormatPopoverId = 0;
let currentSubmenuTrigger = null; // track open submenu trigger for toggle
let cleanupFn = null; // cleanup for global listeners
let selectionViewCleanup = null;
const copyTooltipTargets = new Set(); // track copy buttons needing tooltip updates
const modifierIndicatorMap = new Map(); // map copy buttons to modifier state indicators
const modifierState = { alt: false, shift: false }; // track pressed modifier keys
const CLIPBOARD_MODIFIER_SEQUENCE = ['html', 'markdown', 'ascii', 'tsv']; // preferred modifier sequence

// Build tooltip text reflecting the configured clipboard format.
function buildClipboardTooltipText() {
    const api = window.NqaExport;
    if (!api) return '';
    let label = '';
    if (typeof api.getClipboardFormatLabel === 'function') {
        label = api.getClipboardFormatLabel();
    } else if (typeof api.getClipboardFormat === 'function') {
        label = api.getClipboardFormat();
    }
    if (!label) return '';
    return `Clipboard format: ${label}`;
}

// Apply tooltip to a specific button.
function applyClipboardTooltip(target) {
    if (!(target instanceof Element)) return;
    const text = buildClipboardTooltipText();
    if (text) target.setAttribute('title', text);
    else target.removeAttribute('title');
}

// Register a button so tooltip stays in sync with preferences.
function registerClipboardTooltipTarget(target) {
    if (!(target instanceof Element)) return;
    copyTooltipTargets.add(target);
    applyClipboardTooltip(target);
}

// Remove button from tracking when it is no longer in use.
function unregisterClipboardTooltipTarget(target) {
    if (!target) return;
    copyTooltipTargets.delete(target);
}

// Refresh tooltip text on all tracked buttons (call on config changes).
function refreshClipboardTooltips() {
    const stale = [];
    copyTooltipTargets.forEach((el) => {
        if (!(el instanceof Element) || !document.contains(el)) {
            stale.push(el);
            return;
        }
        applyClipboardTooltip(el);
    });
    stale.forEach((el) => copyTooltipTargets.delete(el));
}

// Return a human-friendly caption for a clipboard format identifier.
function describeClipboardFormatForUi(format) {
    if (!format) return '';
    const api = window.NqaExport;
    if (api && typeof api.describeClipboardFormat === 'function') {
        try { return api.describeClipboardFormat(format); }
        catch (_) { /* ignore */ }
    }
    return String(format);
}

// Build the ordered list of clipboard formats considered for modifiers.
function buildModifierFormatSequence(defaultFormat) {
    const api = window.NqaExport;
    let base = null;
    if (api && typeof api.getClipboardFormatSequence === 'function') {
        try {
            const seq = api.getClipboardFormatSequence();
            if (Array.isArray(seq) && seq.length) base = seq.map((item) => String(item || '').trim().toLowerCase());
        } catch (_) { base = null; }
    }
    const sequence = [];
    const seen = new Set();
    const push = (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        sequence.push(normalized);
    };
    if (defaultFormat) push(defaultFormat);
    (base || CLIPBOARD_MODIFIER_SEQUENCE).forEach(push);
    if (!sequence.length) push('html');
    return sequence;
}

// Resolve the base clipboard format that should be used when no modifier is pressed.
function resolveDefaultClipboardFormat(api) {
    let chosen = '';
    if (api && typeof api.getClipboardFormat === 'function') {
        try { chosen = api.getClipboardFormat(); }
        catch (_) { chosen = ''; }
    }
    if (typeof chosen !== 'string' || !chosen.trim()) {
        const fallback = api?.DEFAULT_PREFS?.textFormat || 'markdown';
        chosen = fallback;
    }
    return String(chosen || '').trim().toLowerCase() || 'markdown';
}

// Normalize and deduplicate a sequence of formats while keeping the default first.
function buildOrderedFormatList(sequence, defaultFormat) {
    const ordered = [];
    const seen = new Set();
    const push = (value) => {
        const key = String(value || '').trim().toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        ordered.push(key);
    };
    push(defaultFormat);
    sequence.forEach(push);
    return ordered;
}

// Pick alternate formats for Alt and Shift from the ordered list.
function pickModifierFormats(orderedFormats, defaultFormat) {
    const alternatives = orderedFormats.filter((fmt) => fmt !== defaultFormat);
    return {
        alt: alternatives[0] || null,
        shift: alternatives[1] || alternatives[0] || null,
    };
}

// Resolve default, Alt, and Shift formats with display labels.
function computeModifierFormats() {
    const api = window.NqaExport;
    if (!api) return null;
    const defaultFormat = resolveDefaultClipboardFormat(api);
    const sequence = buildModifierFormatSequence(defaultFormat);
    const ordered = buildOrderedFormatList(sequence, defaultFormat);
    const { alt: altFormat, shift: shiftFormat } = pickModifierFormats(ordered, defaultFormat);
    const altLabel = altFormat ? describeClipboardFormatForUi(altFormat) : '';
    const shiftLabel = shiftFormat ? describeClipboardFormatForUi(shiftFormat) : '';
    return { defaultFormat, altFormat, shiftFormat, altLabel, shiftLabel };
}

// Determine which modifier (if any) is currently overriding the format.
function getActiveModifierState() {
    const mapping = computeModifierFormats();
    if (!mapping) return null;
    if (modifierState.alt && modifierState.shift) return null;
    if (modifierState.alt && mapping.altFormat && mapping.altFormat !== mapping.defaultFormat) {
        return {
            key: 'Alt',
            format: mapping.altFormat,
            label: mapping.altLabel || mapping.altFormat,
        };
    }
    if (modifierState.shift && mapping.shiftFormat && mapping.shiftFormat !== mapping.defaultFormat) {
        return {
            key: 'Shift',
            format: mapping.shiftFormat,
            label: mapping.shiftLabel || mapping.shiftFormat,
        };
    }
    return null;
}

// Update modifier chips on all tracked buttons so they match current keys.
function refreshModifierIndicators() {
    ensureModifierIndicatorTargets();
    const mapping = computeModifierFormats();
    const state = mapping ? getActiveModifierState() : null;
    const stale = [];
    modifierIndicatorMap.forEach((entry, target) => {
        if (!(target instanceof Element)) {
            stale.push(target);
            return;
        }
        if (!target.isConnected) {
            if (!entry?.chip || !entry.chip.isConnected) stale.push(target);
            return;
        }
        if (!entry || !entry.chip) return;
        if (state) {
            const label = state.label || state.format;
            entry.chip.textContent = `\u00A0(${label})`;
            entry.chip.hidden = false;
            target.setAttribute('data-nqa-modifier-active', '1');
            target.classList.add('nqa-modifier-active');
        } else {
            entry.chip.textContent = '';
            entry.chip.hidden = true;
            target.removeAttribute('data-nqa-modifier-active');
            target.classList.remove('nqa-modifier-active');
        }
    });
    stale.forEach((target) => unregisterModifierIndicatorTarget(target));
}

// Register any copy buttons in DOM that are missing modifier indicators.
function ensureModifierIndicatorTargets() {
    const candidates = document.querySelectorAll(`[${SELECTION_BUTTON_ATTR}][data-nqa-export-copy="1"]`);
    candidates.forEach((el) => {
        if (!(el instanceof Element)) return;
        if (!modifierIndicatorMap.has(el)) {
            registerModifierIndicatorTarget(el);
        }
    });
}

// Attach modifier indicator elements to the provided copy button.
function registerModifierIndicatorTarget(target) {
    if (!(target instanceof Element)) return;
    if (modifierIndicatorMap.has(target)) {
        refreshModifierIndicators();
        return;
    }
    const chip = document.createElement('span');
    chip.className = 'nqa-export-modifier-chip';
    chip.setAttribute('aria-hidden', 'true');
    chip.hidden = true;
    try {
        target.appendChild(chip);
    } catch (_) {
        try { target.insertAdjacentElement('beforeend', chip); }
        catch (__) { return; }
    }
    modifierIndicatorMap.set(target, {
        chip,
    });
    target.classList.add('nqa-export-modifier-anchor');
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => refreshModifierIndicators());
    } else {
        setTimeout(() => refreshModifierIndicators(), 0);
    }
}

// Remove the modifier indicator bindings associated with a copy button.
function unregisterModifierIndicatorTarget(target) {
    if (!(target instanceof Element)) return;
    const entry = modifierIndicatorMap.get(target);
    if (!entry) return;
    modifierIndicatorMap.delete(target);
    try { entry.chip.remove(); } catch (_) {}
    target.classList.remove('nqa-export-modifier-anchor');
    target.classList.remove('nqa-modifier-active');
    target.removeAttribute('data-nqa-modifier-active');
}

// Update a stored modifier flag and report whether the value changed.
function setModifierFlag(flag, value) {
    if (!Object.prototype.hasOwnProperty.call(modifierState, flag)) return false;
    const normalized = !!value;
    if (modifierState[flag] === normalized) return false;
    modifierState[flag] = normalized;
    return true;
}

// Reset all modifier keys back to their default (inactive) state.
function clearModifierState() {
    let changed = false;
    if (modifierState.alt) {
        modifierState.alt = false;
        changed = true;
    }
    if (modifierState.shift) {
        modifierState.shift = false;
        changed = true;
    }
    if (changed) refreshModifierIndicators();
}

// Handle keydown events to detect Alt/Shift activation.
function handleModifierKeyDown(event) {
    if (!event) return;
    let changed = false;
    if (event.key === 'Alt' || event.key === 'AltGraph') {
        changed = setModifierFlag('alt', true) || changed;
    }
    if (event.key === 'Shift') {
        changed = setModifierFlag('shift', true) || changed;
    }
    if (event.altKey && !modifierState.alt) {
        changed = setModifierFlag('alt', true) || changed;
    }
    if (event.shiftKey && !modifierState.shift) {
        changed = setModifierFlag('shift', true) || changed;
    }
    if (changed) refreshModifierIndicators();
}

// Handle keyup events to clear modifier flags when keys are released.
function handleModifierKeyUp(event) {
    if (!event) return;
    let changed = false;
    if (event.key === 'Alt' || event.key === 'AltGraph') {
        changed = setModifierFlag('alt', false) || changed;
    }
    if (event.key === 'Shift') {
        changed = setModifierFlag('shift', false) || changed;
    }
    if (!event.altKey && modifierState.alt) {
        changed = setModifierFlag('alt', false) || changed;
    }
    if (!event.shiftKey && modifierState.shift) {
        changed = setModifierFlag('shift', false) || changed;
    }
    if (changed) refreshModifierIndicators();
}

// Sync modifier flags from pointer events (covers trackpads, stylus buttons, etc.).
function handleModifierPointer(event) {
    if (!event) return;
    let changed = false;
    changed = setModifierFlag('alt', !!event.altKey) || changed;
    changed = setModifierFlag('shift', !!event.shiftKey) || changed;
    if (changed) refreshModifierIndicators();
}

// Clear modifiers if focus leaves the window while a key is held.
function handleModifierBlur() {
    clearModifierState();
}

// Reset modifier state when the document becomes hidden.
function handleVisibilityChange() {
    if (typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible') clearModifierState();
}

if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handleModifierKeyDown, true);
    document.addEventListener('keyup', handleModifierKeyUp, true);
    document.addEventListener('pointerdown', handleModifierPointer, true);
    document.addEventListener('pointermove', handleModifierPointer, true);
    document.addEventListener('pointerup', handleModifierPointer, true);
    document.addEventListener('visibilitychange', handleVisibilityChange, true);
}
if (typeof window !== 'undefined') {
    window.addEventListener('blur', handleModifierBlur, true);
}

// Build a native-like menu entry (container -> contents -> anchor) using classes from an existing item
function buildAnchoredMenuItem(container, label, href, onClick) {
    // Find a reference native menuitem (<a role="menuitem"> or <span role="menuitem">)
    const ref = container.querySelector('a[role="menuitem"], span[role="menuitem"]');
    if (!ref) return null;

    // Reference wrappers
    const refContents = ref.parentElement; // usually the StyledContents div
    const refContainer = ref.closest('[class*="StyledActionMenuItemContainer"]');

    // Create outer container
    const outer = document.createElement("div");
    if (refContainer) {
        refContainer.classList.forEach((cls) => {
            try {
                if (cls) outer.classList.add(cls);
            } catch (_) { }
        });
    }
    outer.setAttribute(INJECTED_ATTR, "1");

    // Create contents wrapper
    const contents = document.createElement("div");
    if (refContents) {
        refContents.classList.forEach((cls) => {
            try {
                if (cls) contents.classList.add(cls);
            } catch (_) { }
        });
    }

    // Create anchor that looks like the native one
    const a = document.createElement("a");
    a.setAttribute("role", "menuitem");
    a.setAttribute("tabindex", "-1");
    a.setAttribute("data-tabindex", "0");
    if (typeof onClick === 'function') {
        a.style.cursor = 'pointer';
        a.addEventListener('click', async (event) => {
            try { event.preventDefault(); } catch (_) {}
            try { event.stopPropagation(); } catch (_) {}
            try { await onClick(event, a); }
            finally { setTimeout(() => hideCustomSubmenu(), 0); }
        });
    } else {
        a.setAttribute("rel", "noreferrer noopener");
        a.setAttribute("target", "_blank");
        a.href = href;
    }

    // Copy classes from the reference item (text-only or icon+text)
    ref.classList.forEach((cls) => {
        try {
            if (cls) a.classList.add(cls);
        } catch (_) { }
    });

    // Text node structure similar to native (<span>Text</span>)
    const span = document.createElement("span");
    span.textContent = label;
    a.appendChild(span);

    contents.appendChild(a);
    outer.appendChild(contents);
    return outer;
}

function supportsCopyFormatAnchorPositioning() {
    return !!window.CSS?.supports?.('position-area: block-end')
        && !!window.CSS?.supports?.('position-try-fallbacks: flip-block');
}

function positionCopyFormatPopover(popover, trigger) {
    if (supportsCopyFormatAnchorPositioning()) {
        popover.style.removeProperty('left');
        popover.style.removeProperty('top');
        return;
    }

    const anchor = trigger.parentElement || trigger;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const gap = 6;
    const edge = 8;

    let left = anchorRect.left;
    if (left + popoverRect.width > viewportWidth - edge) {
        left = anchorRect.right - popoverRect.width;
    }
    left = Math.max(edge, Math.min(left, viewportWidth - popoverRect.width - edge));

    let top = anchorRect.bottom + gap;
    if (top + popoverRect.height > viewportHeight - edge) {
        top = anchorRect.top - popoverRect.height - gap;
    }
    top = Math.max(edge, Math.min(top, viewportHeight - popoverRect.height - edge));

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
}

// Add a one-shot copy-format picker beside a copy action.
function createCopyFormatSelector(referenceTarget, onSelectFormat) {
    ensureSelectionActionStyles();
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nqa-copy-format-toggle';
    toggle.textContent = '▾';
    toggle.setAttribute('aria-label', 'Choose a format for this copy');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.title = 'Choose a format for this copy';
    if (referenceTarget?.style?.color) toggle.style.color = referenceTarget.style.color;

    const id = `nqa-copy-format-popover-${++copyFormatPopoverId}`;
    toggle.setAttribute('aria-controls', id);
    toggle.setAttribute('popovertarget', id);

    const popover = document.createElement('div');
    popover.id = id;
    popover.className = 'nqa-copy-format-popover';
    popover.setAttribute('popover', 'auto');
    popover.setAttribute('role', 'group');
    popover.setAttribute('aria-label', 'Copy format options');
    popover.setAttribute('data-theme', getSelectionViewTheme());
    popover.style.visibility = 'hidden';

    const heading = document.createElement('div');
    heading.className = 'nqa-copy-format-heading';
    heading.textContent = 'Copy as';
    popover.appendChild(heading);

    const defaultFormat = resolveDefaultClipboardFormat(window.NqaExport);
    COPY_FORMATS.forEach((format) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'nqa-copy-format-option';
        const formatLabel = describeClipboardFormatForUi(format) || format;
        option.textContent = formatLabel;
        if (format === defaultFormat) {
            const defaultLabel = document.createElement('span');
            defaultLabel.className = 'nqa-copy-format-default';
            defaultLabel.textContent = 'Default';
            defaultLabel.setAttribute('aria-hidden', 'true');
            option.appendChild(defaultLabel);
            option.setAttribute('aria-label', `${formatLabel} (default)`);
        }
        option.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            try { popover.hidePopover(); } catch (_) {}
            try { toggle.focus({ preventScroll: true }); } catch (_) {}
            if (typeof onSelectFormat === 'function') {
                await onSelectFormat(format, event, toggle);
            }
        });
        popover.appendChild(option);
    });

    let repositionFrame = 0;
    const repositionIfNeeded = () => {
        if (supportsCopyFormatAnchorPositioning() || repositionFrame) return;
        repositionFrame = requestAnimationFrame(() => {
            repositionFrame = 0;
            if (!popover.matches(':popover-open')) return;
            positionCopyFormatPopover(popover, toggle);
        });
    };
    const onToggle = () => {
        const open = popover.matches(':popover-open');
        toggle.setAttribute('aria-expanded', String(open));
        if (open) {
            popover.setAttribute('data-theme', getSelectionViewTheme());
            requestAnimationFrame(() => {
                if (!popover.matches(':popover-open')) return;
                positionCopyFormatPopover(popover, toggle);
                popover.style.visibility = 'visible';
            });
            document.addEventListener('scroll', repositionIfNeeded, true);
            window.addEventListener('resize', repositionIfNeeded);
        } else if (popover.contains(document.activeElement)) {
            document.removeEventListener('scroll', repositionIfNeeded, true);
            window.removeEventListener('resize', repositionIfNeeded);
            if (repositionFrame) cancelAnimationFrame(repositionFrame);
            repositionFrame = 0;
            popover.style.visibility = 'hidden';
            try { toggle.focus({ preventScroll: true }); } catch (_) {}
        } else {
            document.removeEventListener('scroll', repositionIfNeeded, true);
            window.removeEventListener('resize', repositionIfNeeded);
            if (repositionFrame) cancelAnimationFrame(repositionFrame);
            repositionFrame = 0;
            popover.style.visibility = 'hidden';
        }
    };
    popover.addEventListener('toggle', onToggle);

    return { toggle, popover };
}

function buildCopyFormatControl(copyRoot, copyButton, onSelectFormat) {
    const control = document.createElement('div');
    control.className = 'nqa-copy-format-control';
    control.setAttribute('role', 'group');
    control.setAttribute('aria-label', 'Copy actions');
    if (copyButton?.style?.color) control.style.color = copyButton.style.color;
    [copyRoot, copyButton].filter(Boolean).forEach((element) => {
        element.removeAttribute(SELECTION_HOVER_ATTR);
        element.style.removeProperty('--nqa-selection-hover-background');
    });
    control.appendChild(copyRoot);

    const selector = createCopyFormatSelector(copyButton, onSelectFormat);
    control.append(selector.toggle, selector.popover);
    return { root: control, toggle: selector.toggle, popover: selector.popover };
}

function safeCopyClasses(target, source) {
    if (!target || !source || !source.classList) return;
    try { source.classList.forEach((cls) => { if (cls) target.classList.add(cls); }); } catch (_) {}
}

function applySeparatorLineStyles(line, nativeLine) {
    if (!line || !nativeLine) return;
    try {
        const cs = window.getComputedStyle(nativeLine);
        if (!cs) return;
        line.style.height = cs.height || '';
        line.style.margin = cs.margin || '';
        line.style.backgroundColor = cs.backgroundColor || '';
        line.style.opacity = cs.opacity || '';
    } catch (_) {}
}

// Build a separator similar to native menus.
function buildMenuSeparator(container) {
    try {
        // Prefer a native group-separator (not the right-side "StyledExtra" separator used inside items)
        let native = null;
        // 1) Direct child of the menu container with role=separator
        for (const el of Array.from(container.children)) {
            if (el && el.getAttribute && el.getAttribute('role') === 'separator') {
                const cls = String(el.className || '');
                if (!/StyledExtra|Extra_/i.test(cls)) { native = el; break; }
            }
        }
        // 2) Scoped lookup for known separator classes
        if (!native) {
            native = container.querySelector('div[role="separator"][class*="ActionMenuSeparator"], div[role="separator"][class*="SeparatorLi"]');
        }
        // 3) Global fallback
        if (!native) {
            native = document.querySelector('div[role="separator"][class*="ActionMenuSeparator"], div[role="separator"][class*="SeparatorLi"]');
        }

        const sep = document.createElement('div');
        sep.setAttribute('role', 'separator');
        sep.setAttribute(INJECTED_ATTR, '1');

        // Minimal default styling to ensure visibility even if class copy fails
        const ensureLine = (bgColor) => {
            const line = document.createElement('div');
            line.style.height = '1px';
            line.style.margin = '6px 0';
            line.style.backgroundColor = bgColor || 'rgba(0,0,0,0.15)';
            sep.appendChild(line);
        };

        if (native) {
            // Copy outer classes if available
            safeCopyClasses(sep, native);
            // Try to clone the inner line look
            const nativeLine = native.querySelector('div[class*="SeparatorLine"], div');
            if (nativeLine) {
                const line = document.createElement('div');
                safeCopyClasses(line, nativeLine);
                // Mirror computed style to be safe
                applySeparatorLineStyles(line, nativeLine);
                sep.appendChild(line);
            } else {
                ensureLine();
            }
        } else {
            ensureLine();
        }

        return sep;
    } catch (_) {
        return null;
    }
}

// Return only menu entries whose URL contains the placeholder for the current column
// Current column key is read from window.nqaPlaceHolder.columnName (already normalized);
// Device View falls back to a fixed set of device/user placeholders.
// Example: keeps items where url includes `{devices_full_name}` if columnName is `devices_full_name`.
function getMenuFilteredByCurrentColumn(callback) {
    try {
        const holder = window.nqaPlaceHolder || {};
        const table_name = String(holder?.table_name || '').toLowerCase();
        const columnName = holder?.columnName || '';

        const tokens = [];
        if (table_name === 'device_view') {
            tokens.push('devices_name', 'login_name', 'full_name', 'ad_name');
        } else if (columnName) {
            tokens.push(String(columnName));
        }

        const normalizedTokens = tokens
            .map((t) => String(t || '').trim().toLowerCase())
            .filter(Boolean);

        const uniqueTokens = Array.from(new Set(normalizedTokens));
        if (!uniqueTokens.length) { callback([]); return; }

        const store = new window.NqaConfigStore();
        store.getMenu()
            .then((menu) => {
                const filtered = (menu || []).filter((it) => {
                    const url = it?.url ?? '';
                    const matches = url.match(/\{([^}]+)\}/g) || [];
                    if (!matches.length) return false;
                    return matches.some((rawPlaceholder) => {
                        const inner = rawPlaceholder.slice(1, -1);
                        const pattern = inner.replace(/\*/g, '.*');
                        const re = new RegExp('^' + pattern + '$', 'i');
                        return uniqueTokens.some((token) => re.test(token));
                    });
                });
                callback(filtered);
            })
            .catch(() => callback([]));
    } catch (_) { callback([]); }
}

// Build submenu items for a given device name using stored configs.
// Supports any placeholders of the form {name} and replaces them with values
// from window.nqaPlaceHolder.rawValues if available.
// Remove any line breaks from the URL as the edition is a textarea.
function buildActionItemsForDevice(callback) {
    // Get suitable menu entries for the current column
    const store = new window.NqaConfigStore();
    getMenuFilteredByCurrentColumn(async (cfgs) => {
        if (!Array.isArray(cfgs) || !cfgs.length) { callback([]); return; }
        const items = [];
        const raw = { ...(window?.nqaPlaceHolder?.rawValues ?? {}) };
        try {
            const inst = await store.getInstance();
            const prefix = inst && (inst.prefix || inst.name);
            if (prefix) raw.instance_name = String(prefix);
        } catch (_) { /* ignore */ }
        for (const it of cfgs) {
            const label = (it?.name || it?.label) ?? '';
            let url = it?.url ?? '';
            if (!label || !url) continue;
            try {
                url = url.replace(/[\r\n]+/g, '');
                url = url.replace(/\{([^}]+)\}/g, (match, placeholderPattern) => {
                    const regex = new RegExp('^' + placeholderPattern.replace(/\*/g, '.*') + '$', 'i');
                    const matchingKey = Object.keys(raw).find(rawKey => regex.test(rawKey));
                    if (matchingKey) return raw[matchingKey];
                    return match;
                });
            } catch (_) { continue; }
            items.push({ label, href: url });
        }
        callback(items);
    });
}

// Find classes from an existing submenu trigger (one that shows an angle-right icon)
function findSubmenuReference(container) {
    const items = Array.from(container.querySelectorAll('[role="menuitem"]'));
    let fallback = null;
    for (const mi of items) {
        // Prepare a generic fallback based on the first native item
        if (!fallback) {
            fallback = {
                item: mi,
                container: mi.closest('[class*="StyledActionMenuItemContainer"]'),
                contents: mi.parentElement,
                extra: null
            };
        }
        // Look for a stable FontAwesome angle-right chevron near this item
        const scope = mi.parentElement?.parentElement || mi.parentElement || container;
        const icon = scope?.querySelector('[data-icon="angle-right"], .fa-angle-right, svg[data-icon="angle-right"]');
        if (icon) {
            const extra = icon.closest('[aria-hidden="true"][role="separator"]') || icon.parentElement;
            return {
                item: mi,
                container: mi.closest('[class*="StyledActionMenuItemContainer"]'),
                contents: mi.parentElement,
                extra: extra || null
            };
        }
    }
    // No explicit chevron found: return the generic reference (classes may still be copied from item/container)
    return fallback;
}

// Build a native-like submenu trigger with left icon and right chevron
function buildSubmenuTrigger(container, label, iconSpec) {
    // Try to adopt classes from an existing submenu item
    const ref = findSubmenuReference(container);

    const outer = document.createElement('div');
    outer.setAttribute(INJECTED_ATTR, '1');
    if (ref?.container) ref.container.classList.forEach(c => { try { if (c) outer.classList.add(c); } catch (_) { } });

    const contents = document.createElement('div');
    if (ref?.contents) ref.contents.classList.forEach(c => { try { if (c) contents.classList.add(c); } catch (_) { } });

    const trigger = document.createElement('span');
    trigger.setAttribute('role', 'menuitem');
    trigger.setAttribute('tabindex', '-1');
    trigger.setAttribute('data-tabindex', '0');
    trigger.setAttribute('aria-label', label);
    if (ref?.item) ref.item.classList.forEach(c => { try { if (c) trigger.classList.add(c); } catch (_) { } });

    // Inner span holding left icon + label
    const inner = document.createElement('span');

    // Left icon (SVG Element) at 16px
    if (iconSpec && typeof iconSpec === 'object') {
        // Accept an Element (expected SVGElement) and normalize
        const holder = document.createElement('span');
        holder.style.display = 'inline-flex';
        holder.style.width = '16px';
        holder.style.height = '16px';
        holder.style.marginRight = '4px';
        holder.style.verticalAlign = 'middle';
        let svgEl = null;
        try {
            let el = null;
            if (iconSpec instanceof Element) {
                if (iconSpec.tagName && iconSpec.tagName.toLowerCase() === 'svg') {
                    el = iconSpec.cloneNode(true);
                } else if (iconSpec.querySelector) {
                    const found = iconSpec.querySelector('svg');
                    el = (found ? found.cloneNode(true) : iconSpec.cloneNode(true));
                }
            }
            if (el) {
                holder.appendChild(el);
                svgEl = (el.tagName && el.tagName.toLowerCase() === 'svg') ? el : holder.querySelector('svg');
            }
        } catch (_) { svgEl = null; }
        if (svgEl) {
            svgEl.setAttribute('width', '16');
            svgEl.setAttribute('height', '16');
            svgEl.style.width = '16px';
            svgEl.style.height = '16px';
            svgEl.style.display = 'block';
            try {
                let refIcon = null;
                if (ref?.item) refIcon = ref.item.querySelector('svg');
                if (!refIcon) refIcon = container.querySelector('[role="menuitem"] svg');
                if (refIcon) {
                    refIcon.classList.forEach(c => { if (c) svgEl.classList.add(c); });
                    ['aria-hidden', 'focusable', 'role'].forEach(attr => {
                        const val = refIcon.getAttribute(attr);
                        if (val !== null) svgEl.setAttribute(attr, val);
                    });
                }
            } catch (_) { /* keep minimal styling if no reference icon */ }
        }
        inner.appendChild(holder);
    }

    const text = document.createTextNode(label);
    inner.appendChild(text);
    trigger.appendChild(inner);

    // Right side chevron container
    const extra = document.createElement('div');
    extra.setAttribute('aria-hidden', 'true');
    extra.setAttribute('role', 'separator');
    if (ref?.extra) ref.extra.classList.forEach(c => { try { if (c) extra.classList.add(c); } catch (_) { } });
    // Chevron SVG (self-contained, no obfuscated classes)
    try {
        const chevron = buildChevronRightIconSvg();
        extra.appendChild(chevron);
    } catch (_) { /* keep minimal container if SVG fails */ }

    contents.appendChild(trigger);
    contents.appendChild(extra);
    outer.appendChild(contents);
    return { outer, trigger };
}

// Show a custom submenu to the right of a trigger element
function showCustomSubmenu(triggerEl, items) {
    // Close any existing custom submenu
    hideCustomSubmenu();

    // Anchors for positioning
    const itemContainer = triggerEl.closest('[class*="StyledActionMenuItemContainer"]') || triggerEl;
    const rootMenu = triggerEl.closest('[role="menu"]');
    if (!rootMenu) return;

    const itemRect = itemContainer.getBoundingClientRect();
    const rootMenuRect = rootMenu.getBoundingClientRect();

    // Try to clone native submenu wrappers/classes for perfect alignment & radius
    const nativeSubWrap = document.querySelector('[class*="StyledActionSubMenu_"]');
    const nativeInnerMenu = nativeSubWrap?.querySelector('[role="menu"]');

    // Outer wrapper (StyledActionSubMenu_*)
    const outerWrap = document.createElement('div');
    outerWrap.id = 'nca-custom-submenu-wrap';
    if (nativeSubWrap?.classList) {
        nativeSubWrap.classList.forEach(c => { try { if (c) outerWrap.classList.add(c); } catch (_) { } });
    }
    // Position like native: flush to the right edge of the root menu, aligned to the triggering row
    Object.assign(outerWrap.style, {
        position: 'fixed',
        top: `${Math.round(itemRect.top)}px`,
        left: `${Math.round(rootMenuRect.right)}px`,
        transform: `translate(-12px, -2px)`,
        zIndex: 2147483647,
    });

    // Native submenu usually has an extra anonymous div wrapper
    const midWrap = document.createElement('div');
    outerWrap.appendChild(midWrap);

    // Real menu node (StyledActionMenu_*)
    const menu = document.createElement('div');
    menu.id = 'nca-custom-submenu';
    menu.setAttribute('role', 'menu');
    if (nativeInnerMenu?.classList) {
        nativeInnerMenu.classList.forEach(c => { try { if (c) menu.classList.add(c); } catch (_) { } });
    } else if (rootMenu?.classList) {
        rootMenu.classList.forEach(c => { try { if (c) menu.classList.add(c); } catch (_) { } });
    }

    // Try to match rounded corners / shadow from the native submenu (or root menu as fallback)
    try {
        const refNode = nativeInnerMenu || rootMenu;
        const refCS = window.getComputedStyle(refNode);
        if (refCS) {
            const radius = refCS.borderRadius || '8px';
            const shadow = refCS.boxShadow && refCS.boxShadow !== 'none' ? refCS.boxShadow : '0 8px 24px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08)';
            const bg = refCS.backgroundColor || '#fff';

            menu.style.borderRadius = radius;
            menu.style.backgroundColor = bg;
            menu.style.overflow = 'hidden';

            // Some themes place the shadow on the outer wrapper — mirror it there too
            outerWrap.style.boxShadow = shadow;
            // If native uses filter-based shadow, copy that as well
            const filt = refCS.filter;
            if (filt && filt !== 'none') outerWrap.style.filter = filt;
        }
    } catch (_) { }

    // Build items (anchors) similar to native using our anchored builder
    const refRoot = nativeInnerMenu || rootMenu || document;
    const container = document.createElement('div');
    const copyTargets = [];
    items.forEach(it => {
        const isAction = typeof it.onActivate === 'function';
        const item = buildAnchoredMenuItem(
            refRoot,
            it.label,
            it.href,
            isAction ? it.onActivate : null
        );
        if (item) {
            const anchor = item.querySelector('a[role="menuitem"]');
            if (anchor && isAction) {
                if (it.copy) {
                    anchor.setAttribute(SELECTION_BUTTON_ATTR, '1');
                    anchor.setAttribute('data-nqa-export-copy', '1');
                    registerClipboardTooltipTarget(anchor);
                    registerModifierIndicatorTarget(anchor);
                    copyTargets.push(anchor);
                }
            } else if (anchor) {
                // Close our custom submenu right after the new tab is opened
                anchor.addEventListener('click', (e) => {
                    try { console.log('[NQA] submenu anchor click captured', { type: e.type }); } catch (_) {}
                    try { console.log('[NQA][bus] current placeholder:', window.nqaPlaceHolder); } catch (_) {}
                    try { e.preventDefault(); } catch (_) {}
                    try { e.stopPropagation(); } catch (_) {}
                    let url = '';
                    try { url = anchor.href || ''; } catch (_) { url = ''; }
                    try { console.log('[NQA] will open URL in new tab', url); } catch (_) {}
                    try {
                        if (url) window.open(url, '_blank', 'noopener,noreferrer');
                    } catch (_) {
                        try { console.warn('[NQA] window.open failed'); } catch (__) {}
                    }
                    setTimeout(() => { try { console.log('[NQA] closing custom submenu'); } catch(_){} hideCustomSubmenu(); }, 0);
                    // e.stopPropagation();
                    // setTimeout(() => hideCustomSubmenu(), 0);
                }, { capture: true });
            }
            if (anchor && typeof it.onFormatSelect === 'function') {
                item.classList.add('nqa-copy-format-submenu-row');
                item.setAttribute('role', 'group');
                item.setAttribute('aria-label', 'Copy selection actions');
                item.style.display = 'flex';
                item.style.alignItems = 'stretch';
                item.style.color = anchor.style.color || getComputedStyle(anchor).color;
                item.style.setProperty('--nqa-copy-format-hover-background', getSelectionHoverBackground(item.style.color));
                const contents = anchor.parentElement;
                if (contents) {
                    contents.style.flex = '1 1 auto';
                    contents.style.minWidth = '0';
                }
                anchor.style.flex = '1 1 auto';
                anchor.style.minWidth = '0';
                const selector = createCopyFormatSelector(anchor, async (format, event, toggle) => {
                    await it.onFormatSelect(format, event, toggle);
                });
                item.append(selector.toggle, selector.popover);
            }
            container.appendChild(item);
        }
    });
    menu.appendChild(container);
    midWrap.appendChild(menu);

    document.body.appendChild(outerWrap);
    // Track trigger and reflect expanded state for a11y
    currentSubmenuTrigger = triggerEl;
    try { triggerEl.setAttribute('aria-expanded', 'true'); } catch (_) {}


    let rafId = null;
    const isRootMenuVisible = () => {
        try {
            if (!rootMenu || !rootMenu.isConnected) return false;
            const cs = window.getComputedStyle(rootMenu);
            if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
            const op = parseFloat(cs.opacity || '1');
            if (op === 0) return false;
            const r = rootMenu.getBoundingClientRect();
            return r && r.width > 0 && r.height > 0;
        } catch (_) { return false; }
    };

    let closeTimer = null; // debounce submenu close on transient invisibility
    const cancelCloseTimer = () => { try { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } } catch (_) {} };
    const scheduleClose = () => {
        if (closeTimer) return;
        closeTimer = setTimeout(() => {
            try {
                if (!isRootMenuVisible()) hideCustomSubmenu();
            } finally { closeTimer = null; }
        }, 150);
    };

    const reposition = () => {
        try {
            // If the root menu becomes temporarily invisible while scrolling, do not close immediately
            if (!isRootMenuVisible()) { scheduleClose(); rafId = null; return; }
            // If visible again, cancel any pending delayed close
            cancelCloseTimer();
            const itemRectNow = itemContainer.getBoundingClientRect();
            const rootMenuRectNow = rootMenu.getBoundingClientRect();
            outerWrap.style.top = `${Math.round(itemRectNow.top)}px`;
            outerWrap.style.left = `${Math.round(rootMenuRectNow.right)}px`;
        } catch (_) { /* ignore */ }
        rafId = null;
    };
    const onWinMove = () => {
        if (rafId == null) rafId = requestAnimationFrame(reposition);
    };
     // Close on click outside or Escape; and keep submenu aligned on scroll/resize
    const onDocClick = (e) => {
        if (!outerWrap.contains(e.target) && e.target !== triggerEl) hideCustomSubmenu();
    };
    let escapeHandledByCopyPopover = false;
    const onKey = (e) => {
        const isEsc = e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape';
        if (!isEsc) return;
        const openCopyPopover = outerWrap.querySelector('.nqa-copy-format-popover:popover-open');
        if (openCopyPopover) {
            if (e.type === 'keydown') escapeHandledByCopyPopover = true;
            return;
        }
        if (e.type === 'keyup' && escapeHandledByCopyPopover) {
            escapeHandledByCopyPopover = false;
            return;
        }
        if (e.type === 'keydown') hideCustomSubmenu();
    };
    // If the native root menu gets detached/hidden, also close our submenu
    // Maybe not strictly necessary but safer to avoid floating menus
    const mo = new MutationObserver(() => {
       try { if (!rootMenu.isConnected || !isRootMenuVisible()) scheduleClose(); } catch (_) {}
    });
    setTimeout(() => {
        document.addEventListener('mousedown', onDocClick, { capture: true });
        // Right-click (context menu) should also close our submenu immediately
        const onContextMenu = (e) => { try { hideCustomSubmenu(); } catch (_) {} };
        document.addEventListener('contextmenu', onContextMenu, { capture: true });
        document.addEventListener('keydown', onKey, { capture: true });
        document.addEventListener('keyup', onKey, { capture: true });

        // (wheel/touchmove): realign during internal container scrolling
        // (without interfering with clicks, passive capture handlers)
        document.addEventListener('wheel', onWinMove, { capture: true, passive: true });
        document.addEventListener('touchmove', onWinMove, { capture: true, passive: true });
        // (scroll/resize): realign via window events only
        window.addEventListener('resize', onWinMove, { passive: true });
        window.addEventListener('scroll', onWinMove, { passive: true });
        try { mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] }); } catch (_) {}
    }, 0);
    // Store a cleanup to remove listeners when hiding
    if (cleanupFn) { try { cleanupFn(); } catch (_) {} }
    cleanupFn = () => {
        try { document.removeEventListener('mousedown', onDocClick, { capture: true }); } catch (_) {}
        try { document.removeEventListener('contextmenu', onContextMenu, { capture: true }); } catch (_) {}
        try { document.removeEventListener('keydown', onKey, { capture: true }); } catch (_) {}
        try { document.removeEventListener('keyup', onKey, { capture: true }); } catch (_) {}
        // Remove the listeners actually attached
        try { document.removeEventListener('wheel', onWinMove, { capture: true }); } catch (_) {}
        try { document.removeEventListener('touchmove', onWinMove, { capture: true }); } catch (_) {}
        try { window.removeEventListener('resize', onWinMove); } catch (_) {}
        try { window.removeEventListener('scroll', onWinMove); } catch (_) {}
        try { mo.disconnect(); } catch (_) {}
        try { if (rafId != null) cancelAnimationFrame(rafId); } catch (_) {}
        cancelCloseTimer();
        copyTargets.forEach((target) => {
            unregisterModifierIndicatorTarget(target);
            unregisterClipboardTooltipTarget(target);
            target.removeAttribute(SELECTION_BUTTON_ATTR);
            target.removeAttribute('data-nqa-export-copy');
        });
    };
}

// Reset the injected submenu (and cleanup listeners) when the user leaves the menu.
function hideCustomSubmenu() {
    const wrap = document.getElementById('nca-custom-submenu-wrap');
    if (wrap && wrap.parentNode) {
        wrap.parentNode.removeChild(wrap);
        try { if (cleanupFn) cleanupFn(); } catch (_) {}
        try { if (currentSubmenuTrigger) currentSubmenuTrigger.setAttribute('aria-expanded', 'false'); } catch (_) {}
        currentSubmenuTrigger = null;
        return;
    }
    const m = document.getElementById('nca-custom-submenu');
    if (m && m.parentNode) m.parentNode.removeChild(m);
    try { if (cleanupFn) cleanupFn(); } catch (_) {}
    try { if (currentSubmenuTrigger) currentSubmenuTrigger.setAttribute('aria-expanded', 'false'); } catch (_) {}
    currentSubmenuTrigger = null;
}

// Build the inline SVG icon used for the root "Quick Actions" menu entry
// Returns an SVGElement sized by the caller (buildSubmenuTrigger normalizes to 16px)
function buildQuickActionsIconSvg(twoStates) {
    // Backward compatibility: default to single-state icon
    const withTwoStates = !!twoStates;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('xmlns', svgNS);
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('role', 'img');

    const pathData = [
        'M640.413,554.743',
        'C640.413,554.743 323.582,908.073 252.487,986.743',
        'C300.191,933.956 202.138,1059.237 160.199,1038.401',
        'C138.305,1027.524 162.343,969.106 162.343,969.106',
        'C162.343,969.106 238.126,727.204 256.832,690.802',
        'C282.451,640.950 284.878,630.334 242.366,627.569',
        'C232.189,627.757 220.916,628.135 208.1000,627.923',
        'L91.473,627.923',
        'C-7.042,627.807 -7.057,591.495 81.914,502.524',
        'C81.914,502.524 398.685,149.131 469.766,70.447',
        'C422.071,123.243 520.105,-2.060 562.037,18.780',
        'C583.927,29.659 559.893,88.088 559.893,88.088',
        'C559.893,88.088 484.124,330.032 465.422,366.440',
        'C439.720,416.471 437.371,426.990 480.327,429.712',
        'C490.402,429.522 501.538,429.156 513.303,429.365',
        'L630.852,429.365',
        'C729.385,429.481 729.401,465.787 640.413,554.743',
        'Z'
    ].join(' ');

    if (withTwoStates) {
        // Inactive: outline stroke (current behavior)
        const gInactive = document.createElementNS(svgNS, 'g');
        gInactive.setAttribute('id', 'icon-inactive');
        gInactive.setAttribute('transform', 'translate(2.47,0) scale(0.015017) translate(7.057, 2.06)');
        const pathInactive = document.createElementNS(svgNS, 'path');
        pathInactive.setAttribute('fill', 'none');
        pathInactive.setAttribute('stroke', 'currentColor');
        pathInactive.setAttribute('stroke-width', '0.8');
        pathInactive.setAttribute('vector-effect', 'non-scaling-stroke');
        pathInactive.setAttribute('stroke-linecap', 'round');
        pathInactive.setAttribute('stroke-linejoin', 'round');
        pathInactive.setAttribute('d', pathData);
        gInactive.appendChild(pathInactive);

        // Active: filled shape
        const gActive = document.createElementNS(svgNS, 'g');
        gActive.setAttribute('id', 'icon-active');
        gActive.setAttribute('transform', 'translate(2.47,0) scale(0.015017) translate(7.057, 2.06)');
        const pathActive = document.createElementNS(svgNS, 'path');
        pathActive.setAttribute('fill', 'currentColor');
        pathActive.setAttribute('d', pathData);
        gActive.appendChild(pathActive);

        svg.appendChild(gInactive);
        svg.appendChild(gActive);
    } else {
        const g = document.createElementNS(svgNS, 'g');
        g.setAttribute('transform', 'translate(2.47,0) scale(0.015017) translate(7.057, 2.06)');
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('fill', 'none');
        // Inherit color from context to match menu theme (light/dark)
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '0.8');
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('d', pathData);
        g.appendChild(path);
        svg.appendChild(g);
    }
    return svg;
}

// Build a 16px right-pointing chevron SVG used on submenu rows
function buildChevronRightIconSvg() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.style.width = '16px';
    svg.style.height = '16px';
    svg.style.display = 'block';
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute(
        'd',
        'M6.57045 4.5C6.51546 4.5 6.45361 4.52806 6.41237 4.57014L6.06873 4.92084C6.02749 4.96293 6 5.02605 6 5.08216C6 5.13828 6.02749 5.2014 6.06873 5.24349L8.76976 8L6.06873 10.7565C6.02749 10.7986 6 10.8617 6 10.9178C6 10.981 6.02749 11.0371 6.06873 11.0792L6.41237 11.4299C6.45361 11.4719 6.51546 11.5 6.57045 11.5C6.62543 11.5 6.68729 11.4719 6.72852 11.4299L9.93127 8.16132C9.97251 8.11924 10 8.05611 10 8C10 7.94389 9.97251 7.88076 9.93127 7.83868L6.72852 4.57014C6.68728 4.52806 6.62543 4.5 6.57045 4.5Z'
    );
    svg.appendChild(path);
    return svg;
}

// Returns the column name for the kebab button element (rootMenuEl)
function getNqaColumnNameFromKebab(rootMenuEl) {
    try {
        const btn = rootMenuEl && rootMenuEl.nodeType === 1 ? rootMenuEl : null;
        if (!btn) return '';

        // 1) Parse explicit column name from aria-label
        const aria = btn.getAttribute('aria-label') || '';
        if (aria) {
            const m = /column\s+(.+)$/i.exec(aria);
            if (m && m[1]) return normalizeColumnKey(m[1]);
        }

        // 2) Fallback: use aria-colindex on the owning cell and read header th with same index
        const cell = btn.closest('td, [role="gridcell"], [role="cell"]');
        if (!cell) return '';
        const colIndex = cell.getAttribute('aria-colindex');
        if (!colIndex) return '';
        let th = null;
        try {
            const table = cell.closest('table[role="presentation"]');
            th = table ? table.querySelector(`th[aria-colindex="${colIndex}"]`) : null;
        } catch(_) { th = null; }
        if (!th ) th = document.querySelector(`table[role="presentation"] th[aria-colindex="${colIndex}"]`);
        return (th && (th.textContent || '').trim()) || '';
    } catch (_) { return ''; }
}

// Get a safe ID for use in a selector (CSS.escape if available, else minimal escaping)
function getSafeId(rootMenuEl) {
    let id = rootMenuEl.getAttribute('id') || '';
    if (id) {
        id = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : id.replace(/"/g, '\\"');
    }
    return id;
}

function getInvestigationColumnDefinition(button) {
    const header = button?.closest('th, [role="columnheader"]');
    const api = window.NqaExport;
    if (!header || typeof api?.getColumnDefinitions !== 'function') return null;

    const definitions = api.getColumnDefinitions();
    const ariaIndex = Number.parseInt(header.getAttribute('aria-colindex') || '', 10);
    if (Number.isInteger(ariaIndex)) {
        const byAriaIndex = definitions.find((definition) => definition.ariaIndex === ariaIndex);
        if (byAriaIndex) return byAriaIndex;
    }

    const cellIndex = header.cellIndex;
    return Number.isInteger(cellIndex)
        ? definitions.find((definition) => definition.index === cellIndex) || null
        : null;
}

function injectColumnSelectionActions(rootMenuEl, columnDefinition) {
    const api = window.NqaExport;
    if (!api || typeof api.hasSelection !== 'function' || !api.hasSelection()) return true;

    const container = rootMenuEl.querySelector('[role="menu"]') || rootMenuEl;
    const quickIcon = buildQuickActionsIconSvg();
    const { outer, trigger } = buildSubmenuTrigger(container, 'Quick Actions', quickIcon);

    outer.addEventListener('click', (event) => {
        try { event.preventDefault(); } catch (_) {}
        try { event.stopPropagation(); } catch (_) {}

        if (!window.NqaExport?.hasSelection?.()) {
            window.NqaExport?.showToast?.('No rows selected', { anchor: trigger });
            return;
        }

        const selectionOptions = { columnIndex: columnDefinition.index };
        showCustomSubmenu(trigger, [
            {
                label: 'Copy selection',
                copy: true,
                onActivate: (actionEvent) => handleSelectionCopy(actionEvent, selectionOptions),
                onFormatSelect: async (format, actionEvent, toggle) => {
                    const returnFocusTarget = currentSubmenuTrigger;
                    await handleSelectionCopy(actionEvent, selectionOptions, null, format, toggle);
                    hideCustomSubmenu();
                    if (returnFocusTarget?.isConnected) {
                        try { returnFocusTarget.focus({ preventScroll: true }); } catch (_) {}
                    }
                },
            },
            {
                label: 'Download CSV',
                onActivate: (actionEvent) => handleSelectionDownload(actionEvent, selectionOptions),
            },
        ]);
    });

    const separator = buildMenuSeparator(container);
    if (separator) container.appendChild(separator);
    container.appendChild(outer);
    return true;
}

// Generic injection into a discovered native actions menu (Device View, etc.)
function tryInjectIntoRootMenu(rootMenuEl) {
    if (!rootMenuEl) return false;
    try {
        // Prevent duplicate injections within this menu
        if (rootMenuEl.querySelector(`[${INJECTED_ATTR}]`) || rootMenuEl.hasAttribute(INJECTION_PENDING_ATTR)) return true;
        // Resolve the controlling kebab button; native submenus use menuitems instead.
        const safeId = getSafeId(rootMenuEl);
        const btn = safeId ? document.querySelector(`button[aria-controls="${safeId}"]`) : null;
        if (!btn) return true;

        const pageContext = detectPageContext();
        if (pageContext === 'Investigations') {
            const cell = btn.closest('td, [role="gridcell"], [role="cell"]');
            if (!cell) {
                const columnDefinition = getInvestigationColumnDefinition(btn);
                if (!columnDefinition) return true;
                return injectColumnSelectionActions(rootMenuEl, columnDefinition);
            }
        }

        // On Device View multiple action menus exist (timeline, cards, etc.) but we only
        // want the two kebabs located in the header (device/user actions).
        try {
            if (pageContext === 'Device View') {
                const header = btn.closest('header[aria-label="Support header"]');
                if (!header) {
                    return true; // skip non-header menus inside Device View
                }
            }
        } catch (_) {
            // If context detection fails we fall back to previous behaviour.
        }
        // The configuration lookup below is asynchronous. Lock this menu until it
        // resolves so successive DOM mutations cannot queue duplicate insertions.
        rootMenuEl.setAttribute(INJECTION_PENDING_ATTR, '1');
        try { if (btn) initNqaPlaceholder(btn); } catch (_) {}

        // Filter menu asynchronously; only inject if there are eligible items
        getMenuFilteredByCurrentColumn((menus) => {
            try {
                if (!rootMenuEl.isConnected || !menus || !menus.length) return;
                // A previous callback may have completed while this lookup was pending.
                if (rootMenuEl.querySelector(`[${INJECTED_ATTR}]`)) return;

                // Container used to append our entry
                const container = rootMenuEl.querySelector('[role="menu"]') || rootMenuEl;

                // Build our submenu trigger (icon from a dedicated builder)
                const quickIconEl = buildQuickActionsIconSvg();
                const { outer, trigger } = buildSubmenuTrigger(container, 'Quick Actions', quickIconEl);

                outer.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Refresh placeholder for the current row just before rendering submenu
                    try { if (btn) initNqaPlaceholder(btn); } catch (_) {}
                    buildActionItemsForDevice((items) => {
                        try { showCustomSubmenu(trigger, items); } catch (_) {}
                    });
                });

                const sep = buildMenuSeparator(container);
                if (sep) container.appendChild(sep);
                container.appendChild(outer);
            } finally {
                rootMenuEl.removeAttribute(INJECTION_PENDING_ATTR);
            }
        });
        /*
        bus = getNqaEventBus();
        bus.dispatchEvent(new CustomEvent('nqaEvent', {
            detail: { rootMenuEl: rootMenuEl, button: btn }
        }));
        // */

        return true;
    } catch (_) {
        try { rootMenuEl.removeAttribute(INJECTION_PENDING_ATTR); } catch (_) {}
        return false;
    }
}

// Generic observer: watch for native actions menus being attached to the DOM (Device View, etc.)
try {
    const genericMenuObserver = new MutationObserver((muts) => {
        for (const m of muts) {
            for (const n of m.addedNodes) {
                if (!(n instanceof Element)) continue;
                // Direct match or within subtree
                let root = null;
                if (n.matches && n.matches('[role="menu"][id$="_actions"]')) root = n;
                else root = n.querySelector && n.querySelector('[role="menu"][id$="_actions"]');
                if (!root) continue;
                // Avoid duplicate injection
                if (root.querySelector(`[${INJECTED_ATTR}]`)) continue;
                tryInjectIntoRootMenu(root);
            }
        }
    });
    genericMenuObserver.observe(document.body, { childList: true, subtree: true });
} catch (_) { /* no-op */ }

// ----- Generic page context helpers (standalone, to be used later) -----
// Detects high-level page type from header h2: 'Device View' | 'Investigations' | ''
function detectPageContext() {
    try {
        const h2 = document.querySelector('header h2');
        const context = (h2?.textContent || '').trim();
        // Nexthink now renders the Investigations heading as a breadcrumb ("Investigations /").
        // Keep the high-level context stable when the breadcrumb suffix changes.
        if (/^Investigations(?:\s*\/|$)/.test(context)) return 'Investigations';
        return context;
    } catch (_) { return ''; }
}

// Extracts the table name from main h3 title, e.g. "1,20k Devices" → "Devices"
// Will be used for prefixing column keys
function getTableName() {
    try {
        const h3 = document.querySelector('main h3');
        const title = (h3?.title || '').trim();
        // Expect format like "1,20k Devices" or "567 Users"
        const match = title.match(/^[\d.,\s]*[kMGTPE]?[\s]+(\w+)/i);
        return match ? match[1] : '';
    } catch (_) { return ''; }
}

// Read the result table label shown above the investigation grid.
function getInvestigationResultTableName() {
    try {
        const h3 = document.querySelector('main h3');
        const heading = (h3?.title || h3?.textContent || '').replace(/\s+/g, ' ').trim();
        const match = heading.match(/^[\d.,]+\s*[kMGTPE]?\s+([^\s]+)/i) || heading.match(/^([^\s]+)/);
        return match?.[1] || '';
    } catch (_) { return ''; }
}

// Normalize a column header to a safe key: collapse non-alphanumerics to single underscore
function normalizeColumnKey(label) {
    let s = String(label || '')
        .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '') // zero-width chars
        .trim();
    // Prefix with table name to reduce key collisions across different tables
    s = getTableName() + '_' + s
    return s
        .toLowerCase()
        .replace(/[^A-Za-z0-9]+/g, '_') // any non-alnum → _
        .replace(/_+/g, '_')            // collapse multiple _
        .replace(/^_+|_+$/g, '');       // trim leading/trailing _
}

// Extract visible column labels for Investigations grid
function getInvestigationColumnKeys() {
    try {
        const nodes = document.querySelectorAll(INVESTIGATION_COLUMN_SELECTOR);
        const keys = [];
        nodes.forEach((el) => {
            // Prefer text nodes only (ignore <wbr>); fallback to textContent
            let text = '';
            try {
                text = Array.from(el.childNodes)
                    .filter((n) => n.nodeType === Node.TEXT_NODE)
                    .map((n) => n.textContent || '')
                    .join('')
                    .trim();
            } catch (_) { text = (el.textContent || '').trim(); }
            const key = normalizeColumnKey(text);
            if (key) keys.push(key);
        });
        return keys;
    } catch (_) { return []; }
}

// Build a placeholder object for a given Investigations row (<tr> or descendant)
function buildInvestigationPlaceholder(rowLike) {
    const obj = {table_name:'', columnName:'', rawValues: {} };
    const table_name = getTableName();
    if (!table_name) return obj;
    obj.table_name = table_name;

    // Derive normalized columnName from the kebab button if available
    const colName = getNqaColumnNameFromKebab(rowLike);
    if (colName) obj.columnName = colName;

    const keys = getInvestigationColumnKeys();
    // Initialize rawValues with empty strings
    keys.forEach((k) => { obj.rawValues[k] = ''; });
    if (!rowLike) return obj; // empty scaffold if no row provided
    try {
        const row = rowLike.closest ? rowLike.closest('tr, [role="row"]') : null;
        if (!row) return obj;
        const cells = Array.from(row.querySelectorAll('td:not(:has(input[type="checkbox"]))'));
        keys.forEach((k, i) => {
            const cell = cells[i];
            if (!cell) return;
            let val = '';
            try {
                // Prefer link text if present (common for device/user columns)
                const link = cell.querySelector('a, [role="link"]');
                val = (link?.textContent || cell.textContent || '').trim();
            } catch (_) { val = (cell.textContent || '').trim(); }
            obj.rawValues[k] = val;
        });
    } catch (_) { /* ignore */ }
    return obj;
}

// Build a placeholder object for Device View
function buildDeviceViewPlaceholder() {
    const obj = { table_name: 'device_view', columnName: '', rawValues: { devices_name: '', login_name: '', full_name: '', ad_name: '' } };
    try {
        // Device name from the page title
        const h1 = document.querySelector('[aria-label="Support header"] h1, header h1');
        obj.rawValues.devices_name = ((h1?.getAttribute('title') || h1?.textContent) || '').trim();
    } catch (_) {}

    try {
        const assoc = document.querySelector('[data-insights="associatedUser-openUserOverview"]');
        let login = '', full = '';
        if (assoc) {
            // Extract only the value spans (avoid labels/dialog triggers)
            const vals = Array.from(assoc.querySelectorAll('span:not([aria-haspopup="dialog"])'))
                .map((el) => (el.textContent || '').trim());
            login = vals[0] || '';
            full = vals[1] || '';
        }

        obj.rawValues.login_name = login;
        obj.rawValues.full_name = full;
        // Windows vs mac hint: suffix after @ equals deviceName → mac; else Windows AD
        const at = (login || '').split('@');
        if (at.length === 2) {
            const suffix = at[1] || '';
            // Keep only the username part
            obj.rawValues.login_name = at[0] || '';
            if (suffix && (!obj.rawValues.devices_name || suffix !== obj.rawValues.devices_name)) {
                obj.rawValues.ad_name = suffix;
            }
        }
    } catch (_) {}
    return obj;
}

// Public initializer to create/reset the global placeholder depending on context.
// - For Investigations: if a row is provided, fills values from that row; else keys only
// - For Device View: fills devices_name/login_name/full_name/(ad_name?)
function initNqaPlaceholder(rowLike) {
    try {
        const kind = detectPageContext();
        if (kind === 'Investigations') {
            window.nqaPlaceHolder = buildInvestigationPlaceholder(rowLike || null);
            return window.nqaPlaceHolder;
        }
        if (kind === 'Device View') {
            window.nqaPlaceHolder = buildDeviceViewPlaceholder();
            return window.nqaPlaceHolder;
        }
        // Unknown: initialize empty structure
        window.nqaPlaceHolder = { table_name: '', columnName: '', rawValues: {} };
        return window.nqaPlaceHolder;
    } catch (_) {
        window.nqaPlaceHolder = { table_name: '', columnName: '', rawValues: {} };
        return window.nqaPlaceHolder;
    }
}

// Lightweight global event bus for NQA events
function getNqaEventBus() {
    try {
        if (!window.nqaBusEvent) {
            window.nqaBusEvent = new EventTarget();
        }
        return window.nqaBusEvent;
    } catch (_) {
        // Fallback to document if EventTarget construction fails
        return document;
    }
}

// Independent listener: log NQA events to console
try {
    getNqaEventBus().addEventListener('nqaEvent', (e) => {
         try {
            console.log('[NQA][bus] nqaEvent:', e.detail);
            //initNqaPlaceholder(e.detail.rootMenuEl);
            console.log('[NQA][bus] current placeholder:', window.nqaPlaceHolder);
            let colName = getNqaColumnNameFromKebab(e.detail.rootMenuEl);
            console.log('[NQA][bus] derived column name:', colName);
        }
        catch (_) {}
    });
} catch (_) { /* no-op */ }

const SELECTION_MENU_SELECTORS = [
    '[role="menu"][class*="StyledActionsContainer"]',
    '[class*="StyledTableActionBar"] [role="menu"]',
    '[data-testid="selection-actions"]',
    '[data-testid*="selectionActions"]',
    '[data-testid*="bulkActions"]',
    '[data-testid*="selectedActions"]',
    '[class*="SelectionActions"]',
    '[class*="BulkActions"]',
    '[role="menu"][aria-label*="Selection"]',
    '[role="menu"][aria-label*="Selected"]',
    '[role="toolbar"][aria-label*="Selection"]',
    '[role="group"][aria-label*="Selection"]'
];

let selectionFeatureInitialized = false;      // Ensure we only bootstrap export helpers once
let selectionTableRef = null;                 // Current investigations table under watch
let selectionMenuRef = null;                  // Native menu where export actions are injected
let selectionMenuCleanup = null;              // Cleanup callback removing injected nodes
let selectionFallbackRef = null;              // Floating action bar fallback element
let selectionRefreshScheduled = false;        // requestAnimationFrame guard
let selectionCheckboxObserver = null;         // Observe checkbox attribute changes
let selectionTableObserver = null;            // Track table mount/unmount
let selectionContainerObserver = null;        // Watch for DOM reshuffles around the table

// Fetch export preferences from chrome.storage and apply them once export helpers are ready.
async function loadExportPreferences() {
    if (!window.NqaExport || !window.NqaConfigStore) return;
    try {
        const store = new window.NqaConfigStore();
        const prefs = await store.getExportPrefs();
        applyExportPreferences(prefs);
    } catch (_) { /* ignore */ }
}

// Push the provided export preferences into the shared runtime configuration.
function applyExportPreferences(prefs) {
    if (!window.NqaExport || !prefs || typeof prefs !== 'object') return;
    const cfg = {};
    if (typeof prefs.csvDelimiter === 'string' && prefs.csvDelimiter) {
        cfg.csvDelimiter = prefs.csvDelimiter;
    }
    if (typeof prefs.clipboardFormat === 'string' && prefs.clipboardFormat) {
        cfg.textFormat = prefs.clipboardFormat;
    }
    try { window.NqaExport.setConfig(cfg); } catch (_) {}
    refreshClipboardTooltips();
    refreshModifierIndicators();
}

// Lazily inject CSS for the injected export buttons and fallback bar.
function ensureSelectionActionStyles() {
    if (document.getElementById(SELECTION_ACTION_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SELECTION_ACTION_STYLE_ID;
    style.textContent = `
        .nqa-export-action-btn{cursor:pointer;padding:6px 12px;border-radius:6px;border:1px solid rgba(0,0,0,0.12);background:#ffffff;color:#1f1f1f;font-size:13px;line-height:1.4;transition:background .15s ease,border-color .15s ease}
        .nqa-export-action-btn:hover{background:#f4f4f6}
        .nqa-export-action-btn:focus{outline:2px solid #3578e5;outline-offset:2px}
        @media (prefers-color-scheme: dark){.nqa-export-action-btn{background:#2a2d33;color:#f2f4f8;border-color:rgba(255,255,255,0.24)}.nqa-export-action-btn:hover{background:#34373f}}
        #${SELECTION_FALLBACK_ID}{position:fixed;right:16px;bottom:24px;display:none;align-items:center;gap:8px;padding:10px 14px;background:rgba(34,34,34,0.92);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.18),0 2px 4px rgba(0,0,0,0.1);z-index:2147483647}
        #${SELECTION_FALLBACK_ID}.show{display:flex}
        #${SELECTION_FALLBACK_ID} .nqa-export-action-btn{border-color:rgba(255,255,255,0.2)}
        @media (prefers-color-scheme: dark){#${SELECTION_FALLBACK_ID}{background:rgba(17,17,17,0.92);box-shadow:0 8px 24px rgba(0,0,0,0.4),0 2px 4px rgba(0,0,0,0.32)}#${SELECTION_FALLBACK_ID} .nqa-export-action-btn{border-color:rgba(255,255,255,0.3)}}
        html[data-theme*="light"] [${SELECTION_MENU_ATTR}] .nqa-export-action-btn{background:#121212;color:#f6f7fb;border:0;text-align:left;white-space:nowrap}
        html[data-theme*="light"] [${SELECTION_MENU_ATTR}] .nqa-export-action-btn:hover{background:#1f1f1f}
        html[data-theme*="dark"] [${SELECTION_MENU_ATTR}] .nqa-export-action-btn,html[data-theme*="dark"] [${SELECTION_MENU_ATTR}] [${SELECTION_HOVER_ATTR}]{background:#f3f3f3;color:#1f1f1f;border:0;text-align:left;white-space:nowrap}
        html[data-theme*="dark"] [${SELECTION_MENU_ATTR}] .nqa-export-action-btn:hover{background:#c9c9c9}
        html[data-theme*="dark"] [${SELECTION_MENU_ATTR}] [${SELECTION_HOVER_ATTR}]:hover{background-color:#c9c9c9!important}
        [${SELECTION_BUTTON_ATTR}]{position:relative;overflow:visible!important}
        [${SELECTION_HOVER_ATTR}]{transition:background-color .12s ease}
        [${SELECTION_HOVER_ATTR}]:hover{background-color:var(--nqa-selection-hover-background)!important}
        [${SELECTION_BUTTON_ATTR}][data-nqa-modifier-active="1"]{box-shadow:0 0 0 2px rgba(53,120,229,0.45)}
        @media (prefers-color-scheme: dark){[${SELECTION_BUTTON_ATTR}][data-nqa-modifier-active="1"]{box-shadow:0 0 0 2px rgba(53,120,229,0.65)}}
        .nqa-export-modifier-chip{position:absolute;z-index:2147483645;left:50%;top:calc(100% + 6px);transform:translateX(-50%);display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;font-size:12px;line-height:1.2;background:rgba(53,120,229,0.12);color:#1f1f1f;box-shadow:0 6px 14px rgba(0,0,0,0.18)}
        #nca-custom-submenu .nqa-export-modifier-chip, ${SELECTION_ACTION_BAR_SELECTOR} .nqa-export-modifier-chip{position:static!important;left:auto!important;top:auto!important;transform:none!important;margin-left:8px}
        .nqa-export-modifier-chip[hidden]{display:none!important}
        @media (prefers-color-scheme: dark){.nqa-export-modifier-chip{background:rgba(53,120,229,0.28);color:#f2f4f8;box-shadow:0 6px 18px rgba(0,0,0,0.45)}}
        .nqa-copy-format-control{display:inline-flex!important;align-items:stretch;vertical-align:middle;min-width:0;border-radius:6px;background:var(--nqa-copy-format-control-background,transparent);--nqa-copy-format-control-background:transparent;--nqa-copy-format-hover-background:#f4f4f6}
        .nqa-copy-format-control>:first-child{flex:1 1 auto;min-width:0;padding-inline-end:6px!important;border-right:0!important;border-top-right-radius:0!important;border-bottom-right-radius:0!important;background:transparent!important}
        .nqa-copy-format-control>:first-child a[role="menuitem"]{background:transparent!important}
        .nqa-copy-format-control>.nqa-copy-format-toggle{background:transparent!important}
        .nqa-copy-format-control:is(:hover,:has(>.nqa-copy-format-popover:popover-open)){background:var(--nqa-copy-format-hover-background)!important}
        .nqa-copy-format-submenu-row{--nqa-copy-format-hover-background:rgba(0,0,0,.06)}
        .nqa-copy-format-submenu-row:is(:hover,:has(>.nqa-copy-format-popover:popover-open)){background:var(--nqa-copy-format-hover-background)!important}
        #nca-custom-submenu .nqa-copy-format-submenu-row a[role="menuitem"],#nca-custom-submenu .nqa-copy-format-submenu-row>.nqa-copy-format-toggle{background:transparent!important}
        .nqa-copy-format-toggle{appearance:none!important;display:inline-flex!important;flex:0 0 28px;align-items:center;justify-content:center;min-width:28px!important;margin:0!important;padding:0 4px!important;border:0!important;border-left:0!important;border-right:1px solid rgba(127,127,127,.35)!important;border-radius:0 6px 6px 0!important;color:inherit!important;font:inherit!important;line-height:1!important;opacity:.82;cursor:pointer}
        .nqa-copy-format-control:hover>.nqa-copy-format-toggle,.nqa-copy-format-control:has(>.nqa-copy-format-popover:popover-open)>.nqa-copy-format-toggle{opacity:1}
        .nqa-copy-format-toggle:hover{opacity:1}
        .nqa-copy-format-toggle:focus-visible{outline:2px solid #3578e5!important;outline-offset:1px}
        @media (prefers-color-scheme: dark){.nqa-copy-format-control{--nqa-copy-format-control-background:#2a2d33;--nqa-copy-format-hover-background:#34373f}}
        html[data-theme*="light"] [${SELECTION_MENU_ATTR}] .nqa-copy-format-control{--nqa-copy-format-control-background:#121212;--nqa-copy-format-hover-background:#1f1f1f}
        html[data-theme*="dark"] [${SELECTION_MENU_ATTR}] .nqa-copy-format-control{--nqa-copy-format-control-background:#f3f3f3;--nqa-copy-format-hover-background:#c9c9c9}
        html[data-theme*="light"] [${SELECTION_MENU_ATTR}] .nqa-copy-format-control>:first-child,html[data-theme*="light"] [${SELECTION_MENU_ATTR}] .nqa-copy-format-control>:first-child a[role="menuitem"],html[data-theme*="light"] [${SELECTION_MENU_ATTR}] .nqa-copy-format-control>.nqa-copy-format-toggle,html[data-theme*="dark"] [${SELECTION_MENU_ATTR}] .nqa-copy-format-control>:first-child,html[data-theme*="dark"] [${SELECTION_MENU_ATTR}] .nqa-copy-format-control>:first-child a[role="menuitem"],html[data-theme*="dark"] [${SELECTION_MENU_ATTR}] .nqa-copy-format-control>.nqa-copy-format-toggle{background:transparent!important}
        .nqa-copy-format-popover{position:fixed;min-inline-size:min(220px,calc(100vw - 16px));max-inline-size:calc(100vw - 16px);max-block-size:calc(100vh - 16px);width:max-content;overflow:auto;padding:6px;border:1px solid transparent;border-radius:11px;box-shadow:0 10px 28px rgba(0,0,0,.25);z-index:2147483647;box-sizing:border-box}
        .nqa-copy-format-popover:popover-open{display:flex;flex-direction:column;gap:2px}
        .nqa-copy-format-popover[data-theme="light"]{background:#202124;color:#f7f8fa;border-color:#383a3d}
        .nqa-copy-format-popover[data-theme="dark"]{background:#f7f8fa;color:#252a30;border-color:#d9dde2}
        .nqa-copy-format-heading{padding:7px 10px 0;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.75}
        .nqa-copy-format-option{appearance:none!important;display:flex!important;align-items:center;justify-content:space-between;gap:20px;width:100%;min-height:38px;margin:0!important;padding:7px 10px!important;border:0!important;border-radius:6px!important;background:transparent!important;color:inherit!important;font:inherit!important;font-size:14px!important;line-height:1.35!important;text-align:left;white-space:nowrap;cursor:pointer}
        .nqa-copy-format-popover[data-theme="light"] .nqa-copy-format-option:hover,.nqa-copy-format-popover[data-theme="light"] .nqa-copy-format-option:focus-visible{background:#393d42!important}
        .nqa-copy-format-popover[data-theme="dark"] .nqa-copy-format-option:hover,.nqa-copy-format-popover[data-theme="dark"] .nqa-copy-format-option:focus-visible{background:#e5eaf0!important}
        .nqa-copy-format-default{flex:none;padding:3px 7px;border-radius:999px;background:rgba(127,127,127,.2);font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
        @supports (position-area: block-end) and (position-try-fallbacks: flip-block){.nqa-copy-format-popover{inset:auto;margin:0;position-area:block-end span-inline-end;position-try-fallbacks:flip-block,flip-inline,flip-block flip-inline}}
        @supports not ((position-area: block-end) and (position-try-fallbacks: flip-block)){.nqa-copy-format-popover{inset:auto;margin:0}}
        #${SELECTION_FALLBACK_ID} .nqa-copy-format-control{color:#1f1f1f;--nqa-copy-format-control-background:#fff;--nqa-copy-format-hover-background:#f4f4f6}
        @media (prefers-color-scheme: dark){#${SELECTION_FALLBACK_ID} .nqa-copy-format-control{color:#f2f4f8;--nqa-copy-format-control-background:#2a2d33;--nqa-copy-format-hover-background:#34373f}}
        `;
    document.head.appendChild(style);
}

function getSelectionHoverBackground(textColor) {
    const channels = textColor.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (!channels || channels.length < 3) return 'rgba(0,0,0,0.06)';

    const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
    return luminance > 160 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';
}

function markSelectionHoverTarget(element, textColor) {
    element.setAttribute(SELECTION_HOVER_ATTR, '1');
    element.style.setProperty('--nqa-selection-hover-background', getSelectionHoverBackground(textColor));
}

// Clone a native menu item (button or link) to create a consistent export action.
function buildSelectionMenuEntry(container, label, onActivate) {
    const actionColor = getComputedStyle(container).color;
    const templateButton = container.querySelector(`button:not([${SELECTION_BUTTON_ATTR}])`);
    if (templateButton) {
        const clone = templateButton.cloneNode(true);
        try { clone.removeAttribute('id'); } catch (_) {}
        try { clone.removeAttribute('aria-controls'); } catch (_) {}
        try { clone.removeAttribute('aria-expanded'); } catch (_) {}
        try { clone.removeAttribute('data-insights'); } catch (_) {}
        try { clone.removeAttribute('data-testid'); } catch (_) {}
        try { clone.removeAttribute('style'); } catch (_) {}
        try { clone.removeAttribute('disabled'); } catch (_) {}
        try { clone.removeAttribute('aria-disabled'); } catch (_) {}
        clone.style.color = actionColor;
        clone.style.cursor = 'pointer';
        markSelectionHoverTarget(clone, actionColor);
        clone.setAttribute(SELECTION_BUTTON_ATTR, '1');
        clone.setAttribute('type', 'button');
        clone.setAttribute('role', 'menuitem');
        clone.setAttribute('aria-label', label);
        const span = clone.querySelector('span');
        if (span) span.textContent = label;
        else clone.textContent = label;
        clone.addEventListener('click', (event) => {
            try { event.preventDefault(); } catch (_) {}
            try { event.stopPropagation(); } catch (_) {}
            onActivate(event);
        }, { capture: true });
        return { root: clone, button: clone };
    }

    const templateLink = container.querySelector(`a[role="menuitem"]`);
    if (templateLink) {
        const outer = templateLink.closest('[class*="StyledActionMenuItemContainer"]');
        const wrapper = outer ? outer.cloneNode(true) : templateLink.cloneNode(true);
        const clickable = outer ? wrapper.querySelector('a[role="menuitem"]') : wrapper;
        markSelectionHoverTarget(wrapper, actionColor);
        if (clickable) {
            try { clickable.removeAttribute('href'); } catch (_) {}
            try { clickable.removeAttribute('target'); } catch (_) {}
            try { clickable.removeAttribute('rel'); } catch (_) {}
            try { clickable.removeAttribute('id'); } catch (_) {}
            try { clickable.removeAttribute('disabled'); } catch (_) {}
            try { clickable.removeAttribute('aria-disabled'); } catch (_) {}
            clickable.style.color = actionColor;
            clickable.style.cursor = 'pointer';
            clickable.setAttribute(SELECTION_BUTTON_ATTR, '1');
            clickable.setAttribute('role', 'menuitem');
            const span = clickable.querySelector('span');
            if (span) span.textContent = label;
            else clickable.textContent = label;
            clickable.addEventListener('click', (event) => {
                try { event.preventDefault(); } catch (_) {}
                try { event.stopPropagation(); } catch (_) {}
                onActivate(event);
            });
        }
        return { root: wrapper, button: clickable || wrapper };
    }

    ensureSelectionActionStyles();
    const fallback = document.createElement('button');
    fallback.type = 'button';
    fallback.className = 'nqa-export-action-btn';
    fallback.textContent = label;
    fallback.setAttribute(SELECTION_BUTTON_ATTR, '1');
    fallback.addEventListener('click', (event) => {
        try { event.preventDefault(); } catch (_) {}
        try { event.stopPropagation(); } catch (_) {}
        onActivate(event);
    });
    return { root: fallback, button: fallback };
}

// Insert a neutral Spark icon menu item purely as a visual separator.
function buildSparkIconMenuItem(container) {
    try {
        const refItem = container.querySelector('[class*="StyledActionMenuItemContainer"]');
        const wrapper = refItem ? refItem.cloneNode(false) : document.createElement('div');
        if (wrapper.hasAttribute) {
            try { wrapper.removeAttribute('id'); } catch (_) {}
            try { wrapper.removeAttribute('data-testid'); } catch (_) {}
        }
        wrapper.setAttribute(INJECTED_ATTR, '1');

        const contentsRef = refItem ? refItem.querySelector('[class*="StyledContents"]') : null;
        const contents = contentsRef ? contentsRef.cloneNode(false) : document.createElement('div');
        if (contents.setAttribute) contents.setAttribute(INJECTED_ATTR, '1');

        const holder = document.createElement('span');
        holder.setAttribute('role', 'presentation');
        holder.setAttribute(SELECTION_BUTTON_ATTR, '1');
        holder.style.display = 'inline-flex';
        holder.style.alignItems = 'center';
        holder.style.justifyContent = 'center';
        holder.style.padding = '6px 0';

        const icon = buildQuickActionsIconSvg();
        if (icon) {
            icon.setAttribute('width', '16');
            icon.setAttribute('height', '16');
            icon.style.width = '16px';
            icon.style.height = '16px';
            holder.appendChild(icon);
        }

        contents.appendChild(holder);
        wrapper.appendChild(contents);
        return wrapper;
    } catch (_) {
        return null;
    }
}

// Produce a human-friendly toast message describing the export outcome.
function buildSelectionFeedback(action, payload, formatLabel) {
    const verb = action === 'download' ? 'Exported' : 'Copied';
    const rows = payload?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return `No rows ${verb.toLowerCase()}.`;

    const count = Number.isFinite(payload?.feedbackCount) ? payload.feedbackCount : rows.length;
    const noun = count === 1 ? 'row' : 'rows';
    const total = typeof payload?.totalSelected === 'number' ? payload.totalSelected : count;
    let message = '';
    if (payload?.truncated && total > count) {
        const limit = typeof payload?.limitUsed === 'number'
            ? payload.limitUsed
            : window.NqaExport?.MAX_ROWS_DEFAULT || 200;
        message = `${verb} ${count} of ${total} ${noun} (limit ${limit}).`;
    } else {
        message = `${verb} ${count} ${noun}.`;
    }
    if (formatLabel) return `${message} (${formatLabel})`;
    return message;
}

// Lightweight visibility check for Nexthink popovers (helps avoid injecting into hidden elements).
function isElementVisible(el) {
    if (!el) return false;
    try {
        const cs = window.getComputedStyle(el);
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (parseFloat(cs.opacity || '1') === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect && rect.width > 0 && rect.height > 0;
    } catch (_) { return false; }
}

// Return the selection action menu rendered inside the portalized action bar, if any.
function findSelectionMenuViaActionBar() {
    const nodes = document.querySelectorAll(SELECTION_ACTION_BAR_SELECTOR);
    for (const node of nodes) {
        if (!node || !isElementVisible(node)) continue;
        const menu = node.querySelector('[role="menu"]');
        if (menu && isElementVisible(menu)) return menu;
    }
    return null;
}

// Legacy fallback: scan known selectors in case the action bar attribute is unavailable.
function findSelectionMenuViaFallbackSelectors() {
    for (const selector of SELECTION_MENU_SELECTORS) {
        const candidate = document.querySelector(selector);
        if (!candidate) continue;
        if (candidate.id && candidate.id === SELECTION_FALLBACK_ID) continue;
        //if (!isElementVisible(candidate)) continue;
        return candidate;
    }
    return null;
}

// Locate the currently visible selection bulk-action container provided by Nexthink.
function findSelectionMenuContainer() {
    const portalMenu = findSelectionMenuViaActionBar();
    if (portalMenu) return portalMenu;
    return findSelectionMenuViaFallbackSelectors();
}

// Remove previously injected export buttons and clean their event handlers.
function teardownSelectionMenu() {
    if (selectionMenuCleanup) {
        try { selectionMenuCleanup(); } catch (_) {}
        selectionMenuCleanup = null;
    }
    if (selectionMenuRef) {
        try { selectionMenuRef.removeAttribute(SELECTION_MENU_ATTR); } catch (_) {}
        selectionMenuRef = null;
    }
}

// Inject separators, Spark icon, and export buttons into the native selection menu.
function injectSelectionMenu(menu) {
    if (!menu) return false;
    ensureSelectionActionStyles();
    if (menu === selectionMenuRef) {
        if (menu.querySelector(`[${SELECTION_BUTTON_ATTR}]`)) return true;
    } else {
        teardownSelectionMenu();
    }

    const copyEntry = buildSelectionMenuEntry(menu, 'Copy selection', handleSelectionCopy);
    const csvEntry = buildSelectionMenuEntry(menu, 'Download\u00a0CSV', handleSelectionDownload);
    const viewEntry = buildSelectionMenuEntry(menu, 'View', handleSelectionView);
    const copyTarget = copyEntry ? (copyEntry.button || copyEntry.root) : null;
    const copyControl = copyEntry && copyTarget
        ? buildCopyFormatControl(copyEntry.root, copyTarget, (format, event) =>
            handleSelectionCopy(event, null, null, format, copyTarget))
        : null;
    const frag = document.createDocumentFragment();

    const separatorBefore = buildMenuSeparator(menu) || document.createElement('div');
    if (!separatorBefore.hasAttribute?.(INJECTED_ATTR)) separatorBefore.setAttribute?.(INJECTED_ATTR, '1');
    frag.appendChild(separatorBefore);

    const sparkItem = buildSparkIconMenuItem(menu);
    if (sparkItem) frag.appendChild(sparkItem);

    const separatorAfter = buildMenuSeparator(menu) || document.createElement('div');
    if (!separatorAfter.hasAttribute?.(INJECTED_ATTR)) separatorAfter.setAttribute?.(INJECTED_ATTR, '1');
    frag.appendChild(separatorAfter);

    if (copyControl?.root) {
        frag.appendChild(copyControl.root);
    } else if (copyEntry?.root) {
        frag.appendChild(copyEntry.root);
    }
    if (csvEntry?.root) frag.appendChild(csvEntry.root);
    if (viewEntry?.root) frag.appendChild(viewEntry.root);

    try { menu.appendChild(frag); }
    catch (_) { return false; }

    if (copyTarget) {
        copyTarget.setAttribute('data-nqa-export-copy', '1');
        registerClipboardTooltipTarget(copyTarget);
        registerModifierIndicatorTarget(copyTarget);
    }

    selectionMenuRef = menu;
    try { menu.setAttribute(SELECTION_MENU_ATTR, '1'); } catch (_) {}
    selectionMenuCleanup = () => {
        try { separatorBefore.remove(); } catch (_) {}
        try { separatorAfter.remove(); } catch (_) {}
        try { sparkItem?.remove(); } catch (_) {}
        if (copyTarget) {
            unregisterModifierIndicatorTarget(copyTarget);
            unregisterClipboardTooltipTarget(copyTarget);
        }
        if (copyControl?.root) { try { copyControl.root.remove(); } catch (_) {} }
        else if (copyEntry?.root) { try { copyEntry.root.remove(); } catch (_) {} }
        if (csvEntry?.root) {
            try { csvEntry.root.remove(); } catch (_) {}
        }
        if (viewEntry?.root) {
            try { viewEntry.root.remove(); } catch (_) {}
        }
    };
    return true;
}

// Create (or reveal) the floating fallback action bar when the native menu is missing.
function ensureFallbackBar() {
    ensureSelectionActionStyles();
    let bar = document.getElementById(SELECTION_FALLBACK_ID);
    if (!bar) {
        bar = document.createElement('div');
        bar.id = SELECTION_FALLBACK_ID;
        bar.className = 'nqa-export-floating-bar';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'nqa-export-action-btn';
        copyBtn.textContent = 'Copy selection';
        copyBtn.setAttribute(SELECTION_BUTTON_ATTR, '1');
        copyBtn.setAttribute('data-nqa-export-copy', '1');
        copyBtn.addEventListener('click', handleSelectionCopy);
        const copyControl = buildCopyFormatControl(copyBtn, copyBtn, (format, event) =>
            handleSelectionCopy(event, null, null, format, copyBtn));

        const csvBtn = document.createElement('button');
        csvBtn.type = 'button';
        csvBtn.className = 'nqa-export-action-btn';
        csvBtn.textContent = 'Download CSV';
        csvBtn.setAttribute(SELECTION_BUTTON_ATTR, '1');
        csvBtn.addEventListener('click', handleSelectionDownload);

        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'nqa-export-action-btn';
        viewBtn.textContent = 'View';
        viewBtn.setAttribute(SELECTION_BUTTON_ATTR, '1');
        viewBtn.setAttribute('aria-label', 'View selected rows');
        viewBtn.addEventListener('click', handleSelectionView);

        bar.appendChild(copyControl.root);
        bar.appendChild(csvBtn);
        bar.appendChild(viewBtn);
        document.body.appendChild(bar);
        registerClipboardTooltipTarget(copyBtn);
        registerModifierIndicatorTarget(copyBtn);
    }
    bar.classList.add('show');
    selectionFallbackRef = bar;
    refreshClipboardTooltips();
    refreshModifierIndicators();
    return bar;
}

// Hide the floating fallback bar when no selection remains.
function hideFallbackBar() {
    if (selectionFallbackRef) {
        selectionFallbackRef.classList.remove('show');
    }
}

function getSelectionViewTheme() {
    const theme = String(document.documentElement.getAttribute('data-theme') || '').toLowerCase();
    if (theme.includes('dark')) return 'dark';
    if (theme.includes('light')) return 'light';

    try {
        const background = getComputedStyle(document.body).backgroundColor;
        const channels = background.match(/[\d.]+/g)?.map(Number);
        if (channels?.length >= 3 && (channels.length < 4 || channels[3] > 0)) {
            const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
            return luminance < 128 ? 'dark' : 'light';
        }
    } catch (_) { /* use the browser preference below */ }

    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Use the largest visible table text size as the lower bound for the form font.
function getSelectionViewBaseFontSize() {
    const table = document.querySelector(INVESTIGATION_TABLE_SELECTOR);
    if (!table) return 14;

    let baseFontSize = 14;
    const textCells = table.querySelectorAll('th[rowspan="1"], td, [role="columnheader"], [role="gridcell"]');
    const textElements = new Set();
    textCells.forEach((cell) => {
        textElements.add(cell);
        cell.querySelectorAll('*').forEach((element) => {
            const hasOwnText = Array.from(element.childNodes).some((node) =>
                node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim()
            );
            if (hasOwnText) textElements.add(element);
        });
    });
    textElements.forEach((cell) => {
        try {
            const rect = cell.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const fontSize = parseFloat(getComputedStyle(cell).fontSize);
            if (Number.isFinite(fontSize)) baseFontSize = Math.max(baseFontSize, fontSize);
        } catch (_) { /* ignore unavailable cells */ }
    });
    return baseFontSize;
}

// Grow the form text for short forms; keep the source-table size as a hard minimum.
function getSelectionViewFontSize(fieldCount) {
    const baseFontSize = getSelectionViewBaseFontSize();
    const maxFontSize = Math.min(22, baseFontSize + 4);
    const viewportHeight = window.innerHeight || 800;
    const availableBodyHeight = Math.min(560, Math.max(180, viewportHeight * 0.62));
    const estimatedFontSize = availableBodyHeight / Math.max(1, fieldCount) / 2.7;
    const fontSize = Math.max(baseFontSize, Math.min(maxFontSize, estimatedFontSize));
    return Math.round(fontSize * 10) / 10;
}

function ensureSelectionViewStyles() {
    if (document.getElementById(SELECTION_VIEW_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SELECTION_VIEW_STYLE_ID;
    style.textContent = `
        #${SELECTION_VIEW_OVERLAY_ID}{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:16px;background:rgba(9,17,28,.44);font-family:inherit;color:#202a36}
        #${SELECTION_VIEW_OVERLAY_ID} *{box-sizing:border-box}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-dialog{display:flex;flex-direction:column;width:min(760px,100%);max-height:calc(100vh - 32px);border:1px solid #dbe2ea;border-radius:16px;background:#fff;color:#202a36;box-shadow:0 18px 52px rgba(0,0,0,.28);font-size:var(--nqa-selection-view-font-size,14px);overflow:hidden}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-header{flex:0 0 auto;padding:22px 26px 18px;border-bottom:1px solid #e3e8ee}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-title{margin:0;font-size:1.35em;line-height:1.25;font-weight:650}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-fields{flex:1 1 auto;min-height:0;max-height:min(62vh,560px);overflow:auto;padding:16px 20px;overscroll-behavior:contain}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:1em}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table th,#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table td{width:auto;padding:.65em 1em;border-bottom:1px solid #e1e6ed;text-align:left;vertical-align:top;line-height:1.4;overflow-wrap:anywhere;white-space:pre-wrap}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table th{width:40%;font-weight:600;color:#536174}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table td{font-weight:400;color:#202a36}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table tr:nth-child(odd) th,#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table tr:nth-child(odd) td{background:#f2f5f8}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table tr:nth-child(even) th,#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table tr:nth-child(even) td{background:#fff}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table tr:last-child th,#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table tr:last-child td{border-bottom:0}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-footer{display:flex;flex:0 0 auto;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #e3e8ee}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-count{min-width:3.5em;font-weight:650;color:#354254;font-variant-numeric:tabular-nums}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-keyboard-hint{font-size:.8em;color:#788597;white-space:nowrap}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-export-modifier-chip{position:static!important;left:auto!important;top:auto!important;transform:none!important;margin-left:8px}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-spacer{flex:1 1 0}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-actions{display:flex;flex:0 0 auto;align-items:center;gap:8px}
        #${SELECTION_VIEW_OVERLAY_ID} button{min-width:44px;min-height:44px;padding:8px 12px;border:1px solid #cbd3dd;border-radius:9px;background:#fff;color:#263342;font:inherit;line-height:1;cursor:pointer}
        #${SELECTION_VIEW_OVERLAY_ID} button:hover:not(:disabled){background:#edf3fb;border-color:#9db5d4}
        #${SELECTION_VIEW_OVERLAY_ID} button:focus-visible{outline:2px solid #3578e5;outline-offset:2px}
        #${SELECTION_VIEW_OVERLAY_ID} button:disabled{background:#f0f2f5;color:#a6aeb9;border-color:#e0e4e9;cursor:default}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-copy,#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-close{min-width:96px;font-weight:600}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-copy{border-top-right-radius:0;border-bottom-right-radius:0;border-right:0}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-copy-format-toggle{min-width:28px!important;border:1px solid #cbd3dd!important;border-left:0!important;border-radius:0 9px 9px 0!important;color:#263342!important;opacity:1}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="light"] .nqa-copy-format-control{border-radius:9px;--nqa-copy-format-control-background:#fff;--nqa-copy-format-hover-background:#f3f6fa}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-copy-format-control{border-radius:9px;--nqa-copy-format-control-background:#292f38;--nqa-copy-format-hover-background:#343c48}
        #${SELECTION_VIEW_OVERLAY_ID} .nqa-copy-format-control>:first-child,#${SELECTION_VIEW_OVERLAY_ID} .nqa-copy-format-control>.nqa-copy-format-toggle{background:transparent!important}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"]{background:rgba(0,0,0,.62);color:#f1f4f8}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-dialog{border-color:#454d59;background:#292f38;color:#f1f4f8;box-shadow:0 18px 52px rgba(0,0,0,.58)}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-header,#${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-footer{border-color:#424a56}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-table th{border-color:#424a56;color:#b9c4d2}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-table td{border-color:#424a56;color:#f1f4f8}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-table tr:nth-child(odd) th,#${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-table tr:nth-child(odd) td{background:#333a45}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-table tr:nth-child(even) th,#${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-table tr:nth-child(even) td{background:#292f38}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-count{color:#e6ebf2}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-keyboard-hint{color:#9ca8b8}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] button{border-color:#586271;background:#292f38;color:#f0f3f7}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] button:hover:not(:disabled){border-color:#7085a1;background:#343c48}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] button:disabled{border-color:#464e5a;background:#343a44;color:#788392}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-next:not(:disabled){border-color:#416b9c;background:#304a6e;color:#d6e8ff}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-selection-view-copy{border-color:#586271;border-right:0}
        #${SELECTION_VIEW_OVERLAY_ID}[data-theme="dark"] .nqa-copy-format-toggle{border-color:#586271!important;color:#f0f3f7!important}
        @media(max-width:560px){#${SELECTION_VIEW_OVERLAY_ID}{padding:10px}#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-dialog{max-height:calc(100vh - 20px)}#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-header{padding:18px 16px 14px}#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-fields{padding:12px}#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table th,#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-table td{padding:.6em .7em}#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-footer{gap:6px;padding:12px 10px}#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-keyboard-hint{font-size:.72em}#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-actions{gap:4px}#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-copy,#${SELECTION_VIEW_OVERLAY_ID} .nqa-selection-view-close{min-width:64px;padding:8px 6px}#${SELECTION_VIEW_OVERLAY_ID} .nqa-copy-format-toggle{min-width:28px!important;padding:8px 4px!important}}
    `;
    document.head.appendChild(style);
}

function closeSelectionRowView() {
    if (selectionViewCleanup) selectionViewCleanup();
}

function openSelectionRowView(payload, returnFocusTarget) {
    closeSelectionRowView();
    ensureSelectionViewStyles();

    const headers = Array.isArray(payload?.headers) ? payload.headers : [];
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (!headers.length || !rows.length) return false;

    const previousFocus = returnFocusTarget instanceof Element ? returnFocusTarget : document.activeElement;
    const overlay = document.createElement('div');
    overlay.id = SELECTION_VIEW_OVERLAY_ID;
    overlay.setAttribute('data-theme', getSelectionViewTheme());
    overlay.style.setProperty('--nqa-selection-view-font-size', `${getSelectionViewFontSize(headers.length)}px`);

    const dialog = document.createElement('section');
    dialog.className = 'nqa-selection-view-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', `${SELECTION_VIEW_OVERLAY_ID}-title`);

    const header = document.createElement('header');
    header.className = 'nqa-selection-view-header';
    const title = document.createElement('h2');
    title.id = `${SELECTION_VIEW_OVERLAY_ID}-title`;
    title.className = 'nqa-selection-view-title';
    title.textContent = 'Selected item';
    header.appendChild(title);

    const fields = document.createElement('div');
    fields.className = 'nqa-selection-view-fields';
    fields.setAttribute('role', 'region');
    fields.setAttribute('aria-label', 'Selected item details');
    fields.tabIndex = 0;
    const table = document.createElement('table');
    table.className = 'nqa-selection-view-table';
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    fields.appendChild(table);

    const footer = document.createElement('footer');
    footer.className = 'nqa-selection-view-footer';
    const count = document.createElement('span');
    count.className = 'nqa-selection-view-count';
    count.setAttribute('aria-live', 'polite');

    const previousButton = document.createElement('button');
    previousButton.type = 'button';
    previousButton.setAttribute('aria-label', 'Previous selected item');
    previousButton.textContent = '←';

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'nqa-selection-view-next';
    nextButton.setAttribute('aria-label', 'Next selected item');
    nextButton.textContent = '→';

    const keyboardHint = document.createElement('span');
    keyboardHint.className = 'nqa-selection-view-keyboard-hint';
    keyboardHint.textContent = 'Esc to close';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'nqa-selection-view-copy';
    copyButton.setAttribute('aria-label', 'Copy displayed item');
    copyButton.setAttribute(SELECTION_BUTTON_ATTR, '1');
    copyButton.setAttribute('data-nqa-export-copy', '1');
    copyButton.textContent = 'Copy';

    const spacerBeforeHint = document.createElement('span');
    spacerBeforeHint.className = 'nqa-selection-view-spacer';
    const spacerAfterHint = document.createElement('span');
    spacerAfterHint.className = 'nqa-selection-view-spacer';
    const actions = document.createElement('div');
    actions.className = 'nqa-selection-view-actions';
    const copyCurrentView = (event, formatOverride = null, anchor = copyButton) => {
        const currentRow = Array.isArray(rows[currentIndex]) ? rows[currentIndex] : [];
        const transposedRows = headers.map((label, columnIndex) => [
            String(label || `Column ${columnIndex + 1}`),
            currentRow[columnIndex] ?? '',
        ]);
        return handleSelectionCopy(event, null, {
            ...payload,
            headers: [getInvestigationResultTableName() || 'Table', 'Value'],
            rows: transposedRows,
            feedbackCount: 1,
            totalSelected: 1,
            limitUsed: 1,
            truncated: false,
        }, formatOverride, anchor);
    };
    const copyControl = buildCopyFormatControl(copyButton, copyButton, (format, event, toggle) =>
        copyCurrentView(event, format, toggle));
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'nqa-selection-view-close';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', closeSelectionRowView);
    actions.append(copyControl.root, closeButton);

    footer.append(count, previousButton, nextButton, spacerBeforeHint, keyboardHint, spacerAfterHint, actions);
    dialog.append(header, fields, footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const onOverlayClick = (event) => {
        if (event.target === overlay) closeSelectionRowView();
    };
    overlay.addEventListener('click', onOverlayClick);
    registerClipboardTooltipTarget(copyButton);
    registerModifierIndicatorTarget(copyButton);

    let currentIndex = 0;
    const renderRow = () => {
        const values = Array.isArray(rows[currentIndex]) ? rows[currentIndex] : [];
        const fragment = document.createDocumentFragment();
        headers.forEach((label, columnIndex) => {
            const row = document.createElement('tr');
            const nameCell = document.createElement('th');
            nameCell.scope = 'row';
            nameCell.textContent = String(label || `Column ${columnIndex + 1}`);
            const valueCell = document.createElement('td');
            valueCell.textContent = String(values[columnIndex] ?? '');
            row.append(nameCell, valueCell);
            fragment.appendChild(row);
        });
        tbody.replaceChildren(fragment);
        count.textContent = `${currentIndex + 1} / ${rows.length}`;
        previousButton.disabled = currentIndex === 0;
        nextButton.disabled = currentIndex === rows.length - 1;
        fields.scrollTop = 0;
    };

    const showPreviousRow = () => {
        if (currentIndex > 0) {
            currentIndex -= 1;
            renderRow();
        }
    };
    const showNextRow = () => {
        if (currentIndex < rows.length - 1) {
            currentIndex += 1;
            renderRow();
        }
    };
    previousButton.addEventListener('click', showPreviousRow);
    nextButton.addEventListener('click', showNextRow);
    copyButton.addEventListener('click', (event) => copyCurrentView(event));

    const onKeyDown = (event) => {
        if (event.key === 'Escape') {
            const openCopyPopover = overlay.querySelector('.nqa-copy-format-popover:popover-open');
            if (openCopyPopover) {
                event.preventDefault();
                event.stopPropagation();
                try { openCopyPopover.hidePopover(); } catch (_) {}
                try { openCopyPopover.previousElementSibling?.focus({ preventScroll: true }); } catch (_) {}
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            closeSelectionRowView();
            return;
        }
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            showPreviousRow();
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            showNextRow();
        }
    };
    document.addEventListener('keydown', onKeyDown, true);

    const themeObserver = typeof MutationObserver === 'function' ? new MutationObserver(() => {
        overlay.setAttribute('data-theme', getSelectionViewTheme());
    }) : null;
    try { themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] }); } catch (_) {}

    selectionViewCleanup = () => {
        try { document.removeEventListener('keydown', onKeyDown, true); } catch (_) {}
        try { overlay.removeEventListener('click', onOverlayClick); } catch (_) {}
        try { themeObserver?.disconnect(); } catch (_) {}
        unregisterModifierIndicatorTarget(copyButton);
        unregisterClipboardTooltipTarget(copyButton);
        try { overlay.remove(); } catch (_) {}
        selectionViewCleanup = null;
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
            try { previousFocus.focus({ preventScroll: true }); } catch (_) {}
        }
    };

    renderRow();
    closeButton.focus({ preventScroll: true });
    return true;
}

function handleSelectionView(event) {
    let anchor = null;
    if (event) {
        try { event.preventDefault(); } catch (_) {}
        try { event.stopPropagation(); } catch (_) {}
        anchor = event.currentTarget instanceof Element
            ? event.currentTarget
            : event.target?.closest(`[${SELECTION_BUTTON_ATTR}], button, [role="menuitem"]`);
    }

    const api = window.NqaExport;
    if (!api || typeof api.collectSelectionData !== 'function') return;
    const payload = api.collectSelectionData({ includeAll: true });
    if (!payload.rows?.length || !payload.headers?.length) {
        api.showToast('No selected rows to view.', { anchor });
        return;
    }
    if (!openSelectionRowView(payload, anchor)) {
        api.showToast('Unable to read selected rows.', { anchor });
    }
}

// Handle click on "Copy selection" (collect data, build clipboard payload, show toast).
async function handleSelectionCopy(event, collectOptions, payloadOverride = null, explicitFormat = null, anchorOverride = null) {
    let anchor = null;
    if (event) {
        try { event.preventDefault(); } catch (_) {}
        try { event.stopPropagation(); } catch (_) {}
        anchor = (event.currentTarget instanceof Element)
            ? event.currentTarget
            : event.target?.closest(`[${SELECTION_BUTTON_ATTR}], button, [role="menuitem"]`);
    }
    if (anchorOverride instanceof Element) anchor = anchorOverride;
    const api = window.NqaExport;
    if (!api) return;
    const payload = payloadOverride || api.collectSelectionData(collectOptions);
    if (payload.columnMissing) {
        api.showToast('Unable to read selected column', { anchor });
        return;
    }
    if (!Array.isArray(payload.rows) || !payload.rows.length) {
        api.showToast('No rows selected', { anchor });
        return;
    }
    const modifier = explicitFormat ? null : getActiveModifierState();
    const formatOverride = explicitFormat || modifier?.format || null;
    const clipboardData = api.buildClipboardData
        ? api.buildClipboardData(payload, formatOverride)
        : { plain: api.buildPlainText(payload, formatOverride || undefined) };
    const ok = await api.copyToClipboard(clipboardData);
    const formatLabel = explicitFormat
        ? describeClipboardFormatForUi(explicitFormat)
        : modifier?.label || '';
    api.showToast(ok ? buildSelectionFeedback('copy', payload, formatLabel) : 'Unable to copy selection', { anchor });
}

// Handle click on "Download CSV" (collect data, serialize, show toast).
function handleSelectionDownload(event, collectOptions) {
    let anchor = null;
    if (event) {
        try { event.preventDefault(); } catch (_) {}
        try { event.stopPropagation(); } catch (_) {}
        anchor = (event.currentTarget instanceof Element)
            ? event.currentTarget
            : event.target?.closest(`[${SELECTION_BUTTON_ATTR}], button, [role="menuitem"]`);
    }
    const api = window.NqaExport;
    if (!api) return;
    const payload = api.collectSelectionData(collectOptions);
    if (payload.columnMissing) {
        api.showToast('Unable to read selected column', { anchor });
        return;
    }
    if (!Array.isArray(payload.rows) || !payload.rows.length) {
        api.showToast('No rows selected', { anchor });
        return;
    }
    const csv = api.buildCsvString(payload);
    const saved = api.downloadCsv(csv);
    api.showToast(saved ? buildSelectionFeedback('download', payload) : 'Unable to export selection', { anchor });
}

// Debounce refresh of injected actions after DOM mutations / checkbox toggles.
function scheduleSelectionRefresh() {
    if (selectionRefreshScheduled) return;
    selectionRefreshScheduled = true;
    const runner = () => {
        selectionRefreshScheduled = false;
        refreshSelectionExport();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(runner);
    else setTimeout(runner, 60);
}

// Decide where to render export actions (native menu vs fallback bar) based on current selection.
function refreshSelectionExport() {
    const api = window.NqaExport;
    if (!api) return;
    const ctx = (typeof detectPageContext === 'function') ? detectPageContext() : '';
    if (ctx && ctx !== 'Investigations') {
        teardownSelectionMenu();
        hideFallbackBar();
        return;
    }
    const summary = api.getSelectionSummary();
    if (!summary || !summary.checked) {
        teardownSelectionMenu();
        hideFallbackBar();
        return;
    }
    const menu = findSelectionMenuContainer();
    if (menu && injectSelectionMenu(menu)) {
        hideFallbackBar();
        return;
    }
    ensureFallbackBar();
}

// React to checkbox clicks/changes to keep the export menu up to date.
function handleCheckboxInteraction(event) {
    const target = event?.target;
    if (!target || typeof target.closest !== 'function') return;
    const checkbox = target.matches(SELECTION_CHECKBOX_SELECTOR)
        ? target
        : target.closest(SELECTION_CHECKBOX_SELECTOR);
    if (!checkbox) return;
    scheduleSelectionRefresh();
}

// Track the investigations table lifecycle and attach observers + event listeners.
function bindSelectionTable() {
    const table = document.querySelector(INVESTIGATION_TABLE_SELECTOR);
    if (table === selectionTableRef) return;

    if (selectionTableRef) {
        try { selectionTableRef.removeEventListener('change', handleCheckboxInteraction, true); } catch (_) {}
        try { selectionTableRef.removeEventListener('click', handleCheckboxInteraction, true); } catch (_) {}
    }

    selectionTableRef = table;

    if (!table) {
        if (selectionCheckboxObserver) selectionCheckboxObserver.disconnect();
        if (selectionContainerObserver) selectionContainerObserver.disconnect();
        return;
    }

    table.addEventListener('change', handleCheckboxInteraction, true);
    table.addEventListener('click', handleCheckboxInteraction, true);

    if (selectionCheckboxObserver) {
        selectionCheckboxObserver.disconnect();
        selectionCheckboxObserver.observe(table, { attributes: true, attributeFilter: ['checked', 'aria-checked'], subtree: true });
    }

    if (selectionContainerObserver) {
        selectionContainerObserver.disconnect();
        const parent = table.parentElement;
        if (parent) {
            selectionContainerObserver.observe(parent, { childList: true, subtree: true });
        }
    }

    scheduleSelectionRefresh();
}

// One-time bootstrap for export helpers: load prefs, register observers, bind table.
function initSelectionExportFeature() {
    if (selectionFeatureInitialized) return;
    if (!window.NqaExport) {
        setTimeout(initSelectionExportFeature, 60);
        return;
    }
    selectionFeatureInitialized = true;

    loadExportPreferences();

    if (typeof MutationObserver !== 'undefined') {
        selectionCheckboxObserver = new MutationObserver(() => scheduleSelectionRefresh());
        selectionTableObserver = new MutationObserver(() => bindSelectionTable());
        selectionContainerObserver = new MutationObserver(() => scheduleSelectionRefresh());
        selectionTableObserver.observe(document.body, { childList: true, subtree: true });
    }

    bindSelectionTable();
    scheduleSelectionRefresh();
}

initSelectionExportFeature();

try {
    chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || msg.type !== 'nqa-export-prefs-updated') return;
        if (msg.prefs) applyExportPreferences(msg.prefs);
        else loadExportPreferences();
    });
} catch (_) { /* ignore */ }

try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (changes?.exportPrefs) {
            const next = changes.exportPrefs.newValue;
            if (next) applyExportPreferences(next);
            else loadExportPreferences();
        }
    });
} catch (_) { /* ignore */ }
