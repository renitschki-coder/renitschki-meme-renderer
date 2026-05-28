# GDW Meme Renderer

Node.js Service für klassische Instagram-Meme-Bilder.
Echte Impact-Schrift, weiß mit schwarzer Outline, kein Hintergrund, kein Box.

## Deployment auf Render.com

1. GitHub Repo erstellen und Code pushen
2. render.com → New → Web Service → GitHub Repo auswählen
3. Automatisch erkannt via render.yaml
4. Nach Deploy: URL merken z.B. `https://gdw-meme-renderer.onrender.com`

## API Endpoint

### POST /render

**Request:**
```json
{
  "image_url": "https://res.cloudinary.com/deerouw5e/image/upload/gdw/meme_123.jpg",
  "meme_text": "MONTAG OHNE KAFFEE",
  "logo_url": "https://res.cloudinary.com/deerouw5e/image/upload/RenitschKI_Logo_pwk8zq.png"
}
```

**Response:** JPEG Bild (Content-Type: image/jpeg)

### GET /

Health check — returns `{"status":"ok"}`

## Make Integration

In Szenario 3 / Szenario 4 — Modul "Download File" ersetzen durch:

**HTTP Modul → Make a request:**
- URL: `https://DEINE-URL.onrender.com/render`
- Method: POST
- Body Type: JSON
- Body:
```json
{
  "image_url": "{{3.data.records[].data.imageUrl}}",
  "meme_text": "{{overlayText}}",
  "logo_url": "https://res.cloudinary.com/deerouw5e/image/upload/RenitschKI_Logo_pwk8zq.png"
}
```
- Parse Response: YES

Dann Telegram sendPhoto mit `{{module.data}}` als File.

## Lokal testen

```bash
npm install
node server.js
```

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{"image_url":"https://...", "meme_text":"TEST TEXT", "logo_url":"https://..."}' \
  --output test.jpg
```
