#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from '../../node_modules/jiti/lib/jiti.cjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(__dirname, '../..')
const srcDir = resolve(root, 'src')

const jiti = createJiti(root, {
  alias: {
    '@sim': resolve(srcDir, 'sim'),
    '@': srcDir,
  },
})
await jiti.import(resolve(__dirname, 'forcedWarHarness.ts'))
