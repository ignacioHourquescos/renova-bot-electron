/**
 * Sube archivos a Firebase Storage y devuelve URLs públicas.
 * La app de pedidos puede usar estas URLs para ver imágenes y escuchar audios.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

let firebaseInitialized = false;

function initFirebase(): boolean {
  if (firebaseInitialized) return true;

  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

  if (!credPath || !bucketName) {
    return false;
  }

  const absPath = credPath.startsWith('/') || /^[A-Za-z]:/.test(credPath)
    ? credPath
    : resolve(process.cwd(), credPath);
  if (!existsSync(absPath)) {
    console.warn('⚠️ Firebase: archivo de credenciales no encontrado:', absPath);
    return false;
  }

  try {
    const { initializeApp, cert } = require('firebase-admin/app');
    const { getStorage } = require('firebase-admin/storage');

    const serviceAccount = JSON.parse(readFileSync(absPath, 'utf-8'));
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: bucketName,
    });
    firebaseInitialized = true;
    console.log('✅ Firebase Storage inicializado');
    return true;
  } catch (err) {
    console.error('❌ Error al inicializar Firebase:', err);
    return false;
  }
}

/**
 * Indica si Firebase Storage está configurado y disponible.
 */
export function isFirebaseStorageAvailable(): boolean {
  return initFirebase();
}

/**
 * Sube un archivo local a Firebase Storage y devuelve la URL de descarga.
 * @param localFilePath - Ruta del archivo en disco
 * @param remotePath - Ruta en el bucket (ej: pedidos_bot/2024/audio_xxx.ogg)
 * @returns URL pública para descargar el archivo, o null si falla
 */
export async function uploadToFirebaseStorage(
  localFilePath: string,
  remotePath: string,
): Promise<{ storageUrl: string; storagePath: string } | null> {
  if (!initFirebase()) return null;

  try {
    const { getStorage, getDownloadURL } = require('firebase-admin/storage');
    const bucket = getStorage().bucket();

    const file = bucket.file(remotePath);
    await bucket.upload(localFilePath, {
      destination: remotePath,
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: randomUUID(),
        },
      },
    });

    const storageUrl = await getDownloadURL(file);
    return {
      storageUrl,
      storagePath: remotePath,
    };
  } catch (err) {
    console.error('❌ Error al subir a Firebase Storage:', err);
    return null;
  }
}

/**
 * Genera un path único para un archivo de pedido.
 */
export function buildPedidoStoragePath(
  messageId: string,
  type: 'audio' | 'image',
  extension: string,
): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  return `pedidos_bot/${date}/${type}_${safeId}.${extension}`;
}
