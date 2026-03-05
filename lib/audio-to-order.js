/**
 * Audio to Order pipeline: Whisper transcription + GPT extraction + API resolution.
 * CommonJS for Electron main process compatibility.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OpenAI = require('openai');
const fs = require('fs');

const API_URL = 'https://renovaapi-production.up.railway.app';

let priceListCache = null;
let priceListCacheTime = 0;
const CACHE_TTL_MS = 60000;

async function fetchArticleList(listId = '0') {
  const now = Date.now();
  if (priceListCache && (now - priceListCacheTime) < CACHE_TTL_MS) {
    return priceListCache[listId] || [];
  }
  const url = `${API_URL}/obtenerListadoArticulos${listId !== '0' ? `?listaid=${listId}` : ''}`;
  const response = await fetch(url);
  const articles = await response.json();
  const list = articles
    .filter((a) => a.id && a.pr != null)
    .map((a) => ({
      id: String(a.id).toUpperCase(),
      pr: Number(a.pr),
      d: a.d || '',
    }));
  if (!priceListCache) priceListCache = {};
  priceListCache[listId] = list;
  priceListCacheTime = now;
  return list;
}

async function getArticleByCode(code, listId = '0') {
  try {
    const [articleRes, priceList] = await Promise.all([
      fetch(`${API_URL}/obtenerArticulo/${code.toUpperCase()}`),
      fetchArticleList(listId),
    ]);
    if (!articleRes.ok) return null;
    const articles = await articleRes.json();
    if (!Array.isArray(articles) || articles.length === 0) return null;
    const withStock = articles.filter((a) => (a.CANT_STOCK ?? a.CANT_STO ?? a.stock ?? 0) > 0);
    if (withStock.length === 0) return null;
    const a = withStock[0];
    const codigo = a.COD_ARTICULO || a.codigo || '';
    const description = a.DESCRIP_ARTI || a.descripcion || a.d || '';
    const entry = priceList.find((p) => p.id === codigo.toUpperCase());
    const price = entry ? Math.round(entry.pr * 1.21) : 0;
    return { code: codigo, description, price };
  } catch {
    return null;
  }
}

function fuzzyMatchDescription(hint, articles) {
  const terms = hint
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (terms.length === 0) return null;

  let best = null;
  for (const art of articles) {
    const descLower = art.d.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (descLower.includes(t)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { ...art, score };
    }
  }
  return best ? { id: best.id, pr: best.pr, d: best.d } : null;
}

async function transcribeAudio(audioPath) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY no está configurada. Configurá la variable de entorno.');
  }
  const resolved = path.isAbsolute(audioPath) ? audioPath : path.resolve(process.cwd(), audioPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Archivo de audio no encontrado: ${audioPath}`);
  }

  const openai = new OpenAI({ apiKey });
  const file = fs.createReadStream(resolved);
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'es',
  });
  return transcription.text?.trim() || '';
}

async function extractOrderFromTranscript(transcript) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY no está configurada.');
  }
  if (!transcript || transcript.length < 3) {
    return [];
  }

  const openai = new OpenAI({ apiKey });
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Sos un asistente que extrae ítems de pedidos de una transcripción de audio.
El contexto es una empresa de lubricantes y autopartes. Los clientes pueden mencionar:
- Códigos de artículo (ej: 04VA511, CF9323, PE/10W40/4)
- Descripciones parciales (ej: "Premium Blue 7800", "aceite 15w40", "bidón de 4 litros")
- Cantidades (ej: "dos", "2", "un par")

Respondé SOLO con un JSON válido en este formato exacto:
{"items":[{"code":"04VA511" o null,"quantity":1,"description_hint":"texto" o null}]}

Reglas:
- code: solo si el cliente menciona un código alfanumérico explícito. Si no, null.
- quantity: número entero, mínimo 1.
- description_hint: descripción parcial para búsqueda si no hay código. Si hay código, puede ser null.
- Si no hay ítems de pedido en la transcripción, devolvé {"items":[]}`,
      },
      {
        role: 'user',
        content: `Transcripción:\n${transcript}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return items.map((i) => ({
      code: i.code && String(i.code).trim() ? String(i.code).trim() : null,
      quantity: Math.max(1, Number(i.quantity) || 1),
      description_hint: i.description_hint && String(i.description_hint).trim() ? String(i.description_hint).trim() : null,
    }));
  } catch {
    return [];
  }
}

async function resolveItemsWithApi(extracted, listId = '0') {
  const resolved = [];
  const articles = await fetchArticleList(listId);

  for (const item of extracted) {
    let art = null;

    if (item.code) {
      art = await getArticleByCode(item.code, listId);
    }
    if (!art && item.description_hint) {
      const matched = fuzzyMatchDescription(item.description_hint, articles);
      if (matched) {
        art = {
          code: matched.id,
          description: matched.d,
          price: Math.round(matched.pr * 1.21),
        };
      }
    }

    if (art) {
      resolved.push({
        code: art.code,
        description: art.description,
        price: art.price,
        quantity: item.quantity,
        discount: null,
        fixedPrice: null,
      });
    }
  }

  return resolved;
}

/**
 * Full pipeline: transcribe audio -> extract items -> (optional) resolve with API.
 * @param {string} mediaPath - Absolute path to audio file
 * @param {string} listId - Price list ID (0, 1, 3, 4)
 * @param {object} opts - { simple: true } = solo listado extraído, sin consultar API
 * @returns {Promise<{success: boolean, transcript?: string, items?: Array, rawItems?: Array, error?: string}>}
 */
async function audioToOrder(mediaPath, listId = '0', opts = {}) {
  try {
    const transcript = await transcribeAudio(mediaPath);
    if (!transcript) {
      return {
        success: false,
        transcript: '',
        error: 'No se pudo transcribir el audio (vacío o muy corto).',
      };
    }

    const extracted = await extractOrderFromTranscript(transcript);
    if (extracted.length === 0) {
      return {
        success: true,
        transcript,
        items: [],
        rawItems: extracted,
        error: 'No se detectaron ítems de pedido en el audio.',
      };
    }

    if (opts.simple) {
      return {
        success: true,
        transcript,
        rawItems: extracted,
      };
    }

    const resolved = await resolveItemsWithApi(extracted, listId);
    return {
      success: true,
      transcript,
      items: resolved,
      rawItems: extracted,
    };
  } catch (err) {
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}

module.exports = { audioToOrder, transcribeAudio, extractOrderFromTranscript, resolveItemsWithApi };
