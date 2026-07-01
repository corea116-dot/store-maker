import { randomUUID } from "node:crypto";

export function logEntry(level, title, message) {
  return { id: randomUUID(), level, title, message, at: new Date().toISOString() };
}
