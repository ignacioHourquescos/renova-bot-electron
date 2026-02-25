import { CategoryItem, getItemCode } from './config.js';

const API_URL = 'https://renovaapi-production.up.railway.app';

// ─── Caché de precios (se renueva cada 60s) ─────────────────────────────────
interface PriceEntry { pr: number; d: string; }
let priceCache: Map<string, PriceEntry> | null = null;
let priceCacheTime = 0;
const CACHE_TTL_MS = 60_000; // 1 minuto

/**
 * Obtiene el mapa de precios de la API. Cachea por 60 segundos.
 */
async function fetchPriceMap(): Promise<Map<string, PriceEntry>> {
  const now = Date.now();
  if (priceCache && (now - priceCacheTime) < CACHE_TTL_MS) {
    return priceCache;
  }

  // console.log('📡 Consultando precios a la API...');
  const response = await fetch(`${API_URL}/obtenerListadoArticulos`);
  const articles = (await response.json()) as any[];

  const map = new Map<string, PriceEntry>();
  for (const a of articles) {
    if (a.id && a.pr != null) {
      map.set(a.id.toUpperCase(), { pr: Number(a.pr), d: a.d || '' });
    }
  }

  priceCache = map;
  priceCacheTime = now;
  // console.log(`✅ ${map.size} precios cargados desde la API`);
  return map;
}

/**
 * Formatea un precio: sin decimales, miles separados por punto.
 * Ej: 38000 → "38.000", 25990.25 → "25.990"
 */
function formatPrice(price: number): string {
  // Redondear a entero y formatear con punto como separador de miles
  const rounded = Math.round(price);
  return rounded.toLocaleString('de-DE');
}

/**
 * Calcula el precio final de un item:
 * pr × 1.21 (IVA) - descuento% si tiene.
 */
function calcFinalPrice(pr: number, discount: number | null | undefined): number {
  const conIva = pr * 1.21;
  if (discount != null && discount > 0) {
    return conIva * (1 - discount / 100);
  }
  return conIva;
}

// ─── Constantes de formato ────────────────────────────────────────────────
const SEPARATOR = ' - ';      // separador fijo

interface PriceRow {
  desc: string;               // Descripción / Título
  price: string;              // Precio
}

/**
 * Formatea una lista de {desc, price} para WhatsApp.
 *
 * Formato: `[descripción]` (arriba con fondo gris)
 *          [precio] (abajo, texto normal)
 * - Descripción primero: en código inline (backticks simples) con fondo gris
 * - Precio después: con $ incluido, texto normal, en línea siguiente
 */
function formatWhatsAppPriceList(rows: PriceRow[]): string {
  if (rows.length === 0) return '';

  // Normalizar precios (asegurar que tengan $)
  const normalizedRows = rows.map(row => {
    let price = row.price;
    if (!price.startsWith('$')) {
      price = '$' + price;
    }
    return { 
      desc: row.desc || '',
      price
    };
  });

  const lines: string[] = [];
  for (const row of normalizedRows) {
    // Construir: descripción arriba (código inline), precio abajo
    lines.push(`\`${row.desc}\``);
    lines.push(row.price);
  }
  return lines.join('\n');
}

/**
 * Formatea los precios de una categoría.
 * Llama a la API para obtener precios en tiempo real.
 * Genera mensaje con columnas alineadas en fuente monoespaciada.
 */
export async function formatCategory(categoryName: string, items: (string | CategoryItem)[]): Promise<string> {
  // Intentar cargar precios de la API
  let priceMap: Map<string, PriceEntry> | null = null;
  try {
    priceMap = await fetchPriceMap();
  } catch (error) {
    console.error('No se pudo consultar la API:', error);
  }

  // Estructura: secciones separadas por headers
  interface Section {
    header: string | null;
    rows: PriceRow[];
  }

  const sections: Section[] = [];
  let currentSection: Section = { header: null, rows: [] };
  sections.push(currentSection);

  for (const item of items) {
    const code = getItemCode(item);
    const isObject = typeof item === 'object' && item !== null;

    // Encabezados de sección (>>NOMBRE)
    if (code.startsWith('>>')) {
      currentSection = { header: code.substring(2), rows: [] };
      sections.push(currentSection);
      continue;
    }

    const displayName = (isObject && item.shortTitle) ? item.shortTitle : code;
    const discount = isObject ? item.discount : null;
    const fixedPrice = isObject ? item.fixedPrice : null;

    let priceStr = 'Sin precio';

    // 1) Precio fijo definido en Electron
    if (fixedPrice != null && fixedPrice > 0) {
      priceStr = `$${formatPrice(fixedPrice)}`;
    }
    // 2) Precio de la API en tiempo real
    else if (priceMap) {
      const entry = priceMap.get(code.toUpperCase());
      if (entry) {
        const precio = calcFinalPrice(entry.pr, discount);
        priceStr = `$${formatPrice(precio)}`;
      }
    }

    currentSection.rows.push({ 
      desc: displayName,
      price: priceStr
    });
  }

  // Armar mensaje final
  const title = categoryName.toUpperCase();
  const parts: string[] = [];
  
  // Agregar encabezado: "Precio" y título en negrita
  parts.push(`*Precio* *${title}*`);

  for (const section of sections) {
    if (section.rows.length === 0 && !section.header) continue;
    if (section.header) {
      parts.push(`\n${section.header}`);
    }
    if (section.rows.length > 0) {
      parts.push(formatWhatsAppPriceList(section.rows));
    }
  }

  return parts.join('\n');
}
