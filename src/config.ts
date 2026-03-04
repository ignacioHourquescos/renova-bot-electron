import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

/**
 * Item de categoría: puede ser un string simple o un objeto con código y descuento.
 * Los precios siempre se obtienen de la API en tiempo real.
 */
export interface CategoryItem {
  code: string;                    // Código de sistema
  shortTitle?: string | null;      // Título / Descripción corta
  quantity?: number | null;        // Cantidad
  discount?: number | null;
  fixedPrice?: number | null;
}

/**
 * Kit item: tiene una descripción y hasta 4 artículos cuyo precio sumado * 1.21 = precio del kit.
 */
export interface KitItem {
  description: string;
  articles: string[];
}

export function isKitItem(item: any): item is KitItem {
  return typeof item === 'object' && item !== null && Array.isArray(item.articles);
}

/**
 * BotConfig: mapa de categorías.
 * Key = nombre del comando (ej: "kits", "refrigerantes")
 * Value = array de strings, CategoryItem, o KitItem.
 */
export type BotConfig = Record<string, (string | CategoryItem | KitItem)[]>;

/** Extrae el código de un item (string o objeto). */
export function getItemCode(item: string | CategoryItem | KitItem): string {
  if (typeof item === 'string') return item;
  if (isKitItem(item)) return '';
  return item.code || '';
}

/**
 * Lee bot-config.json y devuelve la configuración.
 */
export function loadBotConfig(): BotConfig {
  try {
    const configPath = resolve('./bot-config.json');
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw);
      const result: BotConfig = {};
      for (const [key, value] of Object.entries(config)) {
        if (Array.isArray(value)) {
          result[key] = value as (string | CategoryItem)[];
        }
      }
      return Object.keys(result).length > 0 ? result : {};
    }
  } catch (error) {
    console.error('Error al leer bot-config.json:', error);
  }
  return {};
}
