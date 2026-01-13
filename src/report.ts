import path from 'path'

import type { BlockResult } from './run'

export type ReportOptions = {
  rootDir: string
}

export function printReport(results: BlockResult[], options: ReportOptions): void {
  const summary = summarize(results)

  console.log(
    `Doctest: ${summary.total} blocks, ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped, ${summary.timedOut} timed out`
  )

  for (const result of results) {
    if (result.status === 'passed' || result.status === 'skipped') {
      continue
    }

    const location = result.block.filePath.includes('hook')
      ? result.block.filePath
      : `${path.relative(options.rootDir, result.block.filePath)}:${result.block.startLine}`
    console.log(`\n${location} [${result.block.lang || 'unknown'}] ${result.status}`)

    if (result.reason) {
      console.log(`Reason: ${result.reason}`)
    }

    if (result.stdout.trim()) {
      console.log('stdout:')
      console.log(indent(result.stdout.trim()))
    }

    if (result.stderr.trim()) {
      console.log('stderr:')
      console.log(indent(result.stderr.trim()))
    }
  }
}

function summarize(results: BlockResult[]) {
  return results.reduce(
    (acc, result) => {
      acc.total += 1
      if (result.status === 'passed') {
        acc.passed += 1
      } else if (result.status === 'failed') {
        acc.failed += 1
      } else if (result.status === 'skipped') {
        acc.skipped += 1
      } else if (result.status === 'timeout') {
        acc.timedOut += 1
      }
      return acc
    },
    { total: 0, passed: 0, failed: 0, skipped: 0, timedOut: 0 }
  )
}

function indent(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join('\n')
}
