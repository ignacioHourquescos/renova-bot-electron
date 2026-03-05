const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { app, BrowserWindow, ipcMain, net } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
// QR image is now generated in the renderer

// Función para limpiar auth_info
function cleanAuthInfo() {
  const authInfoPath = path.join(__dirname, 'auth_info');
  try {
    if (fs.existsSync(authInfoPath)) {
      const files = fs.readdirSync(authInfoPath);
      files.forEach(file => {
        const filePath = path.join(authInfoPath, file);
        try {
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          } else {
            fs.rmSync(filePath, { recursive: true, force: true });
          }
        } catch (err) {
          console.error(`Error al eliminar ${filePath}:`, err);
        }
      });
      console.log('✅ auth_info limpiado correctamente');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error al limpiar auth_info:', error);
    return false;
  }
}

let mainWindow;
let botProcess = null;
let isBotRunning = false;
let stdoutBuffer = ''; // Buffer para acumular stdout y detectar QR completo

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'Renova Bot - Control Panel'
  });

  mainWindow.loadFile('electron-ui.html');
}

app.whenReady().then(() => {
  createWindow();

  // Window control handlers (custom frameless titlebar)
  ipcMain.handle('window-minimize', () => {
    mainWindow && mainWindow.minimize();
  });
  ipcMain.handle('window-maximize', () => {
    if (mainWindow) {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    }
  });
  ipcMain.handle('window-close', () => {
    mainWindow && mainWindow.close();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Pre-cachear lista de precios en background para que la primera búsqueda sea rápida
  fetchPriceList().catch(() => {});
});

app.on('window-all-closed', () => {
  if (botProcess) {
    botProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Limpiar códigos ANSI de escape (colores de terminal)
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '');
}

// Patrones de ruido interno de Baileys/libsignal que no queremos mostrar
const NOISE_PATTERNS = [
  'Bad MAC',
  'Failed to decrypt message',
  'Session error:',
  'at Object.verifyMAC',
  'at SessionCipher',
  'at async SessionCipher',
  'at async _asyncQueueExecutor',
  'session_cipher.js',
  'crypto.js:87',
  'queue_job.js',
  'Closing open session',
  'Closing session:',
  'SessionEntry {',
  '_chains:',
  'chainKey:',
  'chainType:',
  'messageKeys:',
  'registrationId:',
  'currentRatchet:',
  'ephemeralKeyPair:',
  'pubKey: <Buffer',
  'privKey: <Buffer',
  'lastRemoteEphemeralKey:',
  'previousCounter:',
  'rootKey: <Buffer',
  'indexInfo:',
  'baseKey: <Buffer',
  'baseKeyType:',
  'closed: -1',
  'used: 1',
  'created: 1',
  'remoteIdentityKey:',
];

function isNoiseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Líneas que son solo llaves/corchetes sueltos (parte del dump de sesión)
  if (/^[\s{}[\],]*$/.test(trimmed)) return true;
  return NOISE_PATTERNS.some(p => trimmed.includes(p));
}

// Función para procesar la salida del bot (compartida entre start y restart)
function handleBotStdout(data) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  stdoutBuffer += data.toString();

  // Procesar líneas completas del buffer (las que terminan en \n)
  const lines = stdoutBuffer.split('\n');
  // Mantener la última línea incompleta en el buffer
  stdoutBuffer = lines.pop() || '';

  const cleanLines = [];
  for (const line of lines) {
    const clean = stripAnsi(line).replace(/\r/g, '');
    // Detectar string QR y enviarlo al renderer
    const qrMatch = clean.match(/\[QR_CODE_STRING\](.+)\[\/QR_CODE_STRING\]/);
    if (qrMatch) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bot-qr-string', qrMatch[1]);
      }
      continue;
    }
    if (clean.includes('[QR_CODE_STRING]') || clean.includes('[/QR_CODE_STRING]')) continue;

    const convMatch = clean.match(/\[CONVERSATION_MSG\](.+)\[\/CONVERSATION_MSG\]/);
    if (convMatch) {
      try {
        const payload = JSON.parse(convMatch[1]);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('conversation-msg', payload);
        }
      } catch (e) {
        console.error('Error parsing CONVERSATION_MSG:', e);
      }
      continue;
    }
    if (clean.includes('[CONVERSATION_MSG]') || clean.includes('[/CONVERSATION_MSG]')) continue;
    if (isNoiseLine(clean)) continue;
    cleanLines.push(clean);
  }

  const cleanOutput = cleanLines.join('\n');
  if (cleanOutput.trim()) {
    mainWindow.webContents.send('bot-output', cleanOutput);
  }
}

// Función para configurar los listeners del proceso del bot
function setupBotProcessListeners() {
  if (!botProcess) return;

  stdoutBuffer = ''; // Resetear buffer

  botProcess.stdout.on('data', handleBotStdout);

  botProcess.stderr.on('data', (data) => {
    const output = stripAnsi(data.toString());
    // Filtrar ruido de stderr también
    const cleanLines = output.split('\n').filter(line => !isNoiseLine(line));
    const clean = cleanLines.join('\n').trim();
    if (clean && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bot-error', clean);
    }
  });

  botProcess.on('close', (code) => {
    isBotRunning = false;
    botProcess = null;
    stdoutBuffer = '';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bot-status', { running: false, code });
    }
  });
}

// Función para crear el proceso del bot
function spawnBotProcess() {
  const isDev = process.env.NODE_ENV !== 'production';
  
  const npxPath = process.platform === 'win32' 
    ? path.join(__dirname, 'node_modules', '.bin', 'npx.cmd')
    : path.join(__dirname, 'node_modules', '.bin', 'npx');
  
  const nodePath = process.platform === 'win32'
    ? path.join(__dirname, 'node_modules', '.bin', 'node.cmd')
    : 'node';
  
  // stdin es 'pipe' para poder enviar SHUTDOWN al bot
  if (isDev) {
    const npxExists = fs.existsSync(npxPath);
    if (npxExists) {
      return spawn(npxPath, ['tsx', 'src/index.ts'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });
    } else {
      return spawn('npx', ['tsx', 'src/index.ts'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });
    }
  } else {
    return spawn(nodePath, ['dist/index.js'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });
  }
}

/**
 * Envía SHUTDOWN al bot y espera que se cierre limpiamente.
 * Si no cierra en `timeout` ms, lo mata a la fuerza.
 */
function gracefulStopBot(timeout = 5000) {
  return new Promise((resolve) => {
    if (!botProcess) {
      resolve(true);
      return;
    }

    let forceKilled = false;

    // Listener para cuando cierre
    const onClose = () => {
      clearTimeout(timer);
      botProcess = null;
      isBotRunning = false;
      stdoutBuffer = '';
      resolve(true);
    };

    botProcess.once('close', onClose);

    // Enviar señal SHUTDOWN por stdin
    try {
      if (botProcess.stdin && !botProcess.stdin.destroyed) {
        botProcess.stdin.write('SHUTDOWN\n');
      }
    } catch (e) {
      // Si falla escribir, matar directo
      console.error('No se pudo enviar SHUTDOWN, forzando kill');
    }

    // Timeout: si no cierra a tiempo, matar a la fuerza
    const timer = setTimeout(() => {
      if (botProcess) {
        forceKilled = true;
        try { botProcess.kill(); } catch(e) {}
        botProcess = null;
        isBotRunning = false;
        stdoutBuffer = '';
        resolve(false);
      }
    }, timeout);
  });
}

// Manejar comandos del bot
ipcMain.handle('start-bot', async () => {
  if (isBotRunning) {
    return { success: false, message: 'El bot ya está corriendo' };
  }

  try {
    botProcess = spawnBotProcess();
    isBotRunning = true;
    setupBotProcessListeners();
    return { success: true, message: 'Bot iniciado correctamente' };
  } catch (error) {
    isBotRunning = false;
    return { success: false, message: `Error al iniciar bot: ${error.message}` };
  }
});

ipcMain.handle('stop-bot', async () => {
  if (!isBotRunning || !botProcess) {
    return { success: false, message: 'El bot no está corriendo' };
  }

  try {
    // Apagado limpio: avisa a WhatsApp que se desconecta
    const cleanExit = await gracefulStopBot(5000);
    
    cleanAuthInfo();
    
    const msg = cleanExit
      ? 'Bot desconectado limpiamente de WhatsApp. Credenciales limpiadas.'
      : 'Bot detenido (forzado). Credenciales limpiadas.';
    return { success: true, message: msg };
  } catch (error) {
    return { success: false, message: `Error al detener bot: ${error.message}` };
  }
});

ipcMain.handle('restart-bot', async () => {
  if (isBotRunning && botProcess) {
    // Apagado limpio antes de reiniciar
    await gracefulStopBot(5000);
  }
  
  cleanAuthInfo();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  try {
    botProcess = spawnBotProcess();
    isBotRunning = true;
    setupBotProcessListeners();
    return { success: true, message: 'Bot reiniciado correctamente' };
  } catch (error) {
    isBotRunning = false;
    return { success: false, message: `Error al reiniciar bot: ${error.message}` };
  }
});

ipcMain.handle('get-bot-status', async () => {
  return { running: isBotRunning };
});

// ---- Config handlers ----
const configPath = path.join(__dirname, 'bot-config.json');

function readConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error leyendo config:', e);
  }
  return { kits: [], refrigerantes: [] };
}

function writeConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Error escribiendo config:', e);
    return false;
  }
}

ipcMain.handle('get-config', async () => {
  return readConfig();
});

ipcMain.handle('save-config', async (event, config) => {
  const success = writeConfig(config);
  return { success, message: success ? 'Configuración guardada' : 'Error al guardar' };
});

// ---- Cotización handlers ----
const API_URL = 'https://renovaapi-production.up.railway.app';
const cotizacionPath = path.join(__dirname, 'cotizacion.json');
const priceListCache = {};
const priceListCacheTime = {};
const PRICE_CACHE_TTL = 60000;

async function fetchPriceList(listId) {
  const id = listId != null ? String(listId) : '0';
  const now = Date.now();
  if (priceListCache[id] && (now - (priceListCacheTime[id] || 0)) < PRICE_CACHE_TTL) {
    return priceListCache[id];
  }
  const url = `${API_URL}/obtenerListadoArticulos${id ? `?listaid=${id}` : ''}`;
  const response = await net.fetch(url);
  const articles = await response.json();
  const map = {};
  for (const a of articles) {
    if (a.id && a.pr != null) {
      map[a.id.toUpperCase()] = { pr: Number(a.pr), d: a.d || '' };
    }
  }
  priceListCache[id] = map;
  priceListCacheTime[id] = now;
  return map;
}

ipcMain.handle('get-articles-price', async (event, codes, listId) => {
  try {
    if (!Array.isArray(codes) || codes.length === 0) {
      return { success: false, total: 0, details: [] };
    }
    const priceMap = await fetchPriceList(listId);
    const details = [];
    let total = 0;
    for (const code of codes) {
      if (!code || !code.trim()) continue;
      const entry = priceMap[code.trim().toUpperCase()];
      if (entry) {
        const prIva = Math.round(entry.pr * 1.21);
        details.push({ code: code.trim().toUpperCase(), pr: entry.pr, prIva, desc: entry.d });
        total += prIva;
      } else {
        details.push({ code: code.trim().toUpperCase(), pr: 0, prIva: 0, desc: 'No encontrado' });
      }
    }
    return { success: true, total, details };
  } catch (error) {
    return { success: false, total: 0, details: [], message: error.message };
  }
});

ipcMain.handle('get-articles-stock', async (event, codes) => {
  try {
    if (!Array.isArray(codes) || codes.length === 0) {
      return { success: true, stocks: {} };
    }
    const stocks = {};
    await Promise.all(
      codes.filter(c => c && c.trim()).map(async (code) => {
        const c = code.trim().toUpperCase();
        try {
          const res = await net.fetch(`${API_URL}/obtenerArticulo/${c}`);
          if (!res.ok) return;
          const articles = await res.json();
          if (!Array.isArray(articles)) return;
          let total = 0;
          for (const a of articles) {
            total += a.CANT_STOCK ?? a.CANT_STO ?? a.stock ?? 0;
          }
          stocks[c] = total;
        } catch (_) {}
      })
    );
    return { success: true, stocks };
  } catch (error) {
    return { success: false, stocks: {}, message: error.message };
  }
});

ipcMain.handle('search-articulo', async (event, codigo, listId) => {
  try {
    // Ambas llamadas en paralelo para no sumar tiempos de espera
    const [articleResponse, priceMap] = await Promise.all([
      net.fetch(`${API_URL}/obtenerArticulo/${codigo.toUpperCase()}`),
      fetchPriceList(listId).catch(() => ({}))
    ]);

    if (!articleResponse.ok) {
      return { success: false, articles: [], message: 'No se encontró el código' };
    }
    const articles = await articleResponse.json();
    if (!Array.isArray(articles) || articles.length === 0) {
      return { success: false, articles: [], message: 'No se encontraron artículos' };
    }

    const withStock = articles.filter(a => {
      const stock = a.CANT_STOCK || a.CANT_STO || a.stock || 0;
      return stock > 0;
    });

    if (withStock.length === 0) {
      return { success: false, articles: [], message: 'No hay artículos con stock' };
    }

    const result = withStock.map(a => {
      const code = a.COD_ARTICULO || a.codigo || '';
      const description = a.DESCRIP_ARTI || a.descripcion || a.d || '';
      const stock = a.CANT_STOCK || a.CANT_STO || a.stock || 0;
      let price = 0;
      const entry = priceMap[code.toUpperCase()];
      if (entry) price = Math.round(entry.pr * 1.21);
      return { code, description, stock, price };
    });

    return { success: true, articles: result };
  } catch (error) {
    return { success: false, articles: [], message: error.message };
  }
});

function readCotizacion() {
  try {
    if (fs.existsSync(cotizacionPath)) {
      return JSON.parse(fs.readFileSync(cotizacionPath, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return { items: [] };
}

function writeCotizacion(data) {
  try {
    fs.writeFileSync(cotizacionPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
}

ipcMain.handle('get-cotizacion', async () => {
  return readCotizacion();
});

ipcMain.handle('save-cotizacion', async (event, data) => {
  const success = writeCotizacion(data);
  return { success };
});

// ---- Conversations (casos por cliente) ----
const conversationsDir = path.join(__dirname, 'conversations');

function ensureConversationsDir() {
  if (!fs.existsSync(conversationsDir)) {
    fs.mkdirSync(conversationsDir, { recursive: true });
  }
}

function readConversationFile(phoneNumber) {
  const filePath = path.join(conversationsDir, `${phoneNumber}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    console.error(`Error reading conversation ${phoneNumber}:`, e);
  }
  return { phoneNumber, pushName: '', messages: [], notes: [] };
}

function writeConversationFile(phoneNumber, data) {
  ensureConversationsDir();
  const filePath = path.join(conversationsDir, `${phoneNumber}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

ipcMain.handle('get-conversations-list', async () => {
  ensureConversationsDir();
  try {
    const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.json'));
    const list = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(conversationsDir, file), 'utf-8');
        const data = JSON.parse(raw);
        const msgs = Array.isArray(data.messages) ? data.messages : [];
        const notes = Array.isArray(data.notes) ? data.notes : [];
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        list.push({
          phoneNumber: data.phoneNumber || file.replace('.json', ''),
          pushName: data.pushName || '',
          lastMessage: lastMsg ? lastMsg.text : '',
          lastMessageTime: lastMsg ? lastMsg.timestamp : '',
          messageCount: msgs.length,
          noteCount: notes.length,
        });
      } catch (e) { /* skip corrupted files */ }
    }
    list.sort((a, b) => {
      if (!a.lastMessageTime) return 1;
      if (!b.lastMessageTime) return -1;
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
    });
    return list;
  } catch (e) {
    console.error('Error reading conversations:', e);
    return [];
  }
});

ipcMain.handle('get-conversation', async (event, phoneNumber) => {
  return readConversationFile(phoneNumber);
});

ipcMain.handle('save-note', async (event, phoneNumber, noteText) => {
  try {
    const data = readConversationFile(phoneNumber);
    if (!Array.isArray(data.notes)) data.notes = [];
    data.notes.push({
      id: `note_${Date.now()}`,
      text: noteText,
      timestamp: new Date().toISOString(),
    });
    writeConversationFile(phoneNumber, data);
    return { success: true };
  } catch (e) {
    console.error('Error saving note:', e);
    return { success: false };
  }
});

ipcMain.handle('delete-note', async (event, phoneNumber, noteId) => {
  try {
    const data = readConversationFile(phoneNumber);
    if (!Array.isArray(data.notes)) return { success: false };
    data.notes = data.notes.filter(n => n.id !== noteId);
    writeConversationFile(phoneNumber, data);
    return { success: true };
  } catch (e) {
    return { success: false };
  }
});

const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.opus': 'audio/opus', '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};

// ---- Audio to Order (OpenAI Whisper + GPT) ----
const { audioToOrder } = require('./lib/audio-to-order.js');

// ---- Image to Order (OpenAI Vision) ----
const { imageToOrder } = require('./lib/image-to-order.js');

ipcMain.handle('audio-to-order', async (event, mediaPath, listId) => {
  try {
    if (!mediaPath || typeof mediaPath !== 'string') {
      return { success: false, error: 'Ruta de audio inválida' };
    }
    const normalized = path.normalize(path.resolve(mediaPath.trim()));
    const conversationsMedia = path.resolve(__dirname, 'conversations', 'media');
    const isInside = normalized.toLowerCase().startsWith(conversationsMedia.toLowerCase());
    if (!isInside || !fs.existsSync(normalized)) {
      return { success: false, error: 'Archivo de audio no encontrado o ruta no permitida' };
    }
    const id = listId != null ? String(listId) : '0';
    const result = await audioToOrder(normalized, id, { simple: true });
    return result;
  } catch (err) {
    console.error('Error en audio-to-order:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('image-to-order', async (event, mediaPath) => {
  try {
    if (!mediaPath || typeof mediaPath !== 'string') {
      return { success: false, error: 'Ruta de imagen inválida' };
    }
    const normalized = path.normalize(path.resolve(mediaPath.trim()));
    const conversationsMedia = path.resolve(__dirname, 'conversations', 'media');
    const isInside = normalized.toLowerCase().startsWith(conversationsMedia.toLowerCase());
    if (!isInside || !fs.existsSync(normalized)) {
      return { success: false, error: 'Archivo de imagen no encontrado o ruta no permitida' };
    }
    const result = await imageToOrder(normalized);
    return result;
  } catch (err) {
    console.error('Error en image-to-order:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('get-media-data-url', async (event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const normalized = path.resolve(filePath);
    if (!normalized.includes(path.join('conversations', 'media'))) return null;
    const buf = fs.readFileSync(normalized);
    const ext = path.extname(normalized).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    console.error('Error reading media file:', e);
    return null;
  }
});
