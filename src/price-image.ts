import { createCanvas } from '@napi-rs/canvas';

export interface PriceRowImg {
  desc: string;
  price: string;
}

export interface SectionImg {
  header: string | null;
  rows: PriceRowImg[];
}

function drawRoundedRect(
  ctx: any, x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Genera una imagen PNG con la lista de precios.
 * Estilo light, limpio, acento naranja — alineado al MVP.
 */
export function generatePriceListImage(title: string, sections: SectionImg[]): Buffer {
  const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

  // Layout
  const PAD = 28;
  const ROW_H = 36;
  const HEADER_H = 34;
  const TITLE_H = 48;
  const SECTION_GAP = 14;
  const DIVIDER_PAD = 10;
  const ACCENT_BAR = 5;
  const CARD_MARGIN = 12;
  const RADIUS = 12;
  const MIN_W = 580;
  const SHADOW_OFFSET = 3;

  // Colors — MVP style (light + orange accent)
  const C = {
    bg:       '#ECECEC',
    card:     '#FFFFFF',
    shadow:   '#D0D0D0',
    accent:   '#7C3AED',
    title:    '#1A1A1A',
    desc:     '#3A3A3A',
    price:    '#1A1A1A',
    header:   '#7C3AED',
    altRow:   '#F6F6F6',
    divider:  '#E0E0E0',
  };

  // --- Measure content width ---
  const tmp = createCanvas(1, 1).getContext('2d');
  let maxDescW = 0;
  let maxPriceW = 0;

  for (const sec of sections) {
    for (const row of sec.rows) {
      tmp.font = `15px ${FONT}`;
      maxDescW = Math.max(maxDescW, tmp.measureText(row.desc).width);
      tmp.font = `bold 16px ${FONT}`;
      maxPriceW = Math.max(maxPriceW, tmp.measureText(row.price).width);
    }
    if (sec.header) {
      tmp.font = `bold 15px ${FONT}`;
      maxDescW = Math.max(maxDescW, tmp.measureText(sec.header).width);
    }
  }

  const COL_GAP = 50;
  const W = Math.max(MIN_W, Math.ceil(maxDescW + COL_GAP + maxPriceW + PAD * 2));

  // --- Calculate height ---
  let H = CARD_MARGIN + ACCENT_BAR + PAD + TITLE_H + DIVIDER_PAD;

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.header) {
      H += (i > 0) ? SECTION_GAP + HEADER_H : HEADER_H;
    }
    H += sec.rows.length * ROW_H;
  }
  H += PAD + CARD_MARGIN + SHADOW_OFFSET;

  // --- Draw ---
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Outer background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const cm = CARD_MARGIN;
  const cardW = W - cm * 2;
  const cardH = H - cm * 2 - SHADOW_OFFSET;

  // Card shadow
  drawRoundedRect(ctx, cm + SHADOW_OFFSET, cm + SHADOW_OFFSET, cardW, cardH, RADIUS);
  ctx.fillStyle = C.shadow;
  ctx.fill();

  // Card
  drawRoundedRect(ctx, cm, cm, cardW, cardH, RADIUS);
  ctx.fillStyle = C.card;
  ctx.fill();

  // Accent bar (top of card, clipped to rounded corners)
  ctx.save();
  drawRoundedRect(ctx, cm, cm, cardW, ACCENT_BAR + RADIUS, RADIUS);
  ctx.clip();
  ctx.fillStyle = C.accent;
  ctx.fillRect(cm, cm, cardW, ACCENT_BAR);
  ctx.restore();

  let y = cm + ACCENT_BAR + PAD;

  // Title
  ctx.font = `bold 22px ${FONT}`;
  ctx.fillStyle = C.title;
  ctx.fillText(title.toUpperCase(), PAD, y + 28);
  y += TITLE_H;

  // Divider
  ctx.strokeStyle = C.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += DIVIDER_PAD;

  // Sections
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];

    if (sec.header) {
      if (si > 0) y += SECTION_GAP;

      // Small orange pip before header text
      ctx.fillStyle = C.accent;
      drawRoundedRect(ctx, PAD, y + 14, 4, 14, 2);
      ctx.fill();

      ctx.font = `bold 15px ${FONT}`;
      ctx.fillStyle = C.header;
      ctx.fillText(sec.header.toUpperCase(), PAD + 12, y + 23);
      y += HEADER_H;
    }

    for (let ri = 0; ri < sec.rows.length; ri++) {
      const row = sec.rows[ri];

      // Alternating row background
      if (ri % 2 === 1) {
        drawRoundedRect(ctx, PAD - 12, y + 2, W - PAD * 2 + 24, ROW_H - 4, 6);
        ctx.fillStyle = C.altRow;
        ctx.fill();
      }

      // Bottom border per row
      ctx.strokeStyle = C.divider;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD, y + ROW_H - 1);
      ctx.lineTo(W - PAD, y + ROW_H - 1);
      ctx.stroke();

      // Description (left)
      ctx.font = `15px ${FONT}`;
      ctx.fillStyle = C.desc;
      ctx.fillText(row.desc, PAD, y + 24);

      // Price (right-aligned, bold)
      ctx.font = `bold 16px ${FONT}`;
      ctx.fillStyle = C.price;
      const pw = ctx.measureText(row.price).width;
      ctx.fillText(row.price, W - PAD - pw, y + 24);

      y += ROW_H;
    }
  }

  return Buffer.from(canvas.toBuffer('image/png'));
}
