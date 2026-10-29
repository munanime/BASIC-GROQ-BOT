require("dotenv").config();

const express = require("express");
const Groq = require("groq-sdk");
const path = require("node:path");
const { toFile } = require("groq-sdk");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const apiKey = process.env.GROQ_API_KEY?.trim();

if (!apiKey) {
  console.error("GROQ_API_KEY is required. Set it in your host's environment variables.");
  process.exit(1);
}

const groq = new Groq({ apiKey });
const publicDirectory = path.join(__dirname, "public");

if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

function rateLimit(maxRequests, windowMs) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      res.setHeader("Retry-After", String(Math.ceil((windowMs - (now - bucket.start)) / 1000)));
      return res.status(429).json({ error: "Too many requests. Please wait and try again." });
    }
    if (buckets.size > 10000) {
      for (const [address, entry] of buckets) {
        if (now - entry.start >= windowMs) buckets.delete(address);
      }
    }
    return next();
  };
}

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "microphone=(self)");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: "30mb" }));
app.use(express.static(publicDirectory, { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));

function decodeUpload({ data, name, type }) {
  if (typeof data !== "string" || typeof name !== "string" || typeof type !== "string") {
    throw Object.assign(new Error("Invalid file upload."), { status: 400 });
  }
  const match = data.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match || match[1] !== type) {
    throw Object.assign(new Error("Invalid file encoding."), { status: 400 });
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
    throw Object.assign(new Error("Files must be smaller than 10 MB."), { status: 413 });
  }
  return { buffer, name: path.basename(name), type };
}

app.use("/extract", rateLimit(30, 60_000));
app.post("/extract", async (req, res, next) => {
  try {
    const uploaded = decodeUpload(req.body || {});
    const extension = path.extname(uploaded.name).toLowerCase();
    let text;

    if (extension === ".pdf" || uploaded.type === "application/pdf") {
      text = (await pdfParse(uploaded.buffer)).text;
    } else if (extension === ".docx") {
      text = (await mammoth.extractRawText({ buffer: uploaded.buffer })).value;
    } else if ([".txt", ".md", ".csv", ".json", ".html"].includes(extension)) {
      text = uploaded.buffer.toString("utf8");
    } else {
      return res.status(415).json({ error: "Supported documents: PDF, DOCX, TXT, Markdown, CSV, JSON, and HTML." });
    }

    text = text.replace(/\u0000/g, "").trim();
    if (!text) return res.status(422).json({ error: "No readable text was found in that document." });
    return res.json({ text: text.slice(0, 60000), truncated: text.length > 60000 });
  } catch (error) {
    return next(error);
  }
});

app.use("/transcribe", rateLimit(10, 60_000));
app.post("/transcribe", async (req, res, next) => {
  let uploaded;
  try {
    uploaded = decodeUpload(req.body || {});
    const audioTypes = ["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp4", "audio/mp3"];
    if (!audioTypes.includes(uploaded.type)) {
      return res.status(415).json({ error: "Unsupported audio format. Use WebM, OGG, WAV, MP3, or M4A." });
    }
    const file = await toFile(uploaded.buffer, uploaded.name, { type: uploaded.type });
    const result = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3-turbo",
      response_format: "json",
    });
    return res.json({ text: result.text || "" });
  } catch (error) {
    if (error.status === 400 || error.status === 413) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Transcription request failed:", error.message);
    return res.status(502).json({ error: "Unable to transcribe that audio." });
  }
});

app.use("/chat", rateLimit(20, 60_000));
app.post("/chat", async (req, res) => {
  const message = req.body?.message;
  const history = req.body?.messages;

  if (typeof message !== "string" || !message.trim() || message.length > 12000) {
    return res.status(400).json({ error: "Provide a message between 1 and 12,000 characters." });
  }
  if (!Array.isArray(history) || history.length < 1 || history.length > 40) {
    return res.status(400).json({ error: "Conversation history is invalid or too long." });
  }

  const validHistory = history.every((item) => {
    if (!item || !["user", "assistant"].includes(item.role)) return false;
    if (typeof item.content === "string") return item.content.trim().length > 0 && item.content.length <= 60000;
    if (item.role !== "user" || !Array.isArray(item.content) || item.content.length > 4) return false;
    return item.content.every((part) => {
      if (part?.type === "text") return typeof part.text === "string" && part.text.length <= 60000;
      return part?.type === "image_url" && typeof part.image_url?.url === "string" &&
        /^data:image\/(jpeg|png|webp);base64,/.test(part.image_url.url) && part.image_url.url.length <= 11 * 1024 * 1024;
    });
  });

  const latest = history.at(-1);
  const latestText = typeof latest?.content === "string"
    ? latest.content
    : latest?.content?.find((part) => part.type === "text")?.text;
  if (!validHistory || latest?.role !== "user" || !latestText?.includes(message.trim())) {
    return res.status(400).json({ error: "Conversation history must include your latest message." });
  }

  const imageCount = history.reduce((count, item) => count + (Array.isArray(item.content)
    ? item.content.filter((part) => part.type === "image_url").length
    : 0), 0);
  if (imageCount > 3) return res.status(400).json({ error: "A request can include up to three images." });

  try {
    const completion = await groq.chat.completions.create({
      model: imageCount ? "qwen/qwen3.8-27b" : "openai/gpt-oss-120b",
      messages: history.map(({ role, content }) => ({
        role,
        content: typeof content === "string"
          ? content.trim()
          : content.map((part) => part.type === "text"
            ? { type: "text", text: part.text.trim() }
            : { type: "image_url", image_url: { url: part.image_url.url } }),
      })),
    });
    const reply = completion.choices?.[0]?.message?.content;
    if (typeof reply !== "string") return res.status(502).json({ error: "Groq returned an empty response." });
    return res.json({ reply });
  } catch (error) {
    console.error("Groq chat request failed:", error.message);
    return res.status(502).json({ error: "Unable to get a response from Groq." });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  if (error.status === 413) return res.status(413).json({ error: "Request is too large." });
  if (error.status === 400) return res.status(400).json({ error: error.message || "Invalid request." });
  console.error("Request error:", error.message);
  return res.status(500).json({ error: "An unexpected server error occurred." });
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = app;
