import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { tmpdir } from "os";

import type { CodeBlock } from "./parse";
import type { Config } from "./config";

export type BlockResult = {
  block: CodeBlock;
  status: "passed" | "failed" | "skipped" | "timeout";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  reason?: string;
  durationMs: number;
};

export type RunOptions = {
  rootDir: string;
  config: Config;
  tempDir: string;
};

export async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), "doctest-"));
}

export async function runBlocks(blocks: CodeBlock[], options: RunOptions): Promise<BlockResult[]> {
  const results: BlockResult[] = [];
  const hookErrors: BlockResult[] = [];

  const setupResult = await runHook("setup", options);
  if (setupResult) {
    hookErrors.push(setupResult);
  }

  for (const block of blocks) {
    if (block.flags.has("no-doctest")) {
      results.push({
        block,
        status: "skipped",
        stdout: "",
        stderr: "",
        exitCode: null,
        reason: "no-doctest",
        durationMs: 0,
      });
      continue;
    }

    if (!block.lang) {
      results.push({
        block,
        status: "skipped",
        stdout: "",
        stderr: "",
        exitCode: null,
        reason: "missing language",
        durationMs: 0,
      });
      continue;
    }

    const runner = options.config.runners[block.lang];
    if (!runner) {
      results.push({
        block,
        status: options.config.unknownLanguage === "fail" ? "failed" : "skipped",
        stdout: "",
        stderr: "",
        exitCode: null,
        reason: "unknown language",
        durationMs: 0,
      });
      continue;
    }

    results.push(await runBlock(block, runner, options));
  }

  const teardownResult = await runHook("teardown", options);
  if (teardownResult) {
    hookErrors.push(teardownResult);
  }

  if (hookErrors.length > 0) {
    return [...hookErrors, ...results];
  }

  return results;
}

async function runBlock(
  block: CodeBlock,
  runner: string,
  options: RunOptions,
): Promise<BlockResult> {
  const startTime = Date.now();
  const blockId = crypto.randomUUID();
  const extension = extensionForLang(block.lang);
  const tempFileName = `${block.lang}-${blockId}${extension}`;
  const tempFilePath = path.join(options.tempDir, tempFileName);
  const blockTempDir = path.join(options.tempDir, `block-${blockId}`);
  await fs.mkdir(blockTempDir, { recursive: true });

  const scriptContent = buildScript(block, runner);
  await fs.writeFile(tempFilePath, scriptContent, "utf8");

  const workdir = block.attributes.workdir
    ? path.resolve(options.rootDir, block.attributes.workdir)
    : options.rootDir;

  const env = {
    ...process.env,
    ...options.config.env,
    ...block.env,
    DOCTEST_ROOT: options.rootDir,
    DOCTEST_FILE: block.filePath,
    DOCTEST_TMP: blockTempDir,
    DOCTEST_WORKDIR: workdir,
  };

  const cmd = buildCommand(runner, block.lang, tempFilePath);
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn({
      cmd,
      cwd: workdir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    await cleanupTemp(tempFilePath, blockTempDir);
    return {
      block,
      status: "failed",
      stdout: "",
      stderr: formatSpawnError(error),
      exitCode: null,
      reason: "spawn failed",
      durationMs: Date.now() - startTime,
    };
  }

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, options.config.timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  clearTimeout(timeout);
  await cleanupTemp(tempFilePath, blockTempDir);

  const durationMs = Date.now() - startTime;

  if (timedOut) {
    return {
      block,
      status: "timeout",
      stdout,
      stderr,
      exitCode: null,
      durationMs,
    };
  }

  if (exitCode !== 0) {
    return {
      block,
      status: "failed",
      stdout,
      stderr,
      exitCode,
      durationMs,
    };
  }

  return {
    block,
    status: "passed",
    stdout,
    stderr,
    exitCode,
    durationMs,
  };
}

function buildScript(block: CodeBlock, runner: string): string {
  if (runner === "nvim" && block.lang === "lua") {
    return [NVIM_LUA_PRELUDE, block.code, NVIM_LUA_POSTLUDE].join("\n");
  }

  return block.code;
}

function buildCommand(runner: string, lang: string, scriptPath: string): string[] {
  if (runner === "nvim" && lang === "lua") {
    return ["nvim", "--headless", "-u", "NONE", "-l", scriptPath];
  }

  return [...splitCommand(runner), scriptPath];
}

async function cleanupTemp(filePath: string, blockTempDir: string): Promise<void> {
  await fs.unlink(filePath).catch(() => undefined);
  await fs.rm(blockTempDir, { recursive: true, force: true }).catch(() => undefined);
}

function formatSpawnError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

const NVIM_LUA_PRELUDE = [
  "local root = os.getenv('DOCTEST_ROOT')",
  "if root and vim then",
  "  vim.g.headless_mode = true",
  "  vim.opt.runtimepath:append(root)",
  "  vim.cmd('cd ' .. vim.fn.fnameescape(root))",
  "end",
  "",
  "local tmp = os.getenv('DOCTEST_TMP')",
  "if tmp and vim then",
  "  vim.fn.mkdir(tmp, 'p')",
  "  vim.env.XDG_DATA_HOME = tmp .. '/data'",
  "  vim.fn.mkdir(vim.env.XDG_DATA_HOME, 'p')",
  "end",
  "",
].join("\n");

const NVIM_LUA_POSTLUDE = "if vim and vim.cmd then vim.cmd('qa') end";

async function runHook(
  type: "setup" | "teardown",
  options: RunOptions,
): Promise<BlockResult | null> {
  const command = options.config.hooks[type];
  if (!command) {
    return null;
  }

  const startTime = Date.now();
  const cmd = splitCommand(command);

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn({
      cmd,
      cwd: options.rootDir,
      env: {
        ...process.env,
        ...options.config.env,
        DOCTEST_ROOT: options.rootDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      block: {
        filePath: `${type}-hook`,
        lang: "hook",
        code: command,
        startLine: 1,
        meta: "",
        flags: new Set(),
        attributes: {},
        env: {},
      },
      status: "failed",
      stdout: "",
      stderr: formatSpawnError(error),
      exitCode: null,
      reason: `${type} hook spawn failed`,
      durationMs: Date.now() - startTime,
    };
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return {
      block: {
        filePath: `${type}-hook`,
        lang: "hook",
        code: command,
        startLine: 1,
        meta: "",
        flags: new Set(),
        attributes: {},
        env: {},
      },
      status: "failed",
      stdout,
      stderr,
      exitCode,
      reason: `${type} hook failed`,
      durationMs: Date.now() - startTime,
    };
  }

  return {
    block: {
      filePath: `${type}-hook`,
      lang: "hook",
      code: command,
      startLine: 1,
      meta: "",
      flags: new Set(),
      attributes: {},
      env: {},
    },
    status: "passed",
    stdout,
    stderr,
    exitCode,
    reason: `${type} hook`,
    durationMs: Date.now() - startTime,
  };
}

function extensionForLang(lang: string): string {
  const map: Record<string, string> = {
    sh: ".sh",
    bash: ".sh",
    js: ".js",
    ts: ".ts",
    lua: ".lua",
  };
  return map[lang] ?? ".txt";
}

function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === " ") {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}
