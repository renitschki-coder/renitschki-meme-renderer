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

app.get('/test', async (req, res) => {
  const meme_text = req.query.text || 'MONTAG OHNE KAFFEE';
  const image_url = 'https://res.cloudinary.com/deerouw5e/image/upload/v1779962765/gdw/meme_1779962763.png';
  const logo_url = 'https://res.cloudinary.com/deerouw5e/image/upload/RenitschKI_Logo_pwk8zq.png';
  try {
    const result = await renderMeme(image_url, meme_text.toUpperCase(), logo_url);
    res.set('Content-Type', 'image/jpeg');
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/render', async (req, res) => {
  const { image_url, meme_text, logo_url } = req.body;
  if (!image_url || !meme_text) {
    return res.status(400).json({ error: 'image_url and meme_text required' });
  }
  try {
    const result = await renderMeme(image_url, meme_text.toUpperCase(), logo_url);
    res.set('Content-Type', 'image/jpeg');
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

async function renderMeme(image_url, text, logo_url) {
  const imgBuffer = await fetchBuffer(image_url);
  const bgImage = await sharp(imgBuffer)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 92 })
    .toBuffer();

  const composites = [];

  // Text overlay — safe area, auto font scaling
  const textSvg = buildTextSvg(text, WIDTH, HEIGHT);
  composites.push({ input: Buffer.from(textSvg), top: 0, left: 0 });

  // Logo — top left, transparent PNG, no black background
  if (logo_url) {
    try {
      const logoBuffer = await fetchBuffer(logo_url);
      const padding = Math.floor(WIDTH * 0.06); // 65px
      const logoMaxSize = Math.floor(WIDTH * 0.12); // 130px

      const logoResized = await sharp(logoBuffer)
        .resize(logoMaxSize, logoMaxSize, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();

      const logoMeta = await sharp(logoResized).metadata();

      // Preserve transparency — only reduce opacity, no flatten, no background
      const logoFinal = await sharp(logoResized)
        .ensureAlpha()
        .linear(0.82, 0) // 82% opacity, preserve alpha channel
        .png()
        .toBuffer();

      composites.push({
        input: logoFinal,
        top: padding,
        left: padding,
        blend: 'over'
      });
    } catch (e) {
      console.warn('Logo failed:', e.message);
    }
  }

  return sharp(bgImage)
    .composite(composites)
    .jpeg({ quality: 92 })
    .toBuffer();
}

function buildTextSvg(text, width, height) {
  // Safe area: 6% padding left/right
  const padding = Math.floor(width * 0.06);       // 65px
  const maxTextWidth = width - padding * 2;         // 950px — text NEVER goes outside
  const bottomPadding = Math.floor(height * 0.06); // 65px from bottom

  // Auto font size: start at 8.5% of width, reduce until text fits in max 3 lines
  let fontSize = Math.floor(width * 0.085); // 91px start
  let lines = [];

  do {
    lines = wrapText(text, maxTextWidth, fontSize);
    const widest = Math.max(...lines.map(l => estimateWidth(l, fontSize)));
    if (widest <= maxTextWidth && lines.length <= 3) break;
    fontSize -= 4;
  } while (fontSize > 28);

  // Hard cap at 3 lines
  lines = lines.slice(0, 3);

  const lineHeight = fontSize * 0.9;
  const strokeWidth = Math.max(6, Math.floor(fontSize * 0.13));

  // Position: bottom-up from safe area
  const baseY = height - bottomPadding;
  const reversedLines = [...lines].reverse();

  const textElements = reversedLines.map((line, i) => {
    const y = Math.round(baseY - i * lineHeight);
    return `<text
      x="${width / 2}"
      y="${y}"
      text-anchor="middle"
      dominant-baseline="auto"
      font-family="Impact, 'Arial Black', Arial, sans-serif"
      font-size="${fontSize}"
      font-weight="900"
      fill="white"
      stroke="black"
      stroke-width="${strokeWidth}"
      stroke-linejoin="round"
      paint-order="stroke fill"
    >${escapeXml(line)}</text>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${textElements}
</svg>`;
}

// Estimate pixel width of text — Impact is narrow, ~0.52x fontSize per char
function estimateWidth(text, fontSize) {
  return text.length * fontSize * 0.52;
}

function wrapText(text, maxWidth, fontSize) {
  const words = text.split(' ');
  const lines = [];
  let line = '';

  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (estimateWidth(test, fontSize) > maxWidth && i > 0) {
      lines.push(line.trim());
      line = words[i];
    } else {
      line = test;
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
