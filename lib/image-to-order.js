/**
 * Image to Order: GPT-4o Vision extracts order items from an image.
 * CommonJS for Electron main process compatibility.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OpenAI = require('openai');
const fs = require('fs');

const EXTRACT_PROMPT = `Sos un asistente que extrae ítems de pedidos de una imagen.
El contexto es una empresa de lubricantes y autopartes. La imagen puede ser:
- Una lista manuscrita
- Una captura de pantalla
- Una foto de un pedido
- Una tabla con códigos y cantidades

Extrae todos los ítems que veas. Para cada ítem:
- code: código alfanumérico si aparece (ej: 04VA511, CF9323). Si no hay código, null.
- quantity: cantidad numérica. Mínimo 1.
- description_hint: descripción del producto si aparece. Si no, null.

Respondé SOLO con un JSON válido en este formato exacto:
{"items":[{"code":"04VA511" o null,"quantity":1,"description_hint":"texto" o null}]}

Si no hay ítems de pedido en la imagen, devolvé {"items":[]}`;

function normalizeExtractedItem(i) {
  return {
    code: i.code && String(i.code).trim() ? String(i.code).trim() : null,
    quantity: Math.max(1, Number(i.quantity) || 1),
    description_hint: i.description_hint && String(i.description_hint).trim() ? String(i.description_hint).trim() : null,
  };
}

/**
 * Extract order items from an image using GPT-4o Vision.
 * @param {string} imagePath - Absolute path to image file (jpg, png, etc.)
 * @returns {Promise<{success: boolean, rawItems?: Array, error?: string}>}
 */
async function imageToOrder(imagePath) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'OPENAI_API_KEY no está configurada.' };
    }

    const resolved = path.isAbsolute(imagePath) ? imagePath : path.resolve(process.cwd(), imagePath);
    if (!fs.existsSync(resolved)) {
      return { success: false, error: `Imagen no encontrada: ${imagePath}` };
    }

    const buf = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
    const mime = mimeMap[ext] || 'image/jpeg';
    const base64 = buf.toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;

    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: EXTRACT_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      return { success: true, rawItems: [] };
    }

    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const rawItems = items.map(normalizeExtractedItem);

    return {
      success: true,
      rawItems,
    };
  } catch (err) {
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}

module.exports = { imageToOrder };
