import { WASocket, DisconnectReason } from '@whiskeysockets/baileys';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { getPhoneNumber, getMessageText, getSenderPhoneNumber } from './helpers.js';
import { downloadMedia, isMediaMessage } from './media.js';
import { formatCategory, buscarCodigo, consultarCosto, formatCotizacion } from './commands.js';
import { loadBotConfig } from './config.js';
import { sendPedido, formatClientPhone, fileToBase64, type PedidoPayload } from './pedidos-api.js';
import {
  isFirebaseStorageAvailable,
  uploadToFirebaseStorage,
  buildPedidoStoragePath,
} from './firebase-storage.js';

const CONVERSATIONS_DIR = resolve(process.cwd(), 'conversations');
const CONVERSATION_MSG_TAG = 'CONVERSATION_MSG';

// ─── Flujo de pedidos (orden flexible: nombre o media primero) ─────────────────
interface PedidoFlowState {
  clientName?: string;
  content?: PedidoPayload['content'];
}

const pedidoFlowState = new Map<string, PedidoFlowState>();
const PEDIDO_FLOW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

const PEDIDOS_WHITELIST = (process.env.PEDIDOS_WHITELIST_NUMBERS ?? '5491140565047,5491165106333')
  .split(',')
  .map((n) => n.trim().replace(/\D/g, ''))
  .filter(Boolean);

function isPedidoAllowed(phoneNumber: string): boolean {
  if (PEDIDOS_WHITELIST.length === 0) return true;
  const normalized = phoneNumber.replace(/\D/g, '');
  return PEDIDOS_WHITELIST.some(
    (allowed) => normalized === allowed || normalized.endsWith(allowed) || allowed.endsWith(normalized),
  );
}

function getPedidoFlow(phoneNumber: string): PedidoFlowState | undefined {
  return pedidoFlowState.get(phoneNumber);
}

function setPedidoFlow(phoneNumber: string, state: PedidoFlowState | null): void {
  if (state) {
    pedidoFlowState.set(phoneNumber, state);
    setTimeout(() => pedidoFlowState.delete(phoneNumber), PEDIDO_FLOW_TIMEOUT_MS);
  } else {
    pedidoFlowState.delete(phoneNumber);
  }
}

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

  // Comando busco.[código]
  if (lower.startsWith('busco.')) {
    const codigo = text.substring(6).trim();
    if (codigo) {
      const result = await buscarCodigo(codigo);
      await sendSafe(sock, from, { text: result });
      return true;
    } else {
      await sendSafe(sock, from, { text: '❌ Por favor, especifica un código. Ejemplo: busco.CF9323' });
      return true;
    }
  }

  // Comando costo.[código]
  if (lower.startsWith('costo.')) {
    const codigo = text.substring(6).trim();
    if (codigo) {
      const result = await consultarCosto(codigo);
      await sendSafe(sock, from, { text: result });
      return true;
    } else {
      await sendSafe(sock, from, { text: '❌ Por favor, especifica un código. Ejemplo: costo.CF9323' });
      return true;
    }
  }

  // Comando .pedido → iniciar flujo guiado (orden flexible: nombre o media primero)
  if (lower === '.pedido' || lower === 'pedido') {
    if (!isPedidoAllowed(senderInfo)) return false;
    setPedidoFlow(senderInfo, {});
    await sendSafe(sock, from, { text: 'Ingrese nombre de Cliente ¿Detalle pedido?' });
    return true;
  }

  // Comando .coti → enviar cotización armada en Electron
  if (lower === '.coti') {
    const cotiText = formatCotizacion();
    if (cotiText) {
      await sendSafe(sock, from, { text: cotiText });
    } else {
      await sendSafe(sock, from, { text: '❌ No hay cotización armada. Armala desde el panel de Electron.' });
    }
    return true;
  }

  // Comandos dinámicos de categorías (desde bot-config.json)
  if (lower.startsWith('.')) {
    const config = loadBotConfig();
    const cmdName = lower.substring(1);
    for (const [category, items] of Object.entries(config)) {
      if (cmdName === category.toLowerCase()) {
        const result = await formatCategory(category, items);
        if (result.imageBuffer) {
          await sendSafe(sock, from, { image: result.imageBuffer });
        } else {
          await sendSafe(sock, from, { text: result.text });
        }
        return true;
      }
    }
  }

  return false;
}

// ─── Handler de mensajes ────────────────────────────────────────────────────
export function registerMessageHandler(sock: WASocket) {
  sock.ev.on('messaging-history.set', ({ messages: msgs }) => {
    for (const msg of msgs) {
      cacheMessage(msg);
    }
    console.log(`📦 Historial recibido: ${msgs.length} mensajes cacheados (total en caché: ${messageCache.size})`);
  });

  sock.ev.on('messages.upsert', async (m) => {
    // Cachear TODOS los mensajes del batch
    for (const msg of m.messages) {
      cacheMessage(msg);
    }

    // Procesar cada mensaje del batch (incluye history/sync para backfill de media)
    let firstMessageCommandCheck = false;
    let firstProcessedForAutoReply = false;
    for (const message of m.messages) {
      if (!message?.key?.id) continue;

      const isGroup = message.key.remoteJid?.endsWith('@g.us');
      const isBroadcast = message.key.remoteJid?.includes('@broadcast');
      const isFromMe = message.key.fromMe;
      const from = message.key.remoteJid || '';
      const phoneNumber = await getSenderPhoneNumber(message, sock);
      const messageId = message.key.id || 'unknown';
      const messageText = getMessageText(message.message);

      // Solo guardar en conversaciones: mensajes de clientes en chats individuales
      if (isFromMe || isGroup || isBroadcast) continue;

      // Deduplicar solo para notify
      if (m.type === 'notify') {
        const msgId = `${message.key.remoteJid}_${message.key.id}`;
        if (isDuplicate(msgId)) continue;
      }

      // ─── Auto-activar flujo de pedidos al recibir imagen o audio (sin .pedido) ─
      const flowBefore = getPedidoFlow(phoneNumber);
      const msgContent = message.message;
      const isImageOrAudio = msgContent && (msgContent.imageMessage || msgContent.audioMessage);
      if (!flowBefore && isImageOrAudio && msgContent && isPedidoAllowed(phoneNumber)) {
        const mediaDir = join(CONVERSATIONS_DIR, 'media', phoneNumber);
        const filePath = await downloadMedia(message, phoneNumber, messageId, sock, mediaDir);
        if (filePath) {
          const ct = msgContent.imageMessage ? 'image' : 'audio';
          const ext = filePath.split('.').pop()?.toLowerCase() || (ct === 'audio' ? 'ogg' : 'jpg');
          let content: PedidoPayload['content'];
          if (isFirebaseStorageAvailable()) {
            const remotePath = buildPedidoStoragePath(messageId, ct, ext);
            const uploaded = await uploadToFirebaseStorage(filePath, remotePath);
            if (uploaded) {
              content = { type: ct, storageUrl: uploaded.storageUrl, storagePath: uploaded.storagePath };
            } else {
              const b64 = fileToBase64(filePath);
              content = { type: ct, dataBase64: b64?.data ?? undefined, mimeType: b64?.mimeType ?? 'application/octet-stream' };
            }
          } else {
            const b64 = fileToBase64(filePath);
            content = { type: ct, dataBase64: b64?.data ?? undefined, mimeType: b64?.mimeType ?? 'application/octet-stream' };
          }
          setPedidoFlow(phoneNumber, { content });
          await sendSafe(sock, from, { text: 'Ingrese nombre de Cliente' });
          continue;
        }
        await sendSafe(sock, from, { text: '❌ No pude descargar el archivo. Intentá reenviarlo.' });
        continue;
      }

      // ─── Flujo de pedidos (orden flexible: nombre o media primero) ───────────
      const flow = getPedidoFlow(phoneNumber);
      if (flow) {
        const lowerText = messageText.toLowerCase().trim();
        if (lowerText === 'cancelar' || lowerText === 'cancel') {
          setPedidoFlow(phoneNumber, null);
          await sendSafe(sock, from, { text: '❌ Pedido cancelado.' });
          continue;
        }

        const hasName = !!flow.clientName;
        const hasContent = !!flow.content;

        // Procesar media a content (helper inline)
        async function processMediaToContent(): Promise<PedidoPayload['content'] | null> {
          if (!message.message || !isMediaMessage(message.message)) return null;
          const mediaDir = join(CONVERSATIONS_DIR, 'media', phoneNumber);
          const filePath = await downloadMedia(message, phoneNumber, messageId, sock, mediaDir);
          if (!filePath) return null;
          const ct = message.message.imageMessage ? 'image' : message.message.audioMessage ? 'audio' : 'image';
          const ext = filePath.split('.').pop()?.toLowerCase() || (ct === 'audio' ? 'ogg' : 'jpg');
          if (isFirebaseStorageAvailable()) {
            const remotePath = buildPedidoStoragePath(messageId, ct as 'audio' | 'image', ext);
            const uploaded = await uploadToFirebaseStorage(filePath, remotePath);
            if (uploaded) {
              return { type: ct as 'image' | 'audio', storageUrl: uploaded.storageUrl, storagePath: uploaded.storagePath };
            }
          }
          const b64 = fileToBase64(filePath);
          return {
            type: ct as 'image' | 'audio',
            dataBase64: b64?.data ?? undefined,
            mimeType: b64?.mimeType ?? 'application/octet-stream',
          };
        }

        // Caso 1: No tenemos nada aún → aceptar nombre O media
        if (!hasName && !hasContent) {
          if (message.message && isMediaMessage(message.message)) {
            const content = await processMediaToContent();
            if (!content) {
              await sendSafe(sock, from, { text: '❌ No pude descargar el archivo. Intentá de nuevo.' });
              continue;
            }
            setPedidoFlow(phoneNumber, { content });
            await sendSafe(sock, from, { text: 'Ingrese nombre de Cliente' });
            continue;
          }
          const text = messageText.trim();
          if (!text) {
            await sendSafe(sock, from, { text: 'Ingrese nombre de Cliente ¿Detalle pedido?' });
            continue;
          }
          setPedidoFlow(phoneNumber, { clientName: text });
          await sendSafe(sock, from, { text: '¿Detalle pedido?' });
          continue;
        }

        // Caso 2: Tenemos nombre, falta contenido
        if (hasName && !hasContent) {
          let content: PedidoPayload['content'] | null = null;
          if (message.message && isMediaMessage(message.message)) {
            content = await processMediaToContent();
            if (!content) {
              await sendSafe(sock, from, { text: '❌ No pude descargar el archivo. Intentá de nuevo.' });
              continue;
            }
          } else {
            const text = messageText.trim();
            if (!text) {
              await sendSafe(sock, from, { text: '¿Detalle pedido?' });
              continue;
            }
            content = { type: 'text', text };
          }
          const rawTs = message.messageTimestamp;
          const msgTs = rawTs ? (typeof rawTs === 'number' ? rawTs : Number(rawTs)) : undefined;
          const payload: PedidoPayload = {
            messageId,
            clientPhone: formatClientPhone(phoneNumber),
            content,
            timestamp: msgTs ? Math.floor(msgTs) : undefined,
            metadata: { clientName: flow.clientName || '', pushName: message.pushName || '' },
          };
          const result = await sendPedido(payload);
          setPedidoFlow(phoneNumber, null);
          if (result.success) {
            await sendSafe(sock, from, { text: 'Pedido ingresado a sistema correctamente' });
          } else {
            await sendSafe(sock, from, { text: `❌ Error al enviar el pedido: ${result.error || 'Error desconocido'}` });
          }
          continue;
        }

        // Caso 3: Tenemos contenido, falta nombre
        if (hasContent && !hasName) {
          if (message.message && isMediaMessage(message.message)) {
            // Nueva media → reemplazar contenido y pedir nombre de nuevo
            const newContent = await processMediaToContent();
            if (newContent) {
              setPedidoFlow(phoneNumber, { content: newContent });
              await sendSafe(sock, from, { text: 'Ingrese nombre de Cliente' });
            } else {
              await sendSafe(sock, from, { text: 'Ingrese nombre de Cliente' });
            }
            continue;
          }
          const clientName = messageText.trim();
          if (!clientName) {
            await sendSafe(sock, from, { text: 'Ingrese nombre de Cliente' });
            continue;
          }
          const rawTs = message.messageTimestamp;
          const msgTs = rawTs ? (typeof rawTs === 'number' ? rawTs : Number(rawTs)) : undefined;
          const payload: PedidoPayload = {
            messageId,
            clientPhone: formatClientPhone(phoneNumber),
            content: flow.content!,
            timestamp: msgTs ? Math.floor(msgTs) : undefined,
            metadata: { clientName, pushName: message.pushName || '' },
          };
          const result = await sendPedido(payload);
          setPedidoFlow(phoneNumber, null);
          if (result.success) {
            await sendSafe(sock, from, { text: 'Pedido ingresado a sistema correctamente' });
          } else {
            await sendSafe(sock, from, { text: `❌ Error al enviar el pedido: ${result.error || 'Error desconocido'}` });
          }
          continue;
        }
      }

      // Comandos: solo para el primer mensaje notify procesado
      if (m.type === 'notify' && !firstMessageCommandCheck) {
        firstMessageCommandCheck = true;
        const senderInfo = phoneNumber;
        const wasCommand = await handleCommand(sock, from, messageText, senderInfo);
        if (wasCommand) return;
      }

      // Descargar media si existe (Baileys requiere el mensaje completo con key y message)
      let media: { type: 'image' | 'audio' | 'video' | 'document'; path: string } | undefined;
      if (message.message && isMediaMessage(message.message)) {
        const mediaDir = join(CONVERSATIONS_DIR, 'media', phoneNumber);
        const filePath = await downloadMedia(message, phoneNumber, messageId, sock, mediaDir);
        if (filePath) {
          const ct = message.message.imageMessage ? 'image'
            : message.message.audioMessage ? 'audio'
            : message.message.videoMessage ? 'video'
            : 'document';
          media = { type: ct as any, path: filePath };
        }
      }

      const rawTs = message.messageTimestamp;
      const ts = rawTs ? (typeof rawTs === 'number' ? rawTs : Number(rawTs)) : undefined;
      const pushName = message.pushName || '';
      const savedMsg = appendConversationMessage(phoneNumber, pushName, messageText, ts, messageId, media);

      if (m.type === 'notify') {
        const payload = { phoneNumber, pushName, message: savedMsg };
        console.log(`[${CONVERSATION_MSG_TAG}]${JSON.stringify(payload)}[/${CONVERSATION_MSG_TAG}]`);
      }

      // Respuestas automáticas solo para el primer mensaje notify procesado
      if (m.type === 'notify' && !firstProcessedForAutoReply) {
        firstProcessedForAutoReply = true;
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
    }
  });
}

// ─── Handler de reacciones ──────────────────────────────────────────────────
const messageCache = new Map<string, any>();
const CACHE_TTL_MS = 24 * 3_600_000;

export function cacheMessage(message: any) {
  if (!message?.key?.id || !message?.key?.remoteJid) return;
  const key = `${message.key.remoteJid}_${message.key.id}`;
  messageCache.set(key, message);
  setTimeout(() => messageCache.delete(key), CACHE_TTL_MS);
}

export function getCachedMessage(jid: string, id: string): any | undefined {
  return messageCache.get(`${jid}_${id}`);
}

// ─── Conversaciones por cliente ──────────────────────────────────────────────

interface ConversationMessage {
  id: string;
  text: string;
  timestamp: string;
  mediaType?: 'image' | 'audio' | 'video' | 'document';
  mediaPath?: string;
}

interface ConversationFile {
  phoneNumber: string;
  pushName: string;
  messages: ConversationMessage[];
  notes: Array<{ id: string; text: string; timestamp: string }>;
}

function readConversation(phoneNumber: string): ConversationFile {
  const filePath = join(CONVERSATIONS_DIR, `${phoneNumber}.json`);
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      return {
        phoneNumber: data.phoneNumber || phoneNumber,
        pushName: data.pushName || '',
        messages: Array.isArray(data.messages) ? data.messages : [],
        notes: Array.isArray(data.notes) ? data.notes : [],
      };
    } catch { /* corrupted file, start fresh */ }
  }
  return { phoneNumber, pushName: '', messages: [], notes: [] };
}

function writeConversation(phoneNumber: string, data: ConversationFile) {
  if (!existsSync(CONVERSATIONS_DIR)) {
    mkdirSync(CONVERSATIONS_DIR, { recursive: true });
  }
  writeFileSync(join(CONVERSATIONS_DIR, `${phoneNumber}.json`), JSON.stringify(data, null, 2), 'utf-8');
}

function updateConversationMessageMedia(
  phoneNumber: string,
  messageId: string,
  media: { type: 'image' | 'audio' | 'video' | 'document'; path: string },
): boolean {
  const conv = readConversation(phoneNumber);
  const msgId = `msg_${messageId}`;
  const idx = conv.messages.findIndex(m => m.id === msgId);
  if (idx === -1 || conv.messages[idx].mediaPath) return false;
  conv.messages[idx].mediaType = media.type;
  conv.messages[idx].mediaPath = media.path;
  writeConversation(phoneNumber, conv);
  return true;
}

function appendConversationMessage(
  phoneNumber: string,
  pushName: string,
  text: string,
  messageTimestamp: number | undefined,
  messageId: string,
  media?: { type: 'image' | 'audio' | 'video' | 'document'; path: string },
): ConversationMessage {
  const conv = readConversation(phoneNumber);
  if (pushName && pushName !== conv.pushName) {
    conv.pushName = pushName;
  }

  const ts = messageTimestamp
    ? new Date(messageTimestamp * 1000).toISOString()
    : new Date().toISOString();

  const msg: ConversationMessage = {
    id: `msg_${messageId}`,
    text,
    timestamp: ts,
  };

  if (media) {
    msg.mediaType = media.type;
    msg.mediaPath = media.path;
  }

  const exists = conv.messages.some(m => m.id === msg.id);
  if (!exists) {
    conv.messages.push(msg);
    writeConversation(phoneNumber, conv);
  } else if (media) {
    // Actualizar media en mensaje existente si no tenía
    updateConversationMessageMedia(phoneNumber, messageId, media);
  }

  return msg;
}

export function registerReactionHandler(sock: WASocket) {
  sock.ev.on('messages.reaction', async (reactions) => {
    for (const reaction of reactions) {
      const { key, reaction: reactionData } = reaction;
      const reactionText = reactionData?.text || '👍';
      const messageJid = key?.remoteJid || '';

      const cacheKey = `${messageJid}_${key?.id || ''}`;
      const cached = messageCache.get(cacheKey);
      const senderJid = cached?.key?.participant || cached?.key?.remoteJid || messageJid;
      const originalText = cached?.message ? getMessageText(cached.message) : 'Mensaje no disponible';
      const phoneNumber = getPhoneNumber(senderJid);

      console.log(`\n⭐ REACCIÓN RECIBIDA:`);
      console.log(`   📱 Número: ${phoneNumber}`);
      console.log(`   😊 Reacción: ${reactionText}`);
      console.log(`   💬 Mensaje: "${originalText}"`);
    }
  });
}

