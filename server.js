const express = require("express");
const sharp = require("sharp");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const TextToSVG = require("text-to-svg");

const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;

// Load fonts
let orbitronTTSVG = null;
let impactTTSVG = null;

try {
  orbitronTTSVG = TextToSVG.loadSync(path.join(__dirname, "Orbitron-Bold.ttf"));
  console.log("Orbitron font loaded via text-to-svg ✅");
} catch(e) {
  console.warn("Orbitron font not found:", e.message);
}

try {
  // Impact fallback - use system or skip
  impactTTSVG = TextToSVG.loadSync("/usr/share/fonts/truetype/msttcorefonts/Impact.ttf");
  console.log("Impact font loaded ✅");
} catch(e) {
  console.warn("Impact system font not found, using Orbitron as fallback");
  impactTTSVG = orbitronTTSVG;
}

async function downloadBuffer(url) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
}

function wrapTextTTSVG(ttsvg, text, fontSize, maxWidth, uppercase) {
  const processedText = uppercase ? text.toUpperCase() : text;
  const words = processedText.split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const metrics = ttsvg.getMetrics(testLine, { fontSize });
    if (metrics.width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function createTextOverlaySVG(text, width, height, font = "orbitron") {
  const isOrbitron = font === "orbitron";
  const ttsvg = isOrbitron ? orbitronTTSVG : (impactTTSVG || orbitronTTSVG);
  const uppercase = !isOrbitron;

  if (!ttsvg) {
    console.warn("No font loaded, skipping text overlay");
    return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"></svg>`);
  }

  const sidePadding = 80;
  const maxTextWidth = width - sidePadding * 2;
  const maxLines = 3;
  const bottomMargin = 80;

  // Auto-scale font size
  let fontSize = Math.floor(width * (isOrbitron ? 0.09 : 0.10));
  const minFontSize = 40;
  let lines = [];

  while (fontSize >= minFontSize) {
    lines = wrapTextTTSVG(ttsvg, text, fontSize, maxTextWidth, uppercase);
    const tooWide = lines.some(l => {
      const m = ttsvg.getMetrics(l, { fontSize });
      return m.width > maxTextWidth;
    });
    if (lines.length <= maxLines && !tooWide) break;
    fontSize -= 4;
  }

  lines = lines.slice(0, maxLines);

  const strokeWidth = Math.max(6, fontSize * 0.07);
  const lineHeight = fontSize * 1.25;
  const totalTextHeight = lines.length * lineHeight;
  const startY = height - bottomMargin - totalTextHeight;

  // Build SVG paths for each line
  const pathElements = lines.map((line, index) => {
    const y = startY + index * lineHeight + fontSize;
    const metrics = ttsvg.getMetrics(line, { fontSize });
    const x = (width - metrics.width) / 2;

    // Get path data
    const pathData = ttsvg.getD(line, {
      x,
      y,
      fontSize,
      anchor: "left top"
    });

    return `
      <path d="${pathData}" fill="white" stroke="black" stroke-width="${strokeWidth}" stroke-linejoin="round" paint-order="stroke fill"/>
    `;
  }).join("");

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${pathElements}
    </svg>
  `);
}

async function prepareLogo(logoBuffer, logoWidth = 120) {
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
    .resize({ width: logoWidth })
    .png()
    .toBuffer();
}

async function renderMeme(image_url, meme_text, logo_url, font = "orbitron") {
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
      const logo = await prepareLogo(logoBuffer, 120);
      overlays.push({ input: logo, left: 40, top: 40, blend: "over" });
    } catch(e) { console.warn("Logo failed:", e.message); }
  }

  if (meme_text && meme_text.trim()) {
    overlays.push({
      input: createTextOverlaySVG(meme_text, width, height, font),
      left: 0, top: 0, blend: "over"
    });
  }

  return sharp(baseImage).composite(overlays).jpeg({ quality: 95 }).toBuffer();
}

// ─── GDW endpoint (Impact/Orbitron) ────────────────────────────────────────
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

// ─── RenitschKI endpoint (Orbitron) ────────────────────────────────────────
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
  const meme_text = req.query.text || "Kein Kaffee kein Leben";
  const image_url = "https://res.cloudinary.com/deerouw5e/image/upload/v1779962765/gdw/meme_1779962763.png";
  const logo_url = "https://res.cloudinary.com/deerouw5e/image/upload/v1780061506/Renitschki_Logo_plain_cro7vq.png";
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
