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

type SockWithLID = { signalRepository?: { lidMapping?: { getPNForLID: (lid: string) => Promise<string | null> } } };

/**
 * Obtiene el número de teléfono real del remitente.
 * WhatsApp puede enviar remoteJid como @lid (ID interno) en vez del número real.
 * Prioriza: remoteJidAlt/participantAlt (formato @s.whatsapp.net) > lidMapping.getPNForLID > remoteJid.
 */
export async function getSenderPhoneNumber(message: any, sock?: SockWithLID): Promise<string> {
  const key = message?.key;
  if (!key) return 'Desconocido';
  const isGroup = key.remoteJid?.endsWith('@g.us');
  const primaryJid = isGroup ? key.participant : key.remoteJid;
  const altJid = isGroup ? key.participantAlt : key.remoteJidAlt;

  if (altJid?.includes('@s.whatsapp.net')) {
    return getPhoneNumber(altJid);
  }
  const jid = primaryJid || (key.remoteJid ?? '');
  if (jid.endsWith('@lid') && sock?.signalRepository?.lidMapping?.getPNForLID) {
    const lid = jid.split('@')[0];
    const pn = await sock.signalRepository.lidMapping.getPNForLID(lid);
    if (pn) return getPhoneNumber(pn);
  }
  return getPhoneNumber(jid);
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



