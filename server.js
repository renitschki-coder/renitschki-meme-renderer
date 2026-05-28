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
    // Load background image
    const imgBuffer = await fetchBuffer(image_url);
    const bgImage = await sharp(imgBuffer)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 92 })
      .toBuffer();

    const composites = [];

    // Build text SVG
    const textSvg = buildTextSvg(meme_text.toUpperCase(), WIDTH, HEIGHT);
    composites.push({
      input: Buffer.from(textSvg),
      top: 0,
      left: 0
    });

    // Load and composite logo
    if (logo_url) {
      try {
        const logoBuffer = await fetchBuffer(logo_url);
        const logoResized = await sharp(logoBuffer)
          .resize(120, null, { fit: 'inside' })
          .png()
          .toBuffer();

        const logoMeta = await sharp(logoResized).metadata();
        const logoH = logoMeta.height;
        const logoW = logoMeta.width;

        // Semi-transparent logo via raw composite trick
        const logoDimmed = await sharp(logoResized)
          .composite([{
            input: Buffer.from(
              `<svg width="${logoW}" height="${logoH}"><rect width="${logoW}" height="${logoH}" fill="black" opacity="0.70"/></svg>`
            ),
            blend: 'dest-in'
          }])
          .png()
          .toBuffer();

        composites.push({
          input: logoDimmed,
          top: HEIGHT - logoH - 18,
          left: WIDTH - logoW - 18
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
  const maxWidth = width - 80;
  const fontSize = calcFontSize(text, maxWidth);
  const lineHeight = fontSize * 1.2;
  const lines = wrapText(text, maxWidth, fontSize);
  const totalH = lines.length * lineHeight;
  const startY = height - 38 - totalH + lineHeight;

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

function calcFontSize(text, maxWidth) {
  // Approximate: Impact ~0.55 * fontSize per char
  const words = text.split(' ');
  let fontSize = 110;
  const longestWord = words.reduce((a, b) => a.length > b.length ? a : b, '');
  const charsPerLine = Math.floor(maxWidth / (fontSize * 0.55));
  if (longestWord.length > charsPerLine) {
    fontSize = Math.floor(maxWidth / (longestWord.length * 0.55));
  }
  return Math.max(60, Math.min(fontSize, 120));
}

function wrapText(text, maxWidth, fontSize) {
  const charWidth = fontSize * 0.55;
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

  // Max 3 lines
  return lines.slice(0, 3);
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
