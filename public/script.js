const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const chatMessages = document.getElementById("chatMessages");
const sendButton = document.getElementById("sendButton");
const welcomeMessage = document.getElementById("welcomeMessage");
const historyElement = document.getElementById("chatHistory");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const fileInput = document.getElementById("fileInput");
const attachmentList = document.getElementById("attachmentList");
const recordingStatus = document.getElementById("recordingStatus");
const attachButton = document.getElementById("attachButton");
const voiceButton = document.getElementById("voiceButton");
const STORAGE_KEY = "groq-ai-chats-v1";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_TOTAL = 12 * 1024 * 1024;

let chats = loadChats();
let currentChat = createChat();
let pendingAttachments = [];
let isSending = false;
let recorder = null;
let recordingStream = null;
let recordingChunks = [];

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved)
      ? saved.filter((chat) => chat && typeof chat.id === "string" && Array.isArray(chat.messages) &&
          chat.messages.every((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string"))
      : [];
  } catch {
    return [];
  }
}

function createChat() {
  return { id: crypto.randomUUID(), title: "New chat", messages: [], updatedAt: Date.now() };
}

function storedVersion(chat) {
  return {
    ...chat,
    messages: chat.messages.map((message) => ({
      role: message.role,
      content: typeof message.content === "string"
        ? message.content
        : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"),
      displayText: message.displayText,
    })),
  };
}

function persistChats() {
  try {
    chats = chats.slice(0, 50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.map(storedVersion)));
  } catch (error) {
    console.warn("Could not save chat history in this browser:", error);
  }
}

function messageDisplay(message) {
  if (message.displayText) return message.displayText;
  if (typeof message.content === "string") return message.content;
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function addMessage(content, role, isError = false) {
  const element = document.createElement("div");
  element.classList.add("message", role);
  if (isError) element.classList.add("error");
  element.textContent = content;
  chatMessages.appendChild(element);
  scrollToLatest();
  return element;
}

function scrollToLatest() {
  const area = document.querySelector(".chat-area");
  area.scrollTop = area.scrollHeight;
}

function renderChat() {
  chatMessages.replaceChildren();
  welcomeMessage.hidden = currentChat.messages.length > 0;
  currentChat.messages.forEach((message) => addMessage(messageDisplay(message), message.role));
  renderHistory();
  closeSidebar();
}

function renderHistory() {
  historyElement.replaceChildren();
  for (const chat of chats) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `history-item${chat.id === currentChat.id ? " active" : ""}`;
    button.textContent = chat.title || "New chat";
    button.title = button.textContent;
    button.disabled = isSending;
    button.addEventListener("click", () => {
      if (isSending) return;
      currentChat = chat;
      pendingAttachments = [];
      renderChat();
    });
    historyElement.appendChild(button);
  }
}

function saveCurrentChat() {
  currentChat.updatedAt = Date.now();
  const oldIndex = chats.findIndex((chat) => chat.id === currentChat.id);
  if (oldIndex >= 0) chats.splice(oldIndex, 1);
  chats.unshift(currentChat);
  persistChats();
  renderHistory();
}

function setSending(value) {
  isSending = value;
  sendButton.disabled = value;
  attachButton.disabled = value;
  voiceButton.disabled = value;
  document.getElementById("newChatButton").disabled = value;
  document.getElementById("topNewChatButton").disabled = value;
  renderHistory();
}

function startNewChat() {
  if (isSending) return;
  currentChat = createChat();
  pendingAttachments = [];
  renderAttachments();
  renderChat();
  messageInput.focus();
}

async function typeReply(element, text) {
  element.textContent = "";
  element.classList.add("typing");
  const delay = text.length > 1200 ? 2 : text.length > 500 ? 5 : 9;
  for (let i = 0; i < text.length; i += 1) {
    element.textContent += text[i];
    if (i % 4 === 0) {
      scrollToLatest();
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  element.classList.remove("typing");
  scrollToLatest();
}

function requestHistory() {
  const messages = currentChat.messages.slice(-40).map((message) => ({
    role: message.role,
    content: typeof message.content === "string" ? message.content : [...message.content],
  }));
  let imagesLeft = 3;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (!Array.isArray(item.content)) continue;
    item.content = item.content.filter((part) => {
      if (part.type !== "image_url") return true;
      if (!imagesLeft) return false;
      imagesLeft -= 1;
      return true;
    });
    if (item.content.length === 1 && item.content[0].type === "text") item.content = item.content[0].text;
  }
  while (messages[0]?.role === "assistant") messages.shift();
  return messages;
}

function showStatus(message = "") {
  recordingStatus.textContent = message;
  recordingStatus.hidden = !message;
}

function renderAttachments() {
  attachmentList.replaceChildren();
  pendingAttachments.forEach((file, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    const label = document.createElement("span");
    label.textContent = `${file.kind === "image" ? "Image" : "Document"}: ${file.name}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.addEventListener("click", () => {
      pendingAttachments.splice(index, 1);
      renderAttachments();
    });
    chip.append(label, remove);
    attachmentList.appendChild(chip);
  });
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.readAsDataURL(blob);
  });
}

async function handleFiles(fileList) {
  const files = [...fileList];
  fileInput.value = "";
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      showStatus(`${file.name} exceeds the 10 MB file limit.`);
      continue;
    }
    const isImage = file.type.startsWith("image/");
    if (isImage) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        showStatus("Images must be JPG, PNG, or WebP.");
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        showStatus(`${file.name} exceeds the 8 MB image limit.`);
        continue;
      }
      const images = pendingAttachments.filter((item) => item.kind === "image");
      if (images.length >= 3 || images.reduce((sum, item) => sum + item.size, 0) + file.size > MAX_IMAGE_TOTAL) {
        showStatus("Attach up to 3 images (12 MB combined) per message.");
        continue;
      }
      pendingAttachments.push({ name: file.name, type: file.type, kind: "image", data: await readAsDataUrl(file), size: file.size });
      renderAttachments();
      continue;
    }

    try {
      showStatus(`Reading ${file.name}…`);
      const data = await readAsDataUrl(file);
      const response = await fetch("/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, type: file.type || "application/octet-stream", data }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Could not read ${file.name}.`);
      const note = result.truncated ? " (text was shortened)" : "";
      pendingAttachments.push({ name: file.name, kind: "document", text: `\n\nDocument: ${file.name}${note}\n${result.text}` });
      renderAttachments();
      showStatus();
    } catch (error) {
      showStatus(error.message);
    }
  }
}

async function transcribeAudio(blob) {
  if (!blob.size) throw new Error("No audio was recorded.");
  if (blob.size > MAX_FILE_BYTES) throw new Error("Voice note exceeds the 10 MB limit.");
  const type = (blob.type.split(";")[0] || "audio/webm").toLowerCase();
  const data = (await readAsDataUrl(blob)).replace(/^data:[^;]+;/, `data:${type};`);
  const response = await fetch("/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `voice-note.${type.split("/")[1]}`, type, data }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Voice transcription failed.");
  if (!result.text) return showStatus("No speech was detected.");
  messageInput.value = `${messageInput.value}${messageInput.value ? " " : ""}${result.text}`;
  messageInput.dispatchEvent(new Event("input"));
  messageInput.focus();
  showStatus("Voice note transcribed. Review it, then send.");
}

async function toggleRecording() {
  if (recorder?.state === "recording") {
    recorder.stop();
    voiceButton.classList.remove("recording");
    voiceButton.setAttribute("aria-label", "Record voice note");
    voiceButton.title = "Record voice note";
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    showStatus("Voice recording is not supported in this browser.");
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined;
    recorder = new MediaRecorder(recordingStream, options);
    recordingChunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) recordingChunks.push(event.data); };
    recorder.onstop = async () => {
      const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
      recordingStream?.getTracks().forEach((track) => track.stop());
      recordingStream = null;
      voiceButton.disabled = true;
      showStatus("Transcribing voice note…");
      try { await transcribeAudio(blob); } catch (error) { showStatus(error.message); }
      voiceButton.disabled = false;
    };
    recorder.start();
    voiceButton.classList.add("recording");
    voiceButton.setAttribute("aria-label", "Stop recording");
    voiceButton.title = "Stop recording";
    showStatus("Recording… press the voice button again to finish.");
  } catch (error) {
    showStatus(error.name === "NotAllowedError" ? "Allow microphone access to record a voice note." : "Could not start the microphone.");
  }
}

async function sendMessage(message) {
  const text = message.trim();
  const files = [...pendingAttachments];
  if ((!text && !files.length) || isSending) return;
  const promptText = text || (files.some((item) => item.kind === "image") ? "Please analyze the attached image(s)." : "Please review the attached document(s).");
  const docs = files.filter((item) => item.kind === "document").map((item) => item.text).join("");
  const images = files.filter((item) => item.kind === "image");
  const imageNames = images.map((item) => `\nAttached image: ${item.name}`).join("");
  const fullPrompt = `${promptText}${docs}${imageNames}`;
  const displayText = `${promptText}${files.length ? `\n\n${files.map((item) => `📎 ${item.name}`).join("\n")}` : ""}`;
  const content = images.length
    ? [{ type: "text", text: fullPrompt }, ...images.map((item) => ({ type: "image_url", image_url: { url: item.data } }))]
    : fullPrompt;

  currentChat.messages.push({ role: "user", content, displayText });
  addMessage(displayText, "user");
  pendingAttachments = [];
  renderAttachments();
  messageInput.value = "";
  messageInput.style.height = "auto";
  showStatus();
  setSending(true);
  const replyElement = addMessage("Thinking...", "assistant");
  replyElement.classList.add("typing");
  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: promptText, messages: requestHistory() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("The server returned an empty reply.");
    await typeReply(replyElement, data.reply);
    currentChat.messages.push({ role: "assistant", content: data.reply });
    if (currentChat.messages.length === 2) currentChat.title = promptText.replace(/\s+/g, " ").slice(0, 42);
    saveCurrentChat();
  } catch (error) {
    replyElement.classList.remove("typing");
    replyElement.textContent = `Sorry, something went wrong: ${error.message}`;
    replyElement.classList.add("error");
    currentChat.messages.pop();
    if (currentChat.messages.length) saveCurrentChat();
  } finally {
    setSending(false);
    messageInput.focus();
    scrollToLatest();
  }
}

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("open");
}

document.getElementById("newChatButton").addEventListener("click", startNewChat);
document.getElementById("topNewChatButton").addEventListener("click", startNewChat);
document.getElementById("mobileMenuButton").addEventListener("click", () => {
  sidebar.classList.toggle("open");
  sidebarBackdrop.classList.toggle("open");
});
sidebarBackdrop.addEventListener("click", closeSidebar);
attachButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => handleFiles(fileInput.files));
voiceButton.addEventListener("click", toggleRecording);
chatForm.addEventListener("submit", (event) => { event.preventDefault(); sendMessage(messageInput.value); });
messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 180)}px`;
});
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

renderChat();
