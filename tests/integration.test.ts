import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exportCad, extractCad, inspectCad } from '../src/index.js'
import { ACadVersion, CadDocument, DwgWriter, Line, XYZ } from '@node-projects/acad-ts'

const config = (outputDir: string) => ({ outputDir, maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 500, maxImageDimension: 8192 })

function dxf(entities: string, version = 'AC1027', codePage = 'UTF-8') {
  return `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\n${version}\n9\n$DWGCODEPAGE\n3\n${codePage}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`
}

const matrixEntities = [
  '0\nLINE\n8\n0\n10\n0\n20\n0\n11\n10\n21\n10\n',
  '0\nCIRCLE\n8\n0\n10\n5\n20\n5\n40\n2\n',
  '0\nARC\n8\n0\n10\n5\n20\n5\n40\n2\n50\n0\n51\n90\n',
  '0\nELLIPSE\n8\n0\n10\n0\n20\n0\n11\n5\n21\n0\n40\n0.5\n41\n0\n42\n6.28\n',
  '0\nPOINT\n8\n0\n10\n1\n20\n1\n',
  '0\nSOLID\n8\n0\n10\n0\n20\n0\n11\n2\n21\n0\n12\n2\n22\n2\n13\n0\n23\n2\n',
  '0\nTEXT\n8\n0\n10\n0\n20\n0\n40\n1\n1\nHello\n',
  '0\nMTEXT\n8\n0\n10\n0\n20\n2\n40\n1\n1\nWorld\n',
  '0\nSPLINE\n8\n0\n70\n0\n71\n2\n72\n5\n73\n3\n74\n0\n42\n0.0000001\n43\n0.0000001\n44\n0.0000001\n40\n0\n40\n0\n40\n0\n40\n1\n40\n1\n10\n0\n20\n0\n30\n0\n10\n1\n20\n1\n30\n0\n10\n2\n20\n0\n30\n0\n',
  '0\nDIMENSION\n8\n0\n2\n*D1\n70\n0\n10\n0\n20\n0\n30\n0\n13\n0\n23\n0\n33\n0\n14\n10\n24\n10\n34\n0\n',
  '0\nATTRIB\n8\n0\n10\n0\n20\n0\n40\n1\n1\nValue\n2\nTAG\n70\n0\n',
  '0\nHATCH\n8\n0\n10\n0\n20\n0\n70\n1\n71\n0\n91\n1\n92\n7\n72\n0\n73\n1\n93\n4\n10\n0\n20\n0\n10\n10\n20\n0\n10\n10\n20\n10\n10\n0\n20\n10\n75\n0\n76\n1\n98\n0\n',
].join('')

const blockFixture = `0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n5\n20\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockBegin\n2\nB\n70\n0\n10\n0\n20\n0\n30\n0\n0\nLINE\n5\n21\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n0\n20\n0\n30\n0\n11\n1\n21\n1\n31\n0\n0\nENDBLK\n5\n22\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockEnd\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nINSERT\n5\n30\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockReference\n2\nB\n10\n0\n20\n0\n30\n0\n41\n1\n42\n1\n43\n1\n50\n0\n70\n2\n71\n2\n44\n2\n45\n2\n0\nENDSEC\n0\nEOF\n`

function nestedBlockFixture(depth: number) {
  const records = Array.from({ length: depth }, (_, index) => {
    const name = `B${index}`
    const child = index + 1 < depth
      ? `0\nINSERT\n5\n${100 + index}\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockReference\n2\nB${index + 1}\n10\n0\n20\n0\n30\n0\n41\n1\n42\n1\n43\n1\n`
      : '0\nLINE\n5\n199\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n0\n20\n0\n30\n0\n11\n1\n21\n1\n31\n0\n'
    return `0\nBLOCK\n5\n${200 + index}\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockBegin\n2\n${name}\n70\n0\n10\n0\n20\n0\n30\n0\n${child}0\nENDBLK\n5\n${300 + index}\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockEnd\n`
  }).join('')
  return `0\nSECTION\n2\nBLOCKS\n${records}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nINSERT\n5\n400\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockReference\n2\nB0\n10\n0\n20\n0\n30\n0\n41\n1\n42\n1\n43\n1\n0\nENDSEC\n0\nEOF\n`
}

function encodedDxf(codePage: string, textBytes: Uint8Array) {
  const prefix = new TextEncoder().encode(`0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n9\n$DWGCODEPAGE\n3\n${codePage}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nTEXT\n8\n0\n10\n0\n20\n0\n40\n1\n1\n`)
  const suffix = new TextEncoder().encode('\n0\nENDSEC\n0\nEOF\n')
  const result = new Uint8Array(prefix.length + textBytes.length + suffix.length)
  result.set(prefix)
  result.set(textBytes, prefix.length)
  result.set(suffix, prefix.length + textBytes.length)
  return result
}

describe('CAD integration matrix', () => {
  it('round-trips UTF-8, GB2312 and ANSI-1252 text fixtures', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-integration-'))
    try {
      const fixtures = [
        ['utf8.dxf', encodedDxf('UTF-8', new TextEncoder().encode('中文')), '中文'],
        ['gb2312.dxf', encodedDxf('ANSI_936', Uint8Array.from([0xD6, 0xD0, 0xCE, 0xC4])), '中文'],
        ['ansi1252.dxf', encodedDxf('ANSI_1252', Uint8Array.from([0x43, 0x61, 0x66, 0xE9])), 'Café'],
      ] as const
      for (const [name, bytes, expected] of fixtures) {
        const file = path.join(dir, name)
        await writeFile(file, bytes)
        const result = await inspectCad(file, config(dir))
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.codePage).toBe(name === 'utf8.dxf' ? 'UTF-8' : name === 'gb2312.dxf' ? 'ANSI_936' : 'ANSI_1252')
        const texts = await extractCad({ path: file, section: 'texts' }, config(dir))
        expect(texts.ok).toBe(true)
        if (texts.ok) expect(texts.records[0]?.text).toBe(expected)
      }
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('covers ASCII and binary DXF plus the AC1014–AC1032 version matrix', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-integration-'))
    try {
      for (const version of ['AC1014', 'AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032']) {
        const file = path.join(dir, `${version}.dxf`)
        await writeFile(file, dxf('0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1\n21\n1\n', version))
        const result = await inspectCad(file, config(dir))
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.version.name).toBe(version)
      }
      const ascii = path.join(dir, 'ascii.dxf')
      await writeFile(ascii, dxf(matrixEntities))
      const output = await exportCad({ path: ascii, format: 'dxf', outputName: 'binary' }, config(dir))
      expect(output.ok).toBe(true)
      if (output.ok) expect((await readFile(output.outputPath)).subarray(0, 7).toString('ascii')).toBe('AutoCAD')
      const versions: Array<[string, ACadVersion]> = [['AC1014', ACadVersion.AC1014], ['AC1015', ACadVersion.AC1015], ['AC1018', ACadVersion.AC1018], ['AC1021', ACadVersion.AC1021], ['AC1024', ACadVersion.AC1024], ['AC1027', ACadVersion.AC1027], ['AC1032', ACadVersion.AC1032]]
      for (const [name, version] of versions) {
        const document = new CadDocument(version, true)
        document.modelSpace?.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(1, 1, 0)))
        const file = path.join(dir, `${name}.dwg`)
        await writeFile(file, DwgWriter.writeToBuffer(document))
        const result = await inspectCad(file, config(dir))
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.version.name).toBe(name)
      }
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('parses the representative entity matrix and rejects damaged or disguised files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-integration-'))
    try {
      const file = path.join(dir, 'entities.dxf')
      await writeFile(file, dxf(matrixEntities))
      const result = await inspectCad(file, config(dir))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.entityTypes).toEqual(expect.objectContaining({ Line: 1, Circle: 1, Arc: 1, Ellipse: 1, Point: 1, Solid: 1, TextEntity: 1, MText: 1, Hatch: 1, Spline: 1, AttributeEntity: 1 }))
      const dimensionFile = path.join(dir, 'dimension.dxf')
      await writeFile(dimensionFile, '0\nSECTION\n2\nENTITIES\n0\nDIMENSION\n8\n0\n2\n*D1\n70\n0\n10\n0\n20\n0\n30\n0\n13\n0\n23\n0\n33\n0\n14\n10\n24\n10\n34\n0\n0\nENDSEC\n0\nEOF\n')
      const dimension = await inspectCad(dimensionFile, config(dir))
      expect(dimension.ok).toBe(true)
      if (dimension.ok) expect(dimension.entityTypes).toEqual(expect.objectContaining({ Dimension: 1 }))

      const truncated = path.join(dir, 'truncated.dxf')
      await writeFile(truncated, (await readFile(file)).subarray(0, 20))
      await expect(inspectCad(truncated, config(dir))).resolves.toMatchObject({ ok: false })
      const disguised = path.join(dir, 'disguised.dwg')
      await writeFile(disguised, await readFile(file))
      await expect(inspectCad(disguised, config(dir))).resolves.toMatchObject({ ok: false })
      await expect(inspectCad(file, { ...config(dir), maxFileSizeMB: 0.000001 })).resolves.toMatchObject({ ok: false, error: { code: 'FILE_TOO_LARGE' } })

      const link = path.join(dir, 'outside-link.dxf')
      try {
        await symlink(file, link)
        await expect(inspectCad(link, { ...config(dir), allowedInputRoots: [path.join(dir, 'not-the-link-target')] })).resolves.toMatchObject({ ok: false, error: { code: 'INPUT_OUTSIDE_ALLOWED_ROOTS' } })
      } catch {
        // Symlink creation can be disabled by the host OS policy.
      }

      const nested = path.join(dir, 'nested.dxf')
      await writeFile(nested, nestedBlockFixture(5))
      const nestedResult = await inspectCad(nested, config(dir))
      expect(nestedResult.ok).toBe(true)
      if (nestedResult.ok) expect(nestedResult.scope.maxNestedDepth).toBeGreaterThanOrEqual(5)
      const limited = await exportCad({ path: nested, format: 'svg', outputName: 'nested-limited' }, { ...config(dir), maxBlockDepth: 2 })
      expect(limited.ok).toBe(true)
      if (limited.ok) expect(limited.unsupportedEntityTypes.Insert ?? 0).toBeGreaterThan(0)

      const xref = path.join(dir, 'xref.dxf')
      await writeFile(xref, '0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n5\n20\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockBegin\n2\nXREF\n70\n4\n1\nmissing.dwg\n10\n0\n20\n0\n30\n0\n0\nENDBLK\n5\n22\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockEnd\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n')
      const xrefResult = await inspectCad(xref, config(dir))
      expect(xrefResult.ok).toBe(true)
      if (xrefResult.ok) expect(xrefResult.scope.resources.xrefs).toBe(1)

      const extreme = path.join(dir, 'extreme.dxf')
      await writeFile(extreme, dxf('0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1000000000\n21\n0\n'))
      const extremeSvg = await exportCad({ path: extreme, format: 'svg', outputName: 'extreme' }, config(dir))
      expect(extremeSvg.ok).toBe(true)
      if (extremeSvg.ok) expect(extremeSvg.bounds.max.x).toBe(1_000_000_000)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('covers block arrays, nested expansion limits and vertex resource limits', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-integration-'))
    try {
      const blocks = path.join(dir, 'blocks.dxf')
      await writeFile(blocks, blockFixture)
      const inspected = await inspectCad(blocks, config(dir))
      expect(inspected.ok).toBe(true)
      if (inspected.ok) expect(inspected.scope.insertCount).toBe(1)
      const rendered = await exportCad({ path: blocks, format: 'svg', outputName: 'blocks' }, config(dir))
      expect(rendered.ok).toBe(true)
      if (rendered.ok) expect(rendered.expandedEntityCount).toBeGreaterThanOrEqual(4)

      const vertices = Array.from({ length: 20 }, (_, index) => `10\n${index}\n20\n0\n`).join('')
      const vertexFile = path.join(dir, 'vertices.dxf')
      await writeFile(vertexFile, dxf(`0\nLWPOLYLINE\n8\n0\n90\n20\n70\n1\n${vertices}`))
      await expect(inspectCad(vertexFile, { ...config(dir), maxTotalVertices: 10 })).resolves.toMatchObject({ ok: false, error: { code: 'GEOMETRY_LIMIT_EXCEEDED' } })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
