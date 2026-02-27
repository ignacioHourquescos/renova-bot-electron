const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');
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
let priceListCache = null;
let priceListCacheTime = 0;
const PRICE_CACHE_TTL = 60000;

async function fetchPriceList() {
  const now = Date.now();
  if (priceListCache && (now - priceListCacheTime) < PRICE_CACHE_TTL) {
    return priceListCache;
  }
  const response = await net.fetch(`${API_URL}/obtenerListadoArticulos`);
  const articles = await response.json();
  const map = {};
  for (const a of articles) {
    if (a.id && a.pr != null) {
      map[a.id.toUpperCase()] = { pr: Number(a.pr), d: a.d || '' };
    }
  }
  priceListCache = map;
  priceListCacheTime = now;
  return map;
}

ipcMain.handle('search-articulo', async (event, codigo) => {
  try {
    // Ambas llamadas en paralelo para no sumar tiempos de espera
    const [articleResponse, priceMap] = await Promise.all([
      net.fetch(`${API_URL}/obtenerArticulo/${codigo.toUpperCase()}`),
      fetchPriceList().catch(() => ({}))
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
