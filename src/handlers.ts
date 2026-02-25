import { WASocket, DisconnectReason } from '@whiskeysockets/baileys';
import { getPhoneNumber, getMessageText } from './helpers.js';
import { downloadMedia, isMediaMessage } from './media.js';
import { formatCategory } from './commands.js';
import { loadBotConfig } from './config.js';

// ─── Deduplicación ──────────────────────────────────────────────────────────
const processedMessages = new Set<string>();
const DEDUP_TTL_MS = 60_000;

function isDuplicate(id: string): boolean {
  if (processedMessages.has(id)) return true;
  processedMessages.add(id);
  setTimeout(() => processedMessages.delete(id), DEDUP_TTL_MS);
  return false;
}

// ─── Enviar mensaje de forma segura ─────────────────────────────────────────
async function sendSafe(sock: WASocket, jid: string, message: any): Promise<boolean> {
  try {
    await sock.sendMessage(jid, message);
    return true;
  } catch (error: any) {
    if (
      error?.message?.includes('Connection Closed') ||
      error?.message?.includes('connection closed') ||
      error?.output?.statusCode === DisconnectReason.connectionClosed
    ) {
      console.log('⚠️ No se pudo enviar mensaje: conexión cerrada.');
      return false;
    }
    console.error('❌ Error al enviar mensaje:', error);
    return false;
  }
}

// ─── Router de comandos ─────────────────────────────────────────────────────
async function handleCommand(sock: WASocket, from: string, text: string, senderInfo: string): Promise<boolean> {
  const lower = text.toLowerCase().trim();

  // Comandos dinámicos de categorías (desde bot-config.json)
  if (lower.startsWith('.')) {
    const config = loadBotConfig();
    const cmdName = lower.substring(1);
    for (const [category, items] of Object.entries(config)) {
      if (cmdName === category.toLowerCase()) {
        // console.log(`📋 Consulta de .${category} de ${senderInfo}`);
        await sendSafe(sock, from, { text: `🔍 Consultando precios de ${category}...` });
        const result = await formatCategory(category, items);
        await sendSafe(sock, from, { text: result });
        return true;
      }
    }
  }

  return false;
}

// ─── Handler de mensajes ────────────────────────────────────────────────────
export function registerMessageHandler(sock: WASocket) {
  sock.ev.on('messages.upsert', async (m) => {
    const message = m.messages[0];
    if (!message?.key?.id) return;

    const msgId = `${message.key.remoteJid}_${message.key.id}`;
    if (isDuplicate(msgId)) return;

    if (m.type !== 'notify' && !(m.type === 'append' && message.key.fromMe)) return;

    const messageText = getMessageText(message.message);
    const from = message.key.remoteJid || '';
    const phoneNumber = getPhoneNumber(from);
    const messageId = message.key.id || 'unknown';
    const isFromMe = message.key.fromMe;

    // Logs reducidos - solo comandos importantes
    // if (isFromMe) {
    //   console.log(`📤 Mensaje enviado por ti: ${messageText}`);
    // } else {
    //   console.log(`📨 Mensaje de ${phoneNumber}: ${messageText}`);
    // }

    const senderInfo = isFromMe ? 'tu' : phoneNumber;

    // Ejecutar comando
    const wasCommand = await handleCommand(sock, from, messageText, senderInfo);
    if (wasCommand) return;

    // Solo para mensajes de otros
    if (!isFromMe) {
      if (message.message && isMediaMessage(message.message)) {
        console.log(`📎 Media detectado de ${phoneNumber}`);
        await downloadMedia(message.message, phoneNumber, messageId, sock);
      }

      const lower = messageText.toLowerCase();
      if (lower === 'hola' || lower === 'hi') {
        await sendSafe(sock, from, {
          text: '¡Hola! 👋 Soy un bot de WhatsApp creado con Baileys. ¿En qué puedo ayudarte?',
        });
      } else if (lower === 'ping') {
        await sendSafe(sock, from, { text: '🏓 Pong!' });
      } else if (lower.startsWith('echo ')) {
        await sendSafe(sock, from, { text: `Echo: ${messageText.substring(5)}` });
      }
    }
  });
}

// ─── Handler de reacciones ──────────────────────────────────────────────────
const messageCache = new Map<string, any>();
const CACHE_TTL_MS = 3_600_000;

export function cacheMessage(message: any) {
  if (!message?.key?.id || !message?.key?.remoteJid) return;
  const key = `${message.key.remoteJid}_${message.key.id}`;
  messageCache.set(key, message);
  setTimeout(() => messageCache.delete(key), CACHE_TTL_MS);
}

export function registerReactionHandler(sock: WASocket) {
  sock.ev.on('messages.reaction', async (reactions) => {
    for (const reaction of reactions) {
      const { key, reaction: reactionData } = reaction;
      const reactionText = reactionData?.text || '👍';
      const messageJid = key?.remoteJid || '';
      const phoneNumber = getPhoneNumber(messageJid);

      let originalText = 'Mensaje no disponible';
      const cacheKey = `${messageJid}_${key?.id || ''}`;
      const cached = messageCache.get(cacheKey);
      if (cached?.message) {
        originalText = getMessageText(cached.message);
      }

      console.log(`\n⭐ REACCIÓN RECIBIDA:`);
      console.log(`   📱 Número: ${phoneNumber}`);
      console.log(`   😊 Reacción: ${reactionText}`);
      console.log(`   💬 Mensaje: "${originalText}"`);
    }
  });
}

