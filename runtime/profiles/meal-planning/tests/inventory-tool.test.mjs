import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const profileDir = new URL('../', import.meta.url)
const runtimeDir = fileURLToPath(new URL('../../../', import.meta.url))
const dshSourceDir = process.env.DSH_SOURCE
  ?? fileURLToPath(new URL('../../../../../DSH/_OriginalCode/', import.meta.url))

function runDsh(args) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', ...args],
    {
      cwd: dshSourceDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        DSH_HOME: runtimeDir,
        DSH_TELEMETRY_DISABLED: '1',
      },
      timeout: 30_000,
    },
  )
}

test('meal-planning is a named Web profile', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', profileDir), 'utf8'))

  assert.equal(manifest.name, 'dsh-profile-meal-planning')
  assert.equal(manifest.private, true)
  assert.deepEqual(manifest.dependencies, {})
  assert.deepEqual(manifest.dsh?.profile?.bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
  ])
})

test('DSH composes the named profile with the inventory tool', () => {
  const result = runDsh(['--profile', 'meal-planning', '--dump-config'])

  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.match(result.stdout, /id: meal-inventory-tool/)
  assert.match(result.stdout, /inventory-tool\.ts/)
  assert.match(result.stdout, /id: tools[\s\S]*mode: native/)
})

test('inventory tool exposes its schema and returns model-visible inventory', () => {
  const probePatch = fileURLToPath(new URL('tool-probe.cordis.patch.yml', import.meta.url))
  const result = runDsh([
    '--profile', 'meal-planning',
    '--patch', probePatch,
    '--no-open',
    '--port', '0',
  ])
  const output = `${result.stdout}${result.stderr}`

  assert.equal(result.status, 0, output || result.error?.message)
  assert.match(output, /MEAL_INVENTORY_TOOL_OK \{"name":"get_inventory","items":4,"rendered":true\}/)
})
