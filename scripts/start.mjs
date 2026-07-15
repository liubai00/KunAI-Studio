import { spawn } from 'node:child_process'

const child = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server/index.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
})

child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
child.on('error', (err) => {
  console.error(err)
  process.exitCode = 1
})
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
