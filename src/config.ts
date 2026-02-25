import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

/**
 * Item de categoría: puede ser un string simple o un objeto con código y descuento.
 * Los precios siempre se obtienen de la API en tiempo real.
 */
export interface CategoryItem {
  code: string;                    // Código de sistema
  shortTitle?: string | null;      // Título / Descripción corta
  discount?: number | null;
  fixedPrice?: number | null;
}

/**
 * BotConfig: mapa de categorías.
 * Key = nombre del comando (ej: "kits", "refrigerantes")
 * Value = array de strings o CategoryItem.
 */
export type BotConfig = Record<string, (string | CategoryItem)[]>;

/** Extrae el código de un item (string o objeto). */
export function getItemCode(item: string | CategoryItem): string {
  if (typeof item === 'string') return item;
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
