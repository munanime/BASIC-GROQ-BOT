const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const chatMessages = document.getElementById("chatMessages");
const sendButton = document.getElementById("sendButton");
const welcomeMessage = document.getElementById("welcomeMessage");
const historyElement = document.getElementById("chatHistory");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const STORAGE_KEY = "groq-ai-chats-v1";
const MAX_SAVED_CHATS = 50;

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved)
      ? saved.filter((chat) =>
          chat &&
          typeof chat.id === "string" &&
          Array.isArray(chat.messages) &&
          chat.messages.every((message) =>
            message &&
            ["user", "assistant"].includes(message.role) &&
            typeof message.content === "string"
          )
        )
      : [];
  } catch {
    return [];
  }
}

let chats = loadChats();
let currentChat = createChat();
let isSending = false;

function createChat() {
  return { id: crypto.randomUUID(), title: "New chat", messages: [], updatedAt: Date.now() };
}

function persistChats() {
  try {
    chats = chats.slice(0, MAX_SAVED_CHATS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch (error) {
    console.warn("Could not save chat history in this browser:", error);
  }
}

function addMessage(content, role, isError = false) {
  const messageElement = document.createElement("div");
  messageElement.classList.add("message", role);
  if (isError) messageElement.classList.add("error");
  messageElement.textContent = content;
  chatMessages.appendChild(messageElement);
  scrollToLatest();
  return messageElement;
}

function scrollToLatest() {
  const chatArea = document.querySelector(".chat-area");
  chatArea.scrollTop = chatArea.scrollHeight;
}

function renderChat() {
  chatMessages.replaceChildren();
  welcomeMessage.hidden = currentChat.messages.length > 0;
  for (const message of currentChat.messages) {
    addMessage(message.content, message.role);
  }
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
      renderChat();
    });
    historyElement.appendChild(button);
  }
}

function saveCurrentChat() {
  currentChat.updatedAt = Date.now();
  const existingIndex = chats.findIndex((chat) => chat.id === currentChat.id);
  if (existingIndex >= 0) chats.splice(existingIndex, 1);
  chats.unshift(currentChat);
  persistChats();
  renderHistory();
}

function setSending(sending) {
  isSending = sending;
  sendButton.disabled = sending;
  document.getElementById("newChatButton").disabled = sending;
  document.getElementById("topNewChatButton").disabled = sending;
  renderHistory();
}

function startNewChat() {
  if (isSending) return;
  currentChat = createChat();
  renderChat();
  messageInput.focus();
}

async function typeReply(element, text) {
  element.textContent = "";
  element.classList.add("typing");
  const speed = text.length > 1200 ? 2 : text.length > 500 ? 5 : 9;
  for (let index = 0; index < text.length; index += 1) {
    element.textContent += text[index];
    if (index % 4 === 0) {
      scrollToLatest();
      await new Promise((resolve) => setTimeout(resolve, speed));
    }
  }
  element.classList.remove("typing");
  scrollToLatest();
}

async function sendMessage(message) {
  const trimmedMessage = message.trim();
  if (!trimmedMessage || isSending) return;

  welcomeMessage.hidden = true;
  currentChat.messages.push({ role: "user", content: trimmedMessage });
  addMessage(trimmedMessage, "user");
  messageInput.value = "";
  messageInput.style.height = "auto";
  setSending(true);

  const replyElement = addMessage("Thinking...", "assistant");
  replyElement.classList.add("typing");

  try {
    const messages = currentChat.messages.slice(-40);
    while (messages[0]?.role === "assistant") messages.shift();
    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmedMessage, messages }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    if (typeof data.reply !== "string" || !data.reply.trim()) {
      throw new Error("The server returned an empty reply.");
    }

    await typeReply(replyElement, data.reply);
    currentChat.messages.push({ role: "assistant", content: data.reply });
    if (currentChat.messages.length === 2) {
      currentChat.title = trimmedMessage.replace(/\s+/g, " ").slice(0, 42) || "New chat";
    }
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

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(messageInput.value);
});

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
