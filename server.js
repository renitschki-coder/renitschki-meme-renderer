const express = require("express");
const sharp = require("sharp");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 10000;

// =========================
// LOGO BACKGROUND REMOVER
// =========================
async function prepareLogo(logoBuffer) {
  const logo = await sharp(logoBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const data = logo.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    // Schwarzen Hintergrund entfernen
    if (r < 25 && g < 25 && b < 25) {
      data[i+3] = 0;
    }
    // Keine Opacity-Reduzierung — Logo soll klar sichtbar sein
  }

  return sharp(data, {
    raw: { width: logo.info.width, height: logo.info.height, channels: 4 }
  })
    .resize({ width: 95 })
    .png()
    .toBuffer();
}

// =========================
// TEXT WRAP (font-size aware)
// =========================
function wrapText(text, fontSize, maxWidth) {
  const words = text.toUpperCase().split(/\s+/);
  const lines = [];
  let line = "";
  const avg = fontSize * 0.58; // Impact: ~0.58x fontSize per char

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (test.length * avg > maxWidth && line) {
      lines.push(line.trim());
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line.trim());
  return lines.slice(0, 3);
}

// =========================
// TEXT SVG
// =========================
function createTextSvg(text, width, height) {
  const sidePadding = 80;
  const maxWidth = width - sidePadding * 2;

  // Auto font size — reduzieren bis Text in max 3 Zeilen passt
  let fontSize = Math.floor(width / 10); // Start: ~108px
  const minFontSize = 42;

  let lines = [];
  while (fontSize >= minFontSize) {
    lines = wrapText(text, fontSize, maxWidth);
    if (lines.length <= 3) break;
    fontSize -= 4;
  }

  const lineHeight = fontSize * 1.05;
  const bottomMargin = 70;
  const totalTextHeight = lines.length * lineHeight;
  const startY = height - bottomMargin - totalTextHeight + fontSize;

  const svgText = lines.map((line, index) => `
    <text
      x="${width / 2}"
      y="${startY + index * lineHeight}"
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

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${svgText}
    </svg>
  `);
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// =========================
// RENDER CORE
// =========================
async function renderMeme(image_url, meme_text, logo_url) {
  const width = 1080, height = 1080;

  const imageBuffer = Buffer.from(
    (await axios.get(image_url, { responseType: "arraybuffer" })).data
  );

  const baseImage = await sharp(imageBuffer)
    .resize(width, height, { fit: "cover", position: "attention" })
    .jpeg({ quality: 94 })
    .toBuffer();

  const overlays = [];

  if (logo_url) {
    try {
      const logoBuffer = Buffer.from(
        (await axios.get(logo_url, { responseType: "arraybuffer" })).data
      );
      const logo = await prepareLogo(logoBuffer);
      overlays.push({ input: logo, top: 35, left: 35, blend: "over" });
    } catch(e) { console.warn("Logo failed:", e.message); }
  }

  overlays.push({
    input: createTextSvg(meme_text.toUpperCase(), width, height),
    top: 0, left: 0, blend: "over"
  });

  return sharp(baseImage).composite(overlays).jpeg({ quality: 95 }).toBuffer();
}

// =========================
// TEST ENDPOINT
// =========================
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

// =========================
// RENDER ENDPOINT
// =========================
app.post("/render", async (req, res) => {
  const { image_url, meme_text, logo_url } = req.body;
  if (!image_url || !meme_text) {
    return res.status(400).json({ error: "image_url und meme_text sind erforderlich" });
  }
  try {
    const result = await renderMeme(image_url, meme_text, logo_url);
    res.set("Content-Type", "image/jpeg");
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Render failed");
  }
});

app.get("/", (req, res) => res.send("RenitschKI Meme Renderer läuft 🚀"));

app.listen(PORT, () => console.log(`Meme Renderer running on port ${PORT}`));
