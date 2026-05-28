const express = require('express');
const sharp = require('sharp');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WIDTH = 1080;
const HEIGHT = 1080;

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'GDW Meme Renderer' });
});

app.post('/render', async (req, res) => {
  const { image_url, meme_text, logo_url } = req.body;

  if (!image_url || !meme_text) {
    return res.status(400).json({ error: 'image_url and meme_text required' });
  }

  try {
    const imgBuffer = await fetchBuffer(image_url);
    const bgImage = await sharp(imgBuffer)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 92 })
      .toBuffer();

    const composites = [];

    // Text SVG
    const textSvg = buildTextSvg(meme_text.toUpperCase(), WIDTH, HEIGHT);
    composites.push({ input: Buffer.from(textSvg), top: 0, left: 0 });

    // Logo — preserve PNG transparency, use Sharp blend for opacity
    if (logo_url) {
      try {
        const logoBuffer = await fetchBuffer(logo_url);

        // Resize to 110px wide, keep aspect ratio, preserve alpha
        const logoResized = await sharp(logoBuffer)
          .resize(110, null, { fit: 'inside' })
          .png()
          .toBuffer();

        const logoMeta = await sharp(logoResized).metadata();
        const logoH = logoMeta.height;
        const logoW = logoMeta.width;

        // Apply 30% opacity via modulate — keep alpha channel intact
        // We use a composite with an alpha mask at 30% opacity
        const logoWithOpacity = await sharp(logoResized)
          .ensureAlpha()
          .linear(0.30, 0) // multiply alpha by 0.30
          .png()
          .toBuffer();

        composites.push({
          input: logoWithOpacity,
          top: HEIGHT - logoH - 20,
          left: WIDTH - logoW - 20,
          blend: 'over'
        });
      } catch (e) {
        console.warn('Logo failed:', e.message);
      }
    }

    const result = await sharp(bgImage)
      .composite(composites)
      .jpeg({ quality: 92 })
      .toBuffer();

    res.set('Content-Type', 'image/jpeg');
    res.send(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function buildTextSvg(text, width, height) {
  const maxWidth = 960; // 60px padding each side
  const bottomPadding = 45;
  const startFontSize = 92;
  const minFontSize = 48;
  const maxLines = 3;

  let fontSize = startFontSize;
  let lines = [];

  // Reduce font size until text fits in maxLines
  while (fontSize >= minFontSize) {
    lines = wrapText(text, maxWidth, fontSize);
    if (lines.length <= maxLines) break;
    fontSize -= 4;
  }

  // Final clamp
  lines = lines.slice(0, maxLines);

  const lineHeight = fontSize * 1.05;
  const totalH = lines.length * lineHeight;
  // Position so bottom of text block is 45px from bottom
  const blockBottom = height - bottomPadding;
  const startY = blockBottom - totalH + lineHeight;

  const textElements = lines.map((line, i) => {
    const y = Math.round(startY + i * lineHeight);
    return `<text
      x="${width / 2}"
      y="${y}"
      text-anchor="middle"
      dominant-baseline="auto"
      font-family="Impact, 'Arial Black', sans-serif"
      font-size="${fontSize}"
      font-weight="900"
      fill="white"
      stroke="black"
      stroke-width="8"
      stroke-linejoin="round"
      paint-order="stroke fill"
    >${escapeXml(line)}</text>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${textElements}
</svg>`;
}

function wrapText(text, maxWidth, fontSize) {
  // Impact character width ~0.52 * fontSize
  const charWidth = fontSize * 0.52;
  const maxChars = Math.floor(maxWidth / charWidth);
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function fetchBuffer(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    headers: { 'User-Agent': 'MemeRenderer/1.0' }
  });
  return Buffer.from(response.data);
}

app.listen(PORT, () => {
  console.log(`Meme Renderer running on port ${PORT}`);
});
