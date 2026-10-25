/*
 * Notepad - shared application logic (MD3 Expressive + MD1 Classic)
 *
 * Each page sets window.NOTEPAD_CONFIG before loading this file:
 *   defaultTitle : document title when no file name is set
 *   newFileName  : default name for a fresh document
 *   themeColors  : { light, dark, tabbedLight, tabbedDark } for <meta name="theme-color">
 */
(() => {
    'use strict';

    // ------------------------------------------------------------------
    // Config
    // ------------------------------------------------------------------
    const userConfig = window.NOTEPAD_CONFIG || {};
    const CONFIG = {
        defaultTitle: 'Notepad',
        newFileName: 'No_name.txt',
        ...userConfig,
        themeColors: {
            light: '#6750A4',
            dark: '#141218',
            tabbedLight: '#EADDFF',
            tabbedDark: '#2B2930',
            ...(userConfig.themeColors || {})
        }
    };

    const THEME_KEY = 'notepad-theme';

    const FILE_TYPES = [{
        description: 'Supported text/code files',
        accept: {
            'text/plain': ['.txt', '.md', '.json', '.lang'],
            'text/html': ['.html', '.htm'],
            'text/css': ['.css'],
            'application/javascript': ['.js'],
            'application/x-bat': ['.bat'],
            'text/x-python': ['.py'],
            'text/x-powershell': ['.ps1'],
            'text/x-vbscript': ['.vbs'],
            'text/x-registry': ['.reg']
        }
    }];
    const SUPPORTED_EXTENSIONS = Object.values(FILE_TYPES[0].accept).flat();

    const AUTO_PAIRS = { '"': '"', "'": "'", '(': ')', '[': ']', '{': '}', '`': '`', '*': '*', '_': '_' };

    // ------------------------------------------------------------------
    // DOM references
    // ------------------------------------------------------------------
    const $ = (id) => document.getElementById(id);

    const contentInput = $('noteContent');
    const searchHighlights = $('searchHighlights');
    const previewPane = $('previewPane');
    const contextMenu = $('contextMenu');
    const moreOptionsMenu = $('moreOptionsMenu');
    const moreOptionsBtn = $('moreOptionsBtn');
    const brandLogo = $('brandLogo');
    const titleInput = $('noteTitle');
    const mainSaveBtn = $('mainSaveBtn');
    const autoSaveToggle = $('autoSaveToggle');
    const autoSaveContainer = $('autoSaveContainer');
    const darkModeToggle = $('darkModeToggle');
    const wordCount = $('wordCount');
    const toast = $('toast');
    const mdToolbar = $('mdToolbar');
    const saveStatus = $('saveStatus');
    const loading = $('loading');
    const findReplaceBar = $('findReplaceBar');
    const findInput = $('findInput');
    const replaceInput = $('replaceInput');
    const findCountDisplay = $('findCount');
    const autoSavePrompt = $('autoSavePrompt');
    const syntaxLayer = $('syntaxLayer');
    const spellLayer = $('spellLayer');
    const editorWrapper = contentInput.parentElement;
    const spellToggle = $('spellCheckToggle');
    const spellLangItem = $('spellLangItem');
    const spellLangSummary = $('spellLangSummary');
    const spellDialog = $('spellLangDialog');
    const spellList = $('spellLangList');
    const spellFilter = $('spellLangFilter');
    const spellEngineInfo = $('spellEngineInfo');
    const spellGeminiBtn = $('spellGeminiBtn');
    const spellCtx = $('spellCtx');
    const spellCtxItem = $('spellCtxItem');
    const spellSubmenu = $('spellSubmenu');

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    let fileHandle = null;
    let isMarkdown = false;
    let isSaved = true;
    let searchResults = [];
    let currentSearchIndex = -1;
    let inputTimer = null;
    let autoSaveTimeout = null;
    let toastTimer = null;

    // ------------------------------------------------------------------
    // Markdown
    // ------------------------------------------------------------------
    const md = window.markdownit
        ? window.markdownit({ html: false, linkify: true, typographer: true, breaks: true })
        : null;
    if (md && window.markdownitTaskLists) md.use(window.markdownitTaskLists);

    function renderPreview() {
        if (!isMarkdown) return;
        const source = contentInput.value;
        if (!md || !window.DOMPurify) {
            previewPane.textContent = source;
            return;
        }
        previewPane.innerHTML = window.DOMPurify.sanitize(md.render(source));
    }

    // ------------------------------------------------------------------
    // Undo / redo history
    // ------------------------------------------------------------------
    const editHistory = {
        stack: [''],
        pointer: 0,
        reset(val) {
            this.stack = [val];
            this.pointer = 0;
        },
        push(val) {
            if (val === this.stack[this.pointer]) return;
            this.stack = this.stack.slice(0, this.pointer + 1);
            this.stack.push(val);
            if (this.stack.length > 50) this.stack.shift();
            this.pointer = this.stack.length - 1;
        },
        undo() {
            return this.pointer > 0 ? this.stack[--this.pointer] : null;
        },
        redo() {
            return this.pointer < this.stack.length - 1 ? this.stack[++this.pointer] : null;
        }
    };

    // Record any typing that is still waiting for the debounce timer.
    function flushHistory() {
        clearTimeout(inputTimer);
        editHistory.push(contentInput.value);
    }

    // Record a programmatic edit and let the normal 'input' pipeline run
    // (save state, preview, word count, auto save, search refresh).
    function commitEdit() {
        editHistory.push(contentInput.value);
        contentInput.dispatchEvent(new Event('input'));
    }

    function replaceRange(start, end, text, selStart, selEnd) {
        flushHistory();
        contentInput.setRangeText(text, start, end, 'end');
        commitEdit();
        if (selStart !== undefined) {
            contentInput.setSelectionRange(selStart, selEnd === undefined ? selStart : selEnd);
        }
    }

    // ------------------------------------------------------------------
    // Small UI helpers
    // ------------------------------------------------------------------
    function showToast(msg) {
        toast.innerText = msg;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function showAutoSavePrompt() { autoSavePrompt.classList.remove('hidden'); }
    function closeAutoSavePrompt() { autoSavePrompt.classList.add('hidden'); }
    function enableAutoSave() {
        autoSaveToggle.checked = true;
        closeAutoSavePrompt();
    }

    function updateWindowTitle() {
        const name = titleInput.value.trim() || CONFIG.defaultTitle;
        document.title = (isSaved ? '' : '● ') + name;
    }

    function updateSaveUI() {
        if (fileHandle && 'showOpenFilePicker' in window) {
            autoSaveContainer.style.display = 'flex';
            mainSaveBtn.classList.remove('hidden');
        } else {
            autoSaveContainer.style.display = 'none';
            mainSaveBtn.classList.add('hidden');
        }
    }

    function updateWordCount() {
        const text = contentInput.value;
        const trimmed = text.trim();
        const words = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
        wordCount.textContent = `${text.length} ký tự • ${words} từ`;
    }

    function checkFileType(fileName) {
        currentExt = fileName.includes('.') ? fileName.toLowerCase().split('.').pop() : '';
        isMarkdown = fileName.toLowerCase().endsWith('.md');
        if (isMarkdown) {
            mdToolbar.classList.replace('opacity-0', 'opacity-100');
            mdToolbar.classList.remove('pointer-events-none');
            previewPane.classList.add('active');
        } else {
            mdToolbar.classList.replace('opacity-100', 'opacity-0');
            mdToolbar.classList.add('pointer-events-none');
            previewPane.classList.remove('active');
        }
    }

    // ------------------------------------------------------------------
    // Theme (light / dark)
    // ------------------------------------------------------------------
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
    const tabbedMedia = window.matchMedia('(display-mode: tabbed)');

    function getStoredTheme() {
        try {
            const t = localStorage.getItem(THEME_KEY);
            return t === 'dark' || t === 'light' ? t : null;
        } catch (err) {
            return null;
        }
    }

    function currentTheme() {
        return getStoredTheme() || (systemDark.matches ? 'dark' : 'light');
    }

    function updateThemeColor() {
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }
        const dark = currentTheme() === 'dark';
        const c = CONFIG.themeColors;
        const color = tabbedMedia.matches
            ? (dark ? c.tabbedDark : c.tabbedLight)
            : (dark ? c.dark : c.light);
        meta.setAttribute('content', color);
    }

    function applyTheme() {
        const theme = currentTheme();
        document.documentElement.setAttribute('data-theme', theme);
        if (darkModeToggle) darkModeToggle.checked = theme === 'dark';
        updateThemeColor();
    }

    function toggleDarkMode(e) {
        if (e) e.stopPropagation(); // keep the menu open so the switch animation is visible
        const next = currentTheme() === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* storage blocked */ }
        applyTheme();
    }

    systemDark.addEventListener('change', () => { if (!getStoredTheme()) applyTheme(); });
    tabbedMedia.addEventListener('change', updateThemeColor);

    // ------------------------------------------------------------------
    // Opening documents
    // ------------------------------------------------------------------
    function openDocument(text, name) {
        contentInput.value = text;
        editHistory.reset(text);
        titleInput.value = name;
        checkFileType(name);
        isSaved = true;
        updateWindowTitle();
        updateSaveUI();
        renderPreview();
        updateWordCount();
        onEditorChange();
        if (findBarOpen()) performSearch();
    }

    async function loadFileFromHandle(handle) {
        loading.classList.remove('hidden');
        try {
            const file = await handle.getFile();
            const text = await file.text();
            fileHandle = handle;
            openDocument(text, file.name);
            if (!autoSaveToggle.checked) showAutoSavePrompt();
            showToast(`Đã mở: ${file.name}`);
        } catch (err) {
            showToast('Không thể mở file!');
        } finally {
            loading.classList.add('hidden');
        }
    }

    async function openFile() {
        if (!('showOpenFilePicker' in window)) {
            showToast('Trình duyệt không hỗ trợ mở tệp trực tiếp!');
            return;
        }
        try {
            const [handle] = await window.showOpenFilePicker({
                types: FILE_TYPES,
                excludeAcceptAllOption: true,
                multiple: false
            });
            await loadFileFromHandle(handle);
        } catch (err) { /* picker cancelled */ }
    }

    // PWA file handler (open with...)
    if ('launchQueue' in window) {
        window.launchQueue.setConsumer(async (launchParams) => {
            if (launchParams.files.length > 0) {
                await loadFileFromHandle(launchParams.files[0]);
            }
        });
    }

    // Drag & drop
    window.addEventListener('dragover', (e) => e.preventDefault()); // required for 'drop' to fire
    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        const items = e.dataTransfer && e.dataTransfer.items;
        if (!items) return;

        for (const item of items) {
            if (item.kind !== 'file') continue;

            const file = item.getAsFile();
            if (!file) continue;

            const lowerName = file.name.toLowerCase();
            if (!SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
                showToast('Định dạng file không được hỗ trợ!');
                return;
            }

            // Must be requested synchronously, before any await.
            const handlePromise = item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null;
            const handle = handlePromise ? await handlePromise : null;

            if (handle && handle.kind === 'file') {
                await loadFileFromHandle(handle);
            } else {
                fileHandle = null;
                openDocument(await file.text(), file.name);
                showToast(`Đã mở: ${file.name}`);
            }
            break; // only open one file
        }
    });

    // ------------------------------------------------------------------
    // Saving / new file
    // ------------------------------------------------------------------
    async function saveFile() {
        if (!fileHandle) return saveFileAs();
        try {
            const writable = await fileHandle.createWritable();
            await writable.write(contentInput.value);
            await writable.close();

            isSaved = true;
            updateWindowTitle();
            saveStatus.style.opacity = '1';
            setTimeout(() => { saveStatus.style.opacity = '0'; }, 1500);
        } catch (err) {
            showToast('Lỗi ghi file!');
        }
    }

    async function saveFileAs() {
        if (!('showSaveFilePicker' in window)) {
            showToast('Trình duyệt không hỗ trợ lưu tệp trực tiếp!');
            return;
        }
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: titleInput.value.trim() || CONFIG.newFileName,
                types: FILE_TYPES
            });

            await saveFile();

            const file = await fileHandle.getFile();
            titleInput.value = file.name;
            checkFileType(file.name);
            onEditorChange();
            updateSaveUI();
            updateWindowTitle();
        } catch (err) { /* picker cancelled */ }
    }

    function newFile() {
        if (!isSaved && !confirm('Tệp chưa được lưu. Bạn có muốn tạo tệp mới không?')) return;

        fileHandle = null;
        openDocument('', CONFIG.newFileName);
    }

    function scheduleAutoSave() {
        if (autoSaveToggle.checked && fileHandle) {
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = setTimeout(saveFile, 1000);
        }
    }

    window.addEventListener('beforeunload', (e) => {
        if (!isSaved) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // ------------------------------------------------------------------
    // Find & replace
    // ------------------------------------------------------------------
    const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const findBarOpen = () => findReplaceBar.style.display === 'flex';

    function toggleFindReplace() {
        const open = findBarOpen();
        findReplaceBar.style.display = open ? 'none' : 'flex';
        if (!open) {
            findInput.focus();
            findInput.select();
            performSearch(true);
        } else {
            contentInput.focus();
            searchHighlights.innerHTML = '';
        }
    }

    function updateSearchUI() {
        findCountDisplay.innerText = searchResults.length === 0
            ? '0/0'
            : `${currentSearchIndex + 1}/${searchResults.length}`;
    }

    function highlightResult() {
        if (currentSearchIndex === -1 || searchResults.length === 0) return;
        const result = searchResults[currentSearchIndex];
        contentInput.setSelectionRange(result.start, result.end);
        const lineHeight = parseInt(window.getComputedStyle(contentInput).lineHeight, 10) || 28;
        const linesBefore = contentInput.value.substring(0, result.start).split('\n').length;
        const scrollTarget = (linesBefore * lineHeight) - (contentInput.clientHeight / 2);
        contentInput.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    }

    // jump = move the editor selection to the current match (only when the
    // user navigates the search, never while they are typing in the editor).
    function performSearch(jump = false) {
        const query = findInput.value;
        const text = contentInput.value;
        searchResults = [];

        if (!query) {
            currentSearchIndex = -1;
            searchHighlights.innerHTML = '';
            updateSearchUI();
            return;
        }

        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        let pos = 0;
        while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
            searchResults.push({ start: pos, end: pos + query.length });
            pos += query.length;
        }

        if (searchResults.length === 0) {
            currentSearchIndex = -1;
        } else if (currentSearchIndex < 0 || currentSearchIndex >= searchResults.length) {
            currentSearchIndex = 0;
        }

        // Build the highlight layer from raw-text positions so special
        // characters (<, &, ...) can be searched safely.
        let html = '';
        let last = 0;
        searchResults.forEach((r, i) => {
            html += escapeHtml(text.slice(last, r.start));
            html += `<mark class="${i === currentSearchIndex ? 'current' : ''}">${escapeHtml(text.slice(r.start, r.end))}</mark>`;
            last = r.end;
        });
        html += escapeHtml(text.slice(last));
        searchHighlights.innerHTML = html + '\n\n';

        updateSearchUI();
        if (jump) highlightResult();
    }

    function findNext(forward = true) {
        if (searchResults.length === 0) return;
        const n = searchResults.length;
        currentSearchIndex = forward ? (currentSearchIndex + 1) % n : (currentSearchIndex - 1 + n) % n;
        performSearch(true);
    }

    function replaceOne() {
        if (currentSearchIndex === -1) return;
        const r = searchResults[currentSearchIndex];
        replaceRange(r.start, r.end, replaceInput.value);
    }

    function replaceAll() {
        const query = findInput.value;
        if (!query) return;
        const regex = new RegExp(escapeRegExp(query), 'gi');
        const matches = contentInput.value.match(regex);
        if (!matches) return;

        const replacement = replaceInput.value;
        flushHistory();
        contentInput.value = contentInput.value.replace(regex, () => replacement);
        commitEdit();
        showToast(`Đã thay thế ${matches.length} vị trí!`);
    }

    findInput.addEventListener('input', () => {
        currentSearchIndex = 0;
        performSearch(true);
    });

    contentInput.addEventListener('scroll', () => {
        syncLayerScroll();
        onScrollSpell();
    });

    // ------------------------------------------------------------------
    // Menus & clipboard
    // ------------------------------------------------------------------
    moreOptionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = moreOptionsBtn.getBoundingClientRect();
        moreOptionsMenu.style.display = 'block';
        moreOptionsMenu.style.right = (window.innerWidth - rect.right) + 'px';
        moreOptionsMenu.style.top = (rect.bottom + 8) + 'px';
    });

    window.addEventListener('click', () => {
        contextMenu.style.display = 'none';
        moreOptionsMenu.style.display = 'none';
        hideSpellSubmenu();
    });

    window.addEventListener('contextmenu', (e) => {
        if (e.target.id !== 'noteContent' && e.target.id !== 'previewPane') return;
        e.preventDefault();
        hideSpellSubmenu();
        // right-click on an underlined word adds the "Chính tả >" entry
        spellCtxEntry = e.target.id === 'noteContent' ? spellEntryAt(e.clientX, e.clientY) : null;
        spellCtx.style.display = spellCtxEntry ? 'block' : 'none';
        moreOptionsMenu.style.display = 'none';
        contextMenu.style.display = 'block';
        contextMenu.style.left = Math.min(e.pageX, window.innerWidth - 230) + 'px';
        contextMenu.style.top = Math.min(e.pageY, window.innerHeight - 360) + 'px';
    });

    async function handleMenuAction(action) {
        contentInput.focus();
        const start = contentInput.selectionStart;
        const end = contentInput.selectionEnd;
        const selectedText = contentInput.value.substring(start, end);

        switch (action) {
            case 'undo': {
                flushHistory();
                const prev = editHistory.undo();
                if (prev !== null) {
                    contentInput.value = prev;
                    contentInput.dispatchEvent(new Event('input'));
                }
                break;
            }
            case 'redo': {
                flushHistory();
                const next = editHistory.redo();
                if (next !== null) {
                    contentInput.value = next;
                    contentInput.dispatchEvent(new Event('input'));
                }
                break;
            }
            case 'cut':
                if (start !== end) {
                    await navigator.clipboard.writeText(selectedText);
                    replaceRange(start, end, '', start);
                }
                break;
            case 'copy':
                if (start !== end) await navigator.clipboard.writeText(selectedText);
                break;
            case 'paste':
                try {
                    const text = await navigator.clipboard.readText();
                    replaceRange(start, end, text);
                } catch (err) {
                    showToast('Cần cấp quyền Clipboard!');
                }
                break;
            case 'select-all':
                contentInput.select();
                break;
        }
    }

    // ------------------------------------------------------------------
    // Markdown toolbar
    // ------------------------------------------------------------------
    function insertMD(prefix, suffix) {
        const start = contentInput.selectionStart;
        const end = contentInput.selectionEnd;
        const selected = contentInput.value.substring(start, end);

        const alreadyWrapped = selected.length >= prefix.length + suffix.length
            && selected.startsWith(prefix)
            && selected.endsWith(suffix);

        if (alreadyWrapped) {
            const inner = selected.slice(prefix.length, selected.length - suffix.length);
            replaceRange(start, end, inner, start, start + inner.length);
        } else {
            replaceRange(start, end, prefix + selected + suffix,
                start + prefix.length, start + prefix.length + selected.length);
        }
        contentInput.focus();
    }

    function insertLinePrefix(prefix) {
        const value = contentInput.value;
        const start = contentInput.selectionStart;
        const end = contentInput.selectionEnd;

        const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
        let lineEnd = value.indexOf('\n', end);
        if (lineEnd === -1) lineEnd = value.length;

        const lines = value.slice(lineStart, lineEnd).split('\n');
        const result = lines.map((line) => prefix + line).join('\n');

        replaceRange(lineStart, lineEnd, result,
            start + prefix.length, end + prefix.length * lines.length);
        contentInput.focus();
    }

    function insertCodeBlock() {
        const start = contentInput.selectionStart;
        const end = contentInput.selectionEnd;
        const selected = contentInput.value.substring(start, end) || 'code here';

        replaceRange(start, end, `\n\`\`\`\n${selected}\n\`\`\`\n`,
            start + 5, start + 5 + selected.length);
        contentInput.focus();
    }

    // ------------------------------------------------------------------
    // Keyboard
    // ------------------------------------------------------------------
    // Editor-only keys
    contentInput.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();

        if (mod && key === 'z') {
            e.preventDefault();
            handleMenuAction(e.shiftKey ? 'redo' : 'undo');
            return;
        }
        if (mod && key === 'y') {
            e.preventDefault();
            handleMenuAction('redo');
            return;
        }
        if (mod || e.altKey) return;

        const start = contentInput.selectionStart;
        const end = contentInput.selectionEnd;

        if (e.key === 'Tab') {
            e.preventDefault();
            replaceRange(start, end, '    ');
            return;
        }

        if (start === end && AUTO_PAIRS[e.key]) {
            e.preventDefault();
            replaceRange(start, end, e.key + AUTO_PAIRS[e.key], start + 1);
        }
    });

    // Global shortcuts (work wherever the focus is)
    document.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();

        // Manual reload is blocked on purpose (use the "Khởi động lại" menu item).
        if (key === 'f5' || (mod && key === 'r')) {
            e.preventDefault();
            return;
        }

        if (mod) {
            switch (key) {
                case 's':
                    e.preventDefault();
                    if (e.shiftKey) saveFileAs(); else saveFile();
                    return;
                case 'o':
                    e.preventDefault();
                    openFile();
                    return;
                case 'n':
                    e.preventDefault();
                    newFile();
                    return;
                case 'f':
                    e.preventDefault();
                    if (findBarOpen()) {
                        findInput.focus();
                        findInput.select();
                    } else {
                        toggleFindReplace();
                    }
                    return;
            }
        }

        if (e.key === 'Escape') {
            if (spellDialogOpen()) { closeSpellDialog(); return; }
            if (contextMenu.style.display === 'block') {
                contextMenu.style.display = 'none';
                hideSpellSubmenu();
                return;
            }
            if (findBarOpen()) toggleFindReplace();
        }
    });

    // ------------------------------------------------------------------
    // Editor input pipeline
    // ------------------------------------------------------------------
    contentInput.addEventListener('input', () => {
        isSaved = false;
        updateWindowTitle();
        onEditorChange();
        renderPreview();
        scheduleAutoSave();
        updateWordCount();
        if (findBarOpen()) performSearch();
        clearTimeout(inputTimer);
        inputTimer = setTimeout(() => editHistory.push(contentInput.value), 500);
    });

    // ------------------------------------------------------------------
    // Editor layers: syntax highlighting (highlight.js) + spell check
    //
    // Both are drawn on transparent <div>s that sit exactly under the
    // textarea (see editor.css), so the textarea stays a plain native
    // <textarea>: typing, IME (Telex), undo, selection all keep working.
    //
    // Spell check engines:
    //   gemini - Chrome's on-device Gemini Nano (Prompt API), used automatically
    //            when the model is already installed and supports every selected language.
    //   nspell - Hunspell dictionaries (nspell + "dictionary-*" npm packages via jsDelivr).
    // ------------------------------------------------------------------
    const EXT_TO_HLJS = {
        js: 'javascript', json: 'json', html: 'xml', htm: 'xml', css: 'css',
        py: 'python', bat: 'dos', ps1: 'powershell', vbs: 'vbscript',
        reg: 'ini', lang: 'ini', md: 'markdown'
    };
    // How the spell checker treats each highlighted language:
    //   prose  - everything except the skipped token classes
    //   markup - only plain text between tags (and comments)
    //   code   - only comments and prose-like strings
    const SPELL_MODE = { md: 'prose', lang: 'prose', html: 'markup', htm: 'markup' };
    const SPELL_SKIP = {
        md: ['hljs-code', 'hljs-link', 'hljs-bullet', 'hljs-symbol', 'hljs-attr'],
        lang: ['hljs-attr', 'hljs-section', 'hljs-number', 'hljs-literal', 'hljs-keyword', 'hljs-variable']
    };

    const SYNTAX_SYNC_MAX = 40000;  // highlight synchronously while typing up to this size
    const SYNTAX_MAX = 250000;      // above this the highlighter is switched off
    const SPELL_SYNC_MAX = 40000;
    const SPELL_MAX = 150000;

    let currentExt = '';
    let syntaxActive = false;
    let syntaxText = null;          // the text the syntax layer currently shows
    let syntaxTimer = null;
    let spellTimer = null;
    let lastScrollbar = -1;

    const layers = [syntaxLayer, spellLayer, searchHighlights];

    function syncLayerScroll() {
        for (const layer of layers) {
            layer.scrollTop = contentInput.scrollTop;
            layer.scrollLeft = contentInput.scrollLeft;
        }
    }

    // The textarea loses width when its scrollbar appears; the layers must wrap identically.
    function syncScrollbarWidth() {
        const sb = contentInput.offsetWidth - contentInput.clientWidth;
        if (sb !== lastScrollbar) {
            lastScrollbar = sb;
            editorWrapper.style.setProperty('--ed-sb', sb + 'px');
        }
    }

    if (window.ResizeObserver) new ResizeObserver(syncScrollbarWidth).observe(contentInput);

    // ---- syntax highlighting ----
    function syntaxLang() {
        const name = EXT_TO_HLJS[currentExt];
        return name && window.hljs && window.hljs.getLanguage(name) ? name : null;
    }

    function setSyntaxActive(on) {
        syntaxActive = on;
        editorWrapper.classList.toggle('syntax-on', on);
        if (!on) {
            syntaxLayer.textContent = '';
            syntaxText = null;
        }
    }

    function renderSyntax() {
        const text = contentInput.value;
        const lang = syntaxLang();
        if (!lang || text.length > SYNTAX_MAX) {
            setSyntaxActive(false);
            return;
        }
        try {
            // trailing '\n' keeps the layer as tall as the textarea when the text ends with a newline
            syntaxLayer.innerHTML = window.hljs.highlight(text, { language: lang, ignoreIllegals: true }).value + '\n';
            setSyntaxActive(true);
            syntaxText = text;
        } catch (err) {
            setSyntaxActive(false);
        }
    }

    // ---- spell check: state ----
    const SPELL_ON_KEY = 'notepad-spell';
    const SPELL_LANGS_KEY = 'notepad-spell-langs';
    const NSPELL_URL = 'https://cdn.jsdelivr.net/npm/nspell@2.1.5/+esm';
    const DICT_BASE = 'https://cdn.jsdelivr.net/npm/';

    // Hunspell dictionaries from the "dictionary-*" npm packages (wooorm/dictionaries), served by jsDelivr.
    const SPELL_LANGS = [
        { code: 'en',    native: 'English (US)',         en: 'English (US)',          pkg: 'dictionary-en',    ver: '4.0.0', size: '0.6 MB' },
        { code: 'en-gb', native: 'English (UK)',         en: 'English (UK)',          pkg: 'dictionary-en-gb', ver: '3.0.0', size: '0.6 MB' },
        { code: 'vi',    native: 'Tiếng Việt',           en: 'Vietnamese',            pkg: 'dictionary-vi',    ver: '3.0.0', size: '40 KB' },
        { code: 'fr',    native: 'Français',             en: 'French',                pkg: 'dictionary-fr',    ver: '3.0.0', size: '1.4 MB' },
        { code: 'de',    native: 'Deutsch',              en: 'German',                pkg: 'dictionary-de',    ver: '3.0.0', size: '1.1 MB' },
        { code: 'es',    native: 'Español',              en: 'Spanish',               pkg: 'dictionary-es',    ver: '4.0.0', size: '0.9 MB' },
        { code: 'it',    native: 'Italiano',             en: 'Italian',               pkg: 'dictionary-it',    ver: '2.0.0', size: '1.4 MB' },
        { code: 'pt',    native: 'Português',            en: 'Portuguese',            pkg: 'dictionary-pt',    ver: '4.0.0', size: '5.5 MB' },
        { code: 'pt-pt', native: 'Português (Portugal)', en: 'Portuguese (Portugal)', pkg: 'dictionary-pt-pt', ver: '2.0.0', size: '1.6 MB' },
        { code: 'ru',    native: 'Русский',              en: 'Russian',               pkg: 'dictionary-ru',    ver: '3.0.0', size: '3.5 MB' },
        { code: 'uk',    native: 'Українська',           en: 'Ukrainian',             pkg: 'dictionary-uk',    ver: '4.0.0', size: '8.7 MB' },
        { code: 'nl',    native: 'Nederlands',           en: 'Dutch',                 pkg: 'dictionary-nl',    ver: '2.0.0', size: '2.5 MB' },
        { code: 'pl',    native: 'Polski',               en: 'Polish',                pkg: 'dictionary-pl',    ver: '2.0.0', size: '4.9 MB' },
        { code: 'cs',    native: 'Čeština',              en: 'Czech',                 pkg: 'dictionary-cs',    ver: '4.0.0', size: '3.8 MB' },
        { code: 'sv',    native: 'Svenska',              en: 'Swedish',               pkg: 'dictionary-sv',    ver: '4.0.0', size: '2.4 MB' },
        { code: 'da',    native: 'Dansk',                en: 'Danish',                pkg: 'dictionary-da',    ver: '6.0.0', size: '3.8 MB' },
        { code: 'nb',    native: 'Norsk bokmål',         en: 'Norwegian',             pkg: 'dictionary-nb',    ver: '3.0.0', size: '5.4 MB' },
        { code: 'tr',    native: 'Türkçe',               en: 'Turkish',               pkg: 'dictionary-tr',    ver: '2.0.0', size: '9.4 MB' },
        { code: 'ro',    native: 'Română',               en: 'Romanian',              pkg: 'dictionary-ro',    ver: '3.0.0', size: '2.3 MB' },
        { code: 'hu',    native: 'Magyar',               en: 'Hungarian',             pkg: 'dictionary-hu',    ver: '3.0.0', size: '3.9 MB' },
        { code: 'bg',    native: 'Български',            en: 'Bulgarian',             pkg: 'dictionary-bg',    ver: '2.0.0', size: '1.6 MB' },
        { code: 'el',    native: 'Ελληνικά',             en: 'Greek',                 pkg: 'dictionary-el',    ver: '4.0.0', size: '19 MB' }
    ];
    const DEFAULT_SPELL_LANGS = ['en', 'vi'];
    const langByCode = (code) => SPELL_LANGS.find((l) => l.code === code);

    function lsGet(key) {
        try { return localStorage.getItem(key); } catch (err) { return null; }
    }
    function lsSet(key, value) {
        try { localStorage.setItem(key, value); } catch (err) { /* storage blocked */ }
    }

    function readSpellLangs() {
        try {
            const saved = JSON.parse(lsGet(SPELL_LANGS_KEY));
            if (Array.isArray(saved)) {
                const valid = saved.filter((c) => langByCode(c));
                if (valid.length) return valid;
            }
        } catch (err) { /* fall through */ }
        return DEFAULT_SPELL_LANGS.slice();
    }

    const spell = {
        enabled: lsGet(SPELL_ON_KEY) !== 'off',     // default ON
        langs: readSpellLangs(),
        engine: 'nspell',                           // 'nspell' | 'gemini'
        gemini: { state: 'unknown', reason: '' },   // result of the last detectGemini()
        NSpell: null,
        dicts: new Map(),       // code -> nspell instance
        cache: new Map(),       // word -> boolean (nspell)
        status: {},             // code -> 'loading' | 'err'
        bad: [],                // misspellings currently underlined: {start, end, word, suggestions?}
        token: 0
    };

    // Gemini Nano state
    const gem = {
        session: null,
        langKey: '',
        verdicts: new Map(),    // word -> { ok: boolean, suggestions: string[] }
        running: false,
        again: false,
        broken: false,
        scrollTimer: null
    };
    const GEMINI_CHUNK = 1000;          // characters of context per request (the session budget is small)
    const GEMINI_WORDS_PER_REQUEST = 100;
    const GEMINI_FULL_MAX = 20000;      // above this only the part of the document near the viewport is checked
    const GEMINI_WINDOW = 8000;
    const GEMINI_TIMEOUT = 30000;
    const GEMINI_SCHEMA = {
        type: 'object',
        properties: {
            errors: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        word: { type: 'string' },
                        suggestions: { type: 'array', items: { type: 'string' }, maxItems: 5 }
                    },
                    required: ['word', 'suggestions'],
                    additionalProperties: false
                }
            }
        },
        required: ['errors'],
        additionalProperties: false
    };

    // ---- spell check: Gemini Nano ----
    function geminiOptions(codes) {
        return {
            expectedInputs: [{ type: 'text', languages: codes }],
            expectedOutputs: [{ type: 'text', languages: codes }]
        };
    }

    function langNamesForBase(bases) {
        return spell.langs.filter((c) => bases.includes(c.split('-')[0])).map((c) => langByCode(c).native);
    }

    // Decide whether Gemini Nano can be used for the selected languages. Never starts a download.
    async function detectGemini() {
        if (typeof self.LanguageModel === 'undefined') {
            return { state: 'none', reason: 'Trình duyệt này chưa có Gemini Nano (cần Chrome 148 trở lên trên máy tính).' };
        }
        if (gem.broken) {
            return { state: 'broken', reason: 'Gemini Nano vừa gặp lỗi nên tạm thời không dùng.' };
        }
        const codes = [...new Set(spell.langs.map((c) => c.split('-')[0]))];
        const opts = geminiOptions(codes);
        let state;
        try {
            state = await self.LanguageModel.availability(opts);
        } catch (err) {
            state = 'unavailable';
        }
        if (state === 'available' || state === 'downloadable' || state === 'downloading') {
            return { state, reason: '', opts };
        }
        // Find out which of the selected languages Gemini Nano cannot handle.
        const unsupported = [];
        for (const code of codes) {
            try {
                if ((await self.LanguageModel.availability(geminiOptions([code]))) === 'unavailable') unsupported.push(code);
            } catch (err) {
                unsupported.push(code);
            }
        }
        if (unsupported.length) {
            return { state: 'unavailable', reason: `Gemini Nano chưa hỗ trợ: ${langNamesForBase(unsupported).join(', ')}.` };
        }
        return { state: 'unavailable', reason: 'Máy này chưa đáp ứng yêu cầu của Gemini Nano.' };
    }

    function geminiSystemPrompt() {
        const names = spell.langs.map((c) => langByCode(c).en).join(', ');
        return 'You are a precise spell checker. The text is written in: ' + names + '. ' +
            'You receive a TEXT and a WORDS list (words copied from the text). ' +
            'Return, as JSON, only the words from the WORDS list that are misspelled (typos, wrong letters, words that do not exist). ' +
            'Never include correctly spelled words, proper nouns, names, brands, abbreviations, technical terms or code. ' +
            'For each misspelled word give up to 5 corrections, best first. ' +
            'If nothing is misspelled return {"errors":[]}.';
    }

    function resetGemini() {
        if (gem.session) {
            try { gem.session.destroy(); } catch (err) { /* already gone */ }
        }
        gem.session = null;
        gem.langKey = '';
        gem.verdicts.clear();
        gem.again = false;
    }

    async function ensureGeminiSession(opts) {
        if (gem.session) return gem.session;
        gem.session = await self.LanguageModel.create({
            ...opts,
            initialPrompts: [{ role: 'system', content: geminiSystemPrompt() }]
        });
        return gem.session;
    }

    function cleanSuggestions(list, word) {
        const out = [];
        if (!Array.isArray(list)) return out;
        for (const s of list) {
            if (typeof s !== 'string') continue;
            const t = s.trim();
            if (!t || t.length > 40 || t.toLowerCase() === word.toLowerCase() || out.includes(t)) continue;
            out.push(t);
            if (out.length >= 6) break;
        }
        return out;
    }

    // Ask Gemini Nano about `words` (they all occur in `chunkText`). Returns Map(word -> suggestions[]) of the misspelled ones.
    async function geminiCheckChunk(chunkText, words) {
        const byLower = new Map(words.map((w) => [w.toLowerCase(), w]));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT);
        let session = gem.session;
        let clone = null;
        try {
            if (typeof gem.session.clone === 'function') clone = session = await gem.session.clone();
            const raw = await session.prompt(
                `TEXT:\n${chunkText}\n\nWORDS: ${words.join(', ')}`,
                { responseConstraint: GEMINI_SCHEMA, signal: controller.signal }
            );
            let parsed;
            try { parsed = JSON.parse(raw); } catch (err) { return new Map(); }
            const flagged = new Map();
            for (const e of (parsed && Array.isArray(parsed.errors) ? parsed.errors : [])) {
                if (!e || typeof e.word !== 'string') continue;
                const original = byLower.get(e.word.trim().toLowerCase());   // only words we asked about
                if (original) flagged.set(original, cleanSuggestions(e.suggestions, original));
            }
            return flagged;
        } finally {
            clearTimeout(timer);
            if (clone) { try { clone.destroy(); } catch (err) { /* ignore */ } }
        }
    }

    // Greedy windows of at most GEMINI_CHUNK characters, preferring to cut at a newline, then at a space.
    function buildChunks(text) {
        const chunks = [];
        let pos = 0;
        while (pos < text.length) {
            let end = Math.min(pos + GEMINI_CHUNK, text.length);
            if (end < text.length) {
                const nl = text.lastIndexOf('\n', end - 1);
                if (nl > pos) end = nl + 1;
                else {
                    const sp = text.lastIndexOf(' ', end - 1);
                    if (sp > pos) end = sp + 1;
                }
            }
            chunks.push({ start: pos, end });
            pos = end;
        }
        return chunks;
    }

    function tokensReady(text) {
        return !syntaxActive || syntaxText === text;
    }

    async function runGemini() {
        if (spell.engine !== 'gemini' || !gem.session) return;
        if (gem.running) { gem.again = true; return; }
        gem.running = true;
        try {
            for (let round = 0; round < 60; round++) {
                gem.again = false;
                const text = contentInput.value;
                if (text.length > SPELL_MAX || !tokensReady(text)) break;

                const unknown = collectWordRanges(text).filter((r) => !gem.verdicts.has(r.word));
                if (!unknown.length) break;

                const chunks = buildChunks(text);
                const ratio = contentInput.scrollHeight ? contentInput.scrollTop / contentInput.scrollHeight : 0;
                const viewAt = ratio * text.length;
                const windowed = text.length > GEMINI_FULL_MAX;

                // group unknown words by chunk
                const plan = [];
                let ci = 0;
                for (const r of unknown) {
                    while (ci < chunks.length - 1 && r.start >= chunks[ci].end) ci++;
                    const ch = chunks[ci];
                    if (windowed && Math.abs(ch.start - viewAt) > GEMINI_WINDOW) continue;
                    let entry = plan[plan.length - 1];
                    if (!entry || entry.ch !== ch) { entry = { ch, words: new Set() }; plan.push(entry); }
                    entry.words.add(r.word);
                }
                if (!plan.length) break;
                plan.sort((a, b) => Math.abs(a.ch.start - viewAt) - Math.abs(b.ch.start - viewAt));

                let progressed = false;
                for (const { ch, words } of plan) {
                    if (contentInput.value !== text || spell.engine !== 'gemini' || !gem.session) { gem.again = true; break; }
                    const list = [...words].slice(0, GEMINI_WORDS_PER_REQUEST);
                    let flagged;
                    try {
                        flagged = await geminiCheckChunk(text.slice(ch.start, ch.end), list);
                    } catch (err) {
                        if (err && err.name === 'AbortError') flagged = new Map();   // too slow: treat as fine
                        else throw err;
                    }
                    for (const w of list) {
                        gem.verdicts.set(w, flagged.has(w) ? { ok: false, suggestions: flagged.get(w) } : { ok: true, suggestions: [] });
                    }
                    progressed = true;
                    renderSpell(false);
                }
                if (!progressed && !gem.again) break;
            }
        } catch (err) {
            console.warn('Gemini Nano failed, falling back to nspell:', err);
            gem.broken = true;
            gem.running = false;
            syncSpellEngine();
            return;
        }
        gem.running = false;
        if (gem.again) runGemini();
    }

    function onScrollSpell() {
        if (spell.engine !== 'gemini' || contentInput.value.length <= GEMINI_FULL_MAX) return;
        clearTimeout(gem.scrollTimer);
        gem.scrollTimer = setTimeout(runGemini, 400);
    }

    async function downloadGeminiNano() {
        if (!spell.gemini.opts) return;
        if (!confirm('Gemini Nano là mô hình AI chạy ngay trên máy, dung lượng vài GB. Tải về bây giờ?')) return;
        spellGeminiBtn.disabled = true;
        try {
            const session = await self.LanguageModel.create({
                ...spell.gemini.opts,
                monitor(m) {
                    m.addEventListener('downloadprogress', (e) => {
                        spellEngineInfo.textContent = `Đang tải Gemini Nano… ${Math.round(e.loaded * 100)}%`;
                    });
                }
            });
            try { session.destroy(); } catch (err) { /* ignore */ }
            showToast('Đã tải xong Gemini Nano!');
        } catch (err) {
            showToast('Không tải được Gemini Nano!');
        }
        spellGeminiBtn.disabled = false;
        gem.broken = false;
        syncSpellEngine();
    }

    // ---- spell check: nspell ----
    async function loadSpellEngine() {
        if (!spell.NSpell) {
            const mod = await import(NSPELL_URL);
            spell.NSpell = mod.default || mod;
        }
        return spell.NSpell;
    }

    async function fetchText(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
    }

    async function fetchDictionary(lang) {
        try {
            const NSpell = await loadSpellEngine();
            const base = `${DICT_BASE}${lang.pkg}@${lang.ver}`;
            const [aff, dic] = await Promise.all([fetchText(base + '/index.aff'), fetchText(base + '/index.dic')]);
            await new Promise((resolve) => setTimeout(resolve, 0)); // let the UI paint before the heavy parse
            return NSpell(aff, dic);
        } catch (err) {
            console.warn('Spell dictionary failed:', lang.code, err);
            return null;
        }
    }

    function setLangStatus(code, status) {
        if (status) spell.status[code] = status; else delete spell.status[code];
        refreshLangMeta(code);
    }

    function dropNspell() {
        spell.dicts.clear();
        spell.cache.clear();
    }

    async function loadNspellDictionaries(token) {
        for (const code of [...spell.dicts.keys()]) {
            if (!spell.langs.includes(code)) spell.dicts.delete(code);
        }
        spell.cache.clear();

        const need = spell.langs.map(langByCode).filter((l) => l && !spell.dicts.has(l.code));
        const slowToast = need.length ? setTimeout(() => showToast('Đang tải từ điển chính tả…'), 700) : null;
        const failed = [];
        for (const lang of need) {
            setLangStatus(lang.code, 'loading');
            const instance = await fetchDictionary(lang);
            if (token !== spell.token) { clearTimeout(slowToast); return; } // superseded by a newer request
            if (instance) {
                spell.dicts.set(lang.code, instance);
                setLangStatus(lang.code, null);
                spell.cache.clear();
                renderSpell(false);
            } else {
                failed.push(lang);
                setLangStatus(lang.code, 'err');
            }
        }
        clearTimeout(slowToast);
        if (failed.length) showToast(`Không tải được từ điển: ${failed.map((l) => l.native).join(', ')}`);
        renderSpell(false);
    }

    // Pick the engine (Gemini Nano if usable, otherwise nspell) and get it ready.
    async function syncSpellEngine() {
        const token = ++spell.token;
        clearTimeout(gem.scrollTimer);
        if (!spell.enabled) {
            dropNspell();
            resetGemini();
            spell.engine = 'nspell';
            spell.bad = [];
            clearSpellLayer();
            updateEngineInfo();
            return;
        }

        const g = await detectGemini();
        if (token !== spell.token) return;
        spell.gemini = g;

        if (g.state === 'available') {
            try {
                if (gem.langKey !== spell.langs.join()) resetGemini();   // languages changed: old verdicts are void
                await ensureGeminiSession(g.opts);
                if (token !== spell.token) return;
                gem.langKey = spell.langs.join();
                spell.engine = 'gemini';
                dropNspell();                                           // no dictionaries needed
                updateEngineInfo();
                renderSpell(false);
                runGemini();
                return;
            } catch (err) {
                console.warn('Gemini Nano could not start:', err);
                gem.broken = true;
                spell.gemini = { state: 'broken', reason: 'Không khởi tạo được Gemini Nano nên dùng thư viện nspell.' };
            }
        }

        resetGemini();
        spell.engine = 'nspell';
        spell.bad = [];
        clearSpellLayer();
        updateEngineInfo();
        await loadNspellDictionaries(token);
    }

    // ---- spell check: finding words ----
    const WORD_RE = /[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}]+)*/gu;
    const MASK_RE = /(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.-]+/g;
    const NOT_A_WORD_BEFORE = './\\#@$%';

    function pushWords(data, base, out) {
        const masked = data.replace(MASK_RE, (m) => ' '.repeat(m.length)); // URLs / e-mails are not prose
        WORD_RE.lastIndex = 0;
        let m;
        while ((m = WORD_RE.exec(masked))) {
            const w = m[0];
            const i = m.index;
            if (w.length < 2) continue;
            if (/[\p{N}_]/u.test(w)) continue;          // identifiers, versions, hex...
            if (/\p{Ll}\p{Lu}/u.test(w)) continue;      // camelCase / PascalCase
            if (w === w.toUpperCase()) continue;        // ACRONYMS
            if (NOT_A_WORD_BEFORE.includes(masked[i - 1] || ' ')) continue; // .ext  /path  #id  @user  $var
            if (masked[i + w.length] === '(') continue; // function calls
            out.push({ start: base + i, end: base + i + w.length, word: w });
        }
    }

    // Is this text node (inside the highlighted syntax layer) prose that should be spell-checked?
    function nodeEligible(node, mode, skip) {
        const chain = [];
        for (let el = node.parentElement; el && el !== syntaxLayer; el = el.parentElement) chain.push(el.classList);
        if (!chain.length) return mode !== 'code';                       // plain text outside any token
        if (mode === 'markup') return chain.every((c) => c.contains('hljs-comment'));
        if (mode === 'prose') return !chain.some((c) => skip.some((s) => c.contains(s)));
        // code: comments, and strings that read like sentences
        if (chain.some((c) => c.contains('hljs-subst'))) return false;
        const inComment = chain.some((c) => c.contains('hljs-comment') || c.contains('hljs-doctag'));
        const inString = chain.some((c) => c.contains('hljs-string'));
        if (!inComment && !inString) return false;
        return inComment || /\s/.test(node.data.trim());
    }

    function collectWordRanges(text) {
        const out = [];
        if (syntaxActive && syntaxText === text) {
            const mode = SPELL_MODE[currentExt] || 'code';
            const skip = SPELL_SKIP[currentExt] || [];
            const walker = document.createTreeWalker(syntaxLayer, NodeFilter.SHOW_TEXT);
            let offset = 0;
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (nodeEligible(node, mode, skip)) pushWords(node.data, offset, out);
                offset += node.data.length;
            }
        } else {
            pushWords(text, 0, out);
        }
        return out;
    }

    function isCorrect(word) {
        let ok = spell.cache.get(word);
        if (ok !== undefined) return ok;
        const w = word.normalize('NFC').replace(/’/g, "'");
        ok = false;
        for (const dict of spell.dicts.values()) {
            if (dict.correct(w)) { ok = true; break; }
        }
        if (spell.cache.size > 60000) spell.cache.clear();
        spell.cache.set(word, ok);
        return ok;
    }

    // true = fine, false = misspelled, null = not checked yet (Gemini only)
    function verdictOf(word) {
        if (spell.engine === 'gemini') {
            const v = gem.verdicts.get(word);
            return v ? v.ok : null;
        }
        return isCorrect(word);
    }

    function clearSpellLayer() {
        if (spellLayer.firstChild) spellLayer.textContent = '';
        spell.bad = [];
    }

    const spellEngineReady = () => spell.enabled && (spell.engine === 'gemini' ? !!gem.session : spell.dicts.size > 0);

    // skipCaret: don't flag the word being typed right now
    function renderSpell(skipCaret) {
        if (!spellEngineReady()) return clearSpellLayer();
        const text = contentInput.value;
        if (text.length > SPELL_MAX) return clearSpellLayer();

        const mode = SPELL_MODE[currentExt] || 'code';
        const needsTokens = EXT_TO_HLJS[currentExt] && mode !== 'prose';
        if (syntaxActive && syntaxText !== text) return clearSpellLayer(); // highlight still pending
        if (needsTokens && !syntaxActive) return clearSpellLayer();        // no tokens -> can't tell code from prose

        const caret = skipCaret && document.activeElement === contentInput ? contentInput.selectionEnd : -1;
        const bad = [];
        for (const r of collectWordRanges(text)) {
            if (verdictOf(r.word) !== false) continue;
            if (caret >= r.start && caret <= r.end) continue;
            if (spell.engine === 'gemini') r.suggestions = gem.verdicts.get(r.word).suggestions;
            bad.push(r);
        }
        spell.bad = bad;
        if (bad.length === 0) {
            if (spellLayer.firstChild) spellLayer.textContent = '';
            return;
        }

        let html = '';
        let last = 0;
        bad.forEach((r, i) => {
            html += escapeHtml(text.slice(last, r.start)) +
                `<span class="spell-err" data-i="${i}">` + escapeHtml(text.slice(r.start, r.end)) + '</span>';
            last = r.end;
        });
        spellLayer.innerHTML = html + escapeHtml(text.slice(last)) + '\n';
        syncLayerScroll();
    }

    function scheduleSpell() {
        clearTimeout(spellTimer);
        if (!spellEngineReady()) return clearSpellLayer();
        const small = contentInput.value.length <= SPELL_SYNC_MAX;
        if (small) renderSpell(true);   // keep underlines glued to the text while typing
        spellTimer = setTimeout(() => {
            renderSpell(!small);
            if (spell.engine === 'gemini') runGemini();
        }, small ? 700 : 400);
    }

    // Called whenever the text, the file type or the layout changed.
    function onEditorChange() {
        const len = contentInput.value.length;
        if (syntaxLang() && len <= SYNTAX_MAX) {
            if (len <= SYNTAX_SYNC_MAX) {
                renderSyntax();
            } else {
                // big file: show plain text right away, colour it a moment later
                setSyntaxActive(true);
                syntaxLayer.textContent = contentInput.value + '\n';
                syntaxText = null;
                clearTimeout(syntaxTimer);
                syntaxTimer = setTimeout(() => { renderSyntax(); scheduleSpell(); }, 150);
            }
        } else if (syntaxActive) {
            setSyntaxActive(false);
        }
        syncScrollbarWidth();
        syncLayerScroll();
        scheduleSpell();
    }

    // ---- spell check: suggestions & right-click menu ----
    function matchCase(original, suggestion) {
        const first = original[0];
        if (first && first === first.toUpperCase() && first !== first.toLowerCase() &&
            suggestion[0] === suggestion[0].toLowerCase()) {
            return suggestion[0].toUpperCase() + suggestion.slice(1);
        }
        return suggestion;
    }

    function suggestionsFor(entry) {
        if (entry.suggestions) return entry.suggestions;
        const word = entry.word.normalize('NFC').replace(/’/g, "'");
        const out = [];
        const seen = new Set();
        for (const dict of spell.dicts.values()) {
            let list = [];
            try { list = dict.suggest(word); } catch (err) { /* ignore */ }
            for (const s of list) {
                const fixed = matchCase(entry.word, s);
                if (!seen.has(fixed)) { seen.add(fixed); out.push(fixed); }
            }
        }
        return out.slice(0, 8);
    }

    // Which underlined word is under the mouse? (the layer is under the textarea, so test the span rectangles)
    function spellEntryAt(x, y) {
        if (!spell.bad.length) return null;
        for (const span of spellLayer.querySelectorAll('.spell-err')) {
            for (const r of span.getClientRects()) {
                if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return spell.bad[Number(span.dataset.i)] || null;
            }
        }
        return null;
    }

    let spellCtxEntry = null;
    let spellSubTimer = null;

    function hideSpellSubmenu() {
        clearTimeout(spellSubTimer);
        spellSubmenu.style.display = 'none';
    }

    function applySuggestion(entry, suggestion) {
        if (contentInput.value.slice(entry.start, entry.end) !== entry.word) {
            showToast('Văn bản đã thay đổi, hãy thử lại!');
            return;
        }
        contentInput.focus();
        replaceRange(entry.start, entry.end, suggestion, entry.start + suggestion.length);
    }

    function openSpellSubmenu() {
        clearTimeout(spellSubTimer);
        const entry = spellCtxEntry;
        if (!entry) return;

        spellSubmenu.textContent = '';
        const list = suggestionsFor(entry);
        if (!list.length) {
            const none = document.createElement('div');
            none.className = 'menu-item disabled';
            none.textContent = 'Không có gợi ý';
            spellSubmenu.append(none);
        }
        for (const s of list) {
            const item = document.createElement('div');
            item.className = 'menu-item spell-suggestion';
            item.textContent = s;
            item.addEventListener('click', () => applySuggestion(entry, s));
            spellSubmenu.append(item);
        }

        spellSubmenu.style.display = 'block';
        const r = spellCtxItem.getBoundingClientRect();
        const w = spellSubmenu.offsetWidth;
        const h = spellSubmenu.offsetHeight;
        let left = r.right - 2;
        if (left + w > window.innerWidth - 4) left = Math.max(4, r.left - w + 2);   // no room on the right
        const top = Math.max(4, Math.min(r.top - 8, window.innerHeight - h - 8));
        spellSubmenu.style.left = left + 'px';
        spellSubmenu.style.top = top + 'px';
    }

    spellCtxItem.addEventListener('mouseenter', openSpellSubmenu);
    spellCtxItem.addEventListener('click', (e) => { e.stopPropagation(); openSpellSubmenu(); });   // touch / keyboard
    for (const el of [spellCtxItem, spellSubmenu]) {
        el.addEventListener('mouseleave', () => {
            clearTimeout(spellSubTimer);
            spellSubTimer = setTimeout(hideSpellSubmenu, 250);
        });
    }
    spellSubmenu.addEventListener('mouseenter', () => clearTimeout(spellSubTimer));
    // hovering any other item of the context menu closes the suggestions
    contextMenu.addEventListener('mouseover', (e) => {
        if (!e.target.closest('#spellCtx')) hideSpellSubmenu();
    });

    // ---- spell check: menu + dialog ----
    function updateSpellMenu() {
        spellToggle.checked = spell.enabled;
        spellLangItem.style.display = spell.enabled ? 'flex' : 'none';
        const names = spell.langs.map((c) => (langByCode(c) || {}).native).filter(Boolean);
        spellLangSummary.textContent = names.length <= 2 ? names.join(', ') : `${names.length} ngôn ngữ`;
    }

    function updateEngineInfo() {
        let text;
        if (!spell.enabled) {
            text = 'Kiểm tra chính tả đang tắt.';
        } else if (spell.engine === 'gemini') {
            text = 'Đang dùng Gemini Nano: chạy ngay trên máy, không cần tải từ điển.';
        } else {
            text = 'Đang dùng thư viện nspell (từ điển Hunspell).';
            if (spell.gemini.reason) text += ' ' + spell.gemini.reason;
            if (spell.gemini.state === 'downloadable') text += ' Gemini Nano dùng được cho các ngôn ngữ này nhưng chưa được tải về máy.';
            if (spell.gemini.state === 'downloading') text += ' Gemini Nano đang được tải về, sẽ tự dùng khi xong.';
        }
        spellEngineInfo.textContent = text;
        spellGeminiBtn.style.display = spell.enabled && spell.engine !== 'gemini' && spell.gemini.state === 'downloadable' ? '' : 'none';
    }

    function toggleSpellCheck(e) {
        if (e) e.stopPropagation(); // keep the menu open
        spell.enabled = !spell.enabled;
        gem.broken = false;
        lsSet(SPELL_ON_KEY, spell.enabled ? 'on' : 'off');
        updateSpellMenu();
        syncSpellEngine();
    }

    function refreshLangMeta(code) {
        const row = spellList.querySelector(`[data-code="${code}"]`);
        if (!row) return;
        const meta = row.querySelector('.dlg-meta');
        const status = spell.status[code];
        meta.className = 'dlg-meta';
        if (spell.engine === 'gemini') meta.textContent = '';
        else if (status === 'loading') meta.textContent = 'Đang tải…';
        else if (status === 'err') { meta.textContent = 'Lỗi tải'; meta.classList.add('err'); }
        else if (spell.dicts.has(code)) { meta.textContent = 'Đã tải'; meta.classList.add('ok'); }
        else meta.textContent = langByCode(code).size;
    }

    function buildSpellList() {
        spellList.textContent = '';
        for (const lang of SPELL_LANGS) {
            const row = document.createElement('label');
            row.className = 'dlg-row';
            row.dataset.code = lang.code;
            row.dataset.search = `${lang.native} ${lang.en} ${lang.code}`.toLowerCase();

            const box = document.createElement('input');
            box.type = 'checkbox';
            box.value = lang.code;
            box.checked = spell.langs.includes(lang.code);

            const name = document.createElement('span');
            name.className = 'dlg-name';
            name.textContent = lang.native === lang.en ? lang.native : `${lang.native} · ${lang.en}`;

            const meta = document.createElement('span');
            meta.className = 'dlg-meta';

            row.append(box, name, meta);
            spellList.append(row);
            refreshLangMeta(lang.code);
        }
    }

    function filterSpellList() {
        const q = spellFilter.value.trim().toLowerCase();
        let shown = 0;
        for (const row of spellList.querySelectorAll('.dlg-row')) {
            const match = !q || row.dataset.search.includes(q);
            row.style.display = match ? '' : 'none';
            if (match) shown++;
        }
        let empty = spellList.querySelector('.dlg-empty');
        if (!shown && !empty) {
            empty = document.createElement('div');
            empty.className = 'dlg-empty';
            empty.textContent = 'Không có ngôn ngữ phù hợp.';
            spellList.append(empty);
        } else if (shown && empty) {
            empty.remove();
        }
    }

    const spellDialogOpen = () => spellDialog.classList.contains('open');

    function openSpellDialog() {
        buildSpellList();
        spellFilter.value = '';
        updateEngineInfo();
        spellDialog.classList.add('open');
        // refresh the Gemini Nano status (the user may have installed the model meanwhile)
        detectGemini().then((g) => {
            if (spell.engine !== 'gemini') { spell.gemini = g; updateEngineInfo(); }
        });
    }

    function closeSpellDialog() {
        spellDialog.classList.remove('open');
        contentInput.focus();
    }

    function applySpellDialog() {
        const chosen = [...spellList.querySelectorAll('input:checked')].map((box) => box.value);
        if (chosen.length === 0) {
            showToast('Hãy chọn ít nhất một ngôn ngữ!');
            return;
        }
        spell.langs = SPELL_LANGS.map((l) => l.code).filter((c) => chosen.includes(c));
        gem.broken = false;
        lsSet(SPELL_LANGS_KEY, JSON.stringify(spell.langs));
        updateSpellMenu();
        closeSpellDialog();
        syncSpellEngine();
    }

    spellFilter.addEventListener('input', filterSpellList);
    // leaving the editor: show the word that was being typed too
    contentInput.addEventListener('blur', () => { if (spell.enabled) renderSpell(false); });

    // ------------------------------------------------------------------
    // App lifecycle
    // ------------------------------------------------------------------
    function restartApp() {
        location.reload();
    }

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        });
    }

    applyTheme();
    updateSpellMenu();
    updateEngineInfo();
    onEditorChange();
    // pick the spell-check engine (Gemini Nano or dictionaries) once the page has settled
    const startSpell = () => setTimeout(syncSpellEngine, 800);
    if (document.readyState === 'complete') startSpell(); else window.addEventListener('load', startSpell);
    setTimeout(() => brandLogo.classList.add('collapsed'), 2000);

    // Functions referenced from inline onclick="" attributes
    Object.assign(window, {
        newFile, openFile, saveFile, saveFileAs,
        handleMenuAction, toggleFindReplace, findNext, replaceOne, replaceAll,
        insertMD, insertLinePrefix, insertCodeBlock,
        restartApp, closeAutoSavePrompt, enableAutoSave, toggleDarkMode,
        toggleSpellCheck, openSpellDialog, closeSpellDialog, applySpellDialog, downloadGeminiNano
    });
})();
