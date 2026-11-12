(function (global) {
    'use strict';

    const TABLE_SELECTOR = 'table[role="presentation"]';
    const CHECKBOX_SELECTOR = "input[type='checkbox']";
    const HEADER_SELECTOR = 'th[rowspan="1"]';
    const HEADER_LABEL_SELECTOR = 'div[class*="LinesEllipsis"]';
    const MAX_ROWS_DEFAULT = 200;
    const TOAST_ID = 'nqa-export-toast';
    const TOAST_STYLE_ID = 'nqa-export-toast-style';
    const TOAST_BASE_CLASS = 'nqa-export-toast';
    const TOAST_SHOW_CLASS = 'show';
    const TOAST_COPIED_ATTR = 'data-nqa-toast-classes';

    const DEFAULT_PREFS = {
        csvDelimiter: ',',
        textFormat: 'markdown',
    };

    const CLIPBOARD_FORMAT_LABELS = {
        html: 'HTML table',
        markdown: 'Markdown',
        ascii: 'ASCII table',
        tsv: 'TSV',
        csv: 'CSV',
    };

    const CLIPBOARD_FORMAT_SEQUENCE = ['html', 'markdown', 'ascii', 'tsv', 'csv'];

    const runtimeConfig = {
        csvDelimiter: DEFAULT_PREFS.csvDelimiter,
        textFormat: DEFAULT_PREFS.textFormat,
        maxRows: MAX_ROWS_DEFAULT,
        downloadFilename: 'NQA_selection.csv',
    };

    const TOAST_DEFAULTS = {
        background: 'rgba(34,34,34,0.92)',
        color: '#fff',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12),0 2px 4px rgba(0,0,0,0.08)',
        borderRadius: '4px',
        borderStyle: 'none',
        borderWidth: '0px',
        borderColor: 'transparent',
        padding: '8px 12px',
    };

    // Update runtime preferences (delimiter, clipboard format, etc.) used during export.
    // Trim and clamp the delimiter (max 3 chars). Falls back to default if empty.
    function applyCsvDelimiter(partial) {
        const raw = partial?.csvDelimiter;
        if (typeof raw !== 'string' || !raw.length) return;
        const trimmed = raw.slice(0, 3);
        runtimeConfig.csvDelimiter = trimmed || DEFAULT_PREFS.csvDelimiter;
    }

    // Update the text/clipboard format when the provided mode is allowed.
    function applyTextFormat(partial) {
        const raw = partial?.textFormat;
        if (typeof raw !== 'string') return;
        const mode = raw.trim().toLowerCase();
        if (!mode) return;
        const allowed = new Set(['markdown', 'ascii', 'html', 'tsv', 'csv']);
        if (allowed.has(mode)) runtimeConfig.textFormat = mode;
    }

    // Clamp the maximum exported rows to a positive integer if provided.
    function applyMaxRows(partial) {
        const value = partial?.maxRows;
        if (!Number.isFinite(value) || value <= 0) return;
        runtimeConfig.maxRows = Math.floor(value);
    }

    // Override the download filename when a non-empty string is supplied.
    function applyDownloadFilename(partial) {
        const raw = partial?.downloadFilename;
        if (typeof raw !== 'string') return;
        const name = raw.trim();
        if (name) runtimeConfig.downloadFilename = name;
    }

    // Update runtime preferences (delimiter, clipboard format, etc.) used during export.
    function setConfig(partial) {
        if (!partial || typeof partial !== 'object') return;
        applyCsvDelimiter(partial);
        applyTextFormat(partial);
        applyMaxRows(partial);
        applyDownloadFilename(partial);
    }

    // Return the currently configured clipboard format (normalized).
    function getClipboardFormat() {
        const raw = runtimeConfig.textFormat || DEFAULT_PREFS.textFormat;
        if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_PREFS.textFormat;
        return raw.trim().toLowerCase();
    }

    // Provide a human friendly label for the clipboard format.
    function getClipboardFormatLabel() {
        const format = getClipboardFormat();
        return describeClipboardFormat(format);
    }

    // Provide a human-friendly label for a supplied clipboard format.
    function describeClipboardFormat(format) {
        if (typeof format !== 'string' || !format) return '';
        const key = format.trim().toLowerCase();
        return CLIPBOARD_FORMAT_LABELS[key] || key;
    }

    // Return the ordered list of supported clipboard formats.
    function getClipboardFormatSequence() {
        return CLIPBOARD_FORMAT_SEQUENCE.slice();
    }

    // Locate the main results table rendered by Nexthink investigations.
    function getTable() {
        try { return document.querySelector(TABLE_SELECTOR); }
        catch (_) { return null; }
    }

    // Return every selection checkbox in the table (first one is the global "select all").
    function getCheckboxes() {
        const table = getTable();
        if (!table) return [];
        try { return Array.from(table.querySelectorAll(CHECKBOX_SELECTOR)); }
        catch (_) { return []; }
    }

    // Exclude the global checkbox so we only keep row-level selectors.
    function getRowCheckboxes() {
        const all = getCheckboxes();
        if (!all.length) return [];
        return all.slice(1);
    }

    // Filter the row checkboxes to the ones currently checked.
    function getCheckedRowCheckboxes() {
        return getRowCheckboxes().filter((cb) => cb.checked);
    }

    // Convenience helper to test whether at least one row is selected.
    function hasSelection() {
        return getCheckedRowCheckboxes().length > 0;
    }

    // Strip Nexthink formatting nodes to retrieve raw header/cell text.
    function extractNodeText(el) {
        if (!el) return '';
        try {
            const text = Array.from(el.childNodes)
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent || '')
                .join('');
            const sanitized = text ? text : (el.textContent || '');
            return sanitized.replace(/[\s\u200B\u200C\u200D\uFEFF]+/g, ' ').trim();
        } catch (_) {
            try {
                return (el.textContent || '').replace(/[\s\u200B\u200C\u200D\uFEFF]+/g, ' ').trim();
            } catch (__) { return ''; }
        }
    }

    // Build an ordered list of column headers (label + index) for later extraction.
    function getColumnDefinitions() {
        const table = getTable();
        if (!table) return [];
        const headers = Array.from(table.querySelectorAll(HEADER_SELECTOR));
        if (!headers.length) return [];

        const defs = [];
        headers.forEach((th) => {
            if (!th) return;
            if (th.querySelector(CHECKBOX_SELECTOR)) return;
            const ariaIndexRaw = th.getAttribute('aria-colindex');
            const ariaIndex = ariaIndexRaw ? parseInt(ariaIndexRaw, 10) : NaN;
            const cellIndex = Number.isFinite(th.cellIndex) ? th.cellIndex : (Number.isFinite(ariaIndex) ? ariaIndex - 1 : NaN);
            if (!Number.isInteger(cellIndex) || cellIndex < 0) return;
            const labelEl = th.querySelector(HEADER_LABEL_SELECTOR) || th;
            const label = extractNodeText(labelEl) || `Column ${defs.length + 1}`;
            defs.push({
                index: cellIndex,
                ariaIndex: Number.isFinite(ariaIndex) ? ariaIndex : null,
                label,
            });
        });

        defs.sort((a, b) => a.index - b.index);
        return defs;
    }

    // Resolve the `<tr>` element controlled by a given checkbox.
    function getRowFromCheckbox(cb) {
        if (!cb) return null;
        try { return cb.closest('tr, [role="row"]'); }
        catch (_) { return null; }
    }

    // Snapshot every cell within a row so we can map them back to headings.
    function collectCellsForRow(row) {
        if (!row) return [];
        try {
            return Array.from(row.querySelectorAll('td, [role="cell"], [role="gridcell"]'));
        } catch (_) { return []; }
    }

    // Extract the visible text of a cell, favouring the hyperlink label when present.
    function sanitizeCellText(cell) {
        if (!cell) return '';
        try {
            const link = cell.querySelector('a, [role="link"]');
            const source = (link?.textContent || cell.textContent || '').trim();
            return source.replace(/[\s\u200B\u200C\u200D\uFEFF]+/g, ' ').trim();
        } catch (_) { return ''; }
    }

    // Produce an array of cell values ordered to match the header definitions.
    function extractRowValues(row, defs) {
        if (!row || !defs.length) return [];
        const cells = collectCellsForRow(row);
        if (!cells.length) return [];

        const filtered = cells.filter((cell) => !cell.querySelector(CHECKBOX_SELECTOR));

        return defs.map((def, idx) => {
            let cell = null;
            if (Number.isInteger(def.index)) {
                cell = cells[def.index] || null;
            }
            if (!cell && Number.isInteger(def.ariaIndex)) {
                cell = row.querySelector(`td[aria-colindex="${def.ariaIndex}"]`);
                if (!cell) {
                    cell = row.querySelector(`[role="gridcell"][aria-colindex="${def.ariaIndex}"]`);
                }
            }
            if (!cell) {
                cell = filtered[idx] || null;
            }
            if (cell && cell.querySelector && cell.querySelector(CHECKBOX_SELECTOR)) {
                const fallback = filtered[idx] || null;
                cell = fallback && !fallback.querySelector(CHECKBOX_SELECTOR) ? fallback : null;
            }
            return sanitizeCellText(cell);
        });
    }

    // Assemble headers + selected rows, enforcing the export cap unless a caller needs all rows.
    function collectSelectionData(options) {
        const allDefs = getColumnDefinitions();
        const restrictToColumn = options && Object.prototype.hasOwnProperty.call(options, 'columnIndex');
        const defs = restrictToColumn
            ? allDefs.filter((def) => def.index === options.columnIndex)
            : allDefs;
        const selection = getCheckedRowCheckboxes();
        const totalSelected = selection.length;
        if (!defs.length || !totalSelected) {
            return {
                headers: defs.map((d) => d.label),
                rows: [],
                totalSelected,
                truncated: false,
                ...(restrictToColumn && !defs.length ? { columnMissing: true } : {}),
            };
        }

        const limit = options?.includeAll === true
            ? selection.length
            : Math.max(1, Math.min(runtimeConfig.maxRows, Number.isFinite(options?.limit) && options.limit > 0 ? Math.floor(options.limit) : runtimeConfig.maxRows));
        const rows = [];
        for (let i = 0; i < selection.length && rows.length < limit; i += 1) {
            const row = getRowFromCheckbox(selection[i]);
            if (!row) continue;
            const values = extractRowValues(row, defs);
            if (values.length) rows.push(values);
        }

        return {
            headers: defs.map((d) => d.label),
            rows,
            totalSelected,
            truncated: rows.length < totalSelected,
            limitUsed: limit,
        };
    }

    // CSV-safe string: quote/escape when a delimiter, quote, or newline is present.
    function serializeCsvCell(value, delimiter) {
        const str = value === undefined || value === null ? '' : String(value);
        const escaped = str.replace(/"/g, '""');
        return `"${escaped}"`;
    }

    // Turn the selection payload into a CSV document (CRLF-separated) using the chosen delimiter.
    function buildCsvString(payload, delimiter) {
        if (!payload || !Array.isArray(payload.rows)) return '';
        const delim = typeof delimiter === 'string' && delimiter.length ? delimiter : runtimeConfig.csvDelimiter;
        const lines = [];
        if (Array.isArray(payload.headers) && payload.headers.length) {
            lines.push(payload.headers.map((cell) => serializeCsvCell(cell, delim)).join(delim));
        }
        payload.rows.forEach((row) => {
            lines.push((Array.isArray(row) ? row : []).map((cell) => serializeCsvCell(cell, delim)).join(delim));
        });
        return lines.join('\r\n');
    }

    // Pretty-print the selection as an ASCII table (used for the clipboard option).
    function buildAsciiTable(headers, rows) {
        const allRows = [headers, ...rows];
        const columns = headers.length;
        if (!columns) return '';
        const widths = new Array(columns).fill(0);
        allRows.forEach((row) => {
            for (let i = 0; i < columns; i += 1) {
                const cell = row?.[i];
                const value = cell === undefined || cell === null ? '' : String(cell);
                widths[i] = Math.max(widths[i], value.length);
            }
        });

        const makeRule = (char) => `+${widths.map((w) => char.repeat(w + 2)).join('+')}+`;
        const makeRow = (cells) => `| ${cells.map((cell, idx) => {
            const value = cell === undefined || cell === null ? '' : String(cell);
            return value.padEnd(widths[idx], ' ');
        }).join(' | ')} |`;

        const lines = [];
        lines.push(makeRule('-'));
        lines.push(makeRow(headers));
        lines.push(makeRule('='));
        rows.forEach((row, idx) => {
            lines.push(makeRow(Array.isArray(row) ? row : []));
            lines.push(makeRule(idx === rows.length - 1 ? '-' : '-'));
        });
        if (rows.length === 0) {
            lines.push(makeRule('-'));
        }
        return lines.join('\n');
    }

    // Basic HTML escape to keep cell contents safe when building rich tables.
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[ch] || ch));
    }

    // Build a minimal styled HTML table that renders nicely in Outlook / rich editors.
    function buildHtmlTable(headers, rows) {
        const safeHeaders = headers.map((cell) => escapeHtml(cell));
        const lines = [];
        lines.push('<table style="border-collapse:collapse;font-family:inherit;font-size:14px;">');
        if (safeHeaders.length) {
            lines.push('  <thead>');
            lines.push('    <tr>');
            safeHeaders.forEach((cell) => {
                lines.push(`      <th style="border:1px solid #d0d4d9;padding:4px 8px;text-align:left;background:#f1f4f8;">${cell}</th>`);
            });
            lines.push('    </tr>');
            lines.push('  </thead>');
        }
        lines.push('  <tbody>');
        if (rows.length) {
            rows.forEach((row) => {
                const cells = Array.isArray(row) ? row : [];
                lines.push('    <tr>');
                cells.forEach((cell) => {
                    lines.push(`      <td style="border:1px solid #d0d4d9;padding:4px 8px;">${escapeHtml(cell)}</td>`);
                });
                lines.push('    </tr>');
            });
        } else if (safeHeaders.length) {
            lines.push('    <tr>');
            safeHeaders.forEach(() => {
                lines.push('      <td style="border:1px solid #d0d4d9;padding:4px 8px;"></td>');
            });
            lines.push('    </tr>');
        }
        lines.push('  </tbody>');
        lines.push('</table>');
        return lines.join('\n');
    }

    // Render the selection as Markdown, ASCII, or delimited plain text.
    function buildPlainText(payload, format) {
        if (!payload || !Array.isArray(payload.rows)) return '';
        const headers = Array.isArray(payload.headers) ? payload.headers : [];
        const mode = (format || runtimeConfig.textFormat || DEFAULT_PREFS.textFormat).toLowerCase();
        if (mode === 'markdown') {
            const headerLine = headers.length ? `| ${headers.join(' | ')} |` : '';
            const separator = headers.length ? `| ${headers.map(() => '---').join(' | ')} |` : '';
            const lines = [headerLine, separator];
            payload.rows.forEach((row) => {
                const cells = Array.isArray(row) ? row : [];
                lines.push(`| ${cells.join(' | ')} |`);
            });
            return lines.filter(Boolean).join('\n');
        }
        if (mode === 'ascii') {
            return buildAsciiTable(headers, payload.rows);
        }
        const delimiter = mode === 'csv' ? ',' : '\t';
        const lines = [];
        if (headers.length) {
            lines.push(headers.join(delimiter));
        }
        payload.rows.forEach((row) => {
            const cells = Array.isArray(row) ? row : [];
            lines.push(cells.join(delimiter));
        });
        return lines.join('\n');
    }

    // Bundle both plain-text and HTML representations depending on the configured format.
    function buildClipboardData(payload, formatOverride) {
        const format = (formatOverride || runtimeConfig.textFormat || DEFAULT_PREFS.textFormat).toLowerCase();
        if (format === 'html') {
            return {
                plain: buildPlainText(payload, 'tsv'),
                html: buildHtmlTable(Array.isArray(payload.headers) ? payload.headers : [], payload.rows || []),
            };
        }
        return { plain: buildPlainText(payload, format) };
    }

    // Attempt to write HTML+plain clipboard entries (fallback to text + legacy execCommand).
    // Normalize the caller payload into { plain, html } strings.
    function normalizeClipboardContent(content) {
        if (typeof content === 'string') {
            return { plain: content, html: null };
        }
        if (content && typeof content === 'object') {
            const plain = content.plain != null ? String(content.plain) : '';
            const html = content.html != null ? String(content.html) : null;
            return { plain, html };
        }
        return { plain: '', html: null };
    }

    // Try the modern async Clipboard API (HTML + plain text). Throw to trigger fallback on failure.
    async function writeModernClipboard(plain, html) {
        if (!navigator.clipboard) throw new Error('clipboard-api-missing');
        const hasHtml = html && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write;
        if (hasHtml) {
            const items = { 'text/html': new Blob([html], { type: 'text/html' }) };
            if (plain) items['text/plain'] = new Blob([plain], { type: 'text/plain' });
            await navigator.clipboard.write([new ClipboardItem(items)]);
            return true;
        }
        if (plain && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(plain);
            return true;
        }
        throw new Error('clipboard-write-unavailable');
    }

    // Fallback to document.execCommand by injecting hidden DOM nodes.
    function writeViaExecCommand(html, plain) {
        if (html) {
            const div = document.createElement('div');
            div.contentEditable = 'true';
            Object.assign(div.style, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
            div.innerHTML = html;
            document.body.appendChild(div);
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(div);
            selection.removeAllRanges();
            selection.addRange(range);
            const ok = document.execCommand('copy');
            selection.removeAllRanges();
            document.body.removeChild(div);
            if (ok) return true;
        }

        const ta = document.createElement('textarea');
        Object.assign(ta.style, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
        ta.setAttribute('readonly', 'readonly');
        ta.value = plain;
        document.body.appendChild(ta);
        ta.focus({ preventScroll: true });
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    }

    // Attempt to write HTML+plain clipboard entries (fallback to text + legacy execCommand).
    async function copyToClipboard(content) {
        const { plain, html } = normalizeClipboardContent(content);
        try {
            return await writeModernClipboard(plain, html);
        } catch (_) {
            try {
                return writeViaExecCommand(html, plain);
            } catch (err) {
                return false;
            }
        }
    }

    function downloadCsv(csvString, filename) {
        if (typeof csvString !== 'string' || !csvString.length) return false;
        try {
            const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename && filename.trim() ? filename.trim() : runtimeConfig.downloadFilename;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            setTimeout(() => URL.revokeObjectURL(url), 0);
            return true;
        } catch (_) {
            return false;
        }
    }

    let toastHideTimer = null;

    function ensureToastElements() {
        if (!document.getElementById(TOAST_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = TOAST_STYLE_ID;
            style.textContent = `
        #${TOAST_ID}{position:fixed;font-size:13px;line-height:1.4;z-index:2147483647;opacity:0;transform:translateY(6px);transition:opacity .15s ease,transform .15s ease;pointer-events:none;max-width:360px;box-shadow:${TOAST_DEFAULTS.boxShadow};background:${TOAST_DEFAULTS.background};color:${TOAST_DEFAULTS.color};border-radius:${TOAST_DEFAULTS.borderRadius};padding:${TOAST_DEFAULTS.padding}}
        #${TOAST_ID}.${TOAST_SHOW_CLASS}{opacity:1;transform:translateY(0)}
        @media (prefers-color-scheme: dark){#${TOAST_ID}{background:rgba(17,17,17,0.92);color:#f3f3f3;box-shadow:0 8px 24px rgba(0,0,0,0.45),0 2px 4px rgba(0,0,0,0.35)}}
      `;
            document.head.appendChild(style);
        }
        let toast = document.getElementById(TOAST_ID);
        if (!toast) {
            toast = document.createElement('div');
            toast.id = TOAST_ID;
            toast.className = TOAST_BASE_CLASS;
            document.body.appendChild(toast);
        }
        if (!toast.classList.contains(TOAST_BASE_CLASS)) {
            toast.classList.add(TOAST_BASE_CLASS);
        }
        return toast;
    }

    function applyToastClasses(toast, anchor) {
        const previous = toast.getAttribute(TOAST_COPIED_ATTR);
        if (previous) {
            previous.split(' ').forEach((cls) => {
                if (cls) toast.classList.remove(cls);
            });
            toast.removeAttribute(TOAST_COPIED_ATTR);
        }
        if (anchor && anchor.classList) {
            const copied = [];
            anchor.classList.forEach((cls) => {
                if (cls && !toast.classList.contains(cls)) {
                    toast.classList.add(cls);
                    copied.push(cls);
                }
            });
            if (copied.length) toast.setAttribute(TOAST_COPIED_ATTR, copied.join(' '));
        }
    }

    function applyToastVisual(toast, anchor) {
        if (anchor && typeof window.getComputedStyle === 'function') {
            const cs = window.getComputedStyle(anchor);
            if (cs) {
                toast.style.background = cs.backgroundColor || TOAST_DEFAULTS.background;
                toast.style.color = cs.color || TOAST_DEFAULTS.color;
                toast.style.boxShadow = (cs.boxShadow && cs.boxShadow !== 'none') ? cs.boxShadow : TOAST_DEFAULTS.boxShadow;
                toast.style.borderRadius = TOAST_DEFAULTS.borderRadius;
                toast.style.border = `${cs.borderWidth || TOAST_DEFAULTS.borderWidth} ${cs.borderStyle || TOAST_DEFAULTS.borderStyle} ${cs.borderColor || TOAST_DEFAULTS.borderColor}`;
                toast.style.padding = cs.padding || TOAST_DEFAULTS.padding;
                toast.style.fontFamily = cs.fontFamily || '';
                toast.style.fontSize = cs.fontSize || '';
                toast.style.fontWeight = cs.fontWeight || '';
            }
        } else {
            toast.style.background = TOAST_DEFAULTS.background;
            toast.style.color = TOAST_DEFAULTS.color;
            toast.style.boxShadow = TOAST_DEFAULTS.boxShadow;
            toast.style.borderRadius = TOAST_DEFAULTS.borderRadius;
            toast.style.border = `${TOAST_DEFAULTS.borderWidth} ${TOAST_DEFAULTS.borderStyle} ${TOAST_DEFAULTS.borderColor}`;
            toast.style.padding = TOAST_DEFAULTS.padding;
            toast.style.fontFamily = '';
            toast.style.fontSize = '';
            toast.style.fontWeight = '';
        }
    }

    function positionToast(toast, anchor) {
        if (anchor && typeof anchor.getBoundingClientRect === 'function') {
            const rect = anchor.getBoundingClientRect();
            const offset = 8;
            let left = rect.left;
            toast.style.right = '';
            toast.style.bottom = '';
            const minWidth = Math.max(120, Math.round(rect.width));
            toast.style.minWidth = `${minWidth}px`;
            toast.style.maxWidth = `${Math.max(minWidth, 420)}px`;
            toast.style.top = `${Math.round(rect.bottom + offset)}px`;

            // Clamp horizontally to viewport bounds once width is known
            const width = toast.offsetWidth || Math.max(minWidth, 200);
            toast.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
        } else {
            toast.style.minWidth = '';
            toast.style.maxWidth = '360px';
            toast.style.left = '';
            toast.style.top = '';
            toast.style.right = '16px';
            toast.style.bottom = '16px';
        }
    }

    // Normalise toast options (timeout + anchor) regardless of the caller payload.
    function resolveToastOptions(timeoutOrOptions) {
        if (Number.isFinite(timeoutOrOptions)) {
            return { timeout: timeoutOrOptions };
        }
        if (!timeoutOrOptions || typeof timeoutOrOptions !== 'object') {
            return {};
        }
        return {
            timeout: sanitizeToastTimeout(timeoutOrOptions.timeout),
            anchor: resolveToastAnchor(timeoutOrOptions.anchor),
        };
    }

    // Ensure timeout is a positive number; otherwise return undefined.
    function sanitizeToastTimeout(value) {
        return Number.isFinite(value) && value > 0 ? value : undefined;
    }

    // Resolve a potential anchor from direct element, event targets, or closest selectors.
    function resolveToastAnchor(anchor) {
        const candidate = findToastAnchorCandidate(anchor);
        if (!candidate) return null;
        if (candidate.matches('button, [role="menuitem"], [data-nqa-export-action]')) return candidate;
        return candidate.closest?.('button, [role="menuitem"], [data-nqa-export-action]') ?? null;
    }

    // Inspect the anchor input to locate an Element we can attach the toast to.
    function findToastAnchorCandidate(anchor) {
        if (anchor instanceof Element) return anchor;
        if (anchor?.currentTarget instanceof Element) return anchor.currentTarget;
        if (anchor?.target instanceof Element) return anchor.target;
        if (anchor && typeof anchor.closest === 'function') {
            return anchor.closest('button, [role="menuitem"], [data-nqa-export-action]');
        }
        return null;
    }

    function showToast(message, timeoutOrOptions) {
        const toast = ensureToastElements();
        const { timeout, anchor } = resolveToastOptions(timeoutOrOptions);

        applyToastClasses(toast, anchor);
        applyToastVisual(toast, anchor);
        toast.textContent = message || '';
        positionToast(toast, anchor);

        // restart animation
        toast.classList.remove(TOAST_SHOW_CLASS);
        void toast.offsetWidth; // force reflow
        toast.classList.add(TOAST_SHOW_CLASS);

        if (toastHideTimer) {
            clearTimeout(toastHideTimer);
            toastHideTimer = null;
        }
        const duration = timeout || 1800;
        toastHideTimer = setTimeout(() => {
            toast.classList.remove(TOAST_SHOW_CLASS);
        }, duration);
    }

    function getSelectionSummary() {
        const total = getRowCheckboxes().length;
        const checked = getCheckedRowCheckboxes().length;
        return { total, checked };
    }

    const api = {
        MAX_ROWS_DEFAULT,
        setConfig,
        DEFAULT_PREFS,
        buildClipboardData,
        getCheckboxes,
        getRowCheckboxes,
        getCheckedRowCheckboxes,
        hasSelection,
        getColumnDefinitions,
        collectSelectionData,
        buildCsvString,
        buildPlainText,
        copyToClipboard,
        downloadCsv,
        showToast,
        getSelectionSummary,
        getClipboardFormat,
        getClipboardFormatLabel,
        getClipboardFormatSequence,
        describeClipboardFormat,
    };

    global.NqaExport = api;
})(typeof window !== 'undefined' ? window : this);
