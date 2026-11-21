// [Alex] File storage under DATA_DIR. No database.
// Layout: units/<unitId>/{unit.json, plan.<ext>, plan.json, diff.json, statement.json,
//         walkthroughs/<wid>/{walkthrough.json, video.<ext>, findings.json, frames/}}
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** DATA_DIR from env (absolute, or relative to the repo root). Defaults to <repo>/.data. */
export function defaultDataDir(): string {
  return resolve(REPO_ROOT, process.env.DATA_DIR ?? '.data');
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export function assertSafeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new HttpError(400, `bad id: ${id}`);
  return id;
}

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 500,
    message: string,
  ) {
    super(message);
  }
}

export class Storage {
  constructor(readonly root: string) {}

  unitDir(unitId: string): string {
    return join(this.root, 'units', assertSafeId(unitId));
  }
  walkthroughDir(unitId: string, wid: string): string {
    return join(this.unitDir(unitId), 'walkthroughs', assertSafeId(wid));
  }

  async exists(path: string): Promise<boolean> {
    return access(path).then(
      () => true,
      () => false,
    );
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value, null, 2) + '\n');
  }

  /** Read and validate JSON. Returns null when the file does not exist. */
  async readJson<T>(path: string, schema: { parse(x: unknown): T }): Promise<T | null> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return null;
    }
    return schema.parse(JSON.parse(raw));
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
}
