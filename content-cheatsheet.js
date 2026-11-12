(function () {
    "use strict";

    function getPageContext() {
        try {
            if (typeof detectPageContext === "function") {
                const ctx = detectPageContext();
                if (ctx) return ctx;
            }
        } catch (_) {
            /* ignore */
        }
        try {
            const h2 = document.querySelector("header h2");
            const t = (h2?.textContent || "").trim();
            if (!t) return "";
            if (/\bInvestigations\b/i.test(t)) return "Investigations";
            if (/\bDevice\s*View\b/i.test(t)) return "Device View";
            return t;
        } catch (_) {
            return "";
        }
    }

    function isSupportedPage(ctx) {
        const kind = ctx || getPageContext();
        return kind === "Investigations" || kind === "Device View";
    }

    function selectHeaderNodes() {
        try {
            return Array.from(
                document.querySelectorAll(
                    'table[role="presentation"] th[rowspan="1"] div[class*="LinesEllipsis"]'
                )
            );
        } catch (_) {
            return [];
        }
    }

    function getLabelText(el) {
        try {
            const txt = Array.from(el.childNodes)
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent || "")
                .join("")
                .trim();
            return txt || (el.textContent || "").trim();
        } catch (_) {
            return ((el && el.textContent) || "").trim();
        }
    }

    function ensureStyles() {
        if (document.getElementById("nqa-cheatsheet-style")) return;
        const css = `
    #nqa-cheatsheet-toggle a, #nqa-cheatsheet-toggle a *{color:#fff!important}
    button#nqa-cheatsheet-toggle{position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#fff;border-radius:20px;border:1px solid rgba(0,0,0,0.15);padding:6px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2)}
    button#nqa-cheatsheet-toggle:hover{background:#f6f6f6}
    button#nqa-cheatsheet-toggle svg{display:block}
    #nqa-cheatsheet{position:fixed;right:16px;bottom:56px;z-index:2147483647;min-width:320px;max-width:480px;max-height:50vh;overflow:auto;background:#fff;color:#222;border:1px solid rgba(0,0,0,0.15);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12),0 2px 4px rgba(0,0,0,0.08)}
    #nqa-cheatsheet header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(0,0,0,0.08);font-weight:600}
    #nqa-cheatsheet .nqa-title{font-weight:700}
    #nqa-cheatsheet .nqa-list{padding:8px 12px}
    #nqa-cheatsheet .nqa-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed rgba(0,0,0,0.06)}
    #nqa-cheatsheet .nqa-label{color:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:0}
    #nqa-cheatsheet .nqa-key{font-family:monospace;background:#f5f7fa;color:#111;padding:2px 6px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 0 16ch;max-width:16ch}
    #nqa-cheatsheet .nqa-copy{flex:0 0 auto}
    #nqa-cheatsheet .nqa-copy{cursor:pointer;border:1px solid rgba(0,0,0,0.15);background:#4c4b4b;padding:2px 6px;border-radius:4px}
    #nqa-cheatsheet .nqa-copy:hover{background:#f6f6f6}
    #nqa-toast{position:fixed;right:16px;bottom:16px;background:#333;color:#fff;padding:6px 10px;border-radius:6px;opacity:0;transform:translateY(8px);transition:opacity .15s ease,transform .15s ease;z-index:2147483647}
    #nqa-toast.show{opacity:1;transform:translateY(0)}
    @media (prefers-color-scheme: dark){
      button#nqa-cheatsheet-toggle{background:#2b2b2b;border-color:rgba(255,255,255,0.15)}
      button#nqa-cheatsheet-toggle:hover{background:#333}
      button#nqa-cheatsheet-toggle svg{filter:invert(1)}
      #nqa-cheatsheet{background:#1f2125;color:#e8e8e8;border-color:rgba(255,255,255,0.12);box-shadow:0 8px 24px rgba(0,0,0,0.5),0 2px 4px rgba(0,0,0,0.4)}
      #nqa-cheatsheet header{border-bottom-color:rgba(255,255,255,0.1)}
      #nqa-cheatsheet .nqa-key{background:#2a2d33;color:#e8e8e8}
      #nqa-cheatsheet .nqa-copy{border-color:rgba(255,255,255,0.15);color:#e8e8e8}
      #nqa-cheatsheet .nqa-copy:hover{background:#2a2d33}
      #nqa-toast{background:#111;color:#eee}
    }
    `;
        const style = document.createElement("style");
        style.id = "nqa-cheatsheet-style";
        style.textContent = css;
        document.head.appendChild(style);
    }

    function setMenuIconActive(li, active) {
        try {
            const svg = li && li.querySelector ? li.querySelector("svg") : null;
            if (!svg) return;
            const gInactive = svg.querySelector("#icon-inactive");
            const gActive = svg.querySelector("#icon-active");
            if (gInactive) gInactive.style.display = active ? "none" : "";
            if (gActive) gActive.style.display = active ? "" : "none";
        } catch (_) {}
    }

    function showToast(msg) {
        let toast = document.getElementById("nqa-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "nqa-toast";
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 1500);
    }

    function copy(text) {
        try {
            navigator.clipboard
                .writeText(text)
                .then(() => showToast(`Copié: ${text}`))
                .catch(() => {
                    const ta = document.createElement("textarea");
                    ta.value = text;
                    ta.style.position = "fixed";
                    ta.style.opacity = "0";
                    document.body.appendChild(ta);
                    ta.select();
                    try {
                        document.execCommand("copy");
                        showToast(`Copié: ${text}`);
                    } catch (_) {}
                    document.body.removeChild(ta);
                });
        } catch (_) {}
    }

    const DEVICE_VIEW_PLACEHOLDERS = [
        { label: "Device name", key: "devices_name" },
        { label: "Login name", key: "login_name" },
        { label: "Full name", key: "full_name" },
        { label: "AD name", key: "ad_name" },
    ];

    function appendPlaceholderRow(list, label, key, value) {
        const safeKey = String(key || "").trim();
        if (!safeKey) return false;
        const safeLabel = (label || "").trim() || safeKey;
        const placeholder = `{${safeKey}}`;
        const row = document.createElement("div");
        row.className = "nqa-row";
        const lab = document.createElement("div");
        lab.className = "nqa-label";
        lab.textContent = safeLabel;
        const val = document.createElement("div");
        val.className = "nqa-key";
        val.textContent = placeholder;
        const btn = document.createElement("button");
        btn.className = "nqa-copy";
        btn.type = "button";
        btn.title = `Copier ${placeholder}`;
        btn.textContent = "Copier";
        const handleCopy = () => copy(placeholder);
        btn.addEventListener("click", handleCopy);
        val.addEventListener("click", handleCopy);
        try {
            val.title = value ? String(value) : placeholder;
        } catch (_) {}
        row.appendChild(lab);
        row.appendChild(val);
        row.appendChild(btn);
        list.appendChild(row);
        return true;
    }

    function populateDeviceView(list) {
        let count = 0;
        let raw = {};
        try {
            if (typeof buildDeviceViewPlaceholder === "function") {
                const obj = buildDeviceViewPlaceholder();
                raw = (obj && obj.rawValues) || {};
            }
        } catch (_) {
            raw = {};
        }
        DEVICE_VIEW_PLACEHOLDERS.forEach(({ label, key }) => {
            if (appendPlaceholderRow(list, label, key, raw[key])) {
                count++;
            }
        });
        return count;
    }

    // Locate the navigation menubar that hosts the Nexthink quick actions toggle.
    function findMenubarList() {
        const uls = document.querySelectorAll("nav ul[role='menubar']");
        if (uls.length) return uls[uls.length - 1] || null;
        // Fallback: newer Blue Bar nav no longer exposes role="menubar".
        try {
            const nav = document.querySelector(
                'nav[data-testid="blue-bar"], nav[aria-label="Main navigation panel"]'
            );
            if (!nav) return null;
            const navUls = Array.from(nav.querySelectorAll("ul"));
            let best = null;
            let bestCount = -1;
            for (const ul of navUls) {
                const count = ul.querySelectorAll(
                    "li[data-testid='item-container']"
                ).length;
                if (count > bestCount) {
                    best = ul;
                    bestCount = count;
                }
            }
            return best;
        } catch (_) {
            return null;
        }
    }


    // Clone the template menu item so we inherit Nexthink styling for the cheatsheet toggle.
    function cloneMenuItemForCheatsheet(templateItem) {
        if (!templateItem) return { item: null, primaryAnchor: null };
        const clone = templateItem.cloneNode(true);
        clone.id = "nqa-cheatsheet-toggle";
        const anchor = clone.querySelector('a[role="menuitem"], a');
        return { item: clone, primaryAnchor: anchor || null };
    }

    // Remove existing icon/text from the anchor and inject the Quick Actions spark.
    function decoratePrimaryAnchor(anchor, templateItem) {
        if (!anchor) return;
        while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
        anchor.removeAttribute("id");
        anchor.title = "QuickActions – Placeholders";
        anchor.setAttribute("aria-label", "QuickActions – Placeholders");
        anchor.setAttribute("aria-haspopup", "false");
        anchor.setAttribute("tabindex", "-1");
        const svgColor = templateItem
            ?.querySelector("svg")
            ?.getAttribute("color") || "currentColor";
        try {
            const svg =
                typeof buildQuickActionsIconSvg === "function"
                    ? buildQuickActionsIconSvg(true)
                    : null;
            if (svg) {
                svg.setAttribute("width", "16");
                svg.setAttribute("height", "16");
                svg.setAttribute("color", svgColor);
                anchor.appendChild(svg);
                return;
            }
        } catch (_) {
            /* fallback handled below */
        }
        anchor.textContent = "QuickActions";
    }

    // Update the textual anchor (if any) so the label matches the new toggle purpose.
    function decorateTitleAnchor(listItem, primaryAnchor) {
        const anchors = Array.from(listItem.querySelectorAll("a"));
        const titleAnchor = anchors.find((el) => el !== primaryAnchor);
        if (!titleAnchor) return;
        titleAnchor.removeAttribute("id");
        const titleDiv = titleAnchor.querySelector("div") || null;
        if (titleDiv) {
            titleDiv.textContent = "QuickActions";
            try {
                titleDiv.setAttribute("title", "QuickActions");
            } catch (_) {}
        } else {
            titleAnchor.textContent = "QuickActions";
        }
    }

    // Append a cloned separator so the toggle remains visually aligned with existing entries.
    function appendMenuSeparator(menu) {
        const sep = menu.querySelector("hr");
        if (!sep) return;
        try {
            const clone = sep.cloneNode(true);
            clone.id = "nqa-cheatsheet-separator";
            menu.appendChild(clone);
        } catch (_) {}
    }

    // Inject the cheatsheet toggle into the Nexthink menubar if it is not already present.
    function injectToggleIntoMenubar() {
        try {
            const menu = findMenubarList();
            if (!menu) return null;
            let exist = document.getElementById("nqa-cheatsheet-toggle");
            if (exist) return exist;
            const templateItem = menu.querySelector(
                "li[data-testid='item-container']:last-child"
            );
            if (!templateItem) return null;
            const { item, primaryAnchor } = cloneMenuItemForCheatsheet(
                templateItem
            );
            if (!item || !primaryAnchor) return null;
            decoratePrimaryAnchor(primaryAnchor, templateItem);
            decorateTitleAnchor(item, primaryAnchor);
            appendMenuSeparator(menu);
            menu.appendChild(item);
            return item;
        } catch (_) {
            return null;
        }
    }

    function buildPanel() {
        const wrap = document.createElement("div");
        wrap.id = "nqa-cheatsheet";
        const header = document.createElement("header");
        header.innerHTML = `<span class="nqa-title">Quick Actions Link Placeholders</span>`;
        const list = document.createElement("div");
        list.className = "nqa-list";
        wrap.appendChild(header);
        wrap.appendChild(list);
        return wrap;
    }

    function populate(context) {
        try {
            const panel = document.getElementById("nqa-cheatsheet");
            if (!panel) return;
            const list = panel.querySelector(".nqa-list");
            if (!list) return;
            list.innerHTML = "";
            const ctx = context || getPageContext();
            let count = 0;
            if (ctx === "Device View") {
                count = populateDeviceView(list);
            } else {
                const nodes = selectHeaderNodes();
                nodes.forEach((el) => {
                    const label = getLabelText(el);
                    const key =
                        typeof normalizeColumnKey === "function"
                            ? normalizeColumnKey(label)
                            : label;
                    if (appendPlaceholderRow(list, label, key)) count++;
                });
            }
            if (count === 0) {
                const info = document.createElement("div");
                info.style.padding = "8px 12px";
                info.textContent = "Aucune colonne détectée.";
                list.appendChild(info);
            }
        } catch (_) {}
    }

    // Install the quick cheatsheet toggle + panel for the given Nexthink context (Device View / Investigations).
    function mount(context) {
        const ctx = context || getPageContext();
        if (!isSupportedPage(ctx)) return false;
        ensureStyles();
        // Toggle entry in menubar (single target app, no fallback)
        const toggle = injectToggleIntoMenubar();
        if (!toggle) return false; // do nothing if menu not available
        // Panel
        let panel = document.getElementById("nqa-cheatsheet");
        if (!panel) {
            panel = buildPanel();
            panel.hidden = true;
            document.body.appendChild(panel);
        }
        populate(ctx);
        setMenuIconActive(toggle, !panel.hidden);
        if (toggle.dataset.nqaCheatsheetInit === "1") return true;

        toggle.dataset.nqaCheatsheetInit = "1";
        toggle.onclick = (ev) => {
            try {
                ev && ev.preventDefault && ev.preventDefault();
            } catch (_) {}
            panel.hidden = !panel.hidden;
            if (!panel.hidden) populate(getPageContext());
            setMenuIconActive(toggle, !panel.hidden);
        };

        // Observe for table changes (debounced, ignore own panel/toggle mutations)
        let populateScheduled = false;
        const schedulePopulate = () => {
            if (populateScheduled) return;
            populateScheduled = true;
            setTimeout(() => {
                try {
                    if (!panel.hidden) populate(getPageContext());
                } finally {
                    populateScheduled = false;
                }
            }, 150);
        };
        // Determine whether the supplied node belongs to the cheatsheet UI so we can ignore self-induced mutations.
        const isCheatsheetElement = (node) => {
            if (!node || !(node instanceof Element)) return false;
            if (panel.contains && panel.contains(node)) return true;
            if (toggle && toggle.contains && toggle.contains(node)) return true;
            return false;
        };

        // Check if a given mutation touches the cheatsheet toggle or panel, in which case the change should be ignored.
        const mutationTouchesCheatsheet = (mutation) => {
            if (isCheatsheetElement(mutation.target)) return true;
            const nodes = mutation.addedNodes;
            if (!nodes || !nodes.length) return false;
            for (const node of nodes) {
                if (isCheatsheetElement(node)) return true;
            }
            return false;
        };

        // Observe the DOM and refresh the cheatsheet when the underlying Nexthink table changes.
        const mo = new MutationObserver((muts) => {
            if (panel.hidden) return;
            for (const mutation of muts) {
                if (mutationTouchesCheatsheet(mutation)) continue;
                schedulePopulate();
                break;
            }
        });
        try {
            mo.observe(document.body, { childList: true, subtree: true });
        } catch (_) {}
        toggle.__nqaCheatsheetObserver = mo;
        return true;
    }

    // Install the cheatsheet toggle once the Nexthink page is ready (supports SPA navigation).
    function scheduleMount() {
        const tryNow = () => {
            const ctx = getPageContext();
            if (!isSupportedPage(ctx)) return false;
            return mount(ctx);
        };
        // If already ok, mount now
        if (tryNow()) return;
        // Wait for DOM ready
        const onReady = () => {
            if (tryNow()) {
                document.removeEventListener("DOMContentLoaded", onReady);
            }
        };
        if (document.readyState === "loading")
            document.addEventListener("DOMContentLoaded", onReady);
        else onReady();
        // Observe DOM mutations to catch SPA navigation
        const mo = new MutationObserver(() => {
            if (tryNow()) {
                try {
                    mo.disconnect();
                } catch (_) {}
            }
        });
        try {
            mo.observe(document.body, { childList: true, subtree: true });
        } catch (_) {}
        // Safety timeout to stop observing after 15s
        setTimeout(() => {
            try {
                mo.disconnect();
            } catch (_) {}
        }, 15000);
    }

    try {
        scheduleMount();
    } catch (_) {}
})();
