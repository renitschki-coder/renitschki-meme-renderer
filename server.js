const express = require("express");
const sharp = require("sharp");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 10000;

async function downloadBuffer(url) {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(res.data);
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapText(text, fontSize, maxWidth) {
  const words = text.toUpperCase().split(/\s+/);
  const lines = [];
  let line = "";
  const avg = fontSize * 0.58;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (test.length * avg > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function createTextSvg(text, width, height) {
  const paddingX = 90;
  const maxTextWidth = width - paddingX * 2;
  let fontSize = 96;
  const minFontSize = 42;
  let lines = [];
  while (fontSize >= minFontSize) {
    lines = wrapText(text, fontSize, maxTextWidth);
    const longest = Math.max(...lines.map(l => l.length));
    if (lines.length <= 3 && longest * fontSize * 0.58 <= maxTextWidth) break;
    fontSize -= 4;
  }
  const lineHeight = fontSize * 1.05;
  const bottomPadding = 58;
  const totalHeight = lines.length * lineHeight;
  const startY = height - bottomPadding - totalHeight + fontSize;
  const svgText = lines.map((line, i) => `
    <text
      x="${width / 2}"
      y="${startY + i * lineHeight}"
      text-anchor="middle"
      font-family="Impact, Arial Black, sans-serif"
      font-size="${fontSize}"
      font-weight="900"
      fill="white"
      stroke="black"
      stroke-width="${Math.max(8, fontSize * 0.10)}"
      paint-order="stroke fill"
      stroke-linejoin="round"
    >${escapeXml(line)}</text>
  `).join("");
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svgText}</svg>`);
}

async function prepareLogo(logoBuffer) {
  // Kein Crop — volles Logo verwenden
  // Schwarze/dunkle Pixel transparent machen, Rest auf 30% Opacity
  const { data, info } = await sharp(logoBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    // Schwarzer Hintergrund weg
    if (r < 40 && g < 40 && b < 40) {
      data[i+3] = 0;
    } else {
      // Wasserzeichen-Effekt: 30% Opacity
      data[i+3] = Math.round(data[i+3] * 0.30);
    }
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 }
  })
    .trim()
    .resize({ width: 110 })
    .png()
    .toBuffer();
}

async function renderMeme(image_url, meme_text, logo_url) {
  const width = 1080, height = 1080;
  const imageBuffer = await downloadBuffer(image_url);
  const baseImage = await sharp(imageBuffer)
    .resize(width, height, { fit: "cover", position: "attention" })
    .jpeg({ quality: 94 })
    .toBuffer();

  const overlays = [];

  if (logo_url) {
    try {
      const logoBuffer = await downloadBuffer(logo_url);
      const logo = await prepareLogo(logoBuffer);
      overlays.push({ input: logo, left: 40, top: 40, blend: "over" });
    } catch(e) { console.warn("Logo failed:", e.message); }
  }

  overlays.push({
    input: createTextSvg(meme_text, width, height),
    left: 0, top: 0, blend: "over"
  });

  return sharp(baseImage).composite(overlays).jpeg({ quality: 94 }).toBuffer();
}

// Test im Browser
app.get("/test", async (req, res) => {
  const meme_text = req.query.text || "MONTAG OHNE KAFFEE";
  const image_url = "https://res.cloudinary.com/deerouw5e/image/upload/v1779962765/gdw/meme_1779962763.png";
  const logo_url = "https://res.cloudinary.com/deerouw5e/image/upload/RenitschKI_Logo_pwk8zq.png";
  try {
    const result = await renderMeme(image_url, meme_text, logo_url);
    res.set("Content-Type", "image/jpeg");
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/render", async (req, res) => {
  const { image_url, meme_text, logo_url } = req.body;
  if (!image_url || !meme_text) return res.status(400).json({ error: "image_url und meme_text sind erforderlich" });
  try {
    const result = await renderMeme(image_url, meme_text, logo_url);
    res.set("Content-Type", "image/jpeg");
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Rendering failed", details: error.message });
  }
});

app.get("/", (req, res) => res.send("RenitschKI Meme Renderer läuft 🚀"));

app.listen(PORT, () => console.log(`Meme Renderer running on port ${PORT}`));
