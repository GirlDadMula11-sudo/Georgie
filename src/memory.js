import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.resolve(process.env.GEORGIE_DATA_DIR || "data");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");

const EMPTY_STORE = {
  version: 1,
  profiles: {},
  memories: [],
  sessions: {}
};

let writeQueue = Promise.resolve();

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(MEMORY_FILE);
  } catch {
    await fs.writeFile(MEMORY_FILE, JSON.stringify(EMPTY_STORE, null, 2));
  }
}

async function readStore() {
  await ensureStore();
  try {
    const raw = await fs.readFile(MEMORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...EMPTY_STORE,
      ...parsed,
      profiles: parsed.profiles || {},
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      sessions: parsed.sessions || {}
    };
  } catch {
    return structuredClone(EMPTY_STORE);
  }
}

async function writeStore(store) {
  const task = async () => {
    await ensureStore();
    const temp = `${MEMORY_FILE}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(store, null, 2));
    await fs.rename(temp, MEMORY_FILE);
  };
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

function now() {
  return new Date().toISOString();
}

function normalizeUserId(value) {
  return String(value || "primary").trim().slice(0, 100) || "primary";
}

function tokenize(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
}

function scoreMemory(memory, queryTokens) {
  const memoryTokens = tokenize(`${memory.text} ${(memory.tags || []).join(" ")} ${memory.category || ""}`);
  let overlap = 0;
  for (const token of queryTokens) if (memoryTokens.has(token)) overlap += 1;

  const ageDays = Math.max(0, (Date.now() - new Date(memory.updatedAt || memory.createdAt).getTime()) / 86400000);
  const recency = 1 / (1 + ageDays / 30);
  const importance = Math.max(0, Math.min(1, Number(memory.importance ?? 0.5)));
  return overlap * 3 + importance * 2 + recency;
}

export async function getProfile(userId = "primary") {
  const id = normalizeUserId(userId);
  const store = await readStore();
  return store.profiles[id] || { userId: id, createdAt: now(), updatedAt: now(), attributes: {} };
}

export async function updateProfile(userId = "primary", patch = {}) {
  const id = normalizeUserId(userId);
  const store = await readStore();
  const current = store.profiles[id] || { userId: id, createdAt: now(), attributes: {} };
  const attributes = {
    ...(current.attributes || {}),
    ...((patch && typeof patch.attributes === "object" && patch.attributes) || {})
  };

  store.profiles[id] = {
    ...current,
    ...patch,
    userId: id,
    attributes,
    createdAt: current.createdAt || now(),
    updatedAt: now()
  };
  await writeStore(store);
  return store.profiles[id];
}

export async function addMemory({ userId = "primary", text, category = "fact", importance = 0.5, tags = [], source = "conversation" }) {
  if (!text?.trim()) return null;
  const id = normalizeUserId(userId);
  const store = await readStore();
  const normalized = text.trim().slice(0, 2000);

  const duplicate = store.memories.find(
    (memory) => memory.userId === id && memory.text.toLowerCase() === normalized.toLowerCase()
  );

  if (duplicate) {
    duplicate.updatedAt = now();
    duplicate.importance = Math.max(duplicate.importance || 0, Number(importance) || 0);
    duplicate.tags = [...new Set([...(duplicate.tags || []), ...tags.map(String)])].slice(0, 12);
    await writeStore(store);
    return duplicate;
  }

  const memory = {
    id: crypto.randomUUID(),
    userId: id,
    text: normalized,
    category: String(category || "fact").slice(0, 50),
    importance: Math.max(0, Math.min(1, Number(importance) || 0.5)),
    tags: [...new Set(tags.map(String))].slice(0, 12),
    source,
    createdAt: now(),
    updatedAt: now()
  };

  store.memories.push(memory);
  if (store.memories.length > 5000) store.memories = store.memories.slice(-5000);
  await writeStore(store);
  return memory;
}

export async function searchMemories(userId = "primary", query = "", limit = 8) {
  const id = normalizeUserId(userId);
  const store = await readStore();
  const queryTokens = tokenize(query);
  return store.memories
    .filter((memory) => memory.userId === id)
    .map((memory) => ({ ...memory, _score: scoreMemory(memory, queryTokens) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 8)))
    .map(({ _score, ...memory }) => memory);
}

export async function listMemories(userId = "primary", limit = 100) {
  const id = normalizeUserId(userId);
  const store = await readStore();
  return store.memories
    .filter((memory) => memory.userId === id)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
}

export async function deleteMemory(userId = "primary", memoryId) {
  const id = normalizeUserId(userId);
  const store = await readStore();
  const before = store.memories.length;
  store.memories = store.memories.filter((memory) => !(memory.userId === id && memory.id === memoryId));
  if (store.memories.length === before) return false;
  await writeStore(store);
  return true;
}

export async function appendSessionTurn({ userId = "primary", sessionId = "default", role, content }) {
  const id = normalizeUserId(userId);
  const sid = String(sessionId || "default").slice(0, 150);
  const store = await readStore();
  const key = `${id}:${sid}`;
  const session = store.sessions[key] || { userId: id, sessionId: sid, turns: [], createdAt: now() };
  session.turns.push({ role, content: String(content || "").slice(0, 12000), at: now() });
  session.turns = session.turns.slice(-80);
  session.updatedAt = now();
  store.sessions[key] = session;
  await writeStore(store);
  return session;
}

export async function getSessionHistory(userId = "primary", sessionId = "default", limit = 16) {
  const id = normalizeUserId(userId);
  const sid = String(sessionId || "default").slice(0, 150);
  const store = await readStore();
  const session = store.sessions[`${id}:${sid}`];
  if (!session) return [];
  return session.turns
    .slice(-Math.max(1, Math.min(40, Number(limit) || 16)))
    .map(({ role, content }) => ({ role, content }));
}

export async function buildMemoryContext(userId = "primary", query = "") {
  const [profile, memories] = await Promise.all([
    getProfile(userId),
    searchMemories(userId, query, 8)
  ]);

  const profileAttributes = Object.entries(profile.attributes || {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");

  const memoryText = memories.map((memory) => `- [${memory.category}] ${memory.text}`).join("\n");

  return {
    profile,
    memories,
    prompt: [
      profileAttributes ? `Known user profile:\n${profileAttributes}` : "",
      memoryText ? `Relevant durable memories:\n${memoryText}` : ""
    ].filter(Boolean).join("\n\n")
  };
}
