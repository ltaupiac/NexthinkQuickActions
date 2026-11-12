/* NQA Import/Export toolbar controller (standalone)
 * Exposes window.NqaImportExportToolbar for use in options UI.
 */
(function (global) {
  'use strict';

  class NqaImportExportToolbar {
    constructor(opts) {
        this.opts = opts || {};
        this._initDomElements(this.opts.els || {});

        // Store API (required): getMenu, setMenu, getInstance, setInstance, getExportPrefs, setExportPrefs
        this.store = this.opts.store || null;

        // Optional callbacks
        this.onMenuChanged = typeof this.opts.onMenuChanged === 'function' ? this.opts.onMenuChanged : null;
        this.onInstanceChanged = typeof this.opts.onInstanceChanged === 'function' ? this.opts.onInstanceChanged : null;
        this.onExportPrefsImported = typeof this.opts.onExportPrefsImported === 'function' ? this.opts.onExportPrefsImported : null;

        // Validators (can be overridden)
        this.isValidNqaUrl = this.opts.isValidNqaUrl || this._isValidNqaUrl;
        this.isValidInstanceUrl = this.opts.isValidInstanceUrl || this._isValidInstanceUrl;

        // Internal pending state
        this._pendingItems = null;
        this._pendingInstance = undefined;
        this._pendingExportPrefs = undefined;
    }

    // Initializes DOM elements references from provided elements map
    _initDomElements(els) {
        this.importBtn = els.importBtn || null;
        this.exportBtn = els.exportBtn || null;
        this.importFile = els.importFile || null;
        // Import modal controls
        this.importModal = els.importModal || null;
        this.importSummary = els.importSummary || null;
        this.importCancelBtn = els.importCancelBtn || null;
        this.importAddBtn = els.importAddBtn || null;
        this.importReplaceBtn = els.importReplaceBtn || null;
    }

    // Attaches event listeners to DOM elements
    attach() {
      if (this.exportBtn) this.exportBtn.addEventListener('click', () => this._onExport());
      if (this.importBtn) this.importBtn.addEventListener('click', () => {
        try { if (this.importFile) this.importFile.click(); } catch (_) {}
      });
      if (this.importFile) this.importFile.addEventListener('change', (e) => this._onImportFile(e));

      if (this.importCancelBtn) this.importCancelBtn.addEventListener('click', () => this._closeImportModal());
      if (this.importAddBtn) this.importAddBtn.addEventListener('click', () => this._finalizeAdd());
      if (this.importReplaceBtn) this.importReplaceBtn.addEventListener('click', () => this._finalizeReplace());
    }

    // Handles export button click - downloads current configuration as JSON
    async _onExport() {
      try {
        if (!this.store?.exportToDownload) throw new Error('Store missing exportToDownload');
        await this.store.exportToDownload('NQA_Configuration.json');
      } catch (e) {
        try { alert('Export failed'); } catch (_) {}
      }
    }

    // Handles file input change - processes imported JSON configuration
    async _onImportFile(ev) {
        const file = ev?.target?.files && ev.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = this._parseImportFile(text);
            if (!parsed) return this._resetFile(ev);

            const clean = this._validateMenuItems(parsed.menu);
            this._pendingItems = clean;
            this._pendingInstance = this._validateInstance(parsed.instance);
            this._pendingExportPrefs = Object.prototype.hasOwnProperty.call(parsed, 'exportPrefs')
                ? parsed.exportPrefs
                : undefined;

            if (!clean.length && this._pendingInstance === undefined && this._pendingExportPrefs === undefined) {
                this._alert('No valid entries to import');
                return this._resetFile(ev);
            }

            await this._handleImport(clean);
        } catch (e) {
            this._alert('Import failed');
        } finally {
            this._resetFile(ev);
        }
    }

    // Parse and validate imported JSON file structure
    _parseImportFile(text) {
        try {
            const parsed = JSON.parse(text);
            const arr = Array.isArray(parsed?.menu) ? parsed.menu : null;
            if (!Array.isArray(arr)) {
                this._alert('Invalid JSON format (expected {"menu": [...], "instance"?: {...}, "exportPrefs"?: {...}})');
                return null;
            }
            return parsed;
        } catch (_) {
            return null;
        }
    }

    // Validate and clean menu items array
    _validateMenuItems(arr) {
        const clean = [];
        for (const it of arr) {
            const name = String((it?.name ?? it?.label ?? '')).trim();
            const url = String(it?.url ?? '').trim();
            if (!name || !url) continue;
            if (!this.isValidNqaUrl(url)) continue;
            clean.push({ name, url });
        }
        return clean;
    }

    // Validate imported instance configuration
    _validateInstance(importedInst) {
        if (importedInst === undefined) return undefined;
        return (importedInst === null || (importedInst && typeof importedInst.name === 'string' && typeof importedInst.url === 'string'))
            ? importedInst
            : undefined;
    }

    // Process import based on current configuration state
    async _handleImport(clean) {
        const existing = await this.store.getMenu();
        if (existing && existing.length) {
            this._pendingItems = clean;
            const details = [`${clean.length} menu item(s) detected`];
            if (this._pendingInstance !== undefined) details.push('instance');
            if (this._pendingExportPrefs !== undefined) details.push('export preferences');
            this._showImportModal(`${details.join(' + ')}. Choose: Add or Replace.`);
        } else {
            await this.store.setMenu(clean);
            await this._maybeApplyInstanceOnImport();
            await this._maybeApplyExportPrefsOnImport();
            if (typeof this.onMenuChanged === 'function') try { this.onMenuChanged(); } catch (_) {}
        }
    }

    // Finalizes import by adding new items to existing configuration
    async _finalizeAdd() {
      try {
        const existing = await this.store.getMenu();
        const merged = Array.isArray(existing) ? existing.slice() : [];
        if (Array.isArray(this._pendingItems)) merged.push(...this._pendingItems);
        await this.store.setMenu(merged);
        await this._maybeApplyInstanceOnImport();
        await this._maybeApplyExportPrefsOnImport();
        if (typeof this.onMenuChanged === 'function') try { this.onMenuChanged(); } catch (_) {}
      } catch (_) { this._alert('Import failed'); }
      finally { this._closeImportModal(true); }
    }

    // Finalizes import by replacing existing configuration with new items
    async _finalizeReplace() {
      try {
        const items = Array.isArray(this._pendingItems) ? this._pendingItems : [];
        await this.store.setMenu(items);
        await this._maybeApplyInstanceOnImport();
        await this._maybeApplyExportPrefsOnImport();
        if (typeof this.onMenuChanged === 'function') try { this.onMenuChanged(); } catch (_) {}
      } catch (_) { this._alert('Import failed'); }
      finally { this._closeImportModal(true); }
    }

    // Applies imported instance configuration if present
    async _maybeApplyInstanceOnImport() {
      if (this._pendingInstance === undefined) return;
      try {
        if (this._pendingInstance === null) {
          await this.store.setInstance(null);
          if (typeof this.onInstanceChanged === 'function') try { this.onInstanceChanged(null); } catch (_) {}
          return;
        }
        const instName = String(this._pendingInstance.name || '').trim();
        const instUrl = String(this._pendingInstance.url || '').trim();
        if (instName && this.isValidInstanceUrl(instUrl)) {
          await this.store.setInstance({ name: instName, url: instUrl });
          if (typeof this.onInstanceChanged === 'function') try { this.onInstanceChanged({ name: instName, url: instUrl }); } catch (_) {}
        }
      } catch (_) { /* ignore */ }
    }

    // Restore export preferences when present; user imports override managed defaults.
    async _maybeApplyExportPrefsOnImport() {
      if (this._pendingExportPrefs === undefined || !this.store?.setExportPrefs) return;

      const savedPrefs = await this.store.setExportPrefs(this._pendingExportPrefs);
      if (this.onExportPrefsImported) {
        this.onExportPrefsImported(savedPrefs);
      }
    }

    // Shows the import modal with given summary text
    _showImportModal(summaryText) {
      try { if (this.importSummary) this.importSummary.textContent = summaryText || ''; } catch (_) {}
      try { if (this.importModal) this.importModal.hidden = false; } catch (_) {}
    }

    // Closes the import modal and optionally resets pending state
    _closeImportModal(resetPending) {
      try { if (this.importModal) this.importModal.hidden = true; } catch (_) {}
      if (resetPending) {
        this._pendingItems = null;
        this._pendingInstance = undefined;
        this._pendingExportPrefs = undefined;
      }
    }

    // Resets the file input value to allow re-selection of the same file
    _resetFile(ev) {
      try { if (this.importFile) this.importFile.value = ''; } catch (_) {}
    }

    // Safe alert wrapper
    _alert(msg) { try { alert(msg); } catch (_) {} }

    // Validates if a URL contains required placeholders and has valid format
    _isValidNqaUrl(str) {
      const s = String(str || '').trim();
      const PH_RE = /\{[A-Za-z0-9_:-]+\}/g;
      if (!PH_RE.test(s)) return false;
      const base = s.replace(PH_RE, 'X');
      try {
        const u = new URL(base);
        return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
      } catch (_) { return false; }
    }

    // Validates if a URL is a valid instance URL (no placeholders, no trailing slash, no query/hash)
    _isValidInstanceUrl(str) {
      const s = String(str || '').trim();
      if (!s) return false;
      if (/\/$/.test(s)) return false;
      try {
        const u = new URL(s);
        if (!(u.protocol === 'http:' || u.protocol === 'https:')) return false;
        if (!u.hostname) return false;
        if (u.search || u.hash) return false;
        const afterHost = s.replace(/^https?:\/\//i, '').replace(/^\[[^\]]+\]/, '').replace(/^[^/]+/, '');
        return afterHost === '';
      } catch (_) { return false; }
    }
  }

  global.NqaImportExportToolbar = NqaImportExportToolbar;
})(window);
