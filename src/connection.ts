import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { resolve } from 'path';
import { registerMessageHandler, registerReactionHandler, getCachedMessage } from './handlers.js';

const logger = pino({ level: 'silent' });

let currentSock: WASocket | null = null;

/**
 * Desconecta limpiamente de WhatsApp (logout + end).
 */
async function gracefulShutdown() {
  if (!currentSock) {
    process.exit(0);
    return;
  }

  console.log('🔌 Desconectando de WhatsApp...');
  try {
    await currentSock.logout();
    console.log('✅ Sesión cerrada correctamente en WhatsApp.');
  } catch (err) {
    try {
      currentSock.end(undefined);
    } catch { /* ignorar */ }
    console.log('⚠️ Sesión finalizada (forzada).');
  }
  currentSock = null;

  setTimeout(() => process.exit(0), 500);
}

/**
 * Escucha stdin para recibir la señal SHUTDOWN de Electron.
 */
function listenForShutdown() {
  if (!process.stdin.readable) return;

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (data: string) => {
    const cmd = data.toString().trim();
    if (cmd === 'SHUTDOWN') {
      gracefulShutdown();
    }
  });
  process.stdin.resume();
}

/**
 * Conecta al bot de WhatsApp, registra los handlers y maneja reconexión.
 */
export async function connectToWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(resolve('./auth_info'));
  const { version } = await fetchLatestBaileysVersion();

  console.log(`Usando Baileys versión ${version.join('.')}`);

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
    getMessage: async (key) => {
      const cached = getCachedMessage(key.remoteJid || '', key.id || '');
      return cached?.message || undefined;
    },
  });

  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Escanea el código QR con tu WhatsApp:\n');
      console.log(`[QR_CODE_STRING]${qr}[/QR_CODE_STRING]`);
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (statusCode === 401) {
        console.log('\n❌ ERROR: Credenciales inválidas o sesión expirada.');
        console.log('📱 Solución:');
        console.log('   1. Ejecuta "resetear-sesion.bat"');
        console.log('   2. O elimina la carpeta "auth_info"');
        console.log('   3. Luego ejecuta "ejecutar-bot.bat" nuevamente\n');
        return;
      }

      if (statusCode === 440) {
        console.log('\n⚠️ Conflicto de sesión detectado.');
        console.log('💡 Detené todas las instancias y reiniciá el bot.\n');
      }

      console.log('Conexión cerrada:', lastDisconnect?.error, '| Reconectando:', shouldReconnect);

      if (shouldReconnect) {
        console.log('⏳ Esperando 3 segundos antes de reconectar...\n');
        setTimeout(() => connectToWhatsApp(), 3000);
      }
    } else if (connection === 'open') {
      console.log('✅ Bot conectado exitosamente a WhatsApp!');
    }
  });

  registerMessageHandler(sock);
  registerReactionHandler(sock);
}

// Escuchar señal de apagado
listenForShutdown();
