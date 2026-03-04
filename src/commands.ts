import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { CategoryItem, KitItem, getItemCode, isKitItem } from './config.js';
import { generatePriceListImage, SectionImg, generateKitPriceListImage, generateKitPriceListImageWithSections, KitPriceRowImg, KitSectionImg } from './price-image.js';

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
    // Construir: descripción arriba (código inline), precio abajo en negrita
    lines.push(`\`${row.desc}\``);
    lines.push(`*${row.price}*`);
  }
  return lines.join('\n');
}

export interface CategoryResult {
  imageBuffer: Buffer | null;
  text: string;
}

/**
 * Formatea los precios de una categoría.
 * Genera imagen PNG + texto de fallback.
 */
/**
 * Calcula el precio sumando pr de los primeros N artículos del kit * 1.21.
 * Devuelve 0 si ningún artículo tiene precio.
 */
function calcKitTierPrice(articles: string[], count: number, priceMap: Map<string, PriceEntry>): number {
  let total = 0;
  let found = false;
  for (let i = 0; i < Math.min(count, articles.length); i++) {
    const code = articles[i]?.trim();
    if (!code) continue;
    const entry = priceMap.get(code.toUpperCase());
    if (entry) {
      total += entry.pr;
      found = true;
    }
  }
  return found ? Math.ceil((total * 1.21) / 10) * 10 : 0;
}

export async function formatCategory(categoryName: string, items: (string | CategoryItem | KitItem)[]): Promise<CategoryResult> {
  let priceMap: Map<string, PriceEntry> | null = null;
  try {
    priceMap = await fetchPriceMap();
  } catch (error) {
    console.error('No se pudo consultar la API:', error);
  }

  // Detect if this category has kit items
  const hasKits = items.some(i => isKitItem(i));

  if (hasKits && priceMap) {
    return formatKitCategory(categoryName, items, priceMap);
  }

  interface Section {
    header: string | null;
    rows: PriceRow[];
  }

  const sections: Section[] = [];
  let currentSection: Section = { header: null, rows: [] };
  sections.push(currentSection);

  for (const item of items) {
    if (isKitItem(item)) continue;

    const code = getItemCode(item);
    const isObject = typeof item === 'object' && item !== null;

    if (code.startsWith('>>')) {
      currentSection = { header: code.substring(2), rows: [] };
      sections.push(currentSection);
      continue;
    }

    const displayName = (isObject && (item as CategoryItem).shortTitle) ? (item as CategoryItem).shortTitle! : code;
    const discount = isObject ? (item as CategoryItem).discount : null;
    const fixedPrice = isObject ? (item as CategoryItem).fixedPrice : null;

    let priceStr = 'Sin precio';

    if (fixedPrice != null && fixedPrice > 0) {
      priceStr = `$${formatPrice(fixedPrice)}`;
    } else if (priceMap) {
      const entry = priceMap.get(code.toUpperCase());
      if (entry) {
        const precio = calcFinalPrice(entry.pr, discount);
        priceStr = `$${formatPrice(precio)}`;
      }
    }

    currentSection.rows.push({ desc: displayName, price: priceStr });
  }

  // --- Text fallback ---
  const parts: string[] = [];
  let isFirstSection = true;
  for (const section of sections) {
    if (section.rows.length === 0 && !section.header) continue;
    if (section.header) {
      if (!isFirstSection) { parts.push(''); parts.push(''); }
      parts.push(`*${section.header}*`);
      parts.push('');
      isFirstSection = false;
    }
    if (section.rows.length > 0) {
      parts.push(formatWhatsAppPriceList(section.rows));
      isFirstSection = false;
    }
  }
  const text = parts.join('\n');

  // --- Image ---
  let imageBuffer: Buffer | null = null;
  try {
    const imgSections: SectionImg[] = sections
      .filter(s => s.rows.length > 0 || s.header)
      .map(s => ({ header: s.header, rows: s.rows }));

    if (imgSections.some(s => s.rows.length > 0)) {
      imageBuffer = generatePriceListImage(categoryName, imgSections);
    }
  } catch (err) {
    console.error('Error generando imagen de precios:', err);
  }

  return { imageBuffer, text };
}

/** Detecta si un ítem es un subtítulo (>>CLASICOS, >>CAMIONETAS, o objeto solo con code tipo CLASICOS). */
function getKitSubtitle(item: string | CategoryItem | KitItem): string | null {
  if (typeof item === 'string') {
    if (item.startsWith('>>')) return item.slice(2).trim() || null;
    return null;
  }
  if (typeof item !== 'object' || item === null || isKitItem(item)) return null;
  const c = item as CategoryItem;
  const code = (c.code || '').trim();
  if (!code) return null;
  if (code.startsWith('>>')) return code.slice(2).trim() || null;
  // Objeto con solo code (sin shortTitle/descuento/precio) = subtítulo legacy (ej. CLASICOS en config)
  const hasPrice = c.discount != null && c.discount !== 0 || c.fixedPrice != null && c.fixedPrice !== 0;
  const hasShortTitle = (c.shortTitle || '').trim() !== '';
  if (!hasPrice && !hasShortTitle) return code;
  return null;
}

/**
 * Formatea una categoría que contiene kits con 3 columnas de precio.
 * Básico (arts 1+2), Completo (arts 1+2+3), Full (arts 1+2+3+4).
 * Los ítems con ">>" (ej. >>CLASICOS, >>CAMIONETAS) se usan como subtítulos en el mensaje y en la imagen.
 * Kits sin precio se omiten.
 */
async function formatKitCategory(
  categoryName: string,
  items: (string | CategoryItem | KitItem)[],
  priceMap: Map<string, PriceEntry>
): Promise<CategoryResult> {
  const sections: KitSectionImg[] = [];
  let currentSection: KitSectionImg = { header: null, rows: [] };

  for (const item of items) {
    const subtitle = getKitSubtitle(item);
    if (subtitle !== null) {
      if (currentSection.rows.length > 0) {
        sections.push(currentSection);
        currentSection = { header: null, rows: [] };
      }
      currentSection.header = subtitle;
      continue;
    }

    if (!isKitItem(item)) continue;
    const arts = (item.articles || []).filter(c => c && c.trim());
    if (arts.length === 0) continue;

    const basico   = calcKitTierPrice(item.articles, 2, priceMap);
    const completo = calcKitTierPrice(item.articles, 3, priceMap);
    const full     = calcKitTierPrice(item.articles, 4, priceMap);
    if (basico === 0 && completo === 0 && full === 0) continue;

    currentSection.rows.push({
      desc: item.description || 'Kit',
      basico:   basico > 0   ? `$${formatPrice(basico)}`   : '-',
      completo: completo > 0 ? `$${formatPrice(completo)}` : '-',
      full:     full > 0     ? `$${formatPrice(full)}`     : '-',
    });
  }
  if (currentSection.rows.length > 0 || currentSection.header) {
    sections.push(currentSection);
  }

  const allRows = sections.flatMap(s => s.rows);

  // --- Text fallback (con subtítulos) ---
  const lines: string[] = [];
  if (allRows.length > 0) {
    lines.push(`*${categoryName.toUpperCase()}*`);
    lines.push('');
    for (const sec of sections) {
      if (sec.header) {
        lines.push(`*${sec.header.toUpperCase()}*`);
        lines.push('');
      }
      for (const row of sec.rows) {
        lines.push(`\`${row.desc}\``);
        const prices: string[] = [];
        if (row.basico !== '-') prices.push(`Básico: *${row.basico}*`);
        if (row.completo !== '-') prices.push(`Completo: *${row.completo}*`);
        if (row.full !== '-') prices.push(`Full: *${row.full}*`);
        lines.push(prices.join(' | '));
      }
      if (sec.rows.length > 0 && sec.header) lines.push('');
    }
  }
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // --- Image ---
  let imageBuffer: Buffer | null = null;
  try {
    if (sections.some(s => s.rows.length > 0)) {
      const hasSubtitles = sections.some(s => s.header != null);
      if (hasSubtitles) {
        imageBuffer = generateKitPriceListImageWithSections(categoryName, sections);
      } else {
        imageBuffer = generateKitPriceListImage(categoryName, allRows);
      }
    }
  } catch (err) {
    console.error('Error generando imagen de kits:', err);
  }

  return { imageBuffer, text };
}

/**
 * Busca un código en el sistema y devuelve todos los artículos relacionados.
 * Formato: Código (monospace), Descripción (itálica), Stock (negrita)
 */
export async function buscarCodigo(codigo: string): Promise<string> {
  try {
    const response = await fetch(`${API_URL}/obtenerArticulo/${codigo.toUpperCase()}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return `❌ No se encontró el código \`${codigo.toUpperCase()}\` en el sistema.`;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    
    const articles = await response.json();
    
    // El endpoint devuelve un array de artículos
    if (!Array.isArray(articles) || articles.length === 0) {
      return `❌ No se encontraron artículos para el código \`${codigo.toUpperCase()}\`.`;
    }
    
    // Filtrar solo artículos con stock mayor a cero
    const articlesConStock = articles.filter(article => {
      const stock = article.CANT_STOCK || article.CANT_STO || article.stock || 0;
      return stock > 0;
    });
    
    if (articlesConStock.length === 0) {
      return `❌ No se encontraron artículos con stock disponible para el código \`${codigo.toUpperCase()}\`.`;
    }
    
    const lines: string[] = [];
    for (let i = 0; i < articlesConStock.length; i++) {
      const article = articlesConStock[i];
      const codigoArt = article.COD_ARTICULO || article.codigo || 'Sin código';
      const descripcion = article.DESCRIP_ARTI || article.descripcion || article.d || 'Sin descripción';
      const stock = article.CANT_STOCK || article.CANT_STO || article.stock || 0;
      
      // Formato: cada atributo en su propia línea
      lines.push(`\`${codigoArt}\``);
      lines.push(`_${descripcion}_`);
      lines.push(`*Stock: ${stock}*`);
      
      // Salto de línea entre bloques (excepto después del último)
      if (i < articlesConStock.length - 1) {
        lines.push('');
      }
    }
    
    return lines.join('\n');
  } catch (error) {
    console.error('Error al buscar código:', error);
    return `❌ Error al consultar el sistema. Intenta más tarde.`;
  }
}

interface CotiItem {
  code?: string;
  description: string;
  price: number;
  quantity?: number;
  discount?: number | null;
  fixedPrice?: number | null;
}

function getCotiItemEffectivePrice(item: CotiItem): number {
  const base = item.price || 0;
  if (item.fixedPrice != null) {
    const v = Number(item.fixedPrice);
    return !Number.isNaN(v) ? v : base;
  }
  if (item.discount != null) {
    const pct = Number(item.discount);
    if (!Number.isNaN(pct) && pct > 0) return base * (1 - pct / 100);
  }
  return base;
}

/**
 * Lee cotizacion.json y formatea el mensaje para WhatsApp.
 * Modo presupuesto: sin cantidades (todo x 1), sin total.
 * Modo cotización: con cantidades y total.
 * Retorna null si la cotización está vacía.
 */
export function formatCotizacion(): string | null {
  try {
    const cotizacionPath = resolve('./cotizacion.json');
    if (!existsSync(cotizacionPath)) return null;

    const raw = readFileSync(cotizacionPath, 'utf-8');
    const data = JSON.parse(raw);
    const items: CotiItem[] = data.items || [];
    const mode = data.mode === 'cotizacion' ? 'cotizacion' : 'presupuesto';

    if (items.length === 0) return null;

    const lines: string[] = [];
    lines.push('_Precios finales (IVA incluido)._');
    lines.push('');
    let total = 0;

    for (const item of items) {
      const effectivePrice = getCotiItemEffectivePrice(item);
      const qty = Math.max(1, Number(item.quantity) || 1);
      const subtotal = effectivePrice * qty;
      total += subtotal;

      if (item.code) {
        lines.push(`Cód. ${item.code}`);
      }
      lines.push(item.description.toUpperCase());
      if (mode === 'cotizacion' && qty > 1) {
        lines.push(`Cant. ${qty} → *$${formatPrice(subtotal)}*`);
      } else if (mode === 'cotizacion') {
        lines.push(`*$${formatPrice(subtotal)}*`);
      } else {
        lines.push(`*$${formatPrice(effectivePrice)}*`);
      }
      lines.push('');
    }

    if (mode === 'cotizacion') {
      lines.push('───────────────');
      lines.push(`*TOTAL $${formatPrice(total)}*`);
    }

    return lines.join('\n');
  } catch (error) {
    console.error('Error al leer cotización:', error);
    return null;
  }
}

/**
 * Consulta el stock y costo con IVA de un código.
 * Usa COSTO_UNI_SIN_DTO y lo multiplica por 1.21 para incluir IVA.
 */
export async function consultarCosto(codigo: string): Promise<string> {
  try {
    const response = await fetch(`${API_URL}/obtenerArticulo/${codigo.toUpperCase()}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return `❌ No se encontró el código \`${codigo.toUpperCase()}\` en el sistema.`;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    
    const articles = await response.json();
    
    // El endpoint devuelve un array de artículos
    if (!Array.isArray(articles) || articles.length === 0) {
      return `❌ No se encontraron artículos para el código \`${codigo.toUpperCase()}\`.`;
    }
    
    // Filtrar solo artículos con stock mayor a cero
    const articlesConStock = articles.filter(article => {
      const stock = article.CANT_STOCK || article.CANT_STO || article.stock || 0;
      return stock > 0;
    });
    
    if (articlesConStock.length === 0) {
      return `❌ No se encontraron artículos con stock disponible para el código \`${codigo.toUpperCase()}\`.`;
    }
    
    const lines: string[] = [];
    for (let i = 0; i < articlesConStock.length; i++) {
      const article = articlesConStock[i];
      const codigoArt = article.COD_ARTICULO || article.codigo || 'Sin código';
      const descripcion = article.DESCRIP_ARTI || article.descripcion || article.d || 'Sin descripción';
      const stock = article.CANT_STOCK || article.CANT_STO || article.stock || 0;
      const costoUniSinDto = article.COSTO_UNI_SIN_DTO || 0;
      
      // Calcular costo con IVA (multiplicar por 1.21)
      const costoConIva = costoUniSinDto * 1.21;
      const costoFormateado = formatPrice(costoConIva);
      
      // Formato: cada atributo en su propia línea
      lines.push(`\`${codigoArt}\``);
      lines.push(`_${descripcion}_`);
      lines.push(`*Stock: ${stock}*`);
      lines.push(`*Costo IVA incluido: $${costoFormateado}*`);
      
      // Salto de línea entre bloques (excepto después del último)
      if (i < articlesConStock.length - 1) {
        lines.push('');
      }
    }
    
    return lines.join('\n');
  } catch (error) {
    console.error('Error al consultar costo:', error);
    return `❌ Error al consultar el sistema. Intenta más tarde.`;
  }
}
