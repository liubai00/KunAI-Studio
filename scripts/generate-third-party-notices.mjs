import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const spdxLicenses = require('spdx-license-list/full')
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
const packages = []
const licenseDocuments = new Map()
const usedSpdxIds = new Set()

for (const [relativePath, locked] of Object.entries(lock.packages || {})) {
  if (!relativePath || locked.dev === true || !relativePath.includes('node_modules/')) continue

  const dir = resolve(root, relativePath)
  const manifestPath = resolve(dir, 'package.json')
  if (!existsSync(manifestPath) && locked.optional !== true) throw new Error(`依赖未安装，无法生成许可清单：${relativePath}`)

  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  const files = existsSync(manifestPath) ? readdirSync(dir).filter((name) => {
    const path = resolve(dir, name)
    return /^(license|licence|copying|notice)([-._].*)?$/i.test(name) && statSync(path).isFile()
  }) : []
  const texts = files.map((name) => ({
    name,
    text: readFileSync(resolve(dir, name), 'utf8').trim(),
  })).filter((item) => item.text)
  const declared = typeof (manifest.license || locked.license) === 'string'
    ? manifest.license || locked.license
    : Array.isArray(manifest.licenses)
      ? manifest.licenses.map((item) => typeof item === 'string' ? item : item.type).filter(Boolean).join(' OR ')
      : manifest.license?.type || ''
  const detected = texts.map((item) => item.text).join('\n').match(/MIT License/i)
    ? 'MIT'
    : texts.length ? `见 ${texts.map((item) => item.name).join(', ')}` : ''
  const license = declared || detected
  const relativeName = relativePath.slice(relativePath.lastIndexOf('node_modules/') + 'node_modules/'.length)
  if (!license) throw new Error(`依赖未声明许可证且未提供许可文件：${manifest.name || relativeName}@${manifest.version || locked.version}`)

  const repository = typeof manifest.repository === 'string'
    ? manifest.repository
    : manifest.repository?.url || manifest.homepage || ''
  packages.push({
    name: manifest.name || relativeName || basename(relativePath),
    version: manifest.version || locked.version || 'unknown',
    license,
    repository: String(repository).replace(/^git\+/, '').replace(/\.git$/, ''),
  })
  for (const token of license.match(/[A-Za-z0-9][A-Za-z0-9.-]*/g) || []) {
    if (spdxLicenses[token]) usedSpdxIds.add(token)
  }

  for (const item of texts) {
    const hash = createHash('sha256').update(item.text).digest('hex')
    const existing = licenseDocuments.get(hash)
    if (existing) {
      existing.packages.push(`${manifest.name || relativeName}@${manifest.version || locked.version}`)
      continue
    }
    licenseDocuments.set(hash, {
      name: item.name,
      packages: [`${manifest.name || relativeName}@${manifest.version || locked.version}`],
      text: item.text,
    })
  }
}

for (const id of usedSpdxIds) {
  const text = String(spdxLicenses[id].licenseText || '').trim()
  if (!text) throw new Error(`SPDX 许可证缺少完整文本：${id}`)
  const hash = createHash('sha256').update(text).digest('hex')
  const existing = licenseDocuments.get(hash)
  if (existing) {
    existing.packages.push(`SPDX:${id}`)
    continue
  }
  licenseDocuments.set(hash, {
    name: `${id}.txt`,
    packages: [`SPDX:${id}`],
    text,
  })
}

packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'))
const documents = Array.from(licenseDocuments.values()).sort((a, b) => a.packages[0].localeCompare(b.packages[0], 'en'))
const foundationLicense = readFileSync(resolve(root, 'LICENSE'), 'utf8').trim()
const output = [
  'KunAI Studio Third-Party Notices',
  '=================================',
  '',
  'KunAI Studio 基于 GPT Image Playground（Copyright (c) 2026 CookSleep）进行二次开发，',
  '原项目依据 MIT License 授权。KunAI Studio 新增并维护品牌系统、平台账户、人民币计费、',
  'Dulupay 支付、Agent、多轮生图、Tavily 搜索、企业管理、部署与安全增强等能力。',
  '',
  '本文件由 scripts/generate-third-party-notices.mjs 根据 package-lock.json 与已安装的生产依赖生成。',
  '它不替代外部模型、搜索、支付、邮件服务及用户素材各自的服务条款或内容授权。',
  '',
  'Foundation License',
  '------------------',
  foundationLicense,
  '',
  `Production Dependency Index (${packages.length} packages)`,
  '------------------------------------------------',
  ...packages.map((item) => `${item.name}@${item.version} | ${item.license}${item.repository ? ` | ${item.repository}` : ''}`),
  '',
  `Bundled License Documents (${documents.length} unique documents)`,
  '------------------------------------------------',
  ...documents.flatMap((item) => [
    '',
    `--- ${item.name} | ${item.packages.join(', ')} ---`,
    item.text,
  ]),
  '',
].join('\n').replace(/[ \t]+$/gm, '')

writeFileSync(resolve(root, 'THIRD_PARTY_NOTICES.txt'), output, 'utf8')
writeFileSync(resolve(root, 'public', 'third-party-notices.txt'), output, 'utf8')
console.log(`Generated notices for ${packages.length} production dependencies with ${documents.length} unique license documents.`)
