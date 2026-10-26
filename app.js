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
    const themeSelect = $('themeSelect');
    const lineCount = $('lineCount');
    const cursorPos = $('cursorPos');
    const fileTypeLabel = $('fileTypeLabel');
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
    const suggestLayer = $('suggestLayer');
    const suggestActions = $('suggestActions');
    const suggestNav = $('suggestNav');
    const lineGutter = $('lineGutter');
    const lineGutterInner = $('lineGutterInner');
    const lineMirror = $('lineMirror');
    const dictDialog = $('dictDialog');
    const dictList = $('dictList');
    const dictInput = $('dictInput');
    const dictSummary = $('dictSummary');
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
        toastTimer = setTimeout(() => toast.classList.remove('show'), Math.min(10000, 3000 + String(msg).length * 40));
    }

    // The prompt is a chat bubble anchored under the Auto Save switch.
    function showAutoSavePrompt() {
        updateSaveUI();
        let r = autoSaveContainer.getBoundingClientRect();
        if (!r.width) r = moreOptionsBtn.getBoundingClientRect();
        const W = Math.min(280, window.innerWidth - 24);
        const cx = r.left + r.width / 2;
        const left = Math.max(12, Math.min(window.innerWidth - 12 - W, cx - W / 2));
        autoSavePrompt.style.width = W + 'px';
        autoSavePrompt.style.left = left + 'px';
        autoSavePrompt.style.top = (r.bottom + 12) + 'px';
        autoSavePrompt.style.setProperty('--tail-x', Math.max(18, Math.min(W - 18, cx - left)) + 'px');
        autoSavePrompt.classList.remove('closing');
        autoSavePrompt.classList.add('open');
    }
    function autoSavePromptOpen() { return autoSavePrompt.classList.contains('open'); }
    function closeAutoSavePrompt() {
        if (!autoSavePromptOpen()) return;
        autoSavePrompt.classList.remove('open');
        autoSavePrompt.classList.add('closing');
        setTimeout(() => autoSavePrompt.classList.remove('closing'), 160);
    }
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
        wordCount.textContent = `${text.length.toLocaleString('vi-VN')} ký tự • ${words.toLocaleString('vi-VN')} từ`;
        let lines = 1;
        for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines++;
        lineCount.textContent = `${lines.toLocaleString('vi-VN')} dòng`;
        updateCursorPos();
    }

    function updateCursorPos() {
        const pos = contentInput.selectionStart || 0;
        const before = contentInput.value.slice(0, pos);
        const ln = before.split('\n').length;
        const col = pos - (before.lastIndexOf('\n') + 1) + 1;
        cursorPos.textContent = `Dòng ${ln}, Cột ${col}`;
    }

    const FILE_TYPE_NAMES = {
        txt: 'Văn bản thuần', md: 'Markdown', js: 'JavaScript', json: 'JSON', html: 'HTML', htm: 'HTML',
        css: 'CSS', py: 'Python', bat: 'Batch', ps1: 'PowerShell', vbs: 'VBScript', reg: 'Registry',
        lang: 'Language (.lang)'
    };
    function updateFileTypeLabel() {
        fileTypeLabel.textContent = FILE_TYPE_NAMES[currentExt] || (currentExt ? currentExt.toUpperCase() : 'Văn bản thuần');
    }
    ['keyup', 'click', 'select', 'focus'].forEach((ev) => contentInput.addEventListener(ev, updateCursorPos));
    document.addEventListener('selectionchange', () => { if (document.activeElement === contentInput) updateCursorPos(); });

    function checkFileType(fileName) {
        currentExt = fileName.includes('.') ? fileName.toLowerCase().split('.').pop() : '';
        updateFileTypeLabel();
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
        if (themeSelect) themeSelect.value = getStoredTheme() || 'system';
        updateThemeColor();
    }

    // mode: 'dark' (Bật) | 'light' (Tắt) | 'system' (Hệ thống)
    function setThemeMode(mode) {
        try {
            if (mode === 'dark' || mode === 'light') localStorage.setItem(THEME_KEY, mode);
            else localStorage.removeItem(THEME_KEY);
        } catch (err) { /* storage blocked */ }
        applyTheme();
    }

    systemDark.addEventListener('change', () => { if (!getStoredTheme()) applyTheme(); });
    tabbedMedia.addEventListener('change', updateThemeColor);

    // ------------------------------------------------------------------
    // Opening documents
    // ------------------------------------------------------------------
    function openDocument(text, name) {
        clearSuggestion();
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
        // The highlight layer wraps exactly like the textarea, so the current <mark> tells the real y position.
        const mark = searchHighlights.querySelector('mark.current');
        let y;
        if (mark) {
            const lh = parseFloat(getComputedStyle(contentInput).lineHeight) || 28;
            y = mark.offsetTop + lh / 2;
        } else {
            const lh = parseFloat(getComputedStyle(contentInput).lineHeight) || 28;
            y = contentInput.value.substring(0, result.start).split('\n').length * lh;
        }
        const view = contentInput.clientHeight;
        const top = contentInput.scrollTop;
        if (y < top + 40 || y > top + view - 60) {          // only scroll when the match is not comfortably visible
            contentInput.scrollTo({ top: Math.max(0, y - view / 2), behavior: 'smooth' });
        }
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

    window.addEventListener('click', (e) => {
        if (autoSavePromptOpen() && !autoSavePrompt.contains(e.target)) closeAutoSavePrompt();
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
            if (suggestDialogOpen()) { closeSuggestDialog(); return; }
            if (dictDialogOpen()) { closeDictDialog(); return; }
            if (autoSavePromptOpen()) { closeAutoSavePrompt(); return; }
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

    const layers = [syntaxLayer, spellLayer, searchHighlights, suggestLayer, suggestActions];

    function syncLayerScroll() {
        for (const layer of layers) {
            layer.scrollTop = contentInput.scrollTop;
            layer.scrollLeft = contentInput.scrollLeft;
        }
        lineGutter.scrollTop = contentInput.scrollTop;
        if (sug.active) updateSuggestNav();
    }

    // ---- line numbers (a number per logical line, as tall as the wrapped line) ----
    const GUTTER_WRAP_MAX = 20000;   // above this many lines wrapped lines are not measured
    let gutterTimer = 0, gutterKey = '';

    function updateGutter() {
        const text = contentInput.value;
        const lines = text.split('\n');
        const n = lines.length;
        const digits = Math.max(2, String(n).length);

        // width of one character in the editor font
        lineMirror.innerHTML = '<span>0000000000</span>';
        const charW = lineMirror.firstChild.getBoundingClientRect().width / 10 || 9;
        const width = Math.ceil(digits * charW) + 24;
        const wrapper = editorWrapper;
        if (wrapper.style.getPropertyValue('--ed-gutter') !== width + 'px') {
            wrapper.style.setProperty('--ed-gutter', width + 'px');
        }

        let html = '';
        if (n <= GUTTER_WRAP_MAX) {
            lineMirror.innerHTML = lines.map((l) => '<div>' + (escapeHtml(l) || '\u200b') + '</div>').join('');
            const kids = lineMirror.children;
            for (let i = 0; i < n; i++) {
                html += '<div style="height:' + kids[i].getBoundingClientRect().height.toFixed(2) + 'px">' + (i + 1) + '</div>';
            }
            lineMirror.textContent = '';
        } else {
            for (let i = 1; i <= n; i++) html += '<div>' + i + '</div>';
        }
        const key = width + '|' + html.length + '|' + n;
        if (key !== gutterKey || lineGutterInner.innerHTML !== html) {
            gutterKey = key;
            lineGutterInner.innerHTML = html;
        }
        lineGutter.scrollTop = contentInput.scrollTop;
    }

    function scheduleGutter() {
        clearTimeout(gutterTimer);
        if (contentInput.value.length < 60000) updateGutter();
        else gutterTimer = setTimeout(updateGutter, 120);
    }

    // The textarea loses width when its scrollbar appears; the layers must wrap identically.
    function syncScrollbarWidth() {
        const sb = contentInput.offsetWidth - contentInput.clientWidth;
        if (sb !== lastScrollbar) {
            lastScrollbar = sb;
            editorWrapper.style.setProperty('--ed-sb', sb + 'px');
        }
    }

    if (window.ResizeObserver) {
        let lastW = 0;
        new ResizeObserver(() => {
            syncScrollbarWidth();
            const w = contentInput.clientWidth;
            if (w !== lastW) { lastW = w; scheduleGutter(); if (sug.active) renderSuggestion(); }   // wrapping changed -> line heights changed
        }).observe(contentInput);
    }

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

    // Words the user added with "Thêm vào từ điển" (stored lower-case, matched case-insensitively)
    const USER_DICT_KEY = 'notepad-user-dict';
    const userDict = new Set();
    try {
        const saved = JSON.parse(lsGet(USER_DICT_KEY));
        if (Array.isArray(saved)) saved.forEach((w) => typeof w === 'string' && userDict.add(w));
    } catch (err) { /* empty dictionary */ }
    const dictKey = (w) => w.normalize('NFC').replace(/’/g, "'").toLowerCase();

    function saveUserDict() {
        lsSet(USER_DICT_KEY, JSON.stringify(Array.from(userDict)));
        updateDictSummary();
    }

    function updateDictSummary() {
        dictSummary.textContent = userDict.size ? `${userDict.size} từ` : 'Chưa có từ nào';
    }

    function renderDictList() {
        const words = Array.from(userDict).sort((x, y) => x.localeCompare(y));
        dictList.textContent = '';
        if (!words.length) {
            const empty = document.createElement('div');
            empty.className = 'dlg-empty';
            empty.textContent = 'Từ điển trống. Chuột phải vào từ bị gạch chân > Chính tả > Thêm vào từ điển, hoặc nhập từ ở trên.';
            dictList.append(empty);
            return;
        }
        for (const w of words) {
            const row = document.createElement('div');
            row.className = 'dlg-row dict-row';
            const name = document.createElement('span');
            name.className = 'dlg-name';
            name.textContent = w;
            const del = document.createElement('button');
            del.className = 'dict-del';
            del.title = 'Xóa khỏi từ điển';
            del.innerHTML = '<span class="material-symbols-outlined">delete</span>';
            del.addEventListener('click', () => {
                userDict.delete(w);
                saveUserDict();
                spell.cache.clear();
                renderSpell(false);
                renderDictList();
            });
            row.append(name, del);
            dictList.append(row);
        }
    }

    function dictDialogOpen() { return dictDialog.classList.contains('open'); }
    function openDictDialog() { renderDictList(); dictInput.value = ''; dictDialog.classList.add('open'); }
    function closeDictDialog() { dictDialog.classList.remove('open'); }
    function addDictWord() {
        const w = dictInput.value.trim();
        if (!w) return;
        if (/\s/.test(w)) return showToast('Chỉ nhập từng từ một.');
        userDict.add(dictKey(w));
        saveUserDict();
        dictInput.value = '';
        spell.cache.clear();
        renderSpell(false);
        renderDictList();
    }
    dictInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addDictWord(); } });
    updateDictSummary();

    function addToUserDict(word) {
        userDict.add(dictKey(word));
        saveUserDict();
        hideSpellSubmenu();
        contextMenu.style.display = 'none';
        renderSpell(false);
        showToast(`Đã thêm "${word}" vào từ điển`);
    }

    // true = fine, false = misspelled, null = not checked yet (Gemini only)
    function verdictOf(word) {
        if (userDict.size && userDict.has(dictKey(word))) return true;
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
        scheduleGutter();
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
        // last row: remember the word so it is never underlined again
        const sep = document.createElement('div');
        sep.className = 'spell-sep';
        spellSubmenu.append(sep);
        const add = document.createElement('div');
        add.className = 'menu-item spell-add';
        add.innerHTML = '<span class="material-symbols-outlined">library_add</span>Thêm vào từ điển';
        add.addEventListener('click', () => addToUserDict(entry.word));
        spellSubmenu.append(add);

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
    // "Gợi ý sửa": VS Code-style edit suggestions powered by the Gemini API
    // ------------------------------------------------------------------
    const SUG_LS = {
        key: 'notepad-suggest-key',
        enabled: 'notepad-suggest',
        model: 'notepad-suggest-model',
        models: 'notepad-suggest-models',
        rpd: 'notepad-suggest-rpd',
        usage: 'notepad-suggest-usage'
    };
    const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
    const SUG_QUOTA_USE = 0.99;      // use 99% of the daily request quota
    const SUG_MIN_INTERVAL = 6;      // seconds, never faster than ~10 requests / minute
    const SUG_MAX_INTERVAL = 300;    // seconds: never wait longer than 5 minutes between checks
    const SUG_IDLE_MS = 1500;        // wait until the user stops typing
    const SUG_WINDOW = 8000;         // characters of context sent per request
    const SUG_MAX_EDITS = 6;
    const SUG_SCHEMA = {
        type: 'OBJECT',
        properties: {
            edits: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: { original: { type: 'STRING' }, replacement: { type: 'STRING' } },
                    required: ['original', 'replacement']
                }
            }
        },
        required: ['edits']
    };
    const SUG_SYSTEM = [
        'You are the "next edit suggestion" engine of a text/code editor, like the one in VS Code.',
        'You receive FILE NAME and FILE TYPE (use them as context: what kind of document this is and which language/syntax it should follow) and the TEXT of the file.',
        'Look for clear, objective mistakes only: typos, misspellings, grammar errors, wrong punctuation, syntax errors, or an obviously unfinished sentence/statement right at CURSOR that can be completed. Report at most ' + SUG_MAX_EDITS + '.',
        'SYNTAX: judge the file by its FILE TYPE and fix real syntax errors of that format: missing or extra brackets, braces, parentheses, quotes, commas or semicolons, invalid keywords, malformed tags or attributes, unclosed blocks (JavaScript, JSON, HTML, CSS, Python indentation/colons, Batch, PowerShell, VBScript, Registry .reg headers/quotes, Markdown fences/links, .lang key=value lines). If a PARSER ERROR line is given, it is a real error reported by a parser: fix that first, with the smallest change.',
        'For plain text and Markdown check the natural language; for code check the syntax and the spelling of comments and strings, not style.',
        'MOST OF THE TIME THE TEXT IS ALREADY FINE. In that case return {"edits":[]}. An empty list is the normal, expected, correct answer.',
        'Never invent a change just to return something. Never improve style, tone, wording or formatting, never translate, never rename identifiers, never "polish". If you are not sure something is wrong, leave it alone.',
        'Keep the language of the document. Do not touch anything that is correct, and never remove or rewrite content that is intentional (names, code, jargon, slang, abbreviations).',
        'Each edit has "original": an EXACT, verbatim substring of TEXT that is unique in TEXT (include a few neighbouring words if needed), and "replacement": that same substring after the fix.',
        'To add text, return the nearby words as "original" and the same words plus the new text as "replacement".'
    ].join('\n');

    const sugDialog = $('suggestDialog');
    const sugKeyInput = $('sugKey');
    const sugKeyStatus = $('sugKeyStatus');
    const sugToggle = $('sugToggle');
    const sugModelSel = $('sugModel');
    const sugRpdInput = $('sugRpd');
    const sugInfo = $('sugInfo');
    const sugSummary = $('sugSummary');
    const sugSaveBtn = $('sugSave');

    const sug = {
        enabled: lsGet(SUG_LS.enabled) === 'on',
        active: null,          // { base, edits:[{s,e,ins}] }
        pending: false,
        lastChecked: null,     // text that was last sent
        lastRequestAt: 0,
        lastInputAt: 0,
        pausedUntil: 0,
        timer: 0,
        padBackup: '',
        ys: [],
        raf: 0
    };

    const sugKey = () => lsGet(SUG_LS.key) || '';
    const sugModel = () => lsGet(SUG_LS.model) || '';
    const sugReady = () => !!(sugKey() && sugModel());

    function sugModelList() {
        try { const l = JSON.parse(lsGet(SUG_LS.models)); return Array.isArray(l) ? l : []; } catch (err) { return []; }
    }

    // Daily request quota differs per model/account and Google gives no API for it, so these are
    // starting values that the user can correct (see AI Studio > Rate limits).
    function defaultRpd(model) {
        const m = model.toLowerCase();
        if (m.includes('lite')) return 1000;
        if (m.includes('flash')) return 250;
        if (m.includes('pro')) return 50;
        return 100;
    }
    function sugRpd(model) {
        try {
            const saved = JSON.parse(lsGet(SUG_LS.rpd) || '{}')[model];
            if (saved > 0) return saved;
        } catch (err) { /* ignore */ }
        return defaultRpd(model);
    }
    const sugBudget = (model) => Math.max(1, Math.floor(sugRpd(model) * SUG_QUOTA_USE));
    // spread the budget evenly over 24 hours
    // (but never longer than 5 minutes; the daily counter still stops requests at 99% of the quota)
    const sugInterval = (model) => Math.min(SUG_MAX_INTERVAL, Math.max(SUG_MIN_INTERVAL, Math.ceil(86400 / sugBudget(model))));

    function fmtDuration(sec) {
        if (sec < 90) return sec + ' giây';
        const m = Math.floor(sec / 60), s = sec % 60;
        if (m < 60) return m + ' phút' + (s ? ' ' + s + ' giây' : '');
        const h = Math.floor(m / 60);
        return h + ' giờ' + (m % 60 ? ' ' + (m % 60) + ' phút' : '');
    }

    // Gemini quotas reset at midnight Pacific time
    function quotaDay() {
        try {
            return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
        } catch (err) { return new Date().toISOString().slice(0, 10); }
    }
    function sugUsed() {
        try {
            const u = JSON.parse(lsGet(SUG_LS.usage) || '{}');
            return u.day === quotaDay() ? (u.n || 0) : 0;
        } catch (err) { return 0; }
    }
    function sugCount(n) {
        lsSet(SUG_LS.usage, JSON.stringify({ day: quotaDay(), n: n === undefined ? sugUsed() + 1 : n }));
    }

    // ---------- rendering ----------
    // While suggestions are pending, #suggestLayer is what the user sees: the (syntax coloured) text with
    // each edit marked in place. The textarea underneath keeps the real text and the caret.
    const ICON_NO = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" fill="none"/></svg>';
    const ICON_OK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

    // text nodes of the *original* text (ghost text, gaps and the fake caret do not count)
    function sugTextNodes(root) {
        const out = [];
        let pos = 0;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => n.parentElement && n.parentElement.closest('ins.sg-ins,.sg-gap,.sg-caret')
                ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        let n;
        while ((n = walker.nextNode())) {
            out.push({ node: n, start: pos, end: pos + n.data.length });
            pos += n.data.length;
        }
        return out;
    }

    // make a text boundary at `offset`; returns the node that ends exactly there (null for offset 0)
    function sugSplitAt(root, offset) {
        for (const it of sugTextNodes(root)) {
            if (offset > it.start && offset <= it.end) {
                if (offset < it.end) it.node.splitText(offset - it.start);
                return it.node;
            }
        }
        return null;
    }

    function sugPlace(root, left, nodes) {
        if (left) left.parentNode.insertBefore(nodes, left.nextSibling);
        else root.insertBefore(nodes, root.firstChild);
    }

    function sugWrapDeleted(root, s, e) {
        sugSplitAt(root, e);
        sugSplitAt(root, s);
        for (const it of sugTextNodes(root)) {
            if (it.end > it.start && it.start >= s && it.end <= e) {
                const del = document.createElement('del');
                del.className = 'sg-del';
                it.node.parentNode.insertBefore(del, it.node);
                del.appendChild(it.node);
            }
        }
    }

    function clearSuggestion() {
        if (!sug.active) return;
        sug.active = null;
        editorWrapper.classList.remove('suggesting');
        suggestLayer.textContent = '';
        suggestActions.textContent = '';
        contentInput.style.paddingBottom = sug.padBackup;
        updateSuggestNav();
        syncLayerScroll();
    }

    function renderSuggestion() {
        const a = sug.active;
        if (!a) return;
        const base = a.base;
        const root = document.createElement('div');
        if (syntaxActive && syntaxText === base) root.innerHTML = syntaxLayer.innerHTML;   // keep the syntax colours
        else root.textContent = base + '\n';

        for (let i = a.edits.length - 1; i >= 0; i--) {
            const ed = a.edits[i];
            if (ed.e > ed.s) sugWrapDeleted(root, ed.s, ed.e);
            let left = sugSplitAt(root, ed.e);
            if (left && left.parentElement && left.parentElement.classList.contains('sg-del')) left = left.parentElement;
            const frag = document.createDocumentFragment();
            if (ed.ins) {
                const ins = document.createElement('ins');
                ins.className = 'sg-ins';
                ins.textContent = ed.ins;
                frag.append(ins);
            }
            const gap = document.createElement('span');     // room for the ✕ ✓ buttons of this edit
            gap.className = 'sg-gap';
            gap.dataset.i = i;
            frag.append(gap);
            sugPlace(root, left, frag);
        }
        if (document.activeElement === contentInput && contentInput.selectionStart === contentInput.selectionEnd) {
            const c = document.createElement('span');
            c.className = 'sg-caret';
            sugPlace(root, sugSplitAt(root, contentInput.selectionStart), c);
        }

        const st = contentInput.scrollTop;
        editorWrapper.classList.add('suggesting');
        suggestLayer.replaceChildren(...root.childNodes);
        contentInput.style.paddingBottom = sug.padBackup;
        // inserted lines make the layer taller than the textarea: let the textarea scroll that far too
        const extra = suggestLayer.scrollHeight - contentInput.scrollHeight;
        if (extra > 0) {
            const pb = parseFloat(getComputedStyle(contentInput).paddingBottom) || 0;
            contentInput.style.paddingBottom = (pb + extra) + 'px';
        }
        contentInput.scrollTop = st;

        // one ✕ / ✓ pair at the end of every edit
        suggestActions.textContent = '';
        sug.ys = [];
        a.edits.forEach((ed, i) => {
            const gap = suggestLayer.querySelector('.sg-gap[data-i="' + i + '"]');
            if (!gap) return;
            sug.ys[i] = gap.offsetTop;
            const box = document.createElement('div');
            box.className = 'sg-actions';
            box.style.left = gap.offsetLeft + 'px';
            box.style.top = gap.offsetTop + 'px';
            box.addEventListener('mousedown', (e) => e.preventDefault());     // keep the caret in the editor
            const no = document.createElement('button');
            no.className = 'sg-no';
            no.title = 'Từ chối (Esc)';
            no.setAttribute('aria-label', 'Từ chối');
            no.innerHTML = ICON_NO;
            no.addEventListener('click', () => rejectEdit(ed));
            const ok = document.createElement('button');
            ok.className = 'sg-ok';
            ok.title = 'Chấp nhận (Tab)';
            ok.setAttribute('aria-label', 'Chấp nhận');
            ok.innerHTML = ICON_OK;
            ok.addEventListener('click', () => acceptEdit(ed));
            box.append(no, ok);
            suggestActions.append(box);
        });
        // the buttons follow the text when the editor scrolls, so this container must be as tall as the text layer
        const spacer = document.createElement('div');
        spacer.className = 'sg-spacer';
        spacer.style.top = Math.max(0, suggestLayer.scrollHeight - 1) + 'px';
        suggestActions.append(spacer);
        syncLayerScroll();
        updateSuggestNav();
    }

    function showSuggestion(base, edits) {
        sug.padBackup = contentInput.style.paddingBottom;
        sug.active = { base, edits };
        renderSuggestion();
    }

    // the text changed (typing, undo, accepting an edit...): edits before the change stay, edits after it
    // move, edits the change touches are cancelled
    function reconcileSuggestions() {
        const a = sug.active;
        if (!a) return;
        const now = contentInput.value, old = a.base;
        if (now === old) return;
        const max = Math.min(old.length, now.length);
        let p = 0;
        while (p < max && old.charCodeAt(p) === now.charCodeAt(p)) p++;
        let q = 0;
        while (q < max - p && old.charCodeAt(old.length - 1 - q) === now.charCodeAt(now.length - 1 - q)) q++;
        const cs = p, ce = old.length - q, delta = now.length - old.length;
        const kept = [];
        for (const ed of a.edits) {
            if (ce < ed.s) kept.push({ s: ed.s + delta, e: ed.e + delta, ins: ed.ins });
            else if (cs > ed.e) kept.push(ed);
        }
        a.base = now;
        a.edits = kept;
        if (!kept.length) clearSuggestion();
        else renderSuggestion();
    }

    function acceptEdit(ed) {
        reconcileSuggestions();
        const a = sug.active;
        if (!a) return;
        const i = a.edits.findIndex((x) => x.s === ed.s && x.e === ed.e && x.ins === ed.ins);
        if (i < 0) return;
        a.edits.splice(i, 1);                       // the others are moved by the input handler below
        contentInput.focus();
        replaceRange(ed.s, ed.e, ed.ins, ed.s + ed.ins.length);
        reconcileSuggestions();
    }

    function rejectEdit(ed) {
        const a = sug.active;
        if (!a) return;
        const i = a.edits.findIndex((x) => x.s === ed.s && x.e === ed.e && x.ins === ed.ins);
        if (i >= 0) a.edits.splice(i, 1);
        contentInput.focus();
        if (!a.edits.length) clearSuggestion(); else renderSuggestion();
    }

    // "↑ N chỉnh sửa cần được xem xét" / "↓ ..." for edits outside the visible part of the editor
    function suggestOffscreen() {
        const out = { up: [], down: [] };
        if (!sug.active) return out;
        const lh = parseFloat(getComputedStyle(contentInput).lineHeight) || 28;
        const top = contentInput.scrollTop, bottom = top + contentInput.clientHeight;
        for (const y of sug.ys || []) {
            if (y === undefined) continue;
            if (y + lh <= top) out.up.push(y);
            else if (y >= bottom) out.down.push(y);
        }
        return out;
    }

    function updateSuggestNav() {
        const o = suggestOffscreen();
        const up = $('sgUp'), down = $('sgDown');
        up.classList.toggle('open', o.up.length > 0);
        down.classList.toggle('open', o.down.length > 0);
        $('sgUpN').textContent = o.up.length;
        $('sgDownN').textContent = o.down.length;
    }

    function sgNav(dir) {
        const o = suggestOffscreen();
        const list = dir < 0 ? o.up : o.down;
        if (!list.length) return;
        const y = dir < 0 ? Math.max(...list) : Math.min(...list);
        contentInput.scrollTo({ top: Math.max(0, y - contentInput.clientHeight / 3), behavior: 'smooth' });
    }

    // base-text offset under a screen point (the textarea's own hit test is wrong while ghost text shifts the layout)
    function suggestOffsetAt(x, y) {
        let pos = null;
        suggestLayer.style.pointerEvents = 'auto';
        contentInput.style.pointerEvents = 'none';
        try {
            if (document.caretPositionFromPoint) {
                const p = document.caretPositionFromPoint(x, y);
                if (p) pos = { node: p.offsetNode, off: p.offset };
            } else if (document.caretRangeFromPoint) {
                const r = document.caretRangeFromPoint(x, y);
                if (r) pos = { node: r.startContainer, off: r.startOffset };
            }
        } finally {
            suggestLayer.style.pointerEvents = '';
            contentInput.style.pointerEvents = '';
        }
        if (!pos || !suggestLayer.contains(pos.node)) return -1;
        let node = pos.node, off = pos.off;
        if (node.nodeType === 1) {           // element + child index -> a text node
            const w = document.createTreeWalker(node.childNodes[off] || node, NodeFilter.SHOW_TEXT);
            const t = w.nextNode();
            if (!t) return -1;
            node = t; off = 0;
        }
        let count = 0;
        const w = document.createTreeWalker(suggestLayer, NodeFilter.SHOW_TEXT);
        let t;
        while ((t = w.nextNode())) {
            const ins = t.parentElement && t.parentElement.closest('ins.sg-ins');
            if (ins) {
                if (t === node) {
                    const gap = ins.nextElementSibling;
                    const ed = gap && sug.active.edits[Number(gap.dataset.i)];
                    return ed ? ed.e : -1;
                }
                continue;
            }
            if (t === node) return Math.min(count + off, sug.active.base.length);
            count += t.data.length;
        }
        return -1;
    }

    // ---------- turning the model's answer into safe edits ----------
    const TOKEN_RE = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

    // Word-level diff of original -> replacement: returns hunks {o1,o2,text} in original coordinates
    function diffHunks(orig, repl) {
        const A = orig.match(TOKEN_RE) || [], B = repl.match(TOKEN_RE) || [];
        if (A.length * B.length > 250000) return [{ o1: 0, o2: orig.length, text: repl }];
        const n = A.length, m = B.length;
        const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
            }
        }
        const hunks = [];
        let i = 0, j = 0, pos = 0, cur = null;
        const flush = () => { if (cur) { hunks.push(cur); cur = null; } };
        while (i < n || j < m) {
            if (i < n && j < m && A[i] === B[j]) {
                flush();
                pos += A[i].length; i++; j++;
            } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
                if (!cur) cur = { o1: pos, o2: pos, text: '' };
                cur.text += B[j++];
            } else {
                if (!cur) cur = { o1: pos, o2: pos, text: '' };
                pos += A[i].length; cur.o2 = pos; i++;
            }
        }
        flush();
        return hunks;
    }

    function normalizeEdits(win, offset, raw) {
        const out = [];
        const full = contentInput.value;
        for (const r of (raw && raw.edits) || []) {
            if (!r || typeof r.original !== 'string' || typeof r.replacement !== 'string') continue;
            const orig = r.original, repl = r.replacement;
            if (!orig || orig === repl) continue;
            const i = win.indexOf(orig);
            if (i < 0 || win.indexOf(orig, i + 1) >= 0) continue;   // must exist exactly once
            for (const h of diffHunks(orig, repl)) {
                const s = offset + i + h.o1, e = offset + i + h.o2;
                if (full.slice(s, e) === h.text) continue;
                out.push({ s, e, ins: h.text });
            }
        }
        out.sort((a, b) => a.s - b.s || a.e - b.e);
        const clean = [];
        for (const ed of out) {
            if (clean.length && ed.s < clean[clean.length - 1].e) continue;   // overlap
            clean.push(ed);
            if (clean.length >= SUG_MAX_EDITS) break;
        }
        return clean;
    }

    // ---------- Gemini calls ----------
    async function geminiFetch(path, init, timeoutMs) {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), timeoutMs || 30000);
        try {
            const res = await fetch(GEMINI_API + path, {
                ...init,
                signal: ctl.signal,
                headers: { 'x-goog-api-key': (init && init.key) || sugKey(), 'Content-Type': 'application/json' }
            });
            let body = null;
            try { body = await res.json(); } catch (err) { /* not json */ }
            return { res, body };
        } finally { clearTimeout(t); }
    }

    function apiMessage(body) { return (body && body.error && body.error.message) || ''; }

    async function listGeminiModels(key) {
        const ids = [];
        let token = '';
        for (let page = 0; page < 4; page++) {
            const { res, body } = await geminiFetch('/models?pageSize=200' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), { key });
            if (!res.ok) {
                const err = new Error(apiMessage(body) || 'HTTP ' + res.status);
                err.status = res.status;
                throw err;
            }
            for (const m of body.models || []) {
                const id = (m.name || '').replace(/^models\//, '');
                if (!/^(gemini|gemma)/.test(id)) continue;
                if (/(tts|image|live|embedding|audio|robotics|computer|aqa|veo|imagen|vision|learnlm)/.test(id)) continue;
                if ((m.supportedGenerationMethods || []).indexOf('generateContent') < 0) continue;
                ids.push(id);
            }
            token = body.nextPageToken || '';
            if (!token) break;
        }
        return Array.from(new Set(ids)).sort().reverse();
    }

    async function requestSuggestion() {
        const model = sugModel();
        const full = contentInput.value;
        if (!full.trim()) return;
        // window of text around the caret
        let a = 0, b = full.length;
        if (full.length > SUG_WINDOW) {
            const c = contentInput.selectionStart;
            a = Math.max(0, c - SUG_WINDOW / 2);
            b = Math.min(full.length, a + SUG_WINDOW);
            a = Math.max(0, b - SUG_WINDOW);
            const nl = full.indexOf('\n', a);
            if (a > 0 && nl >= 0 && nl < c) a = nl + 1;
        }
        const win = full.slice(a, b);
        const cursor = Math.min(Math.max(contentInput.selectionStart - a, 0), win.length);
        const kind = (typeof FILE_TYPE_NAMES !== 'undefined' && FILE_TYPE_NAMES[currentExt]) || 'plain text';
        const fileName = (titleInput.value.trim() || CONFIG.newFileName || 'untitled').slice(0, 120);
        let hint = '';
        if (currentExt === 'json' && full.length === win.length) {
            try { JSON.parse(full); } catch (err) { hint = `PARSER ERROR: ${String(err.message).slice(0, 200)}\n`; }
        }

        sug.pending = true;
        sug.lastChecked = full;
        sug.lastRequestAt = Date.now();
        sugCount();
        updateSuggestInfo();
        try {
            const { res, body } = await geminiFetch(`/models/${encodeURIComponent(model)}:generateContent`, {
                method: 'POST',
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: SUG_SYSTEM }] },
                    contents: [{ role: 'user', parts: [{ text: `FILE NAME: ${fileName}\nFILE TYPE: ${kind}\n${hint}CURSOR OFFSET: ${cursor}\nTEXT:\n${win}` }] }],
                    generationConfig: { responseMimeType: 'application/json', responseSchema: SUG_SCHEMA, temperature: 0 }
                })
            });
            if (!res.ok) return handleSuggestError(res.status, apiMessage(body) || res.statusText);
            if (contentInput.value !== full) return;                 // the user kept typing: stale
            const block = body && body.promptFeedback && body.promptFeedback.blockReason;
            if (block) {
                sug.pausedUntil = Date.now() + 2 * 60000;
                return showToast(`Gemini từ chối yêu cầu: ${block}`);
            }
            const parts = body && body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts;
            const text = (parts || []).map((p) => p.text || '').join('');
            let json = null;
            try { json = JSON.parse(text); } catch (err) {
                const why = body && body.candidates && body.candidates[0] && body.candidates[0].finishReason;
                sug.pausedUntil = Date.now() + 60000;
                return showToast(`Gemini trả về dữ liệu không đọc được${why ? ' (' + why + ')' : ''}.`);
            }
            const edits = normalizeEdits(win, a, json);
            if (edits.length) showSuggestion(full, edits);
        } catch (err) {
            sug.pausedUntil = Date.now() + 60000;
            showToast(err && err.name === 'AbortError'
                ? 'Gemini không phản hồi (quá 30 giây).'
                : `Không gọi được Gemini: ${(err && err.message) || err}`);
        } finally {
            sug.pending = false;
        }
    }

    function handleSuggestError(status, msg) {
        const detail = String(msg || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        const google = `Gemini lỗi ${status}${detail ? ': ' + detail : ''}`;
        if (status === 429) {
            const daily = /day|daily/i.test(detail);
            if (daily) sugCount(sugBudget(sugModel()));       // today's quota is gone
            sug.pausedUntil = Date.now() + (daily ? 30 : 5) * 60000;
            showToast(google + (daily ? ' (hết quota hôm nay, tạm dừng)' : ' (tạm nghỉ vài phút)'));
        } else if ((status === 400 && /api key/i.test(detail)) || status === 401 || status === 403) {
            sug.enabled = false;
            lsSet(SUG_LS.enabled, 'off');
            showToast(google + ' — đã tắt gợi ý sửa.');
        } else if (status === 404) {
            sug.pausedUntil = Date.now() + 10 * 60000;
            showToast(google + ' — hãy chọn mô hình khác.');
        } else {
            sug.pausedUntil = Date.now() + 2 * 60000;
            showToast(google);
        }
        updateSuggestMenu();
    }

    // ---------- scheduler ----------
    function sugTick() {
        sug.timer = setTimeout(sugTick, 1000);
        reconcileSuggestions();
        if (!sug.enabled || !sugReady() || sug.pending || sug.active) return;
        if (document.hidden || !navigator.onLine) return;
        const now = Date.now();
        if (now < sug.pausedUntil || now - sug.lastInputAt < SUG_IDLE_MS) return;
        if (now - sug.lastRequestAt < sugInterval(sugModel()) * 1000) return;
        if (contentInput.value === sug.lastChecked || !contentInput.value.trim()) return;   // nothing new to check
        if (sugUsed() >= sugBudget(sugModel())) return;                                      // quota for today used up
        requestSuggestion();
    }

    function startSuggest() {
        clearTimeout(sug.timer);
        sug.timer = setTimeout(sugTick, 1000);
    }

    contentInput.addEventListener('input', () => {
        sug.lastInputAt = Date.now();
        reconcileSuggestions();
    });
    // Tab = accept, Esc = cancel, but only for the edit the caret is in; typing in an edit cancels it (reconcile)
    contentInput.addEventListener('keydown', (e) => {
        if (!sug.active) return;
        reconcileSuggestions();
        if (!sug.active) return;
        const c = contentInput.selectionStart;
        if (c !== contentInput.selectionEnd) return;
        const ed = sug.active.edits.find((x) => c >= x.s && c <= x.e);
        if (!ed) return;
        if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault(); e.stopImmediatePropagation();
            acceptEdit(ed);
        } else if (e.key === 'Escape') {
            e.preventDefault(); e.stopImmediatePropagation();
            rejectEdit(ed);
        }
    }, true);
    // a click lands on the visible (shifted) text, not on the hidden textarea text
    contentInput.addEventListener('mousedown', (e) => {
        if (!sug.active || e.button !== 0 || e.shiftKey || e.detail > 1) return;
        const off = suggestOffsetAt(e.clientX, e.clientY);
        if (off < 0) return;
        e.preventDefault();
        contentInput.focus();
        contentInput.setSelectionRange(off, off);
    }, true);
    document.addEventListener('selectionchange', () => {
        if (!sug.active || document.activeElement !== contentInput) return;
        if (contentInput.selectionStart !== contentInput.selectionEnd) return clearSuggestion();   // a selection can't be drawn over shifted text
        cancelAnimationFrame(sug.raf);
        sug.raf = requestAnimationFrame(() => {
            reconcileSuggestions();
            if (sug.active) renderSuggestion();            // move the fake caret
        });
    });

    // ---------- menu + dialog ----------
    function updateSuggestMenu() {
        if (!sugSummary) return;
        const on = sug.enabled && sugReady();
        sugSummary.textContent = on ? `Bật • mỗi ${fmtDuration(sugInterval(sugModel()))}` : (sugKey() ? 'Tắt' : 'Chưa có API key');
    }

    function updateSuggestInfo() {
        updateSuggestMenu();
        if (!sugInfo) return;
        const model = sugModel();
        if (!model) { sugInfo.textContent = 'Nhập API key và nhấn Save để chọn mô hình.'; return; }
        sugInfo.textContent = `Kiểm tra mỗi ${fmtDuration(sugInterval(model))} (tối đa 5 phút). Giới hạn dùng ${sugBudget(model)}/${sugRpd(model)} lượt mỗi ngày (${Math.round(SUG_QUOTA_USE * 100)}% quota). Hôm nay đã dùng ${sugUsed()}/${sugBudget(model)}.`;
    }

    function fillModelSelect(ids, selected) {
        sugModelSel.innerHTML = '';
        for (const id of ids) {
            const o = document.createElement('option');
            o.value = id; o.textContent = id;
            sugModelSel.appendChild(o);
        }
        if (selected && ids.indexOf(selected) < 0) {
            const o = document.createElement('option');
            o.value = selected; o.textContent = selected;
            sugModelSel.appendChild(o);
        }
        if (selected) sugModelSel.value = selected;
    }

    function refreshSuggestControls() {
        const hasKey = !!sugKey();
        const model = sugModel();
        const ids = sugModelList();
        fillModelSelect(ids, model);
        sugModelSel.disabled = !hasKey || !sugModelSel.options.length;
        sugRpdInput.disabled = !model;
        sugRpdInput.value = model ? sugRpd(model) : '';
        sugToggle.disabled = !sugReady();
        sugToggle.checked = sug.enabled && sugReady();
        sugKeyInput.value = hasKey ? '••••••••••••••••' : '';
        sugKeyInput.dataset.masked = hasKey ? '1' : '';
        sugKeyStatus.textContent = hasKey ? 'Đã lưu API key trong trình duyệt này.' : '';
        sugKeyStatus.className = 'dlg-meta' + (hasKey ? ' ok' : '');
        updateSuggestInfo();
    }

    function suggestDialogOpen() { return sugDialog.classList.contains('open'); }
    function openSuggestDialog() {
        refreshSuggestControls();
        sugDialog.classList.add('open');
        if (sugKey() && !sugModelList().length) saveSuggestKey(true);
    }
    function closeSuggestDialog() { sugDialog.classList.remove('open'); }

    sugKeyInput.addEventListener('focus', () => {
        if (sugKeyInput.dataset.masked) { sugKeyInput.value = ''; sugKeyInput.dataset.masked = ''; }
    });
    sugKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveSuggestKey(); } });

    async function saveSuggestKey(reuse) {
        const typed = sugKeyInput.value.trim();
        const key = reuse === true || sugKeyInput.dataset.masked ? sugKey() : typed;
        if (!key) { sugKeyStatus.textContent = 'Hãy nhập Gemini API key.'; sugKeyStatus.className = 'dlg-meta err'; return; }
        sugSaveBtn.disabled = true;
        sugKeyStatus.textContent = 'Đang kiểm tra key…';
        sugKeyStatus.className = 'dlg-meta';
        try {
            const ids = await listGeminiModels(key);
            if (!ids.length) throw new Error('Key hợp lệ nhưng không có mô hình nào dùng được.');
            lsSet(SUG_LS.key, key);
            lsSet(SUG_LS.models, JSON.stringify(ids));
            let model = sugModel();
            if (ids.indexOf(model) < 0) {
                model = ids.find((i) => /flash-lite/.test(i) && !/preview|exp/.test(i)) ||
                        ids.find((i) => /flash/.test(i) && !/preview|exp/.test(i)) || ids[0];
                lsSet(SUG_LS.model, model);
            }
            refreshSuggestControls();
            sugKeyStatus.textContent = `Đã lưu. Tìm thấy ${ids.length} mô hình.`;
            sugKeyStatus.className = 'dlg-meta ok';
        } catch (err) {
            sugKeyStatus.textContent = (err.status === 400 || err.status === 403 || err.status === 401)
                ? 'API key không hợp lệ.' : 'Không kiểm tra được key: ' + (err.message || err);
            sugKeyStatus.className = 'dlg-meta err';
        } finally {
            sugSaveBtn.disabled = false;
        }
    }

    function onSuggestToggle() {
        sug.enabled = sugToggle.checked && sugReady();
        lsSet(SUG_LS.enabled, sug.enabled ? 'on' : 'off');
        if (!sug.enabled) clearSuggestion();
        else { sug.lastChecked = null; sug.pausedUntil = 0; sug.lastRequestAt = 0; }
        updateSuggestInfo();
    }
    function onSuggestModel() {
        lsSet(SUG_LS.model, sugModelSel.value);
        sugRpdInput.disabled = false;
        sugRpdInput.value = sugRpd(sugModelSel.value);
        sug.pausedUntil = 0;
        updateSuggestInfo();
    }
    function onSuggestRpd() {
        const model = sugModel();
        const n = Math.round(Number(sugRpdInput.value));
        if (!model || !(n > 0)) return;
        let map = {};
        try { map = JSON.parse(lsGet(SUG_LS.rpd) || '{}') || {}; } catch (err) { /* reset */ }
        map[model] = Math.min(n, 1000000);
        lsSet(SUG_LS.rpd, JSON.stringify(map));
        updateSuggestInfo();
    }
    sugToggle.addEventListener('change', onSuggestToggle);
    sugModelSel.addEventListener('change', onSuggestModel);
    sugRpdInput.addEventListener('input', onSuggestRpd);

    startSuggest();

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
    updateSuggestMenu();
    updateWordCount();
    updateFileTypeLabel();
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
        restartApp, showAutoSavePrompt, closeAutoSavePrompt, enableAutoSave, setThemeMode,
        openDictDialog, closeDictDialog, addDictWord, openSuggestDialog, closeSuggestDialog, saveSuggestKey, sgNav,
        toggleSpellCheck, openSpellDialog, closeSpellDialog, applySpellDialog, downloadGeminiNano
    });
})();
