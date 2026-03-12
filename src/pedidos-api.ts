/**
 * Módulo para enviar pedidos al sistema de gestión de pedidos.
 * Ver INSTRUCCIONES_BOT_PEDIDOS.md para el formato del API.
 */

import { readFileSync } from 'fs';

// Soporta URL completa (PEDIDOS_BOT_API_URL) o BASE + PATH
const API_URL_FULL = process.env.PEDIDOS_BOT_API_URL?.trim();
const BASE_URL = process.env.PEDIDOS_BOT_BASE_URL || 'http://localhost:4000';
const API_PATH = process.env.PEDIDOS_BOT_API_PATH || '/api/pedidos-bot';
const API_KEY = process.env.PEDIDOS_BOT_API_KEY;

const PEDIDOS_API_URL = API_URL_FULL
  ? API_URL_FULL.replace(/\/$/, '')
  : `${BASE_URL.replace(/\/$/, '')}${API_PATH.startsWith('/') ? API_PATH : `/${API_PATH}`}`;

// Log al cargar el módulo (para verificar que usa la URL correcta)
console.log('📡 API pedidos:', PEDIDOS_API_URL);

export interface PedidoPayload {
  messageId?: string;
  clientPhone?: string;
  content: {
    type: 'text' | 'audio' | 'image';
    text?: string;
    mediaUrl?: string;
    storageUrl?: string;
    storagePath?: string;
    /** Base64 del archivo cuando no hay URL (Baileys descarga localmente) */
    dataBase64?: string;
    mimeType?: string;
  };
  timestamp?: number;
  metadata?: Record<string, string>;
}

export interface PedidoResponse {
  success: boolean;
  id?: string;
  message?: string;
  error?: string;
  details?: string;
}

/**
 * Formatea el número para clientPhone (ej: +5491123456789).
 */
export function formatClientPhone(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.startsWith('54')) return `+${digits}`;
  if (digits.startsWith('9') && digits.length >= 10) return `+54${digits}`;
  return `+54${digits}`;
}

/**
 * Envía un pedido al endpoint /api/pedidos-bot.
 */
export async function sendPedido(payload: PedidoPayload): Promise<PedidoResponse> {
  const url = PEDIDOS_API_URL;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
    // Alternativa: headers['Authorization'] = `Bearer ${API_KEY}`;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    const data = (await res.json().catch(() => ({}))) as PedidoResponse & { error?: string };

    if (res.ok && res.status === 201) {
      return {
        success: true,
        id: data.id,
        message: data.message || 'Pedido recibido',
      };
    }

    if (res.status === 404) {
      console.warn(`⚠️ API no encontrada (404): ${url}`);
    }
    return {
      success: false,
      error: data.error || `HTTP ${res.status}`,
      details: data.details,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    const cause = err?.cause?.message || err?.cause?.code;
    console.error('❌ Error al enviar pedido:', msg, cause ? `(causa: ${cause})` : '', '| URL:', url);
    return {
      success: false,
      error: msg,
    };
  }
}

/**
 * Lee un archivo y lo convierte a base64.
 */
export function fileToBase64(filePath: string): { data: string; mimeType: string } | null {
  try {
    const buffer = readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
      ogg: 'audio/ogg',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      opus: 'audio/opus',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
    };
    const mimeType = mimeMap[ext] || 'application/octet-stream';
    return { data: base64, mimeType };
  } catch {
    return null;
  }
}
