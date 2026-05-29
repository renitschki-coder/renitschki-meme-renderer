const express = require("express");
const sharp = require("sharp");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;

async function downloadBuffer(url) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function estimateTextWidth(text, fontSize, font) {
  // Orbitron is slightly wider than Impact
  const factor = font === "orbitron" ? 0.65 : 0.58;
  return text.length * fontSize * factor;
}

function wrapText(text, fontSize, maxWidth, font) {
  const words = (font === "orbitron" ? text : text.toUpperCase()).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (estimateTextWidth(testLine, fontSize, font) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function createTextSvg(text, width, height, font = "impact") {
  const isOrbitron = font === "orbitron";
  const sidePadding = isOrbitron ? 60 : 90;
  const maxTextWidth = width - sidePadding * 2;
  const maxLines = 3;

  // Orbitron starts slightly smaller since it's wider
  let fontSize = Math.floor(width * (isOrbitron ? 0.08 : 0.095));
  const minFontSize = Math.floor(width * 0.04);
  let lines = [];

  while (fontSize >= minFontSize) {
    lines = wrapText(text, fontSize, maxTextWidth, font);
    const tooWide = lines.some(l => estimateTextWidth(l, fontSize, font) > maxTextWidth);
    if (lines.length <= maxLines && !tooWide) break;
    fontSize -= 4;
  }

  lines = lines.slice(0, maxLines);

  const lineHeight = fontSize * (isOrbitron ? 1.2 : 1.05);
  const bottomMargin = isOrbitron ? 80 : 60;
  const totalHeight = lines.length * lineHeight;
  const firstY = height - bottomMargin - totalHeight + fontSize;
  const strokeWidth = Math.max(6, fontSize * (isOrbitron ? 0.07 : 0.1));

  const fontFamily = isOrbitron
    ? "Orbitron, Arial Black, sans-serif"
    : "Impact, Arial Black, sans-serif";

  const fontStyle = isOrbitron
    ? `font-weight="700" letter-spacing="${Math.floor(fontSize * 0.05)}"`
    : `font-weight="900"`;

  // Google Fonts embed for Orbitron
  const fontEmbed = isOrbitron
    ? `<defs>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&amp;display=swap');
        </style>
       </defs>`
    : "";

  const textElements = lines.map((line, index) => `
    <text
      x="${width / 2}"
      y="${firstY + index * lineHeight}"
      text-anchor="middle"
      font-family="${fontFamily}"
      font-size="${fontSize}"
      ${fontStyle}
      fill="white"
      stroke="black"
      stroke-width="${strokeWidth}"
      paint-order="stroke fill"
      stroke-linejoin="round"
    >${escapeXml(line)}</text>
  `).join("");

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${fontEmbed}
      ${textElements}
    </svg>
  `);
}

async function prepareLogo(logoBuffer) {
  const logo = await sharp(logoBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const data = logo.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    if (r < 20 && g < 20 && b < 20) {
      data[i+3] = 0;
    }
  }

  return sharp(data, {
    raw: { width: logo.info.width, height: logo.info.height, channels: 4 }
  })
    .resize({ width: 95 })
    .png()
    .toBuffer();
}

async function renderMeme(image_url, meme_text, logo_url, font = "impact", size = 1080) {
  const width = size, height = size;
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

  // Only add text overlay if meme_text is provided
  if (meme_text && meme_text.trim()) {
    overlays.push({
      input: createTextSvg(meme_text, width, height, font),
      left: 0, top: 0, blend: "over"
    });
  }

  return sharp(baseImage).composite(overlays).jpeg({ quality: 95 }).toBuffer();
}

// ─── Original GDW endpoint (Impact font, no changes) ───────────────────────
app.post("/render", async (req, res) => {
  const { image_url, meme_text, logo_url } = req.body;
  if (!image_url || !meme_text) {
    return res.status(400).json({ error: "image_url und meme_text sind erforderlich" });
  }
  try {
    const result = await renderMeme(image_url, meme_text, logo_url, "impact");
    res.set("Content-Type", "image/jpeg");
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Render failed", details: error.message });
  }
});

// ─── New RenitschKI endpoint ────────────────────────────────────────────────
// font: "orbitron" | "impact" (default: orbitron)
// meme_text: optional — if empty, just resizes image with optional logo
// logo_url: optional
app.post("/render-rk", async (req, res) => {
  const { image_url, meme_text, logo_url, font } = req.body;
  if (!image_url) {
    return res.status(400).json({ error: "image_url ist erforderlich" });
  }
  try {
    const result = await renderMeme(
      image_url,
      meme_text || "",
      logo_url || null,
      font || "orbitron"
    );
    res.set("Content-Type", "image/jpeg");
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Render failed", details: error.message });
  }
});

// ─── Test endpoints ─────────────────────────────────────────────────────────
app.get("/test", async (req, res) => {
  const meme_text = req.query.text || "MONTAG OHNE KAFFEE";
  const image_url = "https://res.cloudinary.com/deerouw5e/image/upload/v1779962765/gdw/meme_1779962763.png";
  const logo_url = "https://res.cloudinary.com/deerouw5e/image/upload/RenitschKI_Logo_pwk8zq.png";
  try {
    const result = await renderMeme(image_url, meme_text, logo_url, "impact");
    res.set("Content-Type", "image/jpeg");
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/test-rk", async (req, res) => {
  const meme_text = req.query.text || "KEIN KAFFEE KEIN LEBEN";
  const image_url = "https://res.cloudinary.com/deerouw5e/image/upload/v1779962765/gdw/meme_1779962763.png";
  const logo_url = "https://res.cloudinary.com/deerouw5e/image/upload/RenitschKI_Logo_pwk8zq.png";
  try {
    const result = await renderMeme(image_url, meme_text, logo_url, "orbitron");
    res.set("Content-Type", "image/jpeg");
    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("RenitschKI Meme Renderer läuft 🚀"));

app.listen(PORT, () => console.log(`Meme Renderer running on port ${PORT}`));
