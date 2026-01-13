export type CodeBlock = {
  filePath: string;
  lang: string;
  code: string;
  startLine: number;
  meta: string;
  flags: Set<string>;
  attributes: Record<string, string>;
  env: Record<string, string>;
};

export function parseFile(filePath: string, content: string): CodeBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: CodeBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const openMatch = line.match(/^(?<fence>`{3,}|~{3,})\s*(?<info>.*)$/);
    if (!openMatch?.groups) {
      index += 1;
      continue;
    }

    const fence = openMatch.groups.fence;
    const info = openMatch.groups.info.trim();
    const { lang, meta } = parseFenceInfo(info);
    const startLine = index + 1;
    index += 1;

    const codeLines: string[] = [];
    while (index < lines.length) {
      const closeLine = lines[index];
      const closeMatch = closeLine.match(new RegExp(`^${fence[0]}{${fence.length},}\\s*$`));
      if (closeMatch) {
        index += 1;
        break;
      }
      codeLines.push(closeLine);
      index += 1;
    }

    const { flags, attributes, env } = parseMeta(meta);
    blocks.push({
      filePath,
      lang,
      code: codeLines.join("\n"),
      startLine,
      meta,
      flags,
      attributes,
      env,
    });
  }

  return blocks;
}

function parseFenceInfo(info: string): { lang: string; meta: string } {
  if (!info) {
    return { lang: "", meta: "" };
  }
  const tokens = info.split(/\s+/).filter(Boolean);
  const lang = tokens.shift() ?? "";
  const meta = tokens.join(" ");
  return { lang, meta };
}

function parseMeta(meta: string): {
  flags: Set<string>;
  attributes: Record<string, string>;
  env: Record<string, string>;
} {
  const flags = new Set<string>();
  const attributes: Record<string, string> = {};
  const env: Record<string, string> = {};

  if (!meta) {
    return { flags, attributes, env };
  }

  const tokens = meta.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (!token.includes("=")) {
      flags.add(token);
      continue;
    }

    const [rawKey, ...rest] = token.split("=");
    const value = rest.join("=");
    const key = rawKey.trim();

    if (key === "env") {
      const [envKey, ...envRest] = value.split("=");
      const envValue = envRest.join("=");
      if (envKey) {
        env[envKey] = envValue;
      }
      continue;
    }

    if (key) {
      attributes[key] = value;
    }
  }

  return { flags, attributes, env };
}
