/**
 * Extrae el número de teléfono de un JID de WhatsApp.
 */
export function getPhoneNumber(jid: string): string {
  if (!jid) return 'Desconocido';
  const phoneNumber = jid.split('@')[0];
  if (phoneNumber.includes(':')) {
    return phoneNumber.split(':')[0];
  }
  return phoneNumber;
}

/**
 * Extrae el texto legible de un mensaje de WhatsApp.
 */
export function getMessageText(message: any): string {
  if (message?.conversation) return message.conversation;
  if (message?.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message?.imageMessage?.caption) return `[Imagen] ${message.imageMessage.caption}`;
  if (message?.videoMessage?.caption) return `[Video] ${message.videoMessage.caption}`;
  if (message?.audioMessage) return '[Audio]';
  if (message?.documentMessage) return `[Documento] ${message.documentMessage.fileName || ''}`;
  return '[Mensaje sin texto]';
}



