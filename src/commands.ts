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
  const parts: string[] = [];
  let isFirstSection = true;

  for (const section of sections) {
    if (section.rows.length === 0 && !section.header) continue;
    if (section.header) {
      // Doble salto de línea antes de cada subtítulo (excepto el primero)
      if (!isFirstSection) {
        parts.push('');
        parts.push('');
      }
      // Subtítulos en negrita con salto de línea después
      parts.push(`*${section.header}*`);
      parts.push('');
      isFirstSection = false;
    }
    if (section.rows.length > 0) {
      parts.push(formatWhatsAppPriceList(section.rows));
      isFirstSection = false;
    }
  }

  return parts.join('\n');
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
