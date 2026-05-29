const express = require("express");
const sharp = require("sharp");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const TextToSVG = require("text-to-svg");
const app = express();
app.use(express.json({ limit: "50mb" }));
const PORT = process.env.PORT || 3000;
let orbitronTTSVG = null;
let impactTTSVG = null;
try {
  orbitronTTSVG = TextToSVG.loadSync(path.join(__dirname, "Orbitron-Bold.ttf"));
  console.log("Orbitron font loaded via text-to-svg ✅");
} catch(e) { console.warn("Orbitron font not found:", e.message); }
try {
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
    if (metrics.width > maxWidth && line) { lines.push(line); line = word; }
    else { line = testLine; }
  }
  if (line) lines.push(line);
  return lines;
}
function createTextOverlaySVG(text, width, height, font = "orbitron") {
  const isOrbitron = font === "orbitron";
  const ttsvg = isOrbitron ? orbitronTTSVG : (impactTTSVG || orbitronTTSVG);
  const uppercase = !isOrbitron;
  if (!ttsvg) return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"></svg>`);
  const sidePadding = 80;
  const maxTextWidth = width - sidePadding * 2;
  const maxLines = 3;
  const bottomMargin = isOrbitron ? 160 : 80;
  let fontSize = Math.floor(width * (isOrbitron ? 0.09 : 0.10));
  const minFontSize = 40;
  let lines = [];
  while (fontSize >= minFontSize) {
    lines = wrapTextTTSVG(ttsvg, text, fontSize, maxTextWidth, uppercase);
    const tooWide = lines.some(l => ttsvg.getMetrics(l, { fontSize }).width > maxTextWidth);
    if (lines.length <= maxLines && !tooWide) break;
    fontSize -= 4;
  }
  lines = lines.slice(0, maxLines);
  const strokeWidth = Math.max(6, fontSize * 0.07);
  const lineHeight = fontSize * 1.25;
  const totalTextHeight = lines.length * lineHeight;
  const startY = height - bottomMargin - totalTextHeight;
  const pathElements = lines.map((line, index) => {
    const y = startY + index * lineHeight + fontSize;
    const metrics = ttsvg.getMetrics(line, { fontSize });
    const x = (width - metrics.width) / 2;
    const pathData = ttsvg.getD(line, { x, y, fontSize, anchor: "left top" });
    return `<path d="${pathData}" fill="white" stroke="black" stroke-width="${strokeWidth}" stroke-linejoin="round" paint-order="stroke fill"/>`;
  }).join("");
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${pathElements}</svg>`);
}
async function prepareLogo(logoBuffer, logoWidth = 120) {
  const logo = await sharp(logoBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const data = logo.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 20 && data[i+1] < 20 && data[i+2] < 20) data[i+3] = 0;
  }
  return sharp(data, { raw: { width: logo.info.width, height: logo.info.height, channels: 4 } })
    .resize({ width: logoWidth }).png().toBuffer();
}
async function renderMeme(image_url, meme_text, logo_url, font = "orbitron") {
  const width = 1080, height = 1080;
  const imageBuffer = await downloadBuffer(image_url);
  const baseImage = await sharp(imageBuffer).resize(width, height, { fit: "cover", position: "attention" }).jpeg({ quality: 94 }).toBuffer();
  const overlays = [];
  if (logo_url) {
    try {
      const logoBuffer = await downloadBuffer(logo_url);
      const logo = await prepareLogo(logoBuffer, 120);
      overlays.push({ input: logo, left: 40, top: 40, blend: "over" });
    } catch(e) { console.warn("Logo failed:", e.message); }
  }
  if (meme_text && meme_text.trim()) {
    overlays.push({ input: createTextOverlaySVG(meme_text, width, height, font), left: 0, top: 0, blend: "over" });
  }
  return sharp(baseImage).composite(overlays).jpeg({ quality: 95 }).toBuffer();
}
app.post("/render", async (req, res) => {
  const { image_url, meme_text, logo_url } = req.body;
  if (!image_url || !meme_text) return res.status(400).json({ error: "image_url und meme_text sind erforderlich" });
  try {
    const result = await renderMeme(image_url, meme_text, logo_url, "impact");
    res.set("Content-Type", "image/jpeg"); res.send(result);
  } catch (error) { res.status(500).json({ error: "Render failed", details: error.message }); }
});
app.post("/render-rk", async (req, res) => {
  const { image_url, meme_text, logo_url, font } = req.body;
  if (!image_url) return res.status(400).json({ error: "image_url ist erforderlich" });
  try {
    const result = await renderMeme(image_url, meme_text || "", logo_url || null, font || "orbitron");
    res.set("Content-Type", "image/jpeg"); res.send(result);
  } catch (error) { res.status(500).json({ error: "Render failed", details: error.message }); }
});
app.get("/test-rk", async (req, res) => {
  const meme_text = req.query.text || "Kein Kaffee kein Leben";
  const image_url = "https://res.cloudinary.com/deerouw5e/image/upload/v1779962765/gdw/meme_1779962763.png";
  const logo_url = "https://res.cloudinary.com/deerouw5e/image/upload/v1780061506/Renitschki_Logo_plain_cro7vq.png";
  try {
    const result = await renderMeme(image_url, meme_text, logo_url, "orbitron");
    res.set("Content-Type", "image/jpeg"); res.send(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DEBUG: Test OpenAI direkt ────────────────────────────────────────────────
app.get("/debug-openai", async (req, res) => {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.json({ error: "OPENAI_API_KEY not set", env: Object.keys(process.env).filter(k => k.includes('OPEN')) });
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/images/generations",
      { model: "dall-e-3", prompt: "a funny cartoon cat", n: 1, size: "1024x1024" },
      { headers: { "Authorization": `Bearer ${openaiKey.substring(0,20)}...`, "Content-Type": "application/json" }, timeout: 30000 }
    );
    res.json({ success: true, url: response.data.data[0].url });
  } catch(e) {
    res.json({
      error: e.message,
      status: e.response?.status,
      openai_error: e.response?.data?.error,
      key_prefix: openaiKey ? openaiKey.substring(0, 15) + "..." : "NOT SET"
    });
  }
});

// ─── Meme to go ───────────────────────────────────────────────────────────────
const MEME_TO_GO_WITZE = [
  "Wissenschaftler haben herausgefunden... – Und sind wieder hineingegangen.",
  "Wie nennt man einen Bumerang, der nicht zurückkommt? – Stock.",
  "Wie heißt die Frau von Herkules? – Frau Kules.",
  "Warum fliegen Vögel im Winter nach Süden? – Weil es schneller geht als Laufen.",
  "Wie nennt man einen Hund, der zaubern kann? – Labrakadabrador.",
  "Ich wollte einen Witz über die Deutsche Bahn machen, aber der kommt nicht an.",
  "Wie nennt man ein helles Mammut? – Hellmut.",
  "Warum summen Bienen? – Weil sie den Text nicht kennen.",
  "Wie heißt der Bruder von Elvis? – Zwölvis.",
  "Was sagt das Schwein zum anderen? – Es ist Wurst, was aus uns wird.",
  "Welche Sprache wird in der Sauna gesprochen? – Schwitzerdeutsch.",
  "Wie nennt man ein Rudel aggressiver Wölfe? – Wolfgang.",
  "Was steht auf dem Grab eines Mathematikers? – Damit hat er nicht gerechnet.",
  "Treffen sich zwei Jäger – Beide tot.",
  "Wie machen Igel Liebe? – Megavorsichtig.",
  "Kommt ein Skelett zum Arzt: Bisschen spät, was?",
  "Wie heißt ein Bär, der fliegen kann? – Hubschraubär.",
  "Magst du Chemie-Witze? – Chlor!",
  "Was macht ein arbeitsloser Schauspieler? – Spielt keine Rolle.",
  "Wie nennt man ein Überraschungsessen? – Topf Secret.",
  "Was passiert, wenn man nachts in der Bäckerei anruft? – Die Mehlbox geht dran.",
  "Was sagt die Null zur Acht? – Schicker Gürtel.",
  "Wie heißt ein Ritter ohne Helm? – Willhelm.",
  "Was ist weiß und stört beim Essen? – Eine Lawine.",
  "Was macht ein Clown im Büro? – Faxen."
];
const MEME_TO_GO_BACKGROUNDS = [
  "https://res.cloudinary.com/deerouw5e/image/upload/v1780059859/gdw/meme_1780059859.png",
  "https://res.cloudinary.com/deerouw5e/image/upload/v1780057997/gdw/meme_1780057997.png",
  "https://res.cloudinary.com/deerouw5e/image/upload/v1780054351/gdw/meme_1780054351.png",
  "https://res.cloudinary.com/deerouw5e/image/upload/v1780052806/gdw/meme_1780052806.png",
  "https://res.cloudinary.com/deerouw5e/image/upload/v1780049543/gdw/meme_1780049543.png"
];
const MEME_TO_GO_LOGO = "https://res.cloudinary.com/deerouw5e/image/upload/v1780064050/copy_of_renitschki_logo_plain_cro7vq.png";

app.options("/meme-to-go", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

async function generateImageForJoke(joke) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not set");
  const themes = [
    "a funny cartoon scene with animals in an office",
    "a colorful comic scene in a supermarket",
    "a funny cartoon of a dog doing human activities",
    "a colorful illustration of robots having a picnic",
    "a humorous cartoon of cats running a business meeting",
    "a funny scene of penguins at a beach bar",
    "a colorful illustration of bears hiking in the mountains",
    "a humorous cartoon of frogs playing football",
    "a funny scene of squirrels working in a bakery",
    "a funny cartoon of ducks at a gym"
  ];
  const theme = themes[Math.floor(Math.random() * themes.length)];
  const prompt = `${theme}. Vibrant colors, funny, no text in image, clean meme background style.`;
  for (const model of ["dall-e-3", "dall-e-2"]) {
    try {
      const size = model === "dall-e-3" ? "1024x1024" : "512x512";
      const body = { model, prompt, n: 1, size };
      if (model === "dall-e-3") body.quality = "standard";
      const response = await axios.post(
        "https://api.openai.com/v1/images/generations",
        body,
        { headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" }, timeout: 45000 }
      );
      console.log(`Image generated with ${model} ✅`);
      return response.data.data[0].url;
    } catch(e) {
      const errMsg = e.response?.data?.error?.message || e.message;
      console.warn(`${model} failed: ${errMsg}`);
      if (model === "dall-e-2") throw new Error(errMsg);
    }
  }
}

app.post("/meme-to-go", async (req, res) => {
  const witz = MEME_TO_GO_WITZE[Math.floor(Math.random() * MEME_TO_GO_WITZE.length)];
  let imageUrl = null;
  let usedFallback = false;
  try {
    imageUrl = await generateImageForJoke(witz);
    console.log("OpenAI image generated ✅");
  } catch (e) {
    console.warn("OpenAI fallback:", e.message);
    imageUrl = MEME_TO_GO_BACKGROUNDS[Math.floor(Math.random() * MEME_TO_GO_BACKGROUNDS.length)];
    usedFallback = true;
  }
  try {
    const result = await renderMeme(imageUrl, witz, MEME_TO_GO_LOGO, "orbitron");
    res.set("Content-Type", "image/jpeg");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("X-Used-Fallback", usedFallback ? "true" : "false");
    res.send(result);
  } catch (error) {
    res.status(500).json({ error: "Render failed", details: error.message });
  }
});

app.get("/", (req, res) => res.send("RenitschKI Meme Renderer läuft 🚀"));
app.listen(PORT, () => console.log(`Meme Renderer running on port ${PORT}`));
