function initVersionAndBrand() {
    try {
        const manifest = chrome.runtime.getManifest();
        const v = manifest?.version ? `v ${manifest.version}` : "";
        const el = document.getElementById("version");
        if (el) el.textContent = v;
        const brand = document.getElementById("brandIcon");
        if (brand) {
            try {
                brand.src = chrome?.runtime?.getURL
                    ? chrome.runtime.getURL("icons/spark16x16.svg")
                    : "../icons/spark16x16.svg";
            } catch (_) {
                brand.src = "../icons/spark16x16.svg";
            }
        }
    } catch (_) {
        // no-op if not available
    }
}

// Placeholder hook: currently return values verbatim, but keep the function so controllers can
// re-enable decoding behaviour later without signature changes.
function decodeForDisplay(val) {
    return val;
}

// Placeholder hook: upstream controllers expect to call this before persisting URLs. Leave the
// function ready in case re-encoding logic needs to be reintroduced.
function encodeTemplateUrlForStorage(input) {
    return input;
}

function isValidNqaUrl(str) {
    const s = String(str || "").trim();
    // Must contain at least one placeholder like {name}
    const PH_RE = /\{[*A-Za-z0-9_:-]+\}/g;
    if (!PH_RE.test(s)) return false;
    // Validate base URL with all placeholders replaced
    const base = s.replace(PH_RE, "X");
    try {
        const u = new URL(base);
        return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
    } catch (_) {
        return false;
    }
}

// Instance base URL must be protocol+host (and optional port), no path/search/hash, no trailing slash in user input
function isValidInstanceUrl(str) {
    const s = String(str || "").trim();
    if (!s) return false;
    if (/\/$/.test(s)) return false; // no trailing slash
    try {
        const u = new URL(s);
        if (!(u.protocol === "http:" || u.protocol === "https:")) return false;
        if (!u.hostname) return false;
        if (u.search || u.hash) return false;
        // URL() normalizes pathname to '/' even if not present; ensure input had no path by checking after host there was nothing
        // Basic check: disallow any extra slash after host in input
        const afterHost = s
            .replace(/^https?:\/\//i, "")
            .replace(/^\[[^\]]+\]/, "")
            .replace(/^[^/]+/, "");
        if (afterHost !== "") return false;
        return true;
    } catch (_) {
        return false;
    }
}

function initTemplateController(opts) {
    if (typeof window.initNqaTemplateModal !== "function") return null;
    return window.initNqaTemplateModal(opts);
}

function initExportPrefs(opts) {
    if (typeof window.initNqaExportPrefs !== "function") return null;
    return window.initNqaExportPrefs(opts);
}

function initMenuController(opts) {
    const {
        menuTable,
        tbody,
        empty,
        addBtn,
        deleteModal,
        deleteDialog,
        deleteSummary,
        deleteCancelBtn,
        deleteConfirmBtn,
        store,
        urlHelp,
        urlErrInvalid,
        templateController,
    } = opts;
    let menuController = null;
    try {
        menuController = new window.NqaMenuEntriesController({
            els: {
                table: menuTable,
                tbody,
                empty,
                addBtn,
                deleteModal,
                deleteDialog,
                deleteSummary,
                deleteCancelBtn,
                deleteConfirmBtn,
            },
            store,
            decodeForDisplay,
            encodeTemplateUrlForStorage,
            isValidNqaUrl,
            URL_HELP: urlHelp,
            URL_ERR_INVALID: urlErrInvalid,
        });
        menuController.attach();

        // Retrieve managed storage values (or {} on error) so policies can be evaluated.
        const fetchManagedConfig = () => {
            return new Promise((resolve) => {
                try {
                    chrome.storage.managed.get(null, (res) =>
                        resolve(res || {})
                    );
                } catch (_) {
                    resolve({});
                }
            });
        };

        // Toggle the ability for users to add/edit menu entries depending on policy.
        const setUserEntriesAccess = async (allowed) => {
            if (typeof menuController?.setUserEntriesAllowed === "function") {
                await menuController.setUserEntriesAllowed(allowed);
            } else if (addBtn) {
                addBtn.disabled = !allowed;
            }
        };

        // Apply the seed policy: replace user config with managed defaults when required.
        const applySeedPolicy = async (store, managed, policy) => {
            const rawMenu = Array.isArray(managed.menu) ? managed.menu : [];
            const validMenu = rawMenu.filter(
                window.NqaConfigStore.isValidMenuItem
            );
            const currentMenu = await store.getMenu();
            const shouldReplace =
                policy.seedReplace ||
                !(Array.isArray(currentMenu) && currentMenu.length);
            if (!shouldReplace) return;
            if (validMenu.length) await store.setMenu(validMenu);
            if (
                managed.instance &&
                window.NqaConfigStore.isValidInstance(managed.instance)
            ) {
                await store.setInstance(managed.instance);
            }
        };

        // Render menu controller while swallowing unexpected errors (avoid breaking UI).
        const renderMenuSafely = () => {
            try {
                menuController.render();
            } catch (_) {}
        };

        // Main policy orchestrator: fetch managed config, apply seed/overlay rules, then update UI state.
        const applyManagedPolicy = async () => {
            const store = new window.NqaConfigStore();
            const managed = await fetchManagedConfig();
            const policy = await store.getManagedPolicy(managed);
            if (policy.mode === "seed") {
                try {
                    await applySeedPolicy(store, managed, policy);
                } catch (_) {}
                await setUserEntriesAccess(true);
                templateController?.setEnabled?.(true);
                return;
            }
            const allowUsers = policy.allowUserEntries !== false;
            await setUserEntriesAccess(allowUsers);
            templateController?.setEnabled?.(allowUsers);
        };

        applyManagedPolicy()
            .catch(() => {})
            .finally(renderMenuSafely);
        window.__nqaMenuController = menuController;
    } catch (_) {
        /* class may be missing if script not loaded */
    }
    return menuController;
}

function initInstanceController(opts) {
    const {
        instSection,
        instTable,
        instTbody,
        instAddBtn,
        instanceModal,
        instanceDialog,
        instPrefixInput,
        instRegionSelect,
        instPrefixErr,
        instPreviewUrl,
        instCopyUrlBtn,
        instCopyPlaceholderBtn,
        instPlaceholderToken,
        instPlaceholderValue,
        instCancelBtn,
        instSaveBtn,
        deleteModal,
        deleteDialog,
        deleteSummary,
        deleteCancelBtn,
        deleteConfirmBtn,
        store,
    } = opts;
    let instanceController = null;
    try {
        instanceController = new window.NqaInstanceSection({
            els: {
                section: instSection,
                table: instTable,
                tbody: instTbody,
                addBtn: instAddBtn,
                modal: instanceModal,
                dialog: instanceDialog,
                prefixInput: instPrefixInput,
                regionSelect: instRegionSelect,
                prefixErr: instPrefixErr,
                previewUrl: instPreviewUrl,
                copyUrlBtn: instCopyUrlBtn,
                copyPlaceholderBtn: instCopyPlaceholderBtn,
                placeholderEl: instPlaceholderToken,
                placeholderValue: instPlaceholderValue,
                cancelBtn: instCancelBtn,
                saveBtn: instSaveBtn,
                deleteModal,
                deleteDialog,
                deleteSummary,
                deleteCancelBtn,
                deleteConfirmBtn,
            },
            store,
        });
        instanceController.attach();
        // Render once and on storage changes
        instanceController.render();
        try {
            chrome.storage?.onChanged?.addListener(() => {
                instanceController && instanceController.render();
            });
        } catch (_) {}
        // Expose for debug if needed
        window.__nqaInstanceController = instanceController;
    } catch (_) {
        /* class may be missing if script not loaded */
    }
    return instanceController;
}

function initImportExportToolbar(opts) {
    const {
        importBtn,
        exportBtn,
        importFile,
        importModal,
        importSummary,
        importCancelBtn,
        importAddBtn,
        importReplaceBtn,
        store,
        instanceController,
        exportPrefsController,
    } = opts;
    try {
        const toolbar = new window.NqaImportExportToolbar({
            els: {
                importBtn,
                exportBtn,
                importFile,
                importModal,
                importSummary,
                importCancelBtn,
                importAddBtn,
                importReplaceBtn,
            },
            store,
            onExportPrefsImported: (prefs) => {
                try {
                    exportPrefsController?.afterImport?.(prefs);
                } catch (_) {}
            },
            onMenuChanged: () => {
                try {
                    window.__nqaMenuController?.render?.();
                } catch (_) {}
            },
            onInstanceChanged: () => {
                try {
                    instanceController.render();
                } catch (_) {}
            },
            isValidNqaUrl,
            isValidInstanceUrl,
        });
        toolbar.attach();
    } catch (_) {
        /* noop if class missing */
    }
}

function attachEscapeHandler(opts) {
    const { importModal, deleteModal, deleteDialog, templateModal, templateController } =
        opts;
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            // Close modals via toolbar controller (if any)
            try {
                if (importModal && !importModal.hidden)
                    importModal.hidden = true;
            } catch (_) {}
            if (deleteModal && !deleteModal.hidden) {
                try {
                    deleteModal.hidden = true;
                } catch (_) {}
                if (deleteDialog) {
                    deleteDialog.style.position = "";
                    deleteDialog.style.left = "";
                    deleteDialog.style.top = "";
                }
            }
            if (templateModal && !templateModal.hidden) {
                templateController?.hide?.();
            }
        }
    });
}

function attachStorageListeners(menuController, instanceController) {
    try {
        chrome.storage?.onChanged?.addListener(() => {
            window.__nqaMenuController?.render?.();
            (instanceController || window.__nqaInstanceController)?.render?.();
        });
    } catch (_) {}
}

document.addEventListener("DOMContentLoaded", () => {
    initVersionAndBrand();

    const tbody = document.getElementById("cfgTbody");
    // Menu table (avoid selecting the instance table)
    const menuTable = document.querySelector("#menuSection .cfg-table");
    const empty = document.getElementById("emptyState");
    const addBtn = document.getElementById("addBtn");
    // Instance section DOM
    const instSection = document.getElementById("instanceSection");
    const instAddBtn = document.getElementById("instAddBtn");
    const instTable = document.getElementById("instTable");
    const instTbody = document.getElementById("instTbody");
    const importBtn = document.getElementById("importBtn");
    const exportBtn = document.getElementById("exportBtn");
    const importFile = document.getElementById("importFile");
    const templateBtn = document.getElementById("templateBtn");
    const templateModal = document.getElementById("templateModal");
    const templateList = document.getElementById("templateList");
    const templateCancelBtn = document.getElementById("templateCancelBtn");
    const templateAddBtn = document.getElementById("templateAddBtn");
    const exportSaveStatus = document.getElementById("exportSaveStatus");
    const csvDelimiterInput = document.getElementById("csvDelimiterInput");
    const csvDelimiterErr = document.getElementById("csvDelimiterErr");
    const clipboardFormatRadios = Array.from(
        document.querySelectorAll('input[name="clipboardFormat"]')
    );
    const modifierCard = document.getElementById("clipboardModifierCard");
    const modifierAltLabel = document.getElementById("clipboardModifierAlt");
    const modifierShiftLabel = document.getElementById("clipboardModifierShift");
    const modifierAltRow = document.getElementById("clipboardModifierAltRow");
    const modifierShiftRow = document.getElementById("clipboardModifierShiftRow");
    // Import modal elements
    const importModal = document.getElementById("importModal");
    const importSummary = document.getElementById("importSummary");
    const importCancelBtn = document.getElementById("importCancelBtn");
    const importAddBtn = document.getElementById("importAddBtn");
    const importReplaceBtn = document.getElementById("importReplaceBtn");
    // Delete modal elements
    const deleteModal = document.getElementById("deleteModal");
    const deleteDialog = document.querySelector("#deleteModal .modal-dialog");
    const deleteSummary = document.getElementById("deleteSummary");
    const deleteCancelBtn = document.getElementById("deleteCancelBtn");
    const deleteConfirmBtn = document.getElementById("deleteConfirmBtn");
    // legacy delete state removed (handled by controllers)
    // Instance modal elements
    const instanceModal = document.getElementById("instanceModal");
    const instanceDialog = document.querySelector(
        "#instanceModal .modal-dialog"
    );
    const instPrefixInput = document.getElementById("instPrefixInput");
    const instRegionSelect = document.getElementById("instRegionSelect");
    const instPrefixErr = document.getElementById("instPrefixErr");
    const instPreviewUrl = document.getElementById("instPreviewUrl");
    const instCopyUrlBtn = document.getElementById("instCopyUrlBtn");
    const instCopyPlaceholderBtn = document.getElementById(
        "instCopyPlaceholderBtn"
    );
    const instPlaceholderToken = document.getElementById(
        "instPlaceholderToken"
    );
    const instPlaceholderValue = document.getElementById(
        "instPlaceholderValue"
    );
    const instCancelBtn = document.getElementById("instCancelBtn");
    const instSaveBtn = document.getElementById("instSaveBtn");
    // legacy instance edit state removed (handled by NqaInstanceSection)

    // Centralized copy for help/errors
    const URL_HELP =
        "Example: http(s)://hostname/path{keyword} <br>{keyword} is a column name and will be replaced by the captured value from the investigation<br>{*keyword} will match the first column name ending with keyword<br>Use {instance_name} to inject the configured tenant prefix";
    const URL_ERR_INVALID = "Invalid URL";

    // Use shared storage class (mandatory)
    const store = new window.NqaConfigStore();
    const templateController = initTemplateController({
        templateBtn,
        templateModal,
        templateList,
        templateCancelBtn,
        templateAddBtn,
        store,
        onMenuChanged: () => {
            try {
                window.__nqaMenuController?.render?.();
            } catch (_) {}
        },
    });

    const exportPrefsController = initExportPrefs({
        store,
        csvDelimiterInput,
        csvDelimiterErr,
        clipboardFormatRadios,
        modifierCard,
        modifierAltLabel,
        modifierShiftLabel,
        modifierAltRow,
        modifierShiftRow,
        exportSaveStatus,
    });

    // Icons rendered via CSS masks; no runtime URL required

    templateController?.setEnabled?.(true);

    const menuController = initMenuController({
        menuTable,
        tbody,
        empty,
        addBtn,
        deleteModal,
        deleteDialog,
        deleteSummary,
        deleteCancelBtn,
        deleteConfirmBtn,
        store,
        urlHelp: URL_HELP,
        urlErrInvalid: URL_ERR_INVALID,
        templateController,
    });

    const instanceController = initInstanceController({
        instSection,
        instTable,
        instTbody,
        instAddBtn,
        instanceModal,
        instanceDialog,
        instPrefixInput,
        instRegionSelect,
        instPrefixErr,
        instPreviewUrl,
        instCopyUrlBtn,
        instCopyPlaceholderBtn,
        instPlaceholderToken,
        instPlaceholderValue,
        instCancelBtn,
        instSaveBtn,
        deleteModal,
        deleteDialog,
        deleteSummary,
        deleteCancelBtn,
        deleteConfirmBtn,
        store,
    });

    initImportExportToolbar({
        importBtn,
        exportBtn,
        importFile,
        importModal,
        importSummary,
        importCancelBtn,
        importAddBtn,
        importReplaceBtn,
        store,
        instanceController,
        exportPrefsController,
    });

    attachEscapeHandler({
        importModal,
        deleteModal,
        deleteDialog,
        templateModal,
        templateController,
    });

    attachStorageListeners(menuController, instanceController);
});
