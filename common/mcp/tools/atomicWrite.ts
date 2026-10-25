/**
 * One way to change a file on disk.
 *
 * Every tool that writes text uses this: a sibling temp file, then `rename()`.
 * `rename` is atomic on POSIX, so a reader never sees a half-written file and a
 * crash leaves either the old content or the new one — never a truncated mix.
 *
 * Duplicating this in each tool would mean three chances to forget the cleanup
 * when the write fails.
 *
 * @module common/mcp/tools/atomicWrite
 */

import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Write `content` to `absolute` atomically, creating parent directories.
 *
 * @param absolute - Absolute path of the destination file.
 * @param content - UTF-8 text to write.
 * @throws Whatever the filesystem throws; the temp file is removed first.
 */
export async function writeFileAtomically(absolute: string, content: string): Promise<void> {
  const dir = dirname(absolute);
  const tempPath = join(dir, `.${basename(absolute)}.${randomUUID()}.tmp`);

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, absolute);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
