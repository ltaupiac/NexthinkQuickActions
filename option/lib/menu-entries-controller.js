/* NQA Menu Entries controller: handles list rendering, inline edit, reorder, delete */
(function(global){
  'use strict';

  function resolveElements(els){
    const src = els || {};
    return {
      table: src.table || null,
      tbody: src.tbody || null,
      empty: src.empty || null,
      addBtn: src.addBtn || null,
      deleteModal: src.deleteModal || null,
      deleteDialog: src.deleteDialog || null,
      deleteSummary: src.deleteSummary || null,
      deleteCancelBtn: src.deleteCancelBtn || null,
      deleteConfirmBtn: src.deleteConfirmBtn || null,
    };
  }

  function resolveHelpers(opts){
    const noOp = (s)=>String(s||'');
    return {
      decodeForDisplay: (typeof opts.decodeForDisplay === 'function') ? opts.decodeForDisplay : noOp,
      encodeTemplateUrlForStorage: (typeof opts.encodeTemplateUrlForStorage === 'function') ? opts.encodeTemplateUrlForStorage : noOp,
      isValidNqaUrl: (typeof opts.isValidNqaUrl === 'function') ? opts.isValidNqaUrl : (()=>false),
      URL_HELP: opts.URL_HELP || 'Example: http(s)://hostname/path{keyword} <br>{keyword} will be replaced by the captured value from the page',
      URL_ERR_INVALID: opts.URL_ERR_INVALID || 'Invalid URL',
    };
  }

  class NqaMenuEntriesController {
    constructor(opts){
      this.opts = opts || {};
      const els = resolveElements(this.opts.els);
      Object.assign(this, els);
      this.store = this.opts.store || null;
      // helpers
      const helpers = resolveHelpers(this.opts);
      this.decodeForDisplay = helpers.decodeForDisplay;
      this.encodeTemplateUrlForStorage = helpers.encodeTemplateUrlForStorage;
      this.isValidNqaUrl = helpers.isValidNqaUrl;

      // state
      this.editingIndex = null; // -1 for new
      this.draft = { name: '', url: '', rawUrl: null };
      this.touched = { name: false, url: false };
      this.pendingDeleteIndex = null;
      this.userEntriesAllowed = true;

      // UI texts
      this.URL_HELP = helpers.URL_HELP;
      this.URL_ERR_INVALID = helpers.URL_ERR_INVALID;
    }

    attach(){
      if (this.addBtn) this.addBtn.addEventListener('click', () => this._onAdd());
      if (this.tbody) {
        this.tbody.addEventListener('input', (e) => this._onTbodyInput(e));
        this.tbody.addEventListener('change', (e) => this._onTbodyChange(e));
        this.tbody.addEventListener('blur', (e) => this._onTbodyBlur(e), true);
        this.tbody.addEventListener('click', (e) => this._onTbodyClick(e));
      }
      if (this.deleteCancelBtn) this.deleteCancelBtn.addEventListener('click', () => this._hideDelete());
      if (this.deleteConfirmBtn) this.deleteConfirmBtn.addEventListener('click', () => this._confirmDelete());
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.editingIndex !== null) {
          e.preventDefault();
          (async ()=>{ const items = await this.store.getMenu(); this.editingIndex = null; this.touched = {name:false,url:false}; this.render(items); })();
        }
      });
    }

    async render(itemsOpt){
      const items = itemsOpt || await this.store.getMenu();
      const hasItems = Array.isArray(items) && items.length > 0;
      const isEditing = this.editingIndex !== null;
      this._syncAddDisabled(isEditing);
      if (this.empty) this.empty.hidden = !!hasItems || isEditing;
      if (this.table) this.table.style.display = (!hasItems && !isEditing) ? 'none' : '';
      if (!hasItems && !isEditing) {
        if (this.tbody) this.tbody.innerHTML = '';
        return;
      }
      const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&','<':'&lt;','>':'&gt;'}[c]));
      const rows = items.map((it, idx) => {
        if (this.editingIndex === idx) return this._buildEditRow(`e${idx}`, idx);
        const locked = !!it?.__locked;
        if (locked) return this._buildLockedRow(it, idx);
        const name = esc(it?.name || '');
        const url = esc(this.decodeForDisplay(it?.url || ''));
        const isFirst = idx === 0; const isLast = idx === (items.length - 1);
        return `<tr data-index="${idx}">
          <td>${name}</td>
          <td><div style="word-wrap:break-word;">${url}</div></td>
          <td class="actions">
            <button class="icon-btn move-up" type="button" title="Move up" aria-label="Move up" ${(isFirst || locked) ? 'disabled' : ''}><span class="mask-icon icon-up" aria-hidden="true"></span></button>
            <button class="icon-btn move-down" type="button" title="Move down" aria-label="Move down" ${(isLast || locked) ? 'disabled' : ''}><span class="mask-icon icon-down" aria-hidden="true"></span></button>
            <button class="icon-btn edit" type="button" title="Edit" aria-label="Edit" ${locked ? 'disabled' : ''}><span class="mask-icon icon-edit" aria-hidden="true"></span></button>
            <button class="icon-btn delete" type="button" title="Delete" aria-label="Delete" ${locked ? 'disabled' : ''}><span class="mask-icon icon-delete" aria-hidden="true"></span></button>
          </td>
        </tr>`;
      });
      if (this.editingIndex === -1) rows.push(this._buildEditRow('new', -1));
      if (this.tbody) this.tbody.innerHTML = rows.join('');
      if (isEditing) this._updateSaveDisabled();
    }

    _buildEditRow(idTag, idx){
      const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&','<':'&lt;','>':'&gt;'}[c]));
      return (
`<tr data-index="${idx}">
  <td>
    <div class="field">
      <input name="name" type="text" placeholder="Menu name" value="${esc(this.draft.name)}" />
    </div>
  </td>
  <td>
    <div class="field">
      <textarea name="url" placeholder="URL" rows="5" style="width:100%;" aria-describedby="urlHelp-${idTag} urlErr-${idTag}">${esc(this.draft.url)}</textarea>
      <div class="help-text" id="urlHelp-${idTag}">${this.URL_HELP}</div>
      <div class="error-text" id="urlErr-${idTag}" hidden>${this.URL_ERR_INVALID}</div>
    </div>
  </td>
  <td class="actions">
    <button class="icon-btn save" type="button" title="Save" aria-label="Save"><span class="mask-icon icon-save" aria-hidden="true"></span></button>
    <button class="icon-btn cancel" type="button" title="Cancel" aria-label="Cancel"><span class="mask-icon icon-cancel" aria-hidden="true"></span></button>
  </td>
</tr>`);
    }

    _buildLockedRow(item, idx){
      const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&','<':'&lt;','>':'&gt;'}[c]));
      const name = esc(item?.name || '');
      const url = esc(this.decodeForDisplay(item?.url || ''));
      return (
`<tr data-index="${idx}" data-locked="true">
  <td>${name}</td>
  <td><div style="word-wrap:break-word;">${url}</div></td>
  <td class="actions locked" title="Managed by your organization">
    <span class="lock-indicator">
      <span class="mask-icon icon-lock" aria-hidden="true"></span>
      <span class="sr-only">Managed by your organization</span>
    </span>
  </td>
</tr>`);
    }

    setUserEntriesAllowed(flag){
      const next = (flag !== false);
      if (this.userEntriesAllowed === next) {
        this._syncAddDisabled(this.editingIndex !== null);
        return;
      }
      this.userEntriesAllowed = next;
      if (!this.userEntriesAllowed && this.editingIndex === -1) {
        this.editingIndex = null;
        this.touched = { name: false, url: false };
        return this.render();
      }
      this._syncAddDisabled(this.editingIndex !== null);
    }

    _syncAddDisabled(isEditing){
      if (!this.addBtn) return;
      const disable = !!isEditing || !this.userEntriesAllowed;
      this.addBtn.disabled = disable;
    }

    async _onAdd(){
      if (!this.userEntriesAllowed) return;
      this.editingIndex = -1;
      this.draft = { name: '', url: '', rawUrl: null };
      this.touched = { name: false, url: false };
      const items = await this.store.getMenu();
      this.render(items);
      setTimeout(() => { try { this.tbody.querySelector('tr[data-index="-1"] textarea[name="name"]').focus(); } catch(_){} }, 0);
    }

    _onTbodyInput(ev){
      const tr = ev.target.closest('tr'); if (!tr) return;
      const idx = Number(tr.getAttribute('data-index'));
      if (idx !== this.editingIndex && !(this.editingIndex === -1 && idx === -1)) return;
      const target = ev.target;
      if (target.name === 'name') this.draft.name = target.value;
      else if (target.name === 'url') { this.draft.url = target.value; this.touched.url = true; }
      
      this._updateSaveDisabled();
    }
    _onTbodyChange(ev){ this._onTbodyInput(ev); }
    _onTbodyBlur(ev){
      const tr = ev.target.closest('tr'); if (!tr) return;
      const idx = Number(tr.getAttribute('data-index'));
      if (idx !== this.editingIndex && !(this.editingIndex === -1 && idx === -1)) return;
      const target = ev.target;
      if (target.name === 'name') this.touched.name = true;
      if (target.name === 'url') {
        this.touched.url = true;
        // ensure placeholder once
        let val = String(target.value || '').trim();
        const PH_RE = /\{[*A-Za-z0-9_:-]+\}/;
        if (val && !PH_RE.test(val)) {
          target.value = val;
          this.draft.url = val;
        }
      }
      this._updateSaveDisabled();
    }
    _getButtonAction(btn){
      if (!btn || !btn.classList) return null;
      const actions = ['edit', 'delete', 'move-up', 'move-down', 'cancel', 'save'];
      for (const cls of actions){
        if (btn.classList.contains(cls)) return cls;
      }
      return null;
    }

    _handleEditAction(idx, items){
      this.editingIndex = idx;
      this.draft = { ...(items[idx] || { name: '', url: '' }) };
      this.draft.rawUrl = items[idx]?.url || null;
      if (this.draft.url) this.draft.url = this.decodeForDisplay(this.draft.url);
      this.touched = { name: false, url: false };
      this.render(items);
      setTimeout(() => { try { this.tbody.querySelector(`tr[data-index="${idx}"] input[name="name"]`).focus(); } catch(_){} }, 0);
    }

    _handleDeleteAction(idx, items, btn){
      this.pendingDeleteIndex = idx;
      if (this.deleteSummary) this.deleteSummary.textContent = `Delete "${(items[idx]?.name) || 'item'}" ?`;
      this._positionDelete(btn);
      if (this.deleteModal) this.deleteModal.hidden = false;
    }

    async _handleMoveAction(idx, items, delta){
      if (this.editingIndex !== null) return;
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= items.length) return;
      const tmp = items[nextIdx]; items[nextIdx] = items[idx]; items[idx] = tmp;
      await this.store.setMenu(items);
      this.render(items);
    }

    _handleCancelAction(items){
      this.editingIndex = null;
      this.touched = { name:false, url:false };
      this.render(items);
    }

    async _handleSaveAction(idx, items){
      const nameV = (this.draft.name || '').trim();
      const urlV = (this.draft.url || '').trim();
      if (!nameV || !urlV || !this.isValidNqaUrl(urlV)) return;
      let toStore = urlV;
      try {
        const rawLooksEncoded = !!(this.draft.rawUrl && /%[0-9A-Fa-f]{2}/.test(this.draft.rawUrl));
        if (this.draft.rawUrl && rawLooksEncoded && this.decodeForDisplay(this.draft.rawUrl).trim() === urlV) toStore = this.draft.rawUrl.trim();
        else toStore = this.encodeTemplateUrlForStorage(urlV);
      } catch(_) { toStore = urlV; }
      const obj = { name: nameV, url: toStore };
      if (idx === -1) items.push(obj); else items[idx] = obj;
      await this.store.setMenu(items);
      this.editingIndex = null;
      this.render(items);
    }

    async _onTbodyClick(ev){
      const btn = ev.target.closest('button.icon-btn');
      if (!btn) return;
      const tr = btn.closest('tr');
      const idx = Number(tr?.getAttribute('data-index'));
      if (Number.isNaN(idx)) return;
      const action = this._getButtonAction(btn);
      if (!action) return;
      const items = await this.store.getMenu();
      const handlers = {
        'edit': () => this._handleEditAction(idx, items),
        'delete': () => this._handleDeleteAction(idx, items, btn),
        'move-up': () => this._handleMoveAction(idx, items, -1),
        'move-down': () => this._handleMoveAction(idx, items, 1),
        'cancel': () => this._handleCancelAction(items),
        'save': () => this._handleSaveAction(idx, items),
      };
      const handler = handlers[action];
      if (handler) await handler();
    }

    _updateSaveDisabled(){
      const selIndex = this.editingIndex ?? -9999;
      const tr = this.tbody?.querySelector(`tr[data-index="${selIndex}"]`) || this.tbody?.querySelector('tr[data-index="-1"]');
      if (!tr) return;
      const nameInput = tr.querySelector('input[name="name"]');
      const urlInput = tr.querySelector('textarea[name="url"], input[name="url"]');
      const nameV = (nameInput?.value || '').trim();
      const urlV = (urlInput?.value || '').trim();
      const nameOk = !!nameV;
      const urlOk = this.isValidNqaUrl(urlV);
      const saveBtn = tr.querySelector('button.save');
      if (saveBtn) saveBtn.disabled = !(nameOk && urlOk);
    }

    _positionDelete(anchor){
      try{
        const rect = anchor.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
        const vh = window.innerHeight || document.documentElement.clientHeight || 768;
        const approxW = 420, approxH = 160;
        let left = rect.left - approxW - 12; if (left < 16) left = rect.right + 12;
        left = Math.max(16, Math.min(vw - approxW - 16, left));
        let top = rect.top + (rect.height - approxH) / 2; if (top < 16) top = 16; if (top + approxH > vh - 16) top = Math.max(16, vh - approxH - 16);
        if (this.deleteDialog) { this.deleteDialog.style.position = 'fixed'; this.deleteDialog.style.left = `${Math.round(left)}px`; this.deleteDialog.style.top = `${Math.round(top)}px`; }
      } catch(_){}
    }
    _hideDelete(){ try { if (this.deleteModal) this.deleteModal.hidden = true; } catch(_){} this.pendingDeleteIndex = null; }
    async _confirmDelete(){
      if (this.pendingDeleteIndex === null || this.pendingDeleteIndex === undefined) return;
      try {
        const items = await this.store.getMenu();
        if (!Array.isArray(items) || this.pendingDeleteIndex < 0 || this.pendingDeleteIndex >= items.length) return;
        items.splice(this.pendingDeleteIndex, 1);
        await this.store.setMenu(items);
        this.editingIndex = null; await this.render(items);
      } finally { this._hideDelete(); }
    }
  }

  global.NqaMenuEntriesController = NqaMenuEntriesController;
})(window);
