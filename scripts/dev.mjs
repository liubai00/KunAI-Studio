import { spawn } from 'node:child_process'
import { loadEnvFile } from 'node:process'

try {
  loadEnvFile('.env.local')
} catch (err) {
  if (err.code !== 'ENOENT') throw err
}

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('请通过 npm run dev 启动开发环境')

const scripts = process.env.VITE_PLATFORM_MODE === 'false' ? ['dev:web'] : ['dev:server', 'dev:web']
const children = scripts.map((script) => spawn(process.execPath, [npmCli, 'run', script], { stdio: 'inherit' }))

let stopping = false
const stop = (code = 0) => {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exitCode = code
}

for (const child of children) {
  child.on('exit', (code) => stop(code ?? 1))
  child.on('error', () => stop(1))
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
