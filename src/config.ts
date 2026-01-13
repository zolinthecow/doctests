import path from 'path'

export type UnknownLanguageMode = 'skip' | 'fail'

export type HookConfig = {
  setup?: string
  teardown?: string
}

export type Config = {
  include: string[]
  exclude: string[]
  timeoutMs: number
  unknownLanguage: UnknownLanguageMode
  runners: Record<string, string>
  env: Record<string, string>
  hooks: HookConfig
}

export type LoadedConfig = {
  config: Config
  rootDir: string
  configPath?: string
}

const defaultConfig: Config = {
  include: ['**/*.md', '**/*.mdx'],
  exclude: ['**/node_modules/**', '**/dist/**'],
  timeoutMs: 20000,
  unknownLanguage: 'skip',
  runners: {
    lua: 'lua',
    sh: '/bin/sh -e',
    bash: '/bin/sh -e',
    js: 'bun',
    ts: 'bun'
  },
  env: {},
  hooks: {}
}

const CONFIG_NAME = 'doctest.config.toml'

export async function loadConfig(configPath?: string): Promise<LoadedConfig> {
  const resolvedPath = configPath
    ? path.resolve(process.cwd(), configPath)
    : path.resolve(process.cwd(), CONFIG_NAME)

  const file = Bun.file(resolvedPath)
  const exists = await file.exists()

  if (!exists) {
    return {
      config: { ...defaultConfig },
      rootDir: process.cwd()
    }
  }

  const raw = await file.text()
  const parsed = Bun.TOML.parse(raw) as Record<string, unknown>
  const config = mergeConfig(parsed)

  return {
    config,
    rootDir: path.dirname(resolvedPath),
    configPath: resolvedPath
  }
}

function mergeConfig(parsed: Record<string, unknown>): Config {
  const include = readStringArray(parsed.include) ?? defaultConfig.include
  const exclude = readStringArray(parsed.exclude) ?? defaultConfig.exclude
  const timeoutMs = readNumber(parsed.timeout_ms) ?? defaultConfig.timeoutMs
  const unknownLanguage = readUnknownLanguage(parsed.unknown_language) ?? defaultConfig.unknownLanguage
  const runners = readStringMap(parsed.runners) ?? defaultConfig.runners
  const env = readStringMap(parsed.env) ?? defaultConfig.env
  const hooks = readHookConfig(parsed.hooks)

  return {
    include,
    exclude,
    timeoutMs,
    unknownLanguage,
    runners,
    env,
    hooks
  }
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const entries = value
    .map((entry) => (typeof entry === 'string' ? entry : null))
    .filter((entry): entry is string => Boolean(entry))
  return entries.length > 0 ? entries : []
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readUnknownLanguage(value: unknown): UnknownLanguageMode | null {
  if (value === 'skip' || value === 'fail') {
    return value
  }
  return null
}

function readStringMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') {
      result[key] = entry
    }
  }
  return Object.keys(result).length > 0 ? result : {}
}

function readHookConfig(value: unknown): HookConfig {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const hooks = value as Record<string, unknown>
  const setup = typeof hooks.setup === 'string' ? hooks.setup : undefined
  const teardown = typeof hooks.teardown === 'string' ? hooks.teardown : undefined

  return {
    setup,
    teardown
  }
}
