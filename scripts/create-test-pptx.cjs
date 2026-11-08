/* eslint-env node, es2021 */
/* eslint-disable no-console */
// Synthetic fixture only: no user data or external downloads.
const pptxgen = require('pptxgenjs')
const fs = require('node:fs')
const path = require('node:path')
const output = process.argv[2] || '/tmp/courseware-integration.pptx'
const samples = 8000
const wav = Buffer.alloc(44 + samples * 2)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / 8000) * 2000), 44 + 2 * i)
fs.writeFileSync(path.join(path.dirname(output), 'courseware-test.wav'), wav)
const pptx = new pptxgen()
pptx.layout = 'LAYOUT_WIDE'
let slide = pptx.addSlide()
slide.background = { color: 'EDF5FF' }
slide.addText('Courseware integration test', { x: 0.7, y: 0.6, w: 11, h: 0.8, fontSize: 32, color: '173B67', fontFace: 'Arial' })
slide.addText('Text, image, shape and chart import', { x: 0.8, y: 1.7, w: 10, h: 0.7, fontSize: 20, fontFace: 'Arial' })
slide.addShape(pptx.ShapeType.rect, { x: 0.8, y: 2.7, w: 3, h: 2, fill: { color: '2878CE' }, line: { color: '2878CE' } })
slide.addImage({ data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9sAAAAASUVORK5CYII=', x: 4.2, y: 2.7, w: 2, h: 2 })
slide.addChart(pptx.ChartType.bar, [{ name: 'Series', labels: ['A', 'B', 'C'], values: [2, 5, 3] }], { x: 7, y: 2.6, w: 5, h: 3 })
slide = pptx.addSlide()
slide.addText('Second slide', { x: 0.8, y: 1, w: 10, h: 1, fontSize: 32, fontFace: 'Arial' })
slide.addTable([['Item', 'Value'], ['Saved', 'Yes'], ['Reload', 'Yes']], { x: 1, y: 2, w: 7, h: 2, fontSize: 20 })
slide.addMedia({ type: 'audio', data: 'audio/wav;base64,' + wav.toString('base64'), x: 9, y: 2, w: 1, h: 1 })
pptx.writeFile({ fileName: output }).then(async () => {
  // PptxGenJS 3.x writes videoFile even for WAV; use the OOXML audioFile tag
  // so this fixture tests the importer's supported embedded-audio path.
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(fs.readFileSync(output))
  const name = 'ppt/slides/slide2.xml'
  zip.file(name, (await zip.file(name).async('string')).replace('<a:videoFile ', '<a:audioFile '))
  fs.writeFileSync(output, await zip.generateAsync({ type: 'nodebuffer' }))
  console.log(output)
})
