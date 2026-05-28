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
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text, fontSize, maxWidth) {
  const words = text.toUpperCase().split(/\s+/);
  const lines = [];
  let line = "";
  const approxCharWidth = fontSize * 0.62;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (testLine.length * approxCharWidth > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function createTextSvg(text, width, height) {
  const paddingX = 90;
  const bottomPadding = 58;
  const maxTextWidth = width - paddingX * 2;
  let fontSize = 100;
  const minFontSize = 42;
  let lines = [];
  while (fontSize >= minFontSize) {
    lines = wrapText(text, fontSize, maxTextWidth);
    const longest = Math.max(...lines.map(l => l.length));
    if (lines.length <= 3 && longest * fontSize * 0.62 <= maxTextWidth) break;
    fontSize -= 4;
  }
  const lineHeight = fontSize * 1.05;
  const totalHeight = lines.length * lineHeight;
  const startY = height - bottomPadding - totalHeight + fontSize;
  const textElements = lines.map((line, index) => {
    const y = startY + index * lineHeight;
    return `<text x="${width / 2}" y="${y}" text-anchor="middle"
      font-family="Impact, Arial Black, sans-serif" font-size="${fontSize}"
      font-weight="900" fill="white" stroke="black"
      stroke-width="${Math.max(7, fontSize * 0.09)}"
      paint-order="stroke fill" stroke-linejoin="round"
    >${escapeXml(line)}</text>`;
  }).join("");
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${textElements}</svg>`);
}

async function makeLogoTransparent(logoBuffer) {
  const { data, info } = await sharp(logoBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 28 && data[i+1] < 28 && data[i+2] < 28) data[i+3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function renderMeme(image_url, meme_text, logo_url) {
  const width = 1080, height = 1080;
  const imageBuffer = await downloadBuffer(image_url);
  let baseImage = await sharp(imageBuffer)
    .resize(width, height, { fit: "cover", position: "attention" })
    .jpeg({ quality: 92 }).toBuffer();
  const overlays = [];
  if (logo_url) {
    try {
      const logoBuffer = await downloadBuffer(logo_url);
      const transparentLogo = await makeLogoTransparent(logoBuffer);
      const logo = await sharp(transparentLogo).resize({ width: 130 }).png().toBuffer();
      overlays.push({ input: logo, left: 55, top: 55, blend: "over" });
    } catch(e) { console.warn("Logo failed:", e.message); }
  }
  overlays.push({ input: createTextSvg(meme_text, width, height), left: 0, top: 0, blend: "over" });
  return sharp(baseImage).composite(overlays).jpeg({ quality: 94 }).toBuffer();
}

// Test endpoint — im Browser öffnen
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
