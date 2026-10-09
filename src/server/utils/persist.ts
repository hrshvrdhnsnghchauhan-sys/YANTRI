/**
 * Atomic, serialized JSON persistence.
 *
 * Writes go to a temp file in the same directory and are then renamed over the
 * target (atomic on POSIX and Windows for same-volume renames). An in-process
 * per-path promise queue serializes concurrent writers so two callers can never
 * interleave a read-modify-write and corrupt a file. This is the write path used
 * by every JSON state store; SQLite (db/index.ts) additionally mirrors the data
 * for cross-process durability.
 */
import * as fs from "fs";
import path from "path";

const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  // Keep the chain alive but never let a rejection poison the next writer.
  queues.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

export function writeTextAtomic(file: string, content: string): Promise<void> {
  return enqueue(file, async () => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.promises.writeFile(tmp, content, "utf-8");
    await fs.promises.rename(tmp, file);
  });
}

export function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  return writeTextAtomic(file, JSON.stringify(data, null, 2));
}

/** Synchronous atomic write for legacy synchronous call sites. */
export function writeTextAtomicSync(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, file);
}

/** Read + parse a JSON file. Returns null when missing or corrupt. */
export function readJsonFile<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}
