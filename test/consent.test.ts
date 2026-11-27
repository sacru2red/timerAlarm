import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConsentStore } from '../src/consent.ts'

test('consent is per guild and survives a restart', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'consent-')), 'nested', 'consent.json')
  const store = new ConsentStore(path)
  assert.equal(store.has('g1', 'u'), false)
  store.set('g1', 'u', true)
  assert.equal(store.has('g1', 'u'), true)
  assert.equal(store.has('g2', 'u'), false)

  const reloaded = new ConsentStore(path)
  assert.equal(reloaded.has('g1', 'u'), true)
  reloaded.set('g1', 'u', false)
  assert.equal(new ConsentStore(path).has('g1', 'u'), false)
})
