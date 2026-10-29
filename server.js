require("dotenv").config();

const express = require("express");
const Groq = require("groq-sdk");
const path = require("node:path");

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const apiKey = process.env.GROQ_API_KEY?.trim();

if (!apiKey) {
  console.error("ERROR: GROQ_API_KEY is missing from your .env file.");
  process.exit(1);
}

const groq = new Groq({ apiKey });

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/chat", async (req, res) => {
  const message = req.body?.message;
  const history = req.body?.messages;

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      error: "Please provide a valid message.",
    });
  }

  if (!Array.isArray(history) || history.length > 40) {
    return res.status(400).json({ error: "Conversation history is invalid or too long." });
  }

  const validHistory = history.every((item) =>
    item &&
    ["user", "assistant"].includes(item.role) &&
    typeof item.content === "string" &&
    item.content.trim() &&
    item.content.length <= 12000
  );

  if (!validHistory || history.at(-1)?.role !== "user" || history.at(-1)?.content !== message.trim()) {
    return res.status(400).json({ error: "Conversation history must end with your latest message." });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: history.map(({ role, content }) => ({ role, content: content.trim() })),
    });

    const reply = completion.choices?.[0]?.message?.content;
    if (typeof reply !== "string") {
      console.error("Groq API returned no text reply.");
      return res.status(502).json({ error: "Groq returned an empty response." });
    }

    return res.json({ reply });
  } catch (error) {
    console.error("Groq API error:", error);
    return res.status(502).json({
      error: "Unable to get a response from Groq.",
    });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }

  if (error.status === 413) {
    return res.status(413).json({ error: "Request body is too large." });
  }

  console.error("Request error:", error);
  return res.status(500).json({ error: "An unexpected server error occurred." });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
