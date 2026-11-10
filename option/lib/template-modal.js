(function () {
    "use strict";

    function initNqaTemplateModal(opts) {
        const {
            templateBtn,
            templateModal,
            templateList,
            templateCancelBtn,
            templateAddBtn,
            store,
            onMenuChanged,
        } = opts || {};

        const TEMPLATE_SOURCE = chrome.runtime.getURL("option/templates.json");
        const templateState = {
            loaded: false,
            templates: [],
            selected: new Set(),
        };

        const escapeHtml = (str) =>
            String(str ?? "").replace(
                /[&<>"]/g,
                (ch) =>
                    ({
                        "&": "&amp;",
                        "<": "&lt;",
                        ">": "&gt;",
                        '"': "&quot;",
                    }[ch])
            );

        const updateTemplateAddDisabled = () => {
            if (templateAddBtn)
                templateAddBtn.disabled = templateState.selected.size === 0;
        };

        const resetTemplateSelection = () => {
            templateState.selected.clear();
            updateTemplateAddDisabled();
        };

        const hideTemplateModal = () => {
            try {
                if (templateModal) templateModal.hidden = true;
            } catch (_) {}
            resetTemplateSelection();
        };

        const renderTemplateList = () => {
            if (!templateList) return;
            if (!templateState.templates.length) {
                templateList.innerHTML =
                    '<div class="template-list-empty">No templates available.</div>';
                return;
            }
            const items = templateState.templates.map((tpl, idx) => {
                const name = escapeHtml(tpl?.name || `Template ${idx + 1}`);
                const title = escapeHtml(tpl?.url || "");
                return `<label class="template-item" title="${title}">
        <input type="checkbox" data-index="${idx}" />
        <span class="template-name">${name}</span>
      </label>`;
            });
            templateList.innerHTML = items.join("");
            resetTemplateSelection();
        };

        const ensureTemplatesLoaded = async () => {
            if (templateState.loaded) return;
            try {
                const resp = await fetch(TEMPLATE_SOURCE);
                if (!resp.ok) throw new Error("Failed to load templates");
                const data = await resp.json();
                if (Array.isArray(data)) {
                    templateState.templates = data.filter(
                        (tpl) => tpl && tpl.name && tpl.url
                    );
                } else {
                    templateState.templates = [];
                }
            } catch (_) {
                templateState.templates = [];
            } finally {
                templateState.loaded = true;
            }
        };

        const openTemplateModal = async () => {
            if (!templateModal || !templateBtn || templateBtn.disabled) return;
            await ensureTemplatesLoaded();
            renderTemplateList();
            templateModal.hidden = false;
            setTimeout(() => {
                try {
                    templateModal.querySelector('input[type="checkbox"]').focus();
                } catch (_) {}
            }, 0);
        };

        const applySelectedTemplates = async () => {
            if (!templateState.selected.size) {
                hideTemplateModal();
                return;
            }
            const templates = Array.from(templateState.selected)
                .map((idx) => templateState.templates[idx])
                .filter((tpl) => tpl && tpl.name && tpl.url);
            if (!templates.length) {
                hideTemplateModal();
                return;
            }
            try {
                const current = await store.getMenu();
                const next = Array.isArray(current) ? current.slice() : [];
                templates.forEach((tpl) => {
                    const entry = { name: tpl.name, url: tpl.url };
                    if (window.NqaConfigStore.isValidMenuItem(entry))
                        next.push(entry);
                });
                await store.setMenu(next);
                if (typeof onMenuChanged === "function") onMenuChanged();
                else {
                    try {
                        window.__nqaMenuController?.render?.();
                    } catch (_) {}
                }
            } catch (_) {
                /* ignore */
            }
            hideTemplateModal();
        };

        const setTemplateButtonEnabled = (flag) => {
            if (templateBtn) {
                templateBtn.disabled = !flag;
            }
            if (!flag) hideTemplateModal();
        };

        if (templateBtn)
            templateBtn.addEventListener("click", () => openTemplateModal());
        if (templateCancelBtn)
            templateCancelBtn.addEventListener("click", () =>
                hideTemplateModal()
            );
        if (templateAddBtn)
            templateAddBtn.addEventListener("click", () =>
                applySelectedTemplates()
            );
        if (templateList)
            templateList.addEventListener("change", (ev) => {
                const checkbox =
                    ev.target &&
                    ev.target.closest &&
                    ev.target.closest('input[type="checkbox"]');
                if (!checkbox) return;
                const idx = Number(checkbox.getAttribute("data-index"));
                if (Number.isNaN(idx)) return;
                if (checkbox.checked) templateState.selected.add(idx);
                else templateState.selected.delete(idx);
                updateTemplateAddDisabled();
            });

        return {
            hide: hideTemplateModal,
            setEnabled: setTemplateButtonEnabled,
        };
    }

    window.initNqaTemplateModal = initNqaTemplateModal;
})();
