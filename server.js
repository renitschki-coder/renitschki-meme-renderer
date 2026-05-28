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
    const estimatedWidth = testLine.length * approxCharWidth;

    if (estimatedWidth > maxWidth && line) {
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
    const estimatedWidth = longest * fontSize * 0.62;

    if (lines.length <= 3 && estimatedWidth <= maxTextWidth) break;
    fontSize -= 4;
  }

  const lineHeight = fontSize * 1.05;
  const totalHeight = lines.length * lineHeight;
  const startY = height - bottomPadding - totalHeight + fontSize;

  const textElements = lines.map((line, index) => {
    const y = startY + index * lineHeight;
    return `
      <text
        x="${width / 2}"
        y="${y}"
        text-anchor="middle"
        font-family="Impact, Arial Black, sans-serif"
        font-size="${fontSize}"
        font-weight="900"
        fill="white"
        stroke="black"
        stroke-width="${Math.max(7, fontSize * 0.09)}"
        paint-order="stroke fill"
        stroke-linejoin="round"
      >${escapeXml(line)}</text>
    `;
  }).join("");

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${textElements}
    </svg>
  `);
}

async function makeLogoTransparent(logoBuffer) {
  const { data, info } = await sharp(logoBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (r < 28 && g < 28 && b < 28) {
      data[i + 3] = 0;
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4
    }
  }).png().toBuffer();
}

app.post("/render", async (req, res) => {
  try {
    const { image_url, meme_text, logo_url } = req.body;

    if (!image_url || !meme_text) {
      return res.status(400).json({
        error: "image_url und meme_text sind erforderlich"
      });
    }

    const width = 1080;
    const height = 1080;

    const imageBuffer = await downloadBuffer(image_url);

    let baseImage = await sharp(imageBuffer)
      .resize(width, height, {
        fit: "cover",
        position: "attention"
      })
      .jpeg({ quality: 92 })
      .toBuffer();

    const overlays = [];

    if (logo_url) {
      const logoBuffer = await downloadBuffer(logo_url);
      const transparentLogo = await makeLogoTransparent(logoBuffer);

      const logo = await sharp(transparentLogo)
        .resize({ width: 130 })
        .png()
        .toBuffer();

      overlays.push({
        input: logo,
        left: 55,
        top: 55,
        blend: "over"
      });
    }

    const textSvg = createTextSvg(meme_text, width, height);

    overlays.push({
      input: textSvg,
      left: 0,
      top: 0,
      blend: "over"
    });

    const finalImage = await sharp(baseImage)
      .composite(overlays)
      .jpeg({ quality: 94 })
      .toBuffer();

    res.set("Content-Type", "image/jpeg");
    res.send(finalImage);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Rendering failed",
      details: error.message
    });
  }
});

app.get("/", (req, res) => {
  res.send("RenitschKI Meme Renderer läuft 🚀");
});

app.listen(PORT, () => {
  console.log(`Meme Renderer running on port ${PORT}`);
});
