const express = require("express");
const sharp = require("sharp");
const axios = require("axios");
const path = require("path");
const TextToSVG = require("text-to-svg");
const app = express();
app.use(express.json({ limit: "50mb" }));
const PORT = process.env.PORT || 3000;
let orbitronTTSVG = null;
let impactTTSVG = null;
try {
  orbitronTTSVG = TextToSVG.loadSync(path.join(__dirname, "Orbitron-Bold.ttf"));
  console.log("Orbitron font loaded ✅");
} catch(e) { console.warn("Orbitron font not found:", e.message); }
try {
  impactTTSVG = TextToSVG.loadSync("/usr/share/fonts/truetype/msttcorefonts/Impact.ttf");
} catch(e) { impactTTSVG = orbitronTTSVG; }
async function downloadBuffer(url) {
  const r = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(r.data);
}
function wrapTextTTSVG(ttsvg, text, fontSize, maxWidth, uppercase) {
  const words = (uppercase ? text.toUpperCase() : text).split(/\s+/);
  const lines = []; let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ttsvg.getMetrics(t, { fontSize }).width > maxWidth && line) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function createTextOverlaySVG(text, width, height, font = "orbitron") {
  const isOrbitron = font === "orbitron";
  const ttsvg = isOrbitron ? orbitronTTSVG : (impactTTSVG || orbitronTTSVG);
  if (!ttsvg) return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"></svg>`);
  const maxTextWidth = width - 160;
  let fontSize = Math.floor(width * (isOrbitron ? 0.09 : 0.10));
  let lines = [];
  while (fontSize >= 40) {
    lines = wrapTextTTSVG(ttsvg, text, fontSize, maxTextWidth, !isOrbitron);
    if (lines.length <= 3 && !lines.some(l => ttsvg.getMetrics(l, { fontSize }).width > maxTextWidth)) break;
    fontSize -= 4;
  }
  lines = lines.slice(0, 3);
  const sw = Math.max(6, fontSize * 0.07), lh = fontSize * 1.25;
  const startY = height - (isOrbitron ? 160 : 80) - lines.length * lh;
  const paths = lines.map((line, i) => {
    const m = ttsvg.getMetrics(line, { fontSize });
    const x = (width - m.width) / 2, y = startY + i * lh + fontSize;
    return `<path d="${ttsvg.getD(line, { x, y, fontSize, anchor: "left top" })}" fill="white" stroke="black" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke fill"/>`;
  }).join("");
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`);
}
async function prepareLogo(buf, w = 120) {
  const l = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const d = l.data;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 20 && d[i+1] < 20 && d[i+2] < 20) d[i+3] = 0;
  return sharp(d, { raw: { width: l.info.width, height: l.info.height, channels: 4 } }).resize({ width: w }).png().toBuffer();
}
async function renderMeme(image_url, meme_text, logo_url, font = "orbitron") {
  const width = 1080, height = 1080;
  const base = await sharp(await downloadBuffer(image_url)).resize(width, height, { fit: "cover", position: "attention" }).jpeg({ quality: 94 }).toBuffer();
  const overlays = [];
  if (logo_url) { try { overlays.push({ input: await prepareLogo(await downloadBuffer(logo_url)), left: 40, top: 40, blend: "over" }); } catch(e) {} }
  if (meme_text?.trim()) overlays.push({ input: createTextOverlaySVG(meme_text, width, height, font), left: 0, top: 0, blend: "over" });
  return sharp(base).composite(overlays).jpeg({ quality: 95 }).toBuffer();
}
app.post("/render", async (req, res) => {
  const { image_url, meme_text, logo_url } = req.body;
  if (!image_url || !meme_text) return res.status(400).json({ error: "image_url und meme_text sind erforderlich" });
  try { res.set("Content-Type", "image/jpeg"); res.send(await renderMeme(image_url, meme_text, logo_url, "impact")); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/render-rk", async (req, res) => {
  const { image_url, meme_text, logo_url, font } = req.body;
  if (!image_url) return res.status(400).json({ error: "image_url ist erforderlich" });
  try { res.set("Content-Type", "image/jpeg"); res.send(await renderMeme(image_url, meme_text || "", logo_url || null, font || "orbitron")); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/test-rk", async (req, res) => {
  try { res.set("Content-Type", "image/jpeg"); res.send(await renderMeme("https://res.cloudinary.com/deerouw5e/image/upload/v1779962765/gdw/meme_1779962763.png", req.query.text || "Kein Kaffee kein Leben", "https://res.cloudinary.com/deerouw5e/image/upload/v1780061506/Renitschki_Logo_plain_cro7vq.png", "orbitron")); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/debug-openai", async (req, res) => {
  const raw = process.env.OPENAI_API_KEY || "";
  const clean = raw.trim().replace(/[\n\r\t]/g, "");
  const info = { raw_len: raw.length, clean_len: clean.length, prefix: clean.substring(0, 20), suffix: clean.slice(-6) };
  try {
    const r = await axios.post("https://api.openai.com/v1/images/generations",
      { model: "dall-e-2", prompt: "a funny cartoon cat", n: 1, size: "512x512" },
      { headers: { "Authorization": `Bearer ${clean}`, "Content-Type": "application/json" }, timeout: 30000 }
    );
    res.json({ success: true, url: r.data.data[0].url, info });
  } catch(e) { res.json({ error: e.message, status: e.response?.status, openai_error: e.response?.data?.error, info }); }
});
const WITZE = [
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
const BGS = [
  "https://res.cloudinary.com/deerouw5e/image/upload/v1780059859/gdw/meme_1780059859.png",
  "https://res.cloudinary.com/deerouw5e/image/upload/v1780057997/gdw/meme_1780057997.png",
  "https://res.cloudinary.com/deerouw5e/image/upload/v1780054351/gdw/meme_1780054351.png",
  "https://res.cloudinary.com/deerouw5e/image/upload/v1780052806/gdw/meme_1780052806.png",
  "https://res.cloudinary.com/deerouw5e/image/upload/v1780049543/gdw/meme_1780049543.png"
];
const LOGO = "https://res.cloudinary.com/deerouw5e/image/upload/v1780064050/copy_of_renitschki_logo_plain_cro7vq.png";
app.options("/meme-to-go", (req, res) => { res.set("Access-Control-Allow-Origin","*"); res.set("Access-Control-Allow-Methods","POST,OPTIONS"); res.set("Access-Control-Allow-Headers","Content-Type"); res.sendStatus(204); });
async function generateImage() {
  const raw = process.env.OPENAI_API_KEY;
  if (!raw) throw new Error("no key");
  const key = raw.trim().replace(/[\n\r\t]/g, "");
  const themes = ["funny cartoon animals in an office","colorful cartoon dogs cooking","funny cartoon cats at a gym","cartoon penguins at a beach bar","funny cartoon frogs playing football"];
  const prompt = themes[Math.floor(Math.random() * themes.length)] + ". Vibrant, funny, no text.";
  const r = await axios.post("https://api.openai.com/v1/images/generations",
    { model: "dall-e-2", prompt, n: 1, size: "512x512" },
    { headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }, timeout: 45000 }
  );
  return r.data.data[0].url;
}
app.post("/meme-to-go", async (req, res) => {
  const witz = WITZE[Math.floor(Math.random() * WITZE.length)];
  let imageUrl, fallback = false;
  try { imageUrl = await generateImage(); console.log("OpenAI ✅"); }
  catch(e) { console.warn("Fallback:", e.message); imageUrl = BGS[Math.floor(Math.random() * BGS.length)]; fallback = true; }
  try {
    res.set("Content-Type","image/jpeg"); res.set("Access-Control-Allow-Origin","*"); res.set("X-Fallback", fallback ? "1":"0");
    res.send(await renderMeme(imageUrl, witz, LOGO, "orbitron"));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get("/", (req, res) => res.send("RenitschKI Meme Renderer läuft 🚀"));
app.listen(PORT, () => console.log(`Running on ${PORT}`));
