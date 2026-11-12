(function () {
    "use strict";

    function initNqaExportPrefs(opts) {
        const {
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
        } = opts || {};

        if (!store) return;

        const radios = Array.isArray(clipboardFormatRadios)
            ? clipboardFormatRadios
            : [];

        const DEFAULT_EXPORT_PREFS = window.NqaConfigStore
            ?.DEFAULT_EXPORT_PREFS || {
            csvDelimiter: ",",
            clipboardFormat: "html",
        };

        const EXPORT_AUTOSAVE_DELAY = 250;
        let exportStatusTimer = null;
        let exportAutosaveTimer = null;
        let currentExportPrefs = {
            csvDelimiter: DEFAULT_EXPORT_PREFS.csvDelimiter,
            clipboardFormat: DEFAULT_EXPORT_PREFS.clipboardFormat,
        };
        let importApplied = false;

        const toDisplayDelimiter = (value) => (value === "\t" ? "\\t" : value);
        const fromDisplayDelimiter = (value) =>
            value === "\\t" ? "\t" : value;

        const getSelectedClipboardFormat = () => {
            const checked = radios.find((radio) => radio.checked);
            return checked ? checked.value : null;
        };

        const setSelectedClipboardFormat = (format) => {
            radios.forEach((radio) => {
                radio.checked = radio.value === format;
            });
        };

        const getFormatEntries = () => {
            return radios.map((radio) => {
                const labelSpan =
                    radio.closest(".radio-option")?.querySelector("span");
                return {
                    value: radio.value,
                    label: labelSpan
                        ? labelSpan.textContent.trim()
                        : radio.value.toUpperCase(),
                };
            });
        };

        const updateClipboardModifierHints = () => {
            if (!modifierCard) return;
            const entries = getFormatEntries();
            if (!entries.length) {
                modifierCard.hidden = true;
                return;
            }
            const selected =
                getSelectedClipboardFormat() ||
                DEFAULT_EXPORT_PREFS.clipboardFormat;
            const selectedEntry =
                entries.find((entry) => entry.value === selected) ||
                entries[0];
            const alternatives = entries.filter(
                (entry) => entry.value !== selectedEntry.value
            );

            const altEntry = alternatives[0] || null;
            const shiftEntry = alternatives[1] || altEntry;

            if (modifierAltLabel)
                modifierAltLabel.textContent = altEntry?.label || "—";
            if (modifierShiftLabel)
                modifierShiftLabel.textContent = shiftEntry?.label || "—";

            if (modifierAltRow) {
                modifierAltRow.classList.toggle(
                    "modifier-disabled",
                    !altEntry || altEntry.value === selectedEntry.value
                );
            }
            if (modifierShiftRow) {
                modifierShiftRow.classList.toggle(
                    "modifier-disabled",
                    !shiftEntry || shiftEntry.value === selectedEntry.value
                );
            }
            modifierCard.hidden = entries.length < 2;
        };

        const showExportStatus = (message, isError = false) => {
            if (!exportSaveStatus) return;
            exportSaveStatus.textContent = message || "";
            exportSaveStatus.classList.toggle("error", !!isError);
            if (exportStatusTimer) {
                clearTimeout(exportStatusTimer);
                exportStatusTimer = null;
            }
            if (message) {
                exportStatusTimer = setTimeout(() => {
                    exportSaveStatus.textContent = "";
                    exportSaveStatus.classList.remove("error");
                    exportStatusTimer = null;
                }, 2500);
            }
        };

        const populateExportForm = (prefs) => {
            const effective = { ...DEFAULT_EXPORT_PREFS, ...(prefs || {}) };
            if (csvDelimiterInput) {
                csvDelimiterInput.value = toDisplayDelimiter(
                    effective.csvDelimiter
                );
                currentExportPrefs.csvDelimiter =
                    fromDisplayDelimiter(csvDelimiterInput.value) ||
                    DEFAULT_EXPORT_PREFS.csvDelimiter;
            }
            if (radios.length) {
                const acceptable = ["markdown", "ascii", "html", "tsv"];
                const fmt = acceptable.includes(effective.clipboardFormat)
                    ? effective.clipboardFormat
                    : DEFAULT_EXPORT_PREFS.clipboardFormat;
                setSelectedClipboardFormat(fmt);
                currentExportPrefs.clipboardFormat = fmt;
            }
            updateClipboardModifierHints();
        };

        const broadcastExportPrefs = (prefs) => {
            if (!prefs) return;
            try {
                if (chrome?.runtime?.sendMessage) {
                    chrome.runtime.sendMessage(
                        { type: "nqa-export-prefs-updated", prefs },
                        () => {
                            // Ignore missing receivers (no open content scripts)
                            void chrome.runtime?.lastError;
                        }
                    );
                }
            } catch (_) {
                /* ignore */
            }
        };

        const loadExportPrefs = async () => {
            try {
                const prefs = await store.getExportPrefs();
                if (!importApplied) populateExportForm(prefs);
            } catch (_) {
                if (!importApplied) populateExportForm(DEFAULT_EXPORT_PREFS);
            }
        };

        const afterImport = (prefs) => {
            if (exportAutosaveTimer) {
                clearTimeout(exportAutosaveTimer);
                exportAutosaveTimer = null;
            }
            importApplied = true;
            populateExportForm(prefs);
            showExportStatus("Export preferences restored.");
            broadcastExportPrefs(prefs);
        };

        const handleExportSave = async () => {
            if (!csvDelimiterInput) return;
            const rawDelimiter = csvDelimiterInput.value
                ? csvDelimiterInput.value.trim()
                : "";
            const parsedDelimiter = fromDisplayDelimiter(rawDelimiter);
            if (!parsedDelimiter) {
                if (csvDelimiterErr) csvDelimiterErr.hidden = false;
                csvDelimiterInput.focus();
                showExportStatus("Separator is required.", true);
                return;
            }
            if (csvDelimiterErr) csvDelimiterErr.hidden = true;

            let format = getSelectedClipboardFormat();
            if (!format) format = DEFAULT_EXPORT_PREFS.clipboardFormat;

            if (
                parsedDelimiter === currentExportPrefs.csvDelimiter &&
                format === currentExportPrefs.clipboardFormat
            ) {
                return;
            }

            showExportStatus("Saving…");
            try {
                const saved = await store.setExportPrefs({
                    csvDelimiter: parsedDelimiter,
                    clipboardFormat: format,
                });
                populateExportForm(saved);
                showExportStatus("Preferences saved.");
                broadcastExportPrefs(saved);
            } catch (err) {
                showExportStatus("Unable to save preferences.", true);
            }
        };

        // Schedule a debounced save to avoid hammering storage on every keystroke.
        const queueExportSave = () => {
            if (exportAutosaveTimer) clearTimeout(exportAutosaveTimer);
            exportAutosaveTimer = setTimeout(() => {
                exportAutosaveTimer = null;
                handleExportSave();
            }, EXPORT_AUTOSAVE_DELAY);
        };

        if (csvDelimiterInput) {
            csvDelimiterInput.addEventListener("input", () => {
                if (csvDelimiterErr) csvDelimiterErr.hidden = true;
            });
            csvDelimiterInput.addEventListener("change", () => {
                queueExportSave();
            });
            csvDelimiterInput.addEventListener("blur", () => {
                queueExportSave();
            });
        }

        radios.forEach((radio) => {
            radio.addEventListener("change", () => {
                updateClipboardModifierHints();
                queueExportSave();
            });
        });

        loadExportPrefs();
        updateClipboardModifierHints();

        return { afterImport };
    }

    window.initNqaExportPrefs = initNqaExportPrefs;
})();
