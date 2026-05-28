const express = require('express');
const { createCanvas, loadImage, registerFont } = require('canvas');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WIDTH = 1080;
const HEIGHT = 1080;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'GDW Meme Renderer' });
});

// Main endpoint
app.post('/render', async (req, res) => {
  const { image_url, meme_text, logo_url } = req.body;

  if (!image_url || !meme_text) {
    return res.status(400).json({ error: 'image_url and meme_text required' });
  }

  try {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Load and draw background image
    const imgBuffer = await fetchBuffer(image_url);
    const bgImage = await loadImage(imgBuffer);
    ctx.drawImage(bgImage, 0, 0, WIDTH, HEIGHT);

    // Draw meme text
    drawMemeText(ctx, meme_text.toUpperCase(), WIDTH, HEIGHT);

    // Draw logo if provided
    if (logo_url) {
      await drawLogo(ctx, logo_url, WIDTH, HEIGHT);
    }

    // Return as JPEG
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });
    res.set('Content-Type', 'image/jpeg');
    res.send(buffer);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function drawMemeText(ctx, text, width, height) {
  const maxWidth = width - 60;
  const strokeWidth = 8;

  // Auto font scaling
  let fontSize = 100;
  ctx.font = `bold ${fontSize}px Impact`;

  // Word wrap
  const words = text.split(' ');
  let lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);

  // Limit to 3 lines, scale down if needed
  if (lines.length > 3) {
    fontSize = 75;
    ctx.font = `bold ${fontSize}px Impact`;
    lines = [];
    currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(testLine).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
  }

  const lineHeight = fontSize * 1.15;
  const totalTextHeight = lines.length * lineHeight;
  const startY = height - 38 - totalTextHeight + lineHeight;

  ctx.font = `bold ${fontSize}px Impact`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineHeight;
    const x = width / 2;

    // Black outline — stroke only, no fill background
    ctx.lineWidth = strokeWidth * 2;
    ctx.strokeStyle = 'black';
    ctx.lineJoin = 'round';
    ctx.strokeText(lines[i], x, y);

    // White fill
    ctx.fillStyle = 'white';
    ctx.fillText(lines[i], x, y);
  }
}

async function drawLogo(ctx, logoUrl, width, height) {
  try {
    const logoBuffer = await fetchBuffer(logoUrl);
    const logoImage = await loadImage(logoBuffer);

    const logoWidth = 120;
    const logoHeight = (logoImage.height / logoImage.width) * logoWidth;
    const x = width - logoWidth - 18;
    const y = height - logoHeight - 18;

    ctx.globalAlpha = 0.30;
    ctx.drawImage(logoImage, x, y, logoWidth, logoHeight);
    ctx.globalAlpha = 1.0;
  } catch (e) {
    console.warn('Logo load failed:', e.message);
  }
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
