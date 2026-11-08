/* eslint-env node, es2021 */
/* eslint-disable no-console */
import { spawnSync } from 'node:child_process'
const mode = process.env.AI_TANG_BUILD_MODE?.trim()
if (!['development', 'test', 'production'].includes(mode)) {
  console.error('AI_TANG_BUILD_MODE must be development, test, or production')
  process.exit(2)
}
console.log(`[courseware build] mode=${mode}`)
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', `build:${mode}`], { stdio: 'inherit', env: process.env })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
