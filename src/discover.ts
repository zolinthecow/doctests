import path from "path";
import { Glob } from "bun";

export async function discoverFiles(
  include: string[],
  exclude: string[],
  rootDir: string,
): Promise<string[]> {
  const includeFiles = new Set<string>();
  for (const pattern of include) {
    const glob = new Glob(pattern);
    for await (const match of glob.scan({ cwd: rootDir, onlyFiles: true, dot: true })) {
      includeFiles.add(path.resolve(rootDir, match));
    }
  }

  const excludeFiles = new Set<string>();
  for (const pattern of exclude) {
    const glob = new Glob(pattern);
    for await (const match of glob.scan({ cwd: rootDir, onlyFiles: true, dot: true })) {
      excludeFiles.add(path.resolve(rootDir, match));
    }
  }

  return [...includeFiles]
    .filter((file) => !excludeFiles.has(file))
    .sort((a, b) => a.localeCompare(b));
}
