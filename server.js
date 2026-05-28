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

    // Logo — top left, transparent PNG, opacity 0.82
    if (logo_url) {
      try {
        const logoBuffer = await fetchBuffer(logo_url);
        const logoSize = Math.floor(WIDTH * 0.12); // 130px
        const padding = Math.floor(WIDTH * 0.06);  // 65px

        const logoResized = await sharp(logoBuffer)
          .resize(logoSize, logoSize, { fit: 'inside' })
          .png()
          .toBuffer();

        const logoMeta = await sharp(logoResized).metadata();

        // Preserve alpha, set opacity to 82%
        const logoWithOpacity = await sharp(logoResized)
          .ensureAlpha()
          .linear(0.82, 0)
          .png()
          .toBuffer();

        composites.push({
          input: logoWithOpacity,
          top: padding,
          left: padding,
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
  const padding = width * 0.06;           // 64.8px
  const maxTextWidth = width - padding * 2; // 950px
  const startFontSize = Math.floor(width * 0.085); // 91 → 92

  let fontSize = startFontSize;
  let lines = [];

  // Reduce fontSize until text fits — same logic as canvas version
  do {
    lines = wrapText(text, maxTextWidth, fontSize);
    const widest = Math.max(...lines.map(l => measureText(l, fontSize)));
    if (widest <= maxTextWidth && lines.length <= 3) break;
    fontSize -= 4;
  } while (fontSize > 30);

  lines = lines.slice(0, 3);

  const lineHeight = fontSize * 0.9;
  const startY = height - padding;

  // Lines reversed — bottom up, like canvas version
  const reversedLines = [...lines].reverse();
  const textElements = reversedLines.map((line, index) => {
    const y = Math.round(startY - index * lineHeight);
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
      stroke-width="${Math.max(6, Math.floor(fontSize * 0.14))}"
      stroke-linejoin="round"
      paint-order="stroke fill"
    >${escapeXml(line)}</text>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${textElements}
</svg>`;
}

// Approximate Impact character width — Impact is narrow, ~0.52x fontSize
function measureText(text, fontSize) {
  return text.length * fontSize * 0.52;
}

function wrapText(text, maxWidth, fontSize) {
  const words = text.split(' ');
  const lines = [];
  let line = '';

  for (let n = 0; n < words.length; n++) {
    const testLine = line ? `${line} ${words[n]}` : words[n];
    if (measureText(testLine, fontSize) > maxWidth && n > 0) {
      lines.push(line.trim());
      line = words[n];
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line.trim());
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
