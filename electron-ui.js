const statusEl = document.getElementById('status');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnRestart = document.getElementById('btnRestart');
const logsEl = document.getElementById('logs');

let botRunning = false;

// ── Estado del bot ──
function updateStatus(running) {
    botRunning = running;
    if (running) {
        statusEl.textContent = 'Bot Prendido';
        statusEl.className = 'header-status-value running';
        btnStart.disabled = true;
        btnStop.disabled = false;
        btnRestart.disabled = false;
    } else {
        statusEl.textContent = 'Bot Detenido';
        statusEl.className = 'header-status-value stopped';
        btnStart.disabled = false;
        btnStop.disabled = true;
        btnRestart.disabled = true;
    }
}

// ── Logs ──
function addLog(message, type = 'info') {
    const lines = message.split('\n');
    for (const line of lines) {
        if (!line && line !== '') continue;
        const logLine = document.createElement('div');
        logLine.className = `log-line log-${type}`;
        if (line.trim()) {
            const timestamp = new Date().toLocaleTimeString();
            logLine.textContent = `[${timestamp}] ${line}`;
        } else {
            logLine.textContent = '';
        }
        logsEl.appendChild(logLine);
    }
    logsEl.scrollTop = logsEl.scrollHeight;
}

function clearLogs() {
    logsEl.innerHTML = '';
}

// ── Botones del header ──
btnStart.addEventListener('click', async () => {
    addLog('Iniciando bot...', 'info');
    try {
        const result = await window.electronAPI.startBot();
        if (result.success) {
            addLog(result.message, 'success');
            updateStatus(true);
        } else {
            addLog(result.message, 'error');
        }
    } catch (error) {
        addLog(`Error: ${error.message}`, 'error');
    }
});

btnStop.addEventListener('click', async () => {
    addLog('Deteniendo bot...', 'info');
    try {
        const result = await window.electronAPI.stopBot();
        if (result.success) {
            addLog(result.message, 'success');
            updateStatus(false);
        } else {
            addLog(result.message, 'error');
        }
    } catch (error) {
        addLog(`Error: ${error.message}`, 'error');
    }
});

btnRestart.addEventListener('click', async () => {
    clearLogs();
    addLog('Reiniciando bot...', 'info');
    try {
        const result = await window.electronAPI.restartBot();
        if (result.success) {
            addLog(result.message, 'success');
            updateStatus(true);
        } else {
            addLog(result.message, 'error');
            updateStatus(false);
        }
    } catch (error) {
        addLog(`Error: ${error.message}`, 'error');
    }
});

// ── Eventos del bot ──
window.electronAPI.onBotOutput((data) => {
    if (data.trim()) addLog(data, 'info');
});

window.electronAPI.onBotQrString((qrString) => {
    const oldQr = logsEl.querySelector('.qr-image-container');
    if (oldQr) oldQr.remove();
    try {
        const qr = qrcode(0, 'L');
        qr.addData(qrString);
        qr.make();
        const container = document.createElement('div');
        container.className = 'qr-image-container';
        container.style.cssText = 'text-align:center; margin:10px 0; padding:12px; background:#fff; border-radius:8px; display:inline-block;';
        container.innerHTML = qr.createImgTag(4, 8);
        logsEl.appendChild(container);
        logsEl.scrollTop = logsEl.scrollHeight;
    } catch (e) {
        addLog('Error generando QR: ' + e.message, 'error');
    }
});

window.electronAPI.onBotError((data) => {
    addLog(data.trim(), 'error');
});

window.electronAPI.onBotStatus((data) => {
    updateStatus(data.running);
    if (!data.running) {
        addLog(`Bot detenido (código: ${data.code || 'N/A'})`, 'info');
    }
});

window.electronAPI.getBotStatus().then(status => {
    updateStatus(status.running);
});

// ── Casos (conversaciones por cliente) ──
let casosClientList = [];
let casosSelectedPhone = null;
let casosSelectedData = null;

function escapeHtml(s) {
    if (typeof s !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function formatCasosTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function formatCasosTimeAgo(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `hace ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `hace ${hours}h`;
    const days = Math.floor(hours / 24);
    return `hace ${days}d`;
}

function renderCasosClientList() {
    const listEl = document.getElementById('casos-client-list');
    const countEl = document.getElementById('casos-count');
    const badgeEl = document.getElementById('casos-badge');
    if (!listEl) return;

    if (casosClientList.length === 0) {
        listEl.innerHTML = '<div style="padding:40px 20px;text-align:center;color:#bbb;font-size:13px;">No hay conversaciones todavía.</div>';
    } else {
        listEl.innerHTML = casosClientList.map(c => {
            const isActive = c.phoneNumber === casosSelectedPhone;
            const name = c.pushName || c.phoneNumber;
            const showPhone = c.pushName ? c.phoneNumber : '';
            return `
            <div class="casos-client-item${isActive ? ' active' : ''}" onclick="selectCasosClient('${escapeHtml(c.phoneNumber)}')">
                <div class="casos-client-name">${escapeHtml(name)}</div>
                ${showPhone ? `<div class="casos-client-phone">${escapeHtml(showPhone)}</div>` : ''}
                <div class="casos-client-preview">${escapeHtml(c.lastMessage || '')}</div>
                <div class="casos-client-meta">
                    <span class="casos-client-time">${formatCasosTimeAgo(c.lastMessageTime)}</span>
                    <div class="casos-client-badges">
                        <span class="casos-client-badge">${c.messageCount} msg</span>
                        ${c.noteCount > 0 ? `<span class="casos-client-badge notes">${c.noteCount} nota${c.noteCount > 1 ? 's' : ''}</span>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');
    }
    if (countEl) countEl.textContent = String(casosClientList.length);
    if (badgeEl) badgeEl.textContent = String(casosClientList.length);
}

function renderCasosDetail() {
    const panel = document.getElementById('casos-detail-panel');
    if (!panel) return;

    if (!casosSelectedData) {
        panel.innerHTML = '<div class="casos-empty-detail"><p>Seleccioná un cliente para ver sus mensajes.</p></div>';
        return;
    }

    const d = casosSelectedData;
    const name = d.pushName || d.phoneNumber;
    const msgs = Array.isArray(d.messages) ? d.messages : [];
    const notes = Array.isArray(d.notes) ? d.notes : [];

    let msgsHtml = '';
    if (msgs.length === 0) {
        msgsHtml = '<div class="casos-no-messages">Sin mensajes</div>';
    } else {
        msgsHtml = msgs.map(m => {
            let mediaHtml = '';
            if (m.mediaType && m.mediaPath) {
                const mediaId = `media_${m.id}`;
                if (m.mediaType === 'image') {
                    mediaHtml = `<div class="casos-msg-media" id="${mediaId}" data-path="${escapeHtml(m.mediaPath)}" data-type="image"><span class="casos-media-loading">Cargando imagen...</span></div>`;
                } else if (m.mediaType === 'audio') {
                    mediaHtml = `<div class="casos-msg-media" id="${mediaId}" data-path="${escapeHtml(m.mediaPath)}" data-type="audio"><span class="casos-media-loading">Cargando audio...</span></div>`;
                } else if (m.mediaType === 'video') {
                    mediaHtml = `<div class="casos-msg-media" id="${mediaId}" data-path="${escapeHtml(m.mediaPath)}" data-type="video"><span class="casos-media-loading">Cargando video...</span></div>`;
                } else {
                    mediaHtml = `<div class="casos-msg-media" id="${mediaId}" data-path="${escapeHtml(m.mediaPath)}" data-type="document"><span class="casos-media-loading">Documento adjunto</span></div>`;
                }
            }
            const textHtml = m.text && !m.text.startsWith('[') ? `<div class="casos-msg-text">${escapeHtml(m.text)}</div>` : (m.mediaType ? '' : `<div class="casos-msg-text">${escapeHtml(m.text)}</div>`);
            return `
            <div class="casos-msg-bubble">
                ${mediaHtml}
                ${textHtml}
                <div class="casos-msg-time">${formatCasosTime(m.timestamp)}</div>
            </div>`;
        }).join('');
    }

    let notesHtml = notes.map(n => `
        <div class="casos-note-item">
            <div class="casos-note-text">${escapeHtml(n.text)}</div>
            <span class="casos-note-time">${formatCasosTime(n.timestamp)}</span>
            <button class="casos-note-delete" onclick="deleteCasosNote('${escapeHtml(d.phoneNumber)}','${n.id}')" title="Eliminar">✕</button>
        </div>
    `).join('');

    panel.innerHTML = `
        <div class="casos-detail-header">
            <div class="casos-detail-name">${escapeHtml(name)}</div>
            <div class="casos-detail-phone">${escapeHtml(d.phoneNumber)} · ${msgs.length} mensaje${msgs.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="casos-messages-area" id="casos-messages-area">${msgsHtml}</div>
        <div class="casos-notes-section">
            <div class="casos-notes-header">Notas (${notes.length})</div>
            <div class="casos-notes-list">${notesHtml || '<div style="padding:8px 16px;color:#ccc;font-size:12px;">Sin notas</div>'}</div>
        </div>
        <div class="casos-add-note">
            <input type="text" id="casos-note-input" placeholder="Agregar nota..."
                onkeypress="if(event.key==='Enter') addCasosNote()">
            <button onclick="addCasosNote()">+ Nota</button>
        </div>
    `;

    const area = document.getElementById('casos-messages-area');
    if (area) area.scrollTop = area.scrollHeight;

    loadMediaElements();
}

async function loadMediaElements() {
    const mediaDivs = document.querySelectorAll('.casos-msg-media[data-path]');
    for (const div of mediaDivs) {
        const filePath = div.getAttribute('data-path');
        const type = div.getAttribute('data-type');
        if (!filePath || div.dataset.loaded) continue;
        div.dataset.loaded = 'true';
        try {
            const dataUrl = await window.electronAPI.getMediaDataUrl(filePath);
            if (!dataUrl) {
                div.innerHTML = '<span style="color:#999;font-size:11px;">Archivo no disponible</span>';
                continue;
            }
            if (type === 'image') {
                div.innerHTML = `<img src="${dataUrl}" class="casos-media-img" onclick="this.classList.toggle('expanded')">`;
            } else if (type === 'audio') {
                div.innerHTML = `<audio controls src="${dataUrl}" class="casos-media-audio"></audio>`;
            } else if (type === 'video') {
                div.innerHTML = `<video controls src="${dataUrl}" class="casos-media-video"></video>`;
            } else {
                div.innerHTML = `<a href="#" class="casos-media-doc" onclick="return false;">📎 Documento adjunto</a>`;
            }
        } catch (e) {
            div.innerHTML = '<span style="color:#999;font-size:11px;">Error cargando media</span>';
        }
    }
    const area = document.getElementById('casos-messages-area');
    if (area) area.scrollTop = area.scrollHeight;
}

async function loadCasosClientList() {
    try {
        casosClientList = await window.electronAPI.getConversationsList();
        renderCasosClientList();
    } catch (e) {
        console.error('Error loading conversations:', e);
    }
}

async function selectCasosClient(phoneNumber) {
    casosSelectedPhone = phoneNumber;
    try {
        casosSelectedData = await window.electronAPI.getConversation(phoneNumber);
    } catch (e) {
        console.error('Error loading conversation:', e);
        casosSelectedData = null;
    }
    renderCasosClientList();
    renderCasosDetail();
}

async function addCasosNote() {
    if (!casosSelectedPhone) return;
    const input = document.getElementById('casos-note-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await window.electronAPI.saveNote(casosSelectedPhone, text);
    await selectCasosClient(casosSelectedPhone);
    await loadCasosClientList();
}

async function deleteCasosNote(phoneNumber, noteId) {
    await window.electronAPI.deleteNote(phoneNumber, noteId);
    if (casosSelectedPhone === phoneNumber) {
        await selectCasosClient(phoneNumber);
    }
    await loadCasosClientList();
}

window.electronAPI.onConversationMsg((payload) => {
    const existing = casosClientList.find(c => c.phoneNumber === payload.phoneNumber);
    if (existing) {
        existing.lastMessage = payload.message.text;
        existing.lastMessageTime = payload.message.timestamp;
        existing.messageCount++;
        if (payload.pushName) existing.pushName = payload.pushName;
        casosClientList.sort((a, b) => {
            if (!a.lastMessageTime) return 1;
            if (!b.lastMessageTime) return -1;
            return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
        });
    } else {
        casosClientList.unshift({
            phoneNumber: payload.phoneNumber,
            pushName: payload.pushName || '',
            lastMessage: payload.message.text,
            lastMessageTime: payload.message.timestamp,
            messageCount: 1,
            noteCount: 0,
        });
    }
    renderCasosClientList();

    if (casosSelectedPhone === payload.phoneNumber && casosSelectedData) {
        const exists = casosSelectedData.messages.some(m => m.id === payload.message.id);
        if (!exists) {
            casosSelectedData.messages.push(payload.message);
            renderCasosDetail();
        }
    }
});

window.selectCasosClient = selectCasosClient;
window.addCasosNote = addCasosNote;
window.deleteCasosNote = deleteCasosNote;

// ══════════════════════════════════════════════════════════════
// ── Gestión de configuración con tabs ──
// ══════════════════════════════════════════════════════════════
let currentConfig = {};

async function loadConfig() {
    try {
        currentConfig = await window.electronAPI.getConfig();
        // Asegurar que la categoría "destacado" exista solo si ya hay otras categorías
        const hasOtherCategories = Object.keys(currentConfig).some(k => k !== 'destacado' && (currentConfig[k]?.length ?? 0) >= 0);
        if (hasOtherCategories && !currentConfig.destacado) {
            currentConfig.destacado = [];
            await window.electronAPI.saveConfig(currentConfig);
        }
        renderSidebarCategories();
    } catch (e) {
        console.error('Error cargando config:', e);
    }
}

// ── Sidebar: renderizar tabs de categorías ──
function renderSidebarCategories() {
    const container = document.getElementById('sidebar-categories');
    if (!container) return;
    container.innerHTML = '';

    for (const category of Object.keys(currentConfig)) {
        const items = currentConfig[category] || [];
        const btn = document.createElement('button');
        btn.className = 'sidebar-tab';
        btn.setAttribute('data-tab', `cat-${category}`);
        btn.onclick = () => switchTab(`cat-${category}`);
        btn.innerHTML = `
            <span class="tab-icon">📋</span>
            <span class="tab-label">.${category}</span>
            <span class="tab-badge">${items.length}</span>
        `;
        container.appendChild(btn);
    }

    // Crear/actualizar los tab panes
    renderCategoryPanes();
}

// ── Crear los panes de cada categoría ──
function renderCategoryPanes() {
    const container = document.getElementById('category-tabs-container');
    if (!container) return;
    container.innerHTML = '';

    for (const category of Object.keys(currentConfig)) {
        const items = currentConfig[category] || [];
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        pane.id = `tab-cat-${category}`;

        pane.innerHTML = `
            <div class="category-pane">
                <div class="category-header">
                    <h2>.${category} <span>${items.length} items</span></h2>
                    <button class="btn-delete-cat" onclick="deleteCategory('${category}')">Eliminar categoría</button>
                </div>
                <div class="category-command-tag">.${category}</div>
                <div class="category-items-list" id="${category}-items"></div>
                <div class="category-add-row">
                    <input type="text" id="${category}-new-input" placeholder="Código o título..."
                        onkeypress="if(event.key==='Enter') addItemAsCode('${category}')">
                    <button class="btn-add" onclick="addItemAsCode('${category}')">+ Código</button>
                    <button class="btn-add btn-title" onclick="addItemAsTitle('${category}')">+ Título</button>
                    <button class="btn-add btn-kit" onclick="addKitItem('${category}')">+ Kit</button>
                </div>
                <div class="category-save-msg" id="${category}-save-msg"></div>
            </div>
        `;
        container.appendChild(pane);

        // Renderizar items
        renderItems(category);
    }
}

// ── Drag & Drop state ──
let dragCategory = null;
let dragFromIndex = null;

function handleDragStart(e, category, index) {
    dragCategory = category;
    dragFromIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    e.target.closest('.cat-item').classList.add('dragging');
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const item = e.target.closest('.cat-item');
    if (!item) return;

    // Remove all drag-over classes
    const list = item.closest('.category-items-list');
    if (list) list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    // Determine if cursor is on top or bottom half
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
        item.classList.add('drag-over-top');
    } else {
        item.classList.add('drag-over-bottom');
    }
}

function handleDragLeave(e) {
    const item = e.target.closest('.cat-item');
    if (item) {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
    }
}

function handleDragEnd(e) {
    document.querySelectorAll('.cat-item.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    dragCategory = null;
    dragFromIndex = null;
}

async function handleDrop(e, category, toIndex) {
    e.preventDefault();
    if (dragCategory !== category || dragFromIndex === null || dragFromIndex === toIndex) {
        handleDragEnd(e);
        return;
    }

    // Determine insert position based on cursor position
    const item = e.target.closest('.cat-item');
    let insertIndex = toIndex;
    if (item) {
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY >= midY && toIndex > dragFromIndex) {
            insertIndex = toIndex;
        } else if (e.clientY < midY && toIndex < dragFromIndex) {
            insertIndex = toIndex;
        }
    }

    const items = currentConfig[category];
    const [moved] = items.splice(dragFromIndex, 1);
    // Adjust insert index after removal
    const adjustedIndex = insertIndex > dragFromIndex ? insertIndex - 1 : insertIndex;
    items.splice(adjustedIndex < 0 ? 0 : adjustedIndex, 0, moved);

    handleDragEnd(e);
    renderItems(category);
    await saveConfig(category);
}

// ── Kit item helpers ──
function isKitItem(item) {
    return typeof item === 'object' && item !== null && Array.isArray(item.articles);
}

function formatKitPrice(price) {
    return Math.round(price).toLocaleString('de-DE');
}

async function fetchKitPrice(category, index) {
    const item = currentConfig[category]?.[index];
    if (!isKitItem(item)) return;

    const codes = (item.articles || []).filter(c => c && c.trim());
    const tierNames = ['basico', 'completo', 'full'];
    for (const tn of tierNames) {
        const el = document.getElementById(`kit-tier-${tn}-${category}-${index}`);
        if (el) { el.textContent = '...'; el.className = 'kit-tier-price loading'; }
    }

    try {
        const [priceResult, stockResult] = await Promise.all([
            window.electronAPI.getArticlesPrice(codes),
            window.electronAPI.getArticlesStock(codes)
        ]);
        const stocks = stockResult.success ? (stockResult.stocks || {}) : {};
        if (priceResult.success && codes.length > 0) {
            updateKitPriceDisplay(category, index, priceResult.total, priceResult.details, stocks);
        } else {
            updateKitPriceDisplay(category, index, null, [], stocks);
        }
    } catch (e) {
        updateKitPriceDisplay(category, index, null, [], {});
    }
}

function roundUpTen(n) {
    return Math.ceil(n / 10) * 10;
}

function updateKitPriceDisplay(category, index, total, details, stocks) {
    stocks = stocks || {};

    const item = currentConfig[category]?.[index];
    const arts = item?.articles || ['', '', '', ''];

    const tierCounts = [2, 3, 4];
    const tierNames = ['basico', 'completo', 'full'];

    for (let t = 0; t < 3; t++) {
        const el = document.getElementById(`kit-tier-${tierNames[t]}-${category}-${index}`);
        if (!el) continue;

        let tierTotal = 0;
        let found = false;
        for (let a = 0; a < tierCounts[t]; a++) {
            const code = (arts[a] || '').trim().toUpperCase();
            if (!code) continue;
            const detail = details.find(d => d.code === code);
            if (detail && detail.prIva > 0) {
                tierTotal += detail.prIva;
                found = true;
            }
        }

        if (found && tierTotal > 0) {
            const rounded = roundUpTen(tierTotal);
            el.textContent = `$${formatKitPrice(rounded)}`;
            el.className = 'kit-tier-price';
        } else {
            el.textContent = '-';
            el.className = 'kit-tier-price no-price';
        }
    }

    for (let i = 0; i < 4; i++) {
        const input = document.getElementById(`kit-art-${category}-${index}-${i}`);
        const infoEl = document.getElementById(`kit-info-${category}-${index}-${i}`);
        if (!input) continue;
        const val = input.value.trim().toUpperCase();

        if (!val) {
            input.classList.remove('not-found', 'has-value');
            if (infoEl) { infoEl.textContent = ''; infoEl.className = 'kit-art-info'; }
            continue;
        }

        input.classList.add('has-value');
        const detail = details.find(d => d.code === val);
        const stock = stocks[val] ?? null;

        if (detail && detail.prIva > 0) {
            input.classList.remove('not-found');
            const parts = [];
            parts.push(`$${formatKitPrice(detail.prIva)}`);
            if (stock != null) parts.push(stock);
            if (infoEl) {
                infoEl.textContent = `(${parts.join(' | ')})`;
                infoEl.className = 'kit-art-info ok';
            }
        } else {
            input.classList.add('not-found');
            if (infoEl) {
                infoEl.textContent = '(?)';
                infoEl.className = 'kit-art-info err';
            }
        }
    }
}

/** Actualiza precios de todos los kits de una categoría (solo se llama al cambiar de tab). */
function fetchKitPricesForCategory(category) {
    const items = currentConfig[category] || [];
    items.forEach((item, index) => {
        if (isKitItem(item)) fetchKitPrice(category, index);
    });
}

async function handleKitArticleChange(category, index, artIndex, value) {
    const item = currentConfig[category]?.[index];
    if (!isKitItem(item)) return;

    if (!item.articles) item.articles = ['', '', '', ''];
    item.articles[artIndex] = value.trim();

    await saveConfig(category);
    // No auto-llamar endpoint: solo al cambiar de tab o al pulsar "Actualizar" en la fila
}

async function handleKitDescriptionChange(category, index, value) {
    const item = currentConfig[category]?.[index];
    if (!isKitItem(item)) return;
    item.description = value;
    await saveConfig(category);
}

// ── Renderizar items de una categoría ──
function renderItems(category) {
    const container = document.getElementById(`${category}-items`);
    if (!container) return;
    container.innerHTML = '';

    const items = currentConfig[category] || [];
    items.forEach((item, index) => {
        const div = document.createElement('div');
        div.setAttribute('data-index', index);
        div.addEventListener('dragstart', (e) => handleDragStart(e, category, index));
        div.addEventListener('dragover', handleDragOver);
        div.addEventListener('dragleave', handleDragLeave);
        div.addEventListener('dragend', handleDragEnd);
        div.addEventListener('drop', (e) => handleDrop(e, category, index));

        const dragHandle = `<span class="cat-item-drag" title="Arrastrar para reordenar">⠿</span>`;
        
        // En el tab de kits no mostramos checkboxes de destacado
        const isKitsTab = (category === 'kits');
        const isDestacado = isKitsTab ? false : isItemInDestacado(item);
        const checkboxId = `destacado-${category}-${index}`;
        const checkboxHtml = isKitsTab ? '' : `<input type="checkbox" id="${checkboxId}" ${isDestacado ? 'checked' : ''} class="destacado-checkbox" title="Destacar">`;

        // ── Kit item (has articles array) ──
        if (isKitItem(item)) {
            div.className = 'cat-item is-kit';
            div.draggable = true;
            const desc = item.description || '';
            const arts = item.articles || ['', '', '', ''];
            while (arts.length < 4) arts.push('');

            div.innerHTML = `
                ${dragHandle}
                <span class="cat-item-index">${index + 1}</span>
                <input type="text" value="${desc}" placeholder="Descripción del kit..."
                    class="kit-description-field"
                    onchange="handleKitDescriptionChange('${category}', ${index}, this.value)">
                <div class="kit-arts-group">
                    <span class="kit-art-wrap">
                        <input type="text" value="${arts[0]}" placeholder="Código 1"
                            class="kit-article-input ${arts[0] ? 'has-value' : ''}"
                            id="kit-art-${category}-${index}-0"
                            onchange="handleKitArticleChange('${category}', ${index}, 0, this.value)">
                        <span class="kit-art-info" id="kit-info-${category}-${index}-0"></span>
                    </span>
                    <span class="kit-art-wrap">
                        <input type="text" value="${arts[1]}" placeholder="Código 2"
                            class="kit-article-input ${arts[1] ? 'has-value' : ''}"
                            id="kit-art-${category}-${index}-1"
                            onchange="handleKitArticleChange('${category}', ${index}, 1, this.value)">
                        <span class="kit-art-info" id="kit-info-${category}-${index}-1"></span>
                    </span>
                    <span class="kit-art-wrap">
                        <input type="text" value="${arts[2]}" placeholder="Código 3"
                            class="kit-article-input ${arts[2] ? 'has-value' : ''}"
                            id="kit-art-${category}-${index}-2"
                            onchange="handleKitArticleChange('${category}', ${index}, 2, this.value)">
                        <span class="kit-art-info" id="kit-info-${category}-${index}-2"></span>
                    </span>
                    <span class="kit-art-wrap">
                        <input type="text" value="${arts[3]}" placeholder="Código 4"
                            class="kit-article-input ${arts[3] ? 'has-value' : ''}"
                            id="kit-art-${category}-${index}-3"
                            onchange="handleKitArticleChange('${category}', ${index}, 3, this.value)">
                        <span class="kit-art-info" id="kit-info-${category}-${index}-3"></span>
                    </span>
                </div>
                <div class="kit-prices-group" id="kit-prices-${category}-${index}">
                    <span class="kit-tier-price loading" id="kit-tier-basico-${category}-${index}">...</span>
                    <span class="kit-tier-price loading" id="kit-tier-completo-${category}-${index}">...</span>
                    <span class="kit-tier-price loading" id="kit-tier-full-${category}-${index}">...</span>
                </div>
                <button type="button" class="btn-refresh-kit" onclick="refreshKitRow('${category}', ${index})" title="Actualizar precios de esta fila">↻</button>
                ${checkboxHtml}
                <button class="btn-remove" onclick="removeItem('${category}', ${index})" title="Eliminar">✕</button>
            `;

            if (!isKitsTab) {
                const checkbox = div.querySelector(`#${checkboxId}`);
                if (checkbox) {
                    checkbox.addEventListener('change', (e) => {
                        e.stopPropagation();
                        toggleDestacado(category, index);
                    });
                }
            }

            container.appendChild(div);
            // No llamar fetchKitPrice aquí: solo al cambiar de tab o al pulsar "Actualizar" en la fila
            return;
        }

        div.className = 'cat-item';
        div.draggable = true;

        if (typeof item === 'object' && item !== null) {
            const code = item.code || '';
            const shortTitle = item.shortTitle || '';
            const quantity = item.quantity != null && item.quantity !== '' ? item.quantity : '';
            const discount = item.discount != null ? item.discount : '';
            const fixedPrice = item.fixedPrice != null ? item.fixedPrice : '';
            const hasDiscount = discount !== '' && discount !== 0;
            const hasFixedPrice = fixedPrice !== '' && fixedPrice !== 0;

            if (code.startsWith('>>')) {
                div.className = 'cat-item is-header';
                div.draggable = true;
                div.innerHTML = `
                    ${dragHandle}
                    <span class="cat-item-index">${index + 1}</span>
                    <span class="cat-item-code">${code.substring(2)}</span>
                    <span class="cat-item-fields"></span>
                    ${checkboxHtml}
                    <button class="btn-remove" onclick="removeItem('${category}', ${index})" title="Eliminar">✕</button>
                `;
            } else {
                div.innerHTML = `
                    ${dragHandle}
                    <span class="cat-item-index">${index + 1}</span>
                    <div class="cat-item-fields">
                        <input type="text" value="${code}" placeholder="Código sistema"
                            class="cat-item-field field-code"
                            onchange="updateItemField('${category}', ${index}, 'code', this.value)">
                        <input type="text" value="${shortTitle}" placeholder="Título / Descripción"
                            class="cat-item-field field-title"
                            onchange="updateItemField('${category}', ${index}, 'shortTitle', this.value)">
                        <input type="number" value="${quantity}" placeholder="Cant" min="1" step="1"
                            class="cat-item-field field-quantity"
                            onchange="handleQuantityChange('${category}', ${index}, this)">
                        <input type="number" value="${discount}" placeholder="% Dto"
                            class="cat-item-field field-discount ${hasFixedPrice ? 'field-locked' : ''}"
                            ${hasFixedPrice ? 'disabled' : ''}
                            onchange="handleDiscountChange('${category}', ${index}, this)">
                        <input type="number" value="${fixedPrice}" placeholder="$ Fijo"
                            class="cat-item-field field-fixed-price ${hasDiscount ? 'field-locked' : ''}"
                            ${hasDiscount ? 'disabled' : ''}
                            onchange="handleFixedPriceChange('${category}', ${index}, this)">
                    </div>
                    ${checkboxHtml}
                    <button class="btn-remove" onclick="removeItem('${category}', ${index})" title="Eliminar">✕</button>
                `;
            }
            
            if (!isKitsTab) {
                const checkbox = div.querySelector(`#${checkboxId}`);
                if (checkbox) {
                    checkbox.addEventListener('change', (e) => {
                        e.stopPropagation();
                        toggleDestacado(category, index);
                    });
                }
            }
        } else {
            const text = String(item);
            if (text.startsWith('>>')) {
                div.className = 'cat-item is-header';
                div.draggable = true;
                div.innerHTML = `
                    ${dragHandle}
                    <span class="cat-item-index">${index + 1}</span>
                    <span class="cat-item-code">${text.substring(2)}</span>
                    <span class="cat-item-fields"></span>
                    ${checkboxHtml}
                    <button class="btn-remove" onclick="removeItem('${category}', ${index})" title="Eliminar">✕</button>
                `;
            } else {
                div.innerHTML = `
                    ${dragHandle}
                    <span class="cat-item-index">${index + 1}</span>
                    <span class="cat-item-code">${text}</span>
                    <span class="cat-item-fields"></span>
                    ${checkboxHtml}
                    <button class="btn-remove" onclick="removeItem('${category}', ${index})" title="Eliminar">✕</button>
                `;
            }
            
            if (!isKitsTab) {
                const checkbox = div.querySelector(`#${checkboxId}`);
                if (checkbox) {
                    checkbox.addEventListener('change', (e) => {
                        e.stopPropagation();
                        toggleDestacado(category, index);
                    });
                }
            }
        }

        container.appendChild(div);
    });
}

// ── Agregar nueva categoría ──
async function addCategory() {
    const input = document.getElementById('new-category-input');
    const name = input.value.trim().toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, '');
    if (!name) return;
    if (currentConfig[name]) {
        alert(`La categoría ".${name}" ya existe.`);
        return;
    }
    currentConfig[name] = [];
    input.value = '';
    renderSidebarCategories();
    await saveConfig(name);
    // Switch to the new tab
    switchTab(`cat-${name}`);
}

// ── Eliminar categoría ──
async function deleteCategory(category) {
    if (!confirm(`¿Eliminar la categoría ".${category}" y todos sus items?`)) return;
    delete currentConfig[category];
    renderSidebarCategories();
    // Switch to consola
    switchTab('consola');
    await saveConfig(null);
}

// ── Actualizar campo de un item ──
async function updateItemField(category, index, field, value) {
    if (!currentConfig[category] || !currentConfig[category][index]) return;
    const item = currentConfig[category][index];
    if (typeof item === 'object' && item !== null) {
        item[field] = value;
        await saveConfig(category);
    }
}

// ── Cambio de cantidad ──
async function handleQuantityChange(category, index, input) {
    const raw = input.value.trim();
    const value = raw === '' ? null : parseInt(raw, 10);
    const item = currentConfig[category]?.[index];
    if (!item || typeof item !== 'object') return;
    item.quantity = (value != null && !Number.isNaN(value) && value >= 1) ? value : null;
    await saveConfig(category);
}

// ── Cambio de descuento: limpia fixedPrice y re-renderiza ──
async function handleDiscountChange(category, index, input) {
    const value = input.value ? Number(input.value) : null;
    const item = currentConfig[category]?.[index];
    if (!item || typeof item !== 'object') return;
    item.discount = value;
    // Si puso descuento, limpiar precio fijo
    if (value != null && value > 0) {
        item.fixedPrice = null;
    }
    renderItems(category);
    await saveConfig(category);
}

// ── Cambio de precio fijo: limpia discount y re-renderiza ──
async function handleFixedPriceChange(category, index, input) {
    const value = input.value ? Number(input.value) : null;
    const item = currentConfig[category]?.[index];
    if (!item || typeof item !== 'object') return;
    item.fixedPrice = value;
    // Si puso precio fijo, limpiar descuento
    if (value != null && value > 0) {
        item.discount = null;
    }
    renderItems(category);
    await saveConfig(category);
}

// ── Agregar item como código (objeto) ──
async function addItemAsCode(category) {
    const input = document.getElementById(`${category}-new-input`);
    const value = input.value.trim();
    if (!value) return;

    if (!currentConfig[category]) currentConfig[category] = [];
    currentConfig[category].push({
        code: value,
        shortTitle: null,
        quantity: 1,
        discount: null
    });
    input.value = '';

    renderItems(category);
    updateSidebarBadge(category);
    updateCategoryHeader(category);
    await saveConfig(category);
}

// ── Agregar item tipo kit (con descripción + hasta 4 artículos) ──
async function addKitItem(category) {
    const input = document.getElementById(`${category}-new-input`);
    const value = input.value.trim();

    if (!currentConfig[category]) currentConfig[category] = [];
    currentConfig[category].push({
        description: value || '',
        articles: ['', '', '', '']
    });
    input.value = '';

    renderItems(category);
    updateSidebarBadge(category);
    updateCategoryHeader(category);
    await saveConfig(category);
}

// ── Agregar item como título (string >>NOMBRE) ──
async function addItemAsTitle(category) {
    const input = document.getElementById(`${category}-new-input`);
    const value = input.value.trim();
    if (!value) return;

    if (!currentConfig[category]) currentConfig[category] = [];
    const titleValue = value.startsWith('>>') ? value : `>>${value}`;
    currentConfig[category].push(titleValue);
    input.value = '';

    renderItems(category);
    updateSidebarBadge(category);
    updateCategoryHeader(category);
    await saveConfig(category);
}

// ── Eliminar item ──
async function removeItem(category, index) {
    if (!currentConfig[category]) return;
    currentConfig[category].splice(index, 1);

    renderItems(category);
    updateSidebarBadge(category);
    updateCategoryHeader(category);
    await saveConfig(category);
}

// ── Actualizar badge en sidebar ──
function updateSidebarBadge(category) {
    const tab = document.querySelector(`.sidebar-tab[data-tab="cat-${category}"]`);
    if (tab) {
        const badge = tab.querySelector('.tab-badge');
        if (badge) badge.textContent = (currentConfig[category] || []).length;
    }
}

// ── Actualizar header de categoría ──
function updateCategoryHeader(category) {
    const pane = document.getElementById(`tab-cat-${category}`);
    if (pane) {
        const h2 = pane.querySelector('.category-header h2');
        if (h2) {
            const count = (currentConfig[category] || []).length;
            h2.innerHTML = `.${category} <span>${count} items</span>`;
        }
    }
}

// ── Guardar config ──
async function saveConfig(category) {
    try {
        const result = await window.electronAPI.saveConfig(currentConfig);
        if (category) {
            const msgEl = document.getElementById(`${category}-save-msg`);
            if (msgEl) {
                msgEl.textContent = result.success ? '✓ Guardado' : '✕ Error al guardar';
                msgEl.style.color = result.success ? '#51cf66' : '#ff6b6b';
                setTimeout(() => { msgEl.textContent = ''; }, 2000);
            }
        }
    } catch (e) {
        console.error('Error guardando config:', e);
    }
}

// ── Verificar si un item ya está en destacado ──
function isItemInDestacado(item) {
    if (!currentConfig.destacado) return false;
    
    return currentConfig.destacado.some(destacadoItem => {
        if (typeof item === 'string' && typeof destacadoItem === 'string') {
            return item === destacadoItem;
        }
        // Kit items: compare by description
        if (isKitItem(item) && isKitItem(destacadoItem)) {
            return (item.description || '') === (destacadoItem.description || '');
        }
        if (typeof item === 'object' && typeof destacadoItem === 'object'
            && !isKitItem(item) && !isKitItem(destacadoItem)) {
            const itemCode = item.code || '';
            const destacadoCode = destacadoItem.code || '';
            return itemCode === destacadoCode;
        }
        return false;
    });
}

// ── Toggle destacado: agregar o quitar de destacado sin mover de la categoría original ──
async function toggleDestacado(category, index) {
    try {
        console.log('toggleDestacado llamado:', category, index);
        
        // Asegurar que la categoría destacado existe
        if (!currentConfig.destacado) {
            currentConfig.destacado = [];
        }

        const items = currentConfig[category] || [];
        if (index < 0 || index >= items.length) {
            console.log('Índice inválido:', index, 'items.length:', items.length);
            return;
        }

        // Obtener el item
        const item = items[index];
        console.log('Item obtenido:', item);
        
        // Verificar si ya está en destacado
        const isInDestacado = isItemInDestacado(item);
        console.log('Está en destacado:', isInDestacado);
        
        if (isInDestacado) {
            const destacadoIndex = currentConfig.destacado.findIndex(destacadoItem => {
                if (typeof item === 'string' && typeof destacadoItem === 'string') {
                    return item === destacadoItem;
                }
                if (isKitItem(item) && isKitItem(destacadoItem)) {
                    return (item.description || '') === (destacadoItem.description || '');
                }
                if (typeof item === 'object' && typeof destacadoItem === 'object'
                    && !isKitItem(item) && !isKitItem(destacadoItem)) {
                    const itemCode = item.code || '';
                    const destacadoCode = destacadoItem.code || '';
                    return itemCode === destacadoCode;
                }
                return false;
            });
            
            if (destacadoIndex !== -1) {
                currentConfig.destacado.splice(destacadoIndex, 1);
                console.log('Item removido de destacado');
            }
        } else {
            // Agregar a destacado (copiar, no mover)
            // Hacer una copia profunda del item
            const itemCopy = typeof item === 'object' && item !== null
                ? JSON.parse(JSON.stringify(item))
                : item;
            currentConfig.destacado.push(itemCopy);
            console.log('Item agregado a destacado');
        }

        // Guardar y actualizar
        await saveConfig(category);
        await saveConfig('destacado');
        
        // Re-renderizar todas las categorías para actualizar el estado de los checkboxes
        for (const cat of Object.keys(currentConfig)) {
            renderItems(cat);
            updateSidebarBadge(cat);
            updateCategoryHeader(cat);
        }
        
        console.log('Toggle completado');
    } catch (error) {
        console.error('Error en toggleDestacado:', error);
    }
}

// ══════════════════════════════════════════════════════════════
// ── Cotización ──
// ══════════════════════════════════════════════════════════════
let cotizacionItems = [];
let cotizacionMode = 'presupuesto'; // 'presupuesto' | 'cotizacion'
let cotizacionListId = '0'; // 0=Lista 1, 1=Lista 2, 3=Lista Normal, 4=Lista Tallerista

async function loadCotizacion() {
    try {
        const data = await window.electronAPI.getCotizacion();
        cotizacionItems = data.items || [];
        cotizacionMode = data.mode === 'cotizacion' ? 'cotizacion' : 'presupuesto';
        const listId = data.listId;
        cotizacionListId = listId !== undefined && listId !== null ? String(listId) : '0';
        cotizacionItems.forEach(it => {
            if (it.quantity == null || it.quantity < 1) it.quantity = 1;
        });
        updateCotiModeUI();
        updateCotiListaSelect();
        renderCotizacion();
    } catch (e) {
        console.error('Error cargando cotización:', e);
    }
}

async function saveCotizacion() {
    try {
        await window.electronAPI.saveCotizacion({ items: cotizacionItems, mode: cotizacionMode, listId: cotizacionListId });
    } catch (e) {
        console.error('Error guardando cotización:', e);
    }
}

function updateCotiListaSelect() {
    const sel = document.getElementById('coti-lista-select');
    if (sel) sel.value = cotizacionListId;
}

function updateCotiModeUI() {
    const presupuestoEl = document.getElementById('coti-mode-presupuesto');
    const cotizacionEl = document.getElementById('coti-mode-cotizacion');
    const hintEl = document.getElementById('coti-mode-hint');
    if (presupuestoEl) presupuestoEl.checked = cotizacionMode === 'presupuesto';
    if (cotizacionEl) cotizacionEl.checked = cotizacionMode === 'cotizacion';
    if (hintEl) hintEl.textContent = cotizacionMode === 'presupuesto'
        ? 'Sin cantidades ni total (todo x 1)'
        : 'Con cantidades y total';
}

function formatCotiPrice(price) {
    const rounded = Math.round(price);
    return rounded.toLocaleString('de-DE');
}

function getCotiItemEffectivePrice(item) {
    const base = item.price || 0;
    if (item.fixedPrice != null && item.fixedPrice !== '') {
        const v = Number(item.fixedPrice);
        return !Number.isNaN(v) ? v : base;
    }
    if (item.discount != null && item.discount !== '') {
        const pct = Number(item.discount);
        if (!Number.isNaN(pct) && pct > 0) return base * (1 - pct / 100);
    }
    return base;
}

function renderCotizacion() {
    const listEl = document.getElementById('coti-items-list');
    const totalRow = document.getElementById('coti-total-row');
    const totalValue = document.getElementById('coti-total-value');
    const countEl = document.getElementById('coti-count');
    const badgeEl = document.getElementById('coti-badge');

    if (!listEl) return;
    listEl.innerHTML = '';

    if (cotizacionItems.length === 0) {
        listEl.innerHTML = '<div class="coti-empty">No hay items. Busca un código para agregar artículos.</div>';
        if (totalRow) totalRow.style.display = 'none';
        if (countEl) countEl.textContent = '0 items';
        if (badgeEl) badgeEl.textContent = '0';
        return;
    }

    const isCotizacion = cotizacionMode === 'cotizacion';
    let total = 0;
    cotizacionItems.forEach((item, index) => {
        const effectivePrice = getCotiItemEffectivePrice(item);
        const qty = Math.max(1, Number(item.quantity) || 1);
        const subtotal = effectivePrice * qty;
        total += subtotal;
        const discount = item.discount != null ? item.discount : '';
        const fixedPrice = item.fixedPrice != null ? item.fixedPrice : '';
        const hasDiscount = discount !== '' && discount !== 0;
        const hasFixedPrice = fixedPrice !== '' && fixedPrice !== 0;
        const div = document.createElement('div');
        div.className = 'coti-item';
        const qtyInput = isCotizacion
            ? `<input type="number" min="1" value="${qty}" class="coti-item-qty" onchange="handleCotiQuantityChange(${index}, this)">`
            : '';
        div.innerHTML = `
            <span class="coti-item-index">${index + 1}</span>
            ${qtyInput}
            <span class="coti-item-desc" title="${item.description}">${item.description}</span>
            <span class="coti-item-code">${item.code}</span>
            <input type="number" value="${discount}" placeholder="% Dto"
                class="coti-item-field field-discount ${hasFixedPrice ? 'field-locked' : ''}"
                ${hasFixedPrice ? 'disabled' : ''}
                onchange="handleCotiDiscountChange(${index}, this)">
            <input type="number" value="${fixedPrice}" placeholder="$ Fijo"
                class="coti-item-field field-fixed-price ${hasDiscount ? 'field-locked' : ''}"
                ${hasDiscount ? 'disabled' : ''}
                onchange="handleCotiFixedPriceChange(${index}, this)">
            <span class="coti-item-price">$${formatCotiPrice(isCotizacion ? subtotal : effectivePrice)}</span>
            <button class="btn-remove" onclick="removeCotiItem(${index})" title="Eliminar">✕</button>
        `;
        listEl.appendChild(div);
    });

    if (totalRow) totalRow.style.display = isCotizacion ? 'flex' : 'none';
    if (totalValue) totalValue.textContent = `$${formatCotiPrice(total)}`;
    if (countEl) countEl.textContent = `${cotizacionItems.length} items`;
    if (badgeEl) badgeEl.textContent = cotizacionItems.length;
}

async function searchForCotizacion() {
    const input = document.getElementById('coti-search-input');
    const btn = document.getElementById('coti-search-btn');
    const codigo = input.value.trim();
    if (!codigo) return;

    btn.disabled = true;
    btn.textContent = 'Buscando...';

    try {
        const result = await window.electronAPI.searchArticulo(codigo, cotizacionListId);
        if (result.success && result.articles.length > 0) {
            openCotiModal(result.articles);
        } else {
            openCotiModal([], result.message || 'No se encontraron resultados');
        }
    } catch (e) {
        openCotiModal([], 'Error de conexión');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Buscar';
    }
}

function openCotiModal(articles, errorMsg) {
    const modal = document.getElementById('coti-modal');
    const body = document.getElementById('coti-modal-body');
    if (!modal || !body) return;

    body.innerHTML = '';

    if (errorMsg || articles.length === 0) {
        body.innerHTML = `<div class="modal-empty">${errorMsg || 'Sin resultados'}</div>`;
    } else {
        for (const article of articles) {
            const priceStr = article.price > 0 ? `$${formatCotiPrice(article.price)}` : 'Sin precio';
            const div = document.createElement('div');
            div.className = 'modal-item';
            div.innerHTML = `
                <div class="modal-item-top">
                    <span class="modal-item-code">${article.code}</span>
                    <span class="modal-item-stock">Stock: ${article.stock}</span>
                    <span class="modal-item-price">${priceStr}</span>
                </div>
                <div class="modal-item-desc">${article.description}</div>
            `;
            div.addEventListener('click', () => selectCotiArticle(article));
            body.appendChild(div);
        }
    }

    modal.style.display = 'flex';
}

function closeCotiModal() {
    const modal = document.getElementById('coti-modal');
    if (modal) modal.style.display = 'none';
}

async function selectCotiArticle(article) {
    cotizacionItems.push({
        code: article.code,
        description: article.description,
        price: article.price,
        quantity: 1,
        discount: null,
        fixedPrice: null
    });
    closeCotiModal();
    renderCotizacion();
    await saveCotizacion();

    const input = document.getElementById('coti-search-input');
    if (input) { input.value = ''; input.focus(); }
}

async function handleCotiDiscountChange(index, input) {
    const value = input.value !== '' ? Number(input.value) : null;
    const item = cotizacionItems[index];
    if (!item) return;
    item.discount = value;
    if (value != null && value > 0) item.fixedPrice = null;
    renderCotizacion();
    await saveCotizacion();
}

async function handleCotiFixedPriceChange(index, input) {
    const value = input.value !== '' ? Number(input.value) : null;
    const item = cotizacionItems[index];
    if (!item) return;
    item.fixedPrice = value;
    if (value != null && value > 0) item.discount = null;
    renderCotizacion();
    await saveCotizacion();
}

async function handleCotiQuantityChange(index, input) {
    const value = Math.max(1, Math.floor(Number(input.value)) || 1);
    const item = cotizacionItems[index];
    if (!item) return;
    item.quantity = value;
    renderCotizacion();
    await saveCotizacion();
}

async function handleCotiModeChange(value) {
    cotizacionMode = value === 'cotizacion' ? 'cotizacion' : 'presupuesto';
    cotizacionItems.forEach(it => {
        if (it.quantity == null || it.quantity < 1) it.quantity = 1;
    });
    updateCotiModeUI();
    renderCotizacion();
    await saveCotizacion();
}

async function removeCotiItem(index) {
    cotizacionItems.splice(index, 1);
    renderCotizacion();
    await saveCotizacion();
}

async function clearCotizacion() {
    if (cotizacionItems.length === 0) return;
    if (!confirm('¿Limpiar toda la cotización?')) return;
    cotizacionItems = [];
    renderCotizacion();
    await saveCotizacion();
}

// Cerrar modal con Escape o click fuera
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCotiModal();
});
document.getElementById('coti-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'coti-modal') closeCotiModal();
});

// ── Exponer funciones globales ──
window.addItemAsCode = addItemAsCode;
window.addItemAsTitle = addItemAsTitle;
window.addKitItem = addKitItem;
window.updateItemField = updateItemField;
window.handleQuantityChange = handleQuantityChange;
window.handleDiscountChange = handleDiscountChange;
window.handleFixedPriceChange = handleFixedPriceChange;
window.handleKitArticleChange = handleKitArticleChange;
window.handleKitDescriptionChange = handleKitDescriptionChange;
window.removeItem = removeItem;
window.addCategory = addCategory;
window.deleteCategory = deleteCategory;
function switchTab(tabId) {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    const tabBtn = document.querySelector(`.sidebar-tab[data-tab="${tabId}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    const pane = document.getElementById(`tab-${tabId}`);
    if (pane) pane.classList.add('active');
    // Solo al cambiar de tab: actualizar precios de kits de esta categoría
    if (tabId && String(tabId).startsWith('cat-')) {
        const category = String(tabId).replace(/^cat-/, '');
        fetchKitPricesForCategory(category);
    }
    if (tabId === 'casos') {
        loadCasosClientList();
    }
}

function refreshKitRow(category, index) {
    fetchKitPrice(category, index);
}

window.switchTab = switchTab;
window.refreshKitRow = refreshKitRow;
window.toggleDestacado = toggleDestacado;
window.searchForCotizacion = searchForCotizacion;
window.closeCotiModal = closeCotiModal;
window.removeCotiItem = removeCotiItem;
window.clearCotizacion = clearCotizacion;
window.handleCotiDiscountChange = handleCotiDiscountChange;
window.handleCotiFixedPriceChange = handleCotiFixedPriceChange;
window.handleCotiQuantityChange = handleCotiQuantityChange;
window.handleCotiModeChange = handleCotiModeChange;

async function handleCotiListaChange(value) {
    cotizacionListId = value;
    updateCotiListaSelect();
    await saveCotizacion();
}
window.handleCotiListaChange = handleCotiListaChange;

// ── Init ──
loadConfig();
loadCotizacion();
loadCasosClientList();
addLog('Panel de control listo. Presiona "Iniciar Bot" para comenzar.', 'info');
