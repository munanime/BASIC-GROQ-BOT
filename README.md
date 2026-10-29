# Groq AI Chatbot

A single Node.js service that serves the web app and proxies chat, vision, document extraction, and audio transcription requests to Groq. The browser never receives the Groq API key.

## Run locally

1. Install Node.js 24 (the project pins `24.x` for Vercel and local version managers).
2. Copy `.env.example` to `.env` and set `GROQ_API_KEY`.
3. Run `npm ci`.
4. Run `npm start` and open `http://localhost:3000`.

## Deploy

Deploy this repository as a Node.js web service. Set the start command to `npm start`, and add `GROQ_API_KEY` in the host's secret environment variable settings. The service listens on `PORT` and exposes `GET /healthz` for health checks. Keep `.env` out of source control; `.env.example` contains placeholders only.

If the host uses one trusted reverse proxy, set `TRUST_PROXY=1` so per-client request limits can use the forwarded client address. Do not enable this behind an untrusted proxy.

If an npm build warns about an unknown `cache-dir` setting, remove the `npm_config_cache_dir` / `NPM_CONFIG_CACHE_DIR` variable from the hosting project's environment settings. npm's supported cache setting is `npm_config_cache`.

## Supported inputs

- Chat with up to 40 recent conversation messages.
- Up to three JPG, PNG, or WebP images per message (8 MB each, 12 MB combined).
- PDF, DOCX, TXT, Markdown, CSV, JSON, and HTML documents (up to 10 MB each; extracted text is capped at 60,000 characters).
- Browser-recorded voice notes, transcribed by Groq. Microphone access requires localhost or HTTPS.

Chat history is stored in the browser's local storage. Uploaded image data is kept in memory for the open page and is not retained on the server. This starter app has no user accounts; its request limits are in-memory per process. For a public multi-instance service, add authentication and shared rate limiting/storage before inviting unrestricted traffic.
