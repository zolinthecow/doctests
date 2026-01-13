#!/usr/bin/env bun
import path from 'path'

import { loadConfig } from './config'
import { discoverFiles } from './discover'
import { parseFile } from './parse'
import { createTempDir, runBlocks } from './run'
import { printReport } from './report'

const HELP_TEXT = `Usage: doctest [options]

Options:
  --config <path>          Path to doctest.config.toml
  --files <glob>           Override include globs (repeatable)
  --timeout <ms>           Override timeout per block
  --fail-on-unknown        Treat unknown languages as failures
  --help                   Show help
`

const args = process.argv.slice(2)
const options = parseArgs(args)

if (options.help) {
  console.log(HELP_TEXT)
  process.exit(0)
}

const { config, rootDir } = await loadConfig(options.configPath)

if (options.timeoutMs !== null) {
  config.timeoutMs = options.timeoutMs
}

if (options.failOnUnknown) {
  config.unknownLanguage = 'fail'
}

const include = options.files.length > 0 ? options.files : config.include
const exclude = options.files.length > 0 ? [] : config.exclude
const files = await discoverFiles(include, exclude, rootDir)

if (files.length === 0) {
  console.log('Doctest: no files matched')
  process.exit(0)
}

const blocks = []
for (const file of files) {
  const content = await Bun.file(file).text()
  blocks.push(...parseFile(file, content))
}

const tempDir = await createTempDir()
const results = await runBlocks(blocks, {
  rootDir,
  config,
  tempDir
})

printReport(results, { rootDir })

const hasFailures = results.some((result) => result.status === 'failed' || result.status === 'timeout')
process.exit(hasFailures ? 1 : 0)

function parseArgs(argv: string[]) {
  const files: string[] = []
  let configPath: string | undefined
  let timeoutMs: number | null = null
  let failOnUnknown = false
  let help = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--config') {
      configPath = argv[index + 1]
      index += 1
      continue
    }
    if (arg === '--files') {
      const value = argv[index + 1]
      if (value) {
        files.push(value)
        index += 1
      }
      continue
    }
    if (arg === '--timeout') {
      const value = argv[index + 1]
      if (value) {
        timeoutMs = Number(value)
        index += 1
      }
      continue
    }
    if (arg === '--fail-on-unknown') {
      failOnUnknown = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg.startsWith('-')) {
      console.log(`Unknown option: ${arg}`)
      process.exit(1)
    }
    files.push(arg)
  }

  return {
    files,
    configPath,
    timeoutMs,
    failOnUnknown,
    help
  }
}
