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

// ══════════════════════════════════════════════════════════════
// ── Gestión de configuración con tabs ──
// ══════════════════════════════════════════════════════════════
let currentConfig = {};

async function loadConfig() {
    try {
        currentConfig = await window.electronAPI.getConfig();
        // Asegurar que la categoría "destacado" exista
        if (!currentConfig.destacado) {
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

// ── Renderizar items de una categoría ──
function renderItems(category) {
    const container = document.getElementById(`${category}-items`);
    if (!container) return;
    container.innerHTML = '';

    const items = currentConfig[category] || [];
    items.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'cat-item';
        div.draggable = true;
        div.setAttribute('data-index', index);
        div.addEventListener('dragstart', (e) => handleDragStart(e, category, index));
        div.addEventListener('dragover', handleDragOver);
        div.addEventListener('dragleave', handleDragLeave);
        div.addEventListener('dragend', handleDragEnd);
        div.addEventListener('drop', (e) => handleDrop(e, category, index));

        const dragHandle = `<span class="cat-item-drag" title="Arrastrar para reordenar">⠿</span>`;
        
        // Verificar si el item está destacado
        const isDestacado = isItemInDestacado(item);
        const checkboxId = `destacado-${category}-${index}`;

        if (typeof item === 'object' && item !== null) {
            const code = item.code || '';
            const shortTitle = item.shortTitle || '';
            const discount = item.discount != null ? item.discount : '';
            const fixedPrice = item.fixedPrice != null ? item.fixedPrice : '';
            const hasDiscount = discount !== '' && discount !== 0;
            const hasFixedPrice = fixedPrice !== '' && fixedPrice !== 0;

            // Header items (>>MARCA)
            if (code.startsWith('>>')) {
                div.className = 'cat-item is-header';
                div.draggable = true;
                div.innerHTML = `
                    ${dragHandle}
                    <span class="cat-item-index">${index + 1}</span>
                    <span class="cat-item-code">${code.substring(2)}</span>
                    <span class="cat-item-fields"></span>
                    <input type="checkbox" id="${checkboxId}" ${isDestacado ? 'checked' : ''} class="destacado-checkbox" title="Destacar">
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
                        <input type="number" value="${discount}" placeholder="% Dto"
                            class="cat-item-field field-discount ${hasFixedPrice ? 'field-locked' : ''}"
                            ${hasFixedPrice ? 'disabled' : ''}
                            onchange="handleDiscountChange('${category}', ${index}, this)">
                        <input type="number" value="${fixedPrice}" placeholder="$ Fijo"
                            class="cat-item-field field-fixed-price ${hasDiscount ? 'field-locked' : ''}"
                            ${hasDiscount ? 'disabled' : ''}
                            onchange="handleFixedPriceChange('${category}', ${index}, this)">
                    </div>
                    <input type="checkbox" id="${checkboxId}" ${isDestacado ? 'checked' : ''} class="destacado-checkbox" title="Destacar">
                    <button class="btn-remove" onclick="removeItem('${category}', ${index})" title="Eliminar">✕</button>
                `;
            }
            
            // Agregar event listener al checkbox después de crear el innerHTML
            const checkbox = div.querySelector(`#${checkboxId}`);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    toggleDestacado(category, index);
                });
            }
        } else {
            // String item
            const text = String(item);
            if (text.startsWith('>>')) {
                div.className = 'cat-item is-header';
                div.draggable = true;
                div.innerHTML = `
                    ${dragHandle}
                    <span class="cat-item-index">${index + 1}</span>
                    <span class="cat-item-code">${text.substring(2)}</span>
                    <span class="cat-item-fields"></span>
                    <input type="checkbox" id="${checkboxId}" ${isDestacado ? 'checked' : ''} class="destacado-checkbox" title="Destacar">
                    <button class="btn-remove" onclick="removeItem('${category}', ${index})" title="Eliminar">✕</button>
                `;
            } else {
                div.innerHTML = `
                    ${dragHandle}
                    <span class="cat-item-index">${index + 1}</span>
                    <span class="cat-item-code">${text}</span>
                    <span class="cat-item-fields"></span>
                    <input type="checkbox" id="${checkboxId}" ${isDestacado ? 'checked' : ''} class="destacado-checkbox" title="Destacar">
                    <button class="btn-remove" onclick="removeItem('${category}', ${index})" title="Eliminar">✕</button>
                `;
            }
            
            // Agregar event listener al checkbox después de crear el innerHTML
            const checkbox = div.querySelector(`#${checkboxId}`);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    toggleDestacado(category, index);
                });
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
        discount: null
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
    
    // Comparar items (string o objeto)
    return currentConfig.destacado.some(destacadoItem => {
        if (typeof item === 'string' && typeof destacadoItem === 'string') {
            return item === destacadoItem;
        }
        if (typeof item === 'object' && typeof destacadoItem === 'object') {
            // Comparar por código
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
            // Quitar de destacado
            const destacadoIndex = currentConfig.destacado.findIndex(destacadoItem => {
                if (typeof item === 'string' && typeof destacadoItem === 'string') {
                    return item === destacadoItem;
                }
                if (typeof item === 'object' && typeof destacadoItem === 'object') {
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

// ── Exponer funciones globales ──
window.addItemAsCode = addItemAsCode;
window.addItemAsTitle = addItemAsTitle;
window.updateItemField = updateItemField;
window.handleDiscountChange = handleDiscountChange;
window.handleFixedPriceChange = handleFixedPriceChange;
window.removeItem = removeItem;
window.addCategory = addCategory;
window.deleteCategory = deleteCategory;
window.switchTab = switchTab;
window.toggleDestacado = toggleDestacado;

// ── Init ──
loadConfig();
addLog('Panel de control listo. Presiona "Iniciar Bot" para comenzar.', 'info');
