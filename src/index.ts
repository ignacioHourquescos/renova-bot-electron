/**
 * Renova Bot — Entry Point
 *
 * Estructura del proyecto (7 archivos):
 *   src/
 *     index.ts          ← este archivo (entrada)
 *     connection.ts     ← conexión a WhatsApp + QR + reconexión
 *     config.ts         ← carga de bot-config.json + tipos
 *     handlers.ts       ← handler de mensajes + reacciones
 *     commands.ts       ← formato de categorías + consulta API de precios
 *     media.ts          ← descarga de multimedia
 *     helpers.ts        ← funciones utilitarias
 *     pedidos-api.ts    ← envío de pedidos al sistema externo
 *
 * Los precios se obtienen en tiempo real de la API (con caché de 60s).
 * bot-config.json define categorías, items, títulos cortos y descuentos.
 */

import 'dotenv/config';
import { connectToWhatsApp } from './connection.js';

connectToWhatsApp().catch((err) => {
  console.error('Error al iniciar el bot:', err);
  process.exit(1);
});
