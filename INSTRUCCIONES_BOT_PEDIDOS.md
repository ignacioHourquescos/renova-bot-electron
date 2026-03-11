# Instrucciones para el Bot de Pedidos

Este documento describe cómo debe configurarse el bot de WhatsApp para enviar pedidos al sistema de gestión de pedidos.

---

## Endpoint

```
POST {BASE_URL}/api/pedidos-bot
```

**Ejemplos de BASE_URL:**
- Desarrollo: `http://localhost:4000`
- Producción: `https://tu-dominio.com` (ej: `https://renova-order-manager.vercel.app`)

---

## Autenticación (opcional pero recomendado)

Si está configurada la variable de entorno `PEDIDOS_BOT_API_KEY`, el bot debe enviar la API key en cada request:

**Opción 1 – Header X-API-Key:**
```
X-API-Key: tu_api_key_secreta
```

**Opción 2 – Header Authorization:**
```
Authorization: Bearer tu_api_key_secreta
```

---

## Formato del body (JSON)

### Campos comunes

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `messageId` | string | No | ID del mensaje en WhatsApp (para trazabilidad) |
| `clientPhone` | string | No | Teléfono del cliente (ej: +5491123456789) |
| `content` | object | **Sí** | Contenido del pedido |
| `timestamp` | number | No | Unix timestamp (solo si no es "ahora") |
| `metadata` | object | No | Datos extra (ej: nombre del remitente) |

### Contenido según tipo

#### 1. Mensaje de texto

```json
{
  "messageId": "wa_msg_123",
  "clientPhone": "+54911...",
  "content": {
    "type": "text",
    "text": "2 filtros de aceite, 3 bujías NGK, 1 correa de distribución"
  }
}
```

#### 2. Mensaje de audio

El bot debe enviar la **URL** donde está el archivo de audio. WhatsApp Business API suele dar URLs temporales.

```json
{
  "messageId": "wa_msg_456",
  "clientPhone": "+54911...",
  "content": {
    "type": "audio",
    "mediaUrl": "https://api.whatsapp.com/media/xxx/audio.ogg"
  }
}
```

**Alternativa:** Si el bot sube el audio a Firebase Storage u otro almacenamiento:

```json
{
  "content": {
    "type": "audio",
    "storageUrl": "https://firebasestorage.googleapis.com/v0/b/...",
    "storagePath": "pedidos_bot/audio_123.ogg"
  }
}
```

#### 3. Mensaje con imagen (foto de lista, recibo, etc.)

```json
{
  "messageId": "wa_msg_789",
  "content": {
    "type": "image",
    "mediaUrl": "https://api.whatsapp.com/media/xxx/image.jpg"
  }
}
```

O con URL de Storage:

```json
{
  "content": {
    "type": "image",
    "storageUrl": "https://firebasestorage.googleapis.com/v0/b/...",
    "storagePath": "pedidos_bot/imagen_123.jpg"
  }
}
```

---

## Ejemplos completos para el bot

### Ejemplo 1: texto simple

```json
POST /api/pedidos-bot
Content-Type: application/json
X-API-Key: tu_api_key

{
  "messageId": "wamid.ABC123",
  "clientPhone": "+5491123456789",
  "content": {
    "type": "text",
    "text": "Hola, necesito para mañana: 2 filtros de aceite Mann, 3 bujías NGK, 1 correa"
  }
}
```

### Ejemplo 2: audio (URL de WhatsApp)

```json
POST /api/pedidos-bot
Content-Type: application/json

{
  "messageId": "wamid.DEF456",
  "clientPhone": "+5491187654321",
  "content": {
    "type": "audio",
    "mediaUrl": "https://whatsapp.com/media/xxx/audio.ogg"
  }
}
```

### Ejemplo 3: imagen

```json
POST /api/pedidos-bot
Content-Type: application/json

{
  "messageId": "wamid.GHI789",
  "content": {
    "type": "image",
    "mediaUrl": "https://whatsapp.com/media/xxx/image.jpg"
  }
}
```

---

## Respuestas del servidor

### Success (201)

```json
{
  "success": true,
  "id": "abc123xyz",
  "message": "Pedido recibido y guardado en bandeja"
}
```

`id` es el ID del documento en Firestore (`pedidos_bot_raw`).

### Error 400 – Bad Request

```json
{
  "error": "Para type='text' se requiere 'content.text'"
}
```

### Error 401 – No autorizado

```json
{
  "error": "API key inválida o faltante"
}
```

### Error 500 – Error del servidor

```json
{
  "error": "Error al guardar el pedido",
  "details": "..."
}
```

---

## Flujo recomendado en el bot

1. Usuario envía mensaje (texto, audio o imagen) al bot.
2. Bot detecta que es un pedido (por contexto, comando o flujo).
3. Si es **texto**: armar el payload con `type: "text"` y `content.text`.
4. Si es **audio** o **imagen**:
   - Obtener la URL del archivo (WhatsApp Business API, etc.).
   - Si es temporal, opcionalmente subir a Firebase Storage o similar para guardar copia permanente.
   - Usar `mediaUrl` o `storageUrl` en el payload.
5. Hacer `POST` a `{BASE_URL}/api/pedidos-bot` con el payload.
6. Si la respuesta es 201, enviar confirmación al usuario (ej: "Pedido recibido, lo procesaremos pronto").

---

## Notas importantes

- **URLs temporales:** Las URLs de WhatsApp suelen expirar en 24–48 horas. Si el procesamiento puede tardar más, conviene que el bot suba el archivo a Firebase Storage y envíe `storageUrl`.
- **Múltiples archivos:** Si un mensaje puede contener varios archivos (ej: varias imágenes), se puede enviar un request por cada uno o definir un formato extendido según necesidad.
- **Mime type:** No es obligatorio enviar el tipo MIME; el sistema puede inferirlo según el tipo de contenido.

---

## Firebase Storage (recomendado)

Si configurás `GOOGLE_APPLICATION_CREDENTIALS` y `FIREBASE_STORAGE_BUCKET`, el bot sube automáticamente las imágenes y audios a Firebase Storage. La app de pedidos recibe `storageUrl` y puede mostrar imágenes o reproducir audios directamente:

```json
{
  "content": {
    "type": "audio",
    "storageUrl": "https://firebasestorage.googleapis.com/v0/b/...",
    "storagePath": "pedidos_bot/2024-03-09/audio_xxx.ogg"
  },
  "metadata": {
    "clientName": "Sola motors"
  }
}
```

Los archivos se guardan en `pedidos_bot/{fecha}/{tipo}_{messageId}.{ext}`.

---

## Fallback sin Firebase (base64)

Si Firebase no está configurado, el bot envía el contenido en base64:

```json
{
  "content": {
    "type": "audio",
    "dataBase64": "<contenido base64>",
    "mimeType": "audio/ogg"
  }
}
```

El backend puede decodificar `dataBase64` y procesar el pedido.
