import { fromFileUrl, join, toFileUrl } from "@std/path";
import * as fs from "@std/fs";

/**
 * Recursively walks a directory and yields all files in it.
 */
export async function* walk(dir: string): AsyncGenerator<string> {
  dir = fromFileUrl(dir);
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);

    if (entry.isFile) {
      yield toFileUrl(path).toString();
    }

    if (entry.isDirectory) {
      yield* walk(path);
    }
  }
}

/**
 * Reads a file from a `file:` URL.
 */
export async function read(path: string): Promise<string> {
  path = fromFileUrl(path);
  return await Deno.readTextFile(path);
}

/**
 * Writes a file from a `file:` URL to the filesystem ensuring that the path
 * exists.
 */
export async function write(path: string, content: string) {
  path = fromFileUrl(path);
  await fs.ensureFile(path);
  await Deno.writeTextFile(path, content);
}

/**
 * Recursively copies a file or directory from one `file:` URL to another.
 */
export async function copy(source: string, dest: string) {
  source = fromFileUrl(source);
  dest = fromFileUrl(dest);
  await fs.copy(source, dest, { overwrite: true });
}
