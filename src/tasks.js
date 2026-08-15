import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = process.env.GEORGIE_DATA_DIR || "data";
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(TASKS_FILE); }
  catch { await fs.writeFile(TASKS_FILE, JSON.stringify({ tasks: [] }, null, 2)); }
}

async function readStore() {
  await ensureStore();
  return JSON.parse(await fs.readFile(TASKS_FILE, "utf8"));
}

async function writeStore(store) {
  await ensureStore();
  const temp = `${TASKS_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(store, null, 2));
  await fs.rename(temp, TASKS_FILE);
}

export async function createTask({ userId, title, notes = "", dueAt = null, priority = "normal", source = "assistant" }) {
  if (!title?.trim()) throw new Error("Task title is required");
  const store = await readStore();
  const task = {
    id: crypto.randomUUID(),
    userId,
    title: title.trim().slice(0, 240),
    notes: String(notes || "").slice(0, 4000),
    dueAt: dueAt || null,
    priority: ["low", "normal", "high", "urgent"].includes(priority) ? priority : "normal",
    status: "open",
    source,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };
  store.tasks.push(task);
  await writeStore(store);
  return task;
}

export async function listTasks(userId, { status = "open", limit = 50 } = {}) {
  const store = await readStore();
  return store.tasks
    .filter((task) => task.userId === userId && (status === "all" || task.status === status))
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return new Date(a.dueAt) - new Date(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    })
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}

export async function listAllTasks({ status = "open", limit = 1000 } = {}) {
  const store = await readStore();
  return store.tasks
    .filter((task) => status === "all" || task.status === status)
    .sort((a, b) => new Date(a.dueAt || a.createdAt) - new Date(b.dueAt || b.createdAt))
    .slice(0, Math.max(1, Math.min(Number(limit) || 1000, 5000)));
}

export async function updateTask(userId, taskId, patch = {}) {
  const store = await readStore();
  const task = store.tasks.find((item) => item.userId === userId && item.id === taskId);
  if (!task) return null;
  if (patch.title !== undefined) task.title = String(patch.title).trim().slice(0, 240);
  if (patch.notes !== undefined) task.notes = String(patch.notes || "").slice(0, 4000);
  if (patch.dueAt !== undefined) task.dueAt = patch.dueAt || null;
  if (patch.priority && ["low", "normal", "high", "urgent"].includes(patch.priority)) task.priority = patch.priority;
  if (patch.status && ["open", "completed", "cancelled"].includes(patch.status)) {
    task.status = patch.status;
    task.completedAt = patch.status === "completed" ? new Date().toISOString() : null;
  }
  task.updatedAt = new Date().toISOString();
  await writeStore(store);
  return task;
}

export async function deleteTask(userId, taskId) {
  const store = await readStore();
  const before = store.tasks.length;
  store.tasks = store.tasks.filter((task) => !(task.userId === userId && task.id === taskId));
  if (store.tasks.length === before) return false;
  await writeStore(store);
  return true;
}
