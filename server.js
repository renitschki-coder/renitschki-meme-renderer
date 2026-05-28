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

function estimateTextWidth(text, fontSize) {
  return text.length * fontSize * 0.58;
}

function wrapText(text, fontSize, maxWidth) {
  const words = text.toUpperCase().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (estimateTextWidth(testLine, fontSize) > maxWidth && line) {
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
  const sidePadding = 90;
  const maxTextWidth = width - sidePadding * 2;
  const maxLines = 3;

  let fontSize = Math.floor(width * 0.095);
  const minFontSize = Math.floor(width * 0.04);
  let lines = [];

  while (fontSize >= minFontSize) {
    lines = wrapText(text, fontSize, maxTextWidth);
    const tooWide = lines.some(l => estimateTextWidth(l, fontSize) > maxTextWidth);
    if (lines.length <= maxLines && !tooWide) break;
    fontSize -= 4;
  }

  lines = lines.slice(0, maxLines);

  const lineHeight = fontSize * 1.05;
  const bottomMargin = 60;
  const totalHeight = lines.length * lineHeight;
  const firstY = height - bottomMargin - totalHeight + fontSize;
  const strokeWidth = Math.max(8, fontSize * 0.1);

  const textElements = lines.map((line, index) => `
    <text
      x="${width / 2}"
      y="${firstY + index * lineHeight}"
      text-anchor="middle"
      font-family="Impact, Arial Black, sans-serif"
      font-size="${fontSize}"
      font-weight="900"
      fill="white"
      stroke="black"
      stroke-width="${strokeWidth}"
      paint-order="stroke fill"
      stroke-linejoin="round"
    >${escapeXml(line)}</text>
  `).join("");

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
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
      data[i+3] = 0; // schwarzen Hintergrund transparent
    }
    // Keine Opacity-Reduzierung — Logo bleibt original
  }

  return sharp(data, {
    raw: { width: logo.info.width, height: logo.info.height, channels: 4 }
  })
    .resize({ width: 95 })
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

  return sharp(baseImage).composite(overlays).jpeg({ quality: 95 }).toBuffer();
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
  if (!image_url || !meme_text) {
    return res.status(400).json({ error: "image_url und meme_text sind erforderlich" });
  }
  try {
    const result = await renderMeme(image_url, meme_text, logo_url);
    res.set("Content-Type", "image/jpeg");
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Render failed", details: error.message });
  }
});

app.get("/", (req, res) => res.send("RenitschKI Meme Renderer läuft 🚀"));

app.listen(PORT, () => console.log(`Meme Renderer running on port ${PORT}`));
