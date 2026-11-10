/*
  NqaConfigStore — centralized storage + import/export for Nexthink Quick Actions.

  Storage schema (single source of truth):
    - key `menu`:     { menu: Array<MenuItem> }
    - key `instance`: { instance: Instance|null }
    - global version key: `version` (string) shared by the whole storage

  Types:
    MenuItem = { name: string, url: string }
    Instance = { name: string, url: string }

  Export/Import JSON format:
    { menu: Array<MenuItem>, instance: Instance|null, version: string }

  Notes:
    - The class is exposed globally as `window.NqaConfigStore`.
*/
(function (global) {
  'use strict';

  // Resolve extension version from manifest (fallback to a default if unavailable)
  function getExtensionVersion() {
    try { return (chrome?.runtime?.getManifest?.() || {}).version || '1.0.0'; }
    catch (_) { return '1.0.0'; }
  }

  // Compare two SemVer strings. Returns -1, 0, 1
  function semverCompare(a, b) {
    const pa = String(a || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if (pa[i] < pb[i]) return -1;
      if (pa[i] > pb[i]) return 1;
    }
    return 0;
  }

  const hasChromeSync = () => {
    try { return !!(chrome && chrome.storage && chrome.storage.sync); } catch (_) { return false; }
  };

  const getSync = () => hasChromeSync() ? chrome.storage.sync : null;

  const promisifyGet = (keys) => new Promise((resolve) => {
    const SYNC = getSync();
    if (!SYNC) { resolve({}); return; }
    try { SYNC.get(keys, (res) => resolve(res || {})); } catch (_) { resolve({}); }
  });

  const promisifySet = (obj) => new Promise((resolve) => {
    const SYNC = getSync();
    if (!SYNC) { resolve(); return; }
    try { SYNC.set(obj, resolve); } catch (_) { resolve(); }
  });

  const DEFAULT_EXPORT_PREFS = {
    csvDelimiter: ',',
    clipboardFormat: 'html',
  };

  const VALID_CLIPBOARD_FORMATS = new Set(['markdown', 'ascii', 'html', 'tsv']);

  // Read all managed policies (read-only). Returns {} if none or not available
  const getManagedAll = () => new Promise((resolve) => {
    try { chrome.storage.managed.get(null, (res) => resolve(res || {})); } catch (_) { resolve({}); }
  });

  const InstanceUtils = global.NqaInstanceUtils;
  if (!InstanceUtils) {
    throw new Error('NqaInstanceUtils not loaded — ensure option/lib/instance-utils.js is included before config-store.js');
  }
  const { sanitizePrefix, isValidRegion, derivePrefixFromUrl, deriveRegionFromUrl } = InstanceUtils;

  // Minimal sanitization: ensure we have name + url and normalize optional prefix/region fields
  const sanitizeInstance = (inst) => {
    if (!inst || typeof inst !== 'object') return null;
    const name = String(inst.name || inst.prefix || '').trim();
    const url = String(inst.url || '').trim();
    if (!name || !url) return null;
    const out = { name, url };
    const prefixSource = inst.prefix || derivePrefixFromUrl(url) || name;
    const prefix = sanitizePrefix(prefixSource);
    if (prefix) out.prefix = prefix;
    const regionRaw = String(inst.region || '').trim().toLowerCase();
    if (isValidRegion(regionRaw)) out.region = regionRaw;
    return out;
  };

  // Enrich instance with derived prefix/region/name so downstream consumers always have a coherent model
  const augmentInstance = (inst) => {
    if (!inst) return inst;
    const clone = { ...inst };
    if (clone.prefix) clone.prefix = sanitizePrefix(clone.prefix);
    if (!clone.prefix && clone.name) clone.prefix = sanitizePrefix(clone.name);
    if (!clone.name && clone.prefix) clone.name = clone.prefix;
    if (!clone.region || !isValidRegion(clone.region)) {
      const derivedRegion = deriveRegionFromUrl(clone.url);
      if (derivedRegion) clone.region = derivedRegion;
      else delete clone.region;
    }
    if (!clone.prefix && clone.url) {
      const derivedPrefix = derivePrefixFromUrl(clone.url);
      if (derivedPrefix) {
        clone.prefix = derivedPrefix;
        if (!clone.name) clone.name = derivedPrefix;
      }
    }
    return clone;
  };

  class NqaConfigStore {
    // Static constants (defined at the top of the class)
    static VERSION = getExtensionVersion();   // current model/storage version
    static VERSION_KEY = 'version';          // single, global storage version key
    static KEYS = { MENU: 'menu', INSTANCE: 'instance', EXPORT: 'exportPrefs' };
    static DEFAULT_EXPORT_FILENAME = 'NQA_Configuration.json';
    static DEFAULT_EXPORT_PREFS = DEFAULT_EXPORT_PREFS;

    // Validation helpers
    static isValidMenuItem(it) {
      if (!it || typeof it !== 'object') return false;
      const name = String(it.name || '').trim();
      const url = String(it.url || '').trim();
      if (!name || !url) return false;
      return true;
    }
    static isValidInstance(obj) {
      if (!obj) return false;
      if (typeof obj !== 'object') return false;
      const name = String(obj.name || '').trim();
      const url = String(obj.url || '').trim();
      if (!name || !url) return false;
      try {
        const u = new URL(url);
        if (!(u.protocol === 'http:' || u.protocol === 'https:')) return false;
        return !!u.hostname;
      } catch (_) { return false; }
    }

    static sanitizeExportPrefs(prefs) {
      const base = { ...DEFAULT_EXPORT_PREFS };
      if (!prefs || typeof prefs !== 'object') return base;
      const rawDelimiter = String(prefs.csvDelimiter ?? '').trim();
      if (rawDelimiter) {
        base.csvDelimiter = rawDelimiter.slice(0, 3);
      }
      const rawFormat = String(prefs.clipboardFormat ?? '').trim().toLowerCase();
      if (VALID_CLIPBOARD_FORMATS.has(rawFormat)) {
        base.clipboardFormat = rawFormat;
      }
      return base;
    }

    // Read API
    async getMenu() {
      await this.ensureAndMigrateStorage();
      const managed = await getManagedAll();
      const pol = await this.getManagedPolicy(managed);
      // In seed mode, we always return user (sync) menu; managed is only used at seed time
      const userMenu = await (async () => {
        const def = { [NqaConfigStore.KEYS.MENU]: { menu: [] } };
        const res = await promisifyGet(def);
        const doc = res[NqaConfigStore.KEYS.MENU];
        return Array.isArray(doc?.menu) ? doc.menu : [];
      })();
      if (pol.mode === 'seed') return userMenu;
      // Overlay mode: merge managed (locked) + user (optionally)
      const mm = Array.isArray(managed.menu) ? managed.menu.filter(NqaConfigStore.isValidMenuItem) : [];
      const lock = pol.lockManagedEntries !== false; // default true
      const result = [];
      const seen = new Set();
      const sig = (it) => `${(it.name||'').toLowerCase()}|${(it.url||'').toLowerCase()}`;
      mm.forEach((it) => { const o = { name: it.name, url: it.url, __managed: true, __locked: !!lock }; result.push(o); seen.add(sig(o)); });
      if (pol.allowUserEntries !== false) {
        userMenu.forEach((it) => { const s = sig(it); if (!seen.has(s)) { result.push({ name: it.name, url: it.url }); } });
      }
      return result;
    }
    async getInstance() {
      await this.ensureAndMigrateStorage();
      const managed = await getManagedAll();
      const pol = await this.getManagedPolicy(managed);
      if (pol.mode !== 'seed') {
        const inst = managed?.instance;
        if (inst && NqaConfigStore.isValidInstance(inst)) {
          const clean = augmentInstance(sanitizeInstance(inst));
          if (clean) {
            return {
              ...clean,
              __managed: true,
              __locked: !!pol.lockManagedEntries,
            };
          }
        }
      }
      const def = { [NqaConfigStore.KEYS.INSTANCE]: { instance: null } };
      const res = await promisifyGet(def);
      const inst = res?.[NqaConfigStore.KEYS.INSTANCE]?.instance ?? null;
      if (inst && NqaConfigStore.isValidInstance(inst)) {
        const clean = augmentInstance(sanitizeInstance(inst));
        return clean || null;
      }
      return null;
    }

    // Write API
    async setMenu(items) {
      const arr = Array.isArray(items) ? items.filter(NqaConfigStore.isValidMenuItem) : [];
      await promisifySet({ [NqaConfigStore.KEYS.MENU]: { menu: arr } });
      await this.ensureStorageVersion();
    }
    async setInstance(inst) {
      const payload = (inst && NqaConfigStore.isValidInstance(inst)) ? augmentInstance(sanitizeInstance(inst)) : null;
      await promisifySet({ [NqaConfigStore.KEYS.INSTANCE]: { instance: payload } });
      await this.ensureStorageVersion();
    }

    async getStorageVersion() {
      // Do not provide a default here; we need to detect first-run (no key stored)
      const res = await promisifyGet([NqaConfigStore.VERSION_KEY]);
      const v = res && res[NqaConfigStore.VERSION_KEY];
      return (typeof v === 'string' && v) ? v : null;
    }
    async setStorageVersion(version) {
      const v = (typeof version === 'string' && version) ? version : getExtensionVersion();
      await promisifySet({ [NqaConfigStore.VERSION_KEY]: v });
    }
    async ensureStorageVersion() {
      const current = getExtensionVersion();
      const stored = await this.getStorageVersion();
      if (stored !== current) await this.setStorageVersion(current);
    }

    // Ensure storage version is aligned with the extension, run migration if older
    async ensureAndMigrateStorage() {
      const current = getExtensionVersion();
      const stored = await this.getStorageVersion();
      if (!stored) {
        try { console.log('[NQA][store] Migration: initialize storage to', current); } catch (_) {}
        await this._migrateStorage('0.0.0', current);
        await this.setStorageVersion(current);
        return;
      }
      const cmp = semverCompare(stored, current);
      if (cmp < 0) {
        try { console.log(`[NQA][store] Migration from ${stored} to ${current}`); } catch (_) {}
        await this._migrateStorage(stored, current);
        await this.setStorageVersion(current);
      }
    }

    // Normalized managed policy (with defaults)
    async getManagedPolicy(managedOpt) {
      const managed = managedOpt || await getManagedAll();
      const p = (managed && managed.policy) || {};
      return {
        mode: (p.mode === 'seed') ? 'seed' : 'overlay',
        allowUserEntries: (p.allowUserEntries !== false),
        lockManagedEntries: (p.lockManagedEntries !== false),
        seedReplace: !!p.seedReplace,
      };
    }

    // Migration steps from old stored version to current
    async _migrateStorage(fromVersion, toVersion) {
      // For now: log only. Real migration steps can be added later.
      try { console.log('[NQA][store] Migration', { fromVersion, toVersion }); } catch (_) {}
    }

    // Export current config as a single JSON-safe object
    async exportAsObject() {
      const menu = await this.getMenu();
      const instance = await this.getInstance();
      const exportPrefsRaw = await this.getExportPrefs();
      const exportPrefs = NqaConfigStore.sanitizeExportPrefs(exportPrefsRaw);
      const version = await this.getStorageVersion();
      const plainInstance = instance ? augmentInstance(sanitizeInstance(instance)) : null;
      return { menu, instance: plainInstance, exportPrefs, version };
    }

    // Trigger a download of the exported configuration
    async exportToDownload(filename = NqaConfigStore.DEFAULT_EXPORT_FILENAME) {
      const obj = await this.exportAsObject();
      const payload = JSON.stringify(obj, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try { document.body.removeChild(a); } catch (_) {}
          URL.revokeObjectURL(url);
        }, 0);
      } catch (_) {
        URL.revokeObjectURL(url);
      }
    }

    // Import from an object that should look like: { menu: [...], instance?: {...}|null, version?: string }
    // options: { mode: 'add' | 'replace', overrideInstance?: boolean (default replace only), validateOnly?: boolean }
    async importFromObject(obj, options = {}) {
      const mode = (options.mode === 'add' || options.mode === 'replace') ? options.mode : 'replace';
      const overrideInstance = options.overrideInstance === true || mode === 'replace';
      const validateOnly = options.validateOnly === true;

      this._assertValidImportObject(obj);
      const menu = this._sanitizeMenuEntries(obj.menu);
      const instance = this._sanitizeInstance(obj);
      const exportPrefs = this._sanitizeExportPrefs(obj);

      if (validateOnly) {
        return {
          ok: true,
          counts: { menu: menu.length },
          hasInstance: (instance !== undefined),
          hasExportPrefs: (exportPrefs !== undefined),
          mode,
        };
      }

      // Apply
      if (mode === 'replace') {
        await this.setMenu(menu);
        if (instance !== undefined) await this.setInstance(instance);
        if (exportPrefs !== undefined) await this.setExportPrefs(exportPrefs);
      } else {
        // add
        const existing = await this.getMenu();
        await this.setMenu((existing || []).concat(menu));
        if (instance !== undefined && overrideInstance) {
          const cur = await this.getInstance();
          if (!cur && instance) await this.setInstance(instance);
        }
        if (exportPrefs !== undefined) await this.setExportPrefs(exportPrefs);
      }

      // Align stored version to current extension version after import
      await this.ensureStorageVersion();

      return {
        ok: true,
        counts: { menu: menu.length },
        appliedInstance: instance !== undefined,
        appliedExportPrefs: exportPrefs !== undefined,
      };
    }

    _assertValidImportObject(obj) {
      if (!obj || typeof obj !== 'object') throw new Error('Invalid import object');
      const rawArr = Array.isArray(obj.menu) ? obj.menu : null;
      if (!Array.isArray(rawArr)) throw new Error('Invalid JSON format: expected { menu: [...] }');
    }

    _sanitizeMenuEntries(rawArr) {
      const menu = [];
      for (const it of rawArr) {
        if (!it || typeof it !== 'object') continue;
        const clean = {
          name: String(it.name || '').trim(),
          url: String(it.url || '').trim(),
        };
        if (NqaConfigStore.isValidMenuItem(clean)) menu.push(clean);
      }
      return menu;
    }

    _sanitizeInstance(obj) {
      let instance = undefined; // means: not provided
      if (Object.prototype.hasOwnProperty.call(obj, 'instance')) {
        const provided = obj.instance;
        if (provided === null) instance = null;
        else if (NqaConfigStore.isValidInstance(provided)) {
          instance = { name: provided.name.trim(), url: provided.url.trim() };
        } else {
          instance = undefined; // ignore invalid instance
        }
      }
      return instance;
    }

    _sanitizeExportPrefs(obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, 'exportPrefs')) return undefined;
      try {
        return NqaConfigStore.sanitizeExportPrefs(obj.exportPrefs);
      } catch (_) {
        return undefined;
      }
    }

    async getExportPrefs() {
      await this.ensureAndMigrateStorage();
      const managed = await getManagedAll();
      const pol = await this.getManagedPolicy(managed);
      if (pol.mode !== 'seed') {
        const rawManaged = managed?.exportPrefs;
        if (rawManaged && typeof rawManaged === 'object') {
          // Honor managed defaults when present so policies take precedence over user sync data
          const prefs = NqaConfigStore.sanitizeExportPrefs(rawManaged);
          return {
            ...prefs,
            __managed: true,
            __locked: !!pol.lockManagedEntries,
          };
        }
      }
      const def = { [NqaConfigStore.KEYS.EXPORT]: DEFAULT_EXPORT_PREFS };
      const res = await promisifyGet(def);
      const raw = res?.[NqaConfigStore.KEYS.EXPORT];
      return NqaConfigStore.sanitizeExportPrefs(raw);
    }

    async setExportPrefs(prefs) {
      const clean = NqaConfigStore.sanitizeExportPrefs(prefs);
      await promisifySet({ [NqaConfigStore.KEYS.EXPORT]: clean });
      await this.ensureStorageVersion();
      return clean;
    }
  }

  global.NqaConfigStore = NqaConfigStore;
})(typeof window !== 'undefined' ? window : this);
