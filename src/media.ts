import { downloadMediaMessage, getContentType, WASocket } from '@whiskeysockets/baileys';
import { resolve } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import pino from 'pino';

const logger = pino({ level: 'silent' });

const MIME_TO_EXT: Record<string, string> = {
  pdf: 'pdf',
  msword: 'doc',
  'vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'vnd.ms-excel': 'xls',
  'vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'vnd.ms-powerpoint': 'ppt',
  'vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  zip: 'zip',
  'x-rar-compressed': 'rar',
};

interface MediaTypeInfo {
  data: any;
  folder: string;
  defaultExt: string;
  label: string;
}

function getMediaTypeInfo(message: any): MediaTypeInfo | null {
  const contentType = getContentType(message);
  if (!contentType) return null;

  const map: Record<string, Omit<MediaTypeInfo, 'data'> & { key: string }> = {
    imageMessage:    { key: 'imageMessage',    folder: 'images',    defaultExt: 'jpg', label: 'Imagen' },
    documentMessage: { key: 'documentMessage', folder: 'documents', defaultExt: 'bin', label: 'Documento' },
    videoMessage:    { key: 'videoMessage',    folder: 'videos',    defaultExt: 'mp4', label: 'Video' },
    audioMessage:    { key: 'audioMessage',    folder: 'audios',    defaultExt: 'ogg', label: 'Audio' },
  };

  const info = map[contentType];
  if (!info) return null;

  return {
    data: message[info.key],
    folder: info.folder,
    defaultExt: info.defaultExt,
    label: info.label,
  };
}

function resolveExtension(mediaData: any, contentType: string, defaultExt: string): string {
  if (contentType === 'documentMessage') {
    const fileName = mediaData.fileName || '';
    if (fileName) {
      const lastDot = fileName.lastIndexOf('.');
      if (lastDot !== -1) return fileName.substring(lastDot + 1);
    }
  }

  const mimeType = mediaData.mimetype || '';
  if (mimeType) {
    const parts = mimeType.split('/');
    if (parts.length > 1) {
      let ext = parts[1].split(';')[0];
      if (contentType === 'documentMessage') {
        ext = MIME_TO_EXT[ext] || ext;
      }
      return ext || defaultExt;
    }
  }

  return defaultExt;
}

/**
 * Descarga y guarda un archivo multimedia recibido por WhatsApp.
 * @param fullMessage - Mensaje completo WAMessage { key, message } (requerido por Baileys)
 */
export async function downloadMedia(
  fullMessage: any,
  phoneNumber: string,
  messageId: string,
  sock: WASocket,
  outputDir?: string,
): Promise<string | null> {
  try {
    const messageContent = fullMessage?.message || fullMessage;
    const typeInfo = getMediaTypeInfo(messageContent);
    if (!typeInfo) return null;

    const contentType = getContentType(messageContent) || '';

    // Baileys requiere el mensaje completo con key y message
    const buffer = await downloadMediaMessage(
      fullMessage?.message ? fullMessage : { key: {}, message: messageContent },
      'buffer', {},
      { reuploadRequest: sock.updateMediaMessage, logger },
    );

    const mediaDir = outputDir || resolve('./downloads', typeInfo.folder);
    if (!existsSync(mediaDir)) {
      await mkdir(mediaDir, { recursive: true });
    }

    const extension = resolveExtension(typeInfo.data, contentType, typeInfo.defaultExt);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const originalName = contentType === 'documentMessage' && typeInfo.data.fileName
      ? `_${typeInfo.data.fileName.substring(0, typeInfo.data.fileName.lastIndexOf('.') > 0 ? typeInfo.data.fileName.lastIndexOf('.') : undefined)}`
      : '';
    const filename = `${phoneNumber}_${messageId}${originalName}_${timestamp}.${extension}`;
    const filepath = resolve(mediaDir, filename);

    await writeFile(filepath, buffer as Buffer);

    const fileSize = (buffer as Buffer).length;
    const sizeDisplay = fileSize > 1024 * 1024
      ? `${(fileSize / (1024 * 1024)).toFixed(2)} MB`
      : `${(fileSize / 1024).toFixed(2)} KB`;

    console.log(`📥 ${typeInfo.label} descargado: ${filepath}`);
    console.log(`   📏 Tamaño: ${sizeDisplay}`);

    return filepath;
  } catch (error) {
    console.error('❌ Error al descargar archivo:', error);
    return null;
  }
}

/**
 * Determina si un mensaje contiene media descargable.
 */
export function isMediaMessage(message: any): boolean {
  if (!message) return false;
  const contentType = getContentType(message);
  return ['imageMessage', 'documentMessage', 'videoMessage', 'audioMessage'].includes(contentType || '');
}



