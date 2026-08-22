import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const dxf = `0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n10\n21\n0\n0\nTEXT\n8\n0\n10\n0\n20\n2\n40\n1\n1\nSynthetic fixture\n0\nENDSEC\n0\nEOF\n`
await mkdir(root, { recursive: true })
await writeFile(path.join(root, 'basic.dxf'), dxf, 'utf8')
