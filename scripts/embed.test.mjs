/* eslint-env node, es2021 */
/* eslint-disable no-console */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

test('embedded preview sends a cloneable unsaved snapshot and preserves the editor', async () => {
  const built = await build({
    stdin: { contents: "export { default as useScreening } from './src/hooks/useScreening.ts'; export * from '@/embed/bridge'; export * from '@/store'", resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'screening-boundaries', setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => ({ path: args.path, namespace: 'boundary' }))
      builder.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ contents:
        args.path === '@/embed/bridge' ? `
          export let embedded = true, readOnly = false;
          export const messages = [];
          export function setMode(edit) { readOnly = !edit; }
          export function send(type, payload) { messages.push(structuredClone({ type, payload })); }
        ` : args.path === '@/store' ? `
          export const slides = { title: 'Unsaved draft', viewportSize: 1000, viewportRatio: .5625,
            slideIndex: 1, theme: new Proxy({ themeColors: ['#fff'] }, {}),
            slides: new Proxy([{ id: 'first', elements: [] }, { id: 'second', elements: [],
              animations: [{ elId: 'text', effect: 'fadeIn', trigger: 'click' }] }], {}),
            updateSlideIndex(value) { this.slideIndex = value; } };
          export const screen = { screening: false, setScreening(value) { this.screening = value; } };
          export const useSlidesStore = () => slides;
          export const useScreenStore = () => screen;
        ` : `
          export function enterFullscreen() { throw new Error('must not enter browser fullscreen'); }
          export function exitFullscreen() { throw new Error('must not exit browser fullscreen'); }
          export const isFullscreen = () => false;
        `,
      }))
    } }],
  })
  const module = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
  const screening = module.useScreening()
  screening.enterScreening()
  assert.equal(module.screen.screening, false)
  assert.equal(module.messages[0].type, 'PREVIEW')
  assert.equal(module.messages[0].payload.startIndex, 1)
  assert.equal(module.messages[0].payload.document.height, 562.5)
  assert.equal(Object.hasOwn(module.messages[0].payload.document, 'title'), false)
  assert.equal(module.messages[0].payload.document.slides[1].animations[0].effect, 'fadeIn')
  module.slides.theme.themeColors[0] = '#000'
  assert.equal(module.messages[0].payload.document.theme.themeColors[0], '#fff')
  screening.enterScreeningFromStart()
  assert.equal(module.messages[1].payload.startIndex, 0)
  assert.equal(module.slides.slideIndex, 1)
  module.setMode(false)
  screening.exitScreening()
  assert.equal(module.messages[2].type, 'CLOSE_PREVIEW')
})

// Exercise the real bridge and media client with browser boundary fakes, not a duplicate implementation.
test('bridge validates sources; credentials coalesce; media survives serialize and rehydrate', async () => {
  const listeners = []
  const messages = []
  let issuedToken = 'test-only-token'
  const parent = { postMessage(message, origin) {
    assert.equal(origin, 'http://parent.test')
    messages.push(message)
    if (message.type === 'TOKEN_REQUEST') {
      queueMicrotask(() => dispatch({ ...message,
        type: 'TOKEN', payload: { token: issuedToken, expires_in: 300 } }))
    }
  } }
  globalThis.location = { search: '?embed=edit&parentOrigin=http%3A%2F%2Fparent.test&instanceId=test-instance' }
  globalThis.window = { parent, addEventListener: (_, callback) => listeners.push(callback), setTimeout }
  function dispatch(data, origin = 'http://parent.test', source = parent) {
    for (const listener of listeners) listener({ data, origin, source })
  }
  const built = await build({ stdin: { contents: "export * from './src/embed/api.ts'; export * from './src/embed/bridge.ts'", resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'esm', define: { 'import.meta.env': JSON.stringify({
      VITE_API_BASE_URL: 'http://api.test/api/v1', VITE_PARENT_ORIGINS: 'http://parent.test',
    }) } })
  const client = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
  client.send('HELLO')
  const envelope = messages[0]
  let delivered = 0
  const dispose = client.subscribe(() => delivered++)
  dispatch(envelope, 'http://evil.test')
  dispatch(envelope, 'http://parent.test', {})
  dispatch({ ...envelope, instanceId: 'stale' })
  dispatch({ ...envelope, bootId: 'stale' })
  dispatch({ ...envelope, version: 2 })
  assert.equal(delivered, 0)
  dispatch(envelope)
  assert.equal(delivered, 1)
  dispose()
  assert.deepEqual(await Promise.all([client.getToken(), client.getToken()]), ['test-only-token', 'test-only-token'])
  assert.equal(messages.filter(message => message.type === 'TOKEN_REQUEST').length, 1)

  const originalFetch = globalThis.fetch
  const assets = new Map()
  let failedUpload = false
  let failedRead = true
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith('http://api.test')) return await originalFetch(url, init)
    const targetLesson = String(url).includes('/lessons/2/')
    if (targetLesson) {
      assert.equal(init.method || 'GET', 'GET')
      assert.equal(init.headers.Authorization, 'Bearer lesson-two-token')
    }
    else assert.equal(init.headers.Authorization, 'Bearer test-only-token')
    assert.match(String(url), /^http:\/\/api\.test\/api\/v1\/lessons\/[12]\/courseware\/assets/)
    assert.equal(init.credentials, 'omit')
    if (init.method === 'POST') {
      if (failedUpload) return Response.json({ message: 'storage unavailable' }, { status: 503 })
      const id = String(assets.size + 1)
      assets.set(id, init.body)
      return Response.json({ id, reference: `asset:${id}` }, { status: 201 })
    }
    const id = String(url).split('/').pop()
    if (failedRead || !assets.has(id)) return Response.json({ message: 'asset unavailable' }, { status: 404 })
    return new Response(assets.get(id))
  }
  try {
    const source = { slides: [{ elements: [
      { src: 'data:audio/wav;base64,AQID' }, { src: 'data:video/mp4;base64,BAUG' },
      { src: 'data:audio/wav;base64,AQID' }, { src: 'https://external.test/video.mp4' },
    ] }] }
    const media = new client.MediaSession('1')
    const persisted = await media.persist(source)
    assert.equal(assets.size, 2)
    assert.equal(persisted.slides[0].elements[0].src, persisted.slides[0].elements[2].src)
    assert.equal(persisted.slides[0].elements[3].src, 'https://external.test/video.mp4')
    assert.match(source.slides[0].elements[0].src, /^data:/)
    assert.doesNotMatch(JSON.stringify(persisted), /data:|blob:/)
    await assert.rejects(media.hydrate(persisted), { status: 404 })
    assert.match(persisted.slides[0].elements[0].src, /^asset:/)
    failedRead = false
    const hydrated = await media.hydrate(persisted)
    const mediaUrl = hydrated.slides[0].elements[0].src
    assert.match(mediaUrl, /^blob:/)
    assert.deepEqual(new Uint8Array(await (await originalFetch(mediaUrl)).arrayBuffer()), new Uint8Array([1, 2, 3]))
    assert.deepEqual(await media.persist(hydrated), persisted)
    assert.equal(assets.size, 2)
    issuedToken = 'lesson-two-token'
    const otherClient = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}#lesson-two`)
    const targetMedia = new otherClient.MediaSession('2')
    const imported = await targetMedia.hydrate(persisted)
    assert.match(imported.slides[0].elements[0].src, /^blob:/)
    assert.deepEqual(await targetMedia.persist(imported), persisted)
    assert.equal(assets.size, 2)
    targetMedia.dispose()
    failedUpload = true
    const failed = { slides: [{ src: 'data:audio/wav;base64,BwgJ' }] }
    await assert.rejects(media.persist(failed), /storage unavailable/)
    assert.match(failed.slides[0].src, /^data:/)
    failedUpload = false
    await media.persist(failed)
    assert.equal(assets.size, 3)
    assert.equal(media.invalidate([persisted.slides[0].elements[0].src]), true)
    const retry = await media.persist(hydrated)
    assert.equal(assets.size, 4)
    assert.notEqual(retry.slides[0].elements[0].src, persisted.slides[0].elements[0].src)
    assert.equal(retry.slides[0].elements[1].src, persisted.slides[0].elements[1].src)
    media.dispose()
    await assert.rejects(originalFetch(mediaUrl))
  }
  finally {
    globalThis.fetch = originalFetch 
  }
})

test('full-courseware import accepts both export formats and checks the document before use', async () => {
  const built = await build({ entryPoints: ['src/embed/documentImport.ts'], alias: { '@': './src' }, bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'browser-markup-boundary', setup(builder) {
      builder.onResolve({ filter: /^dompurify$/ }, () => ({ path: 'dompurify', namespace: 'browser' }))
      builder.onLoad({ filter: /^dompurify$/, namespace: 'browser' }, () => ({ contents: 'export default { sanitize: value => value }' }))
    } }],
  })
  const { parseCoursewareDocument, readCoursewareDocument } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
  const position = { left: 10, top: 20, width: 200, height: 100, rotate: 0 }
  const document = { format_version: 1, width: 960, height: 720, theme: {
    backgroundColor: '#fafafa', themeColors: ['#222'], fontName: '', fontColor: '#222',
    outline: { style: 'solid' }, shadow: { h: 1, v: 2, blur: 3, color: '#444' },
  }, slides: [
    { id: 'page1', elements: [
      { ...position, id: 'text', type: 'text', content: '<p>课件</p>', link: { type: 'web', target: 'https://example.com' } },
      { ...position, id: 'image', type: 'image', src: 'asset:123' },
      { ...position, id: 'audio', type: 'audio', src: 'data:audio/wav;base64,AQID' },
    ], remark: '<p>备注</p>', turningMode: 'fade', animations: [
      { id: 'a1', elId: 'text', type: 'in', effect: 'fadeIn', duration: 1000, trigger: 'click' },
    ] },
    { id: 'page2', elements: [], background: { type: 'solid', color: '#eee' } },
  ] }

  const raw = JSON.stringify(document)
  assert.deepEqual(parseCoursewareDocument('\uFEFF' + raw), document)
  const legacyTheme = parseCoursewareDocument(JSON.stringify({ ...document, theme: { backgroundColor: '#ddd' } })).theme
  assert.equal(legacyTheme.backgroundColor, '#ddd')
  assert.equal(legacyTheme.fontColor, '#333')
  const envelope = { base_id: 'original', document, allowed_effects: {}, instructions: '示例' }
  assert.deepEqual(await readCoursewareDocument(new File([JSON.stringify(envelope)], '课件.JSON')), document)
  assert.throws(() => parseCoursewareDocument('{broken'), /无法解析/)
  assert.throws(() => parseCoursewareDocument(JSON.stringify({ base_id: 'original', changes: [] })), /导入动画变更/)
  for (const [changes, expected] of [
    [{ format_version: 2 }, /版本 1/],
    [{ height: 10001 }, /画布宽高/],
    [{ theme: { ...document.theme, themeColors: null } }, /课件主题/],
    [{ slides: [] }, /1–200 页/],
    [{ slides: Array(201).fill(document.slides[0]) }, /1–200 页/],
    [{ slides: [document.slides[0], document.slides[0]] }, /ID 重复/],
    [{ slides: [{ id: 'invalid', elements: [null] }] }, /元素结构/],
    [{ slides: [{ id: 'invalid', elements: [], animations: {} }] }, /动画结构/],
    [{ slides: [{ id: 'invalid', elements: [{ ...position, id: 'image', type: 'image', src: 'blob:expired' }] }] }, /临时素材/],
    [{ slides: [{ id: 'invalid', elements: [{ ...position, id: 'image', type: 'image', src: 'asset:invalid' }] }] }, /私有素材引用/],
    [{ slides: [{ id: 'invalid', elements: [{ ...position, id: 'text', type: 'text', content: '', link: { type: 'web', target: 'file:///example' } }] }] }, /链接/],
  ]) {
    assert.throws(() => parseCoursewareDocument(JSON.stringify({ ...document, ...changes })), expected)
  }
  await assert.rejects(readCoursewareDocument({ name: 'big.json', size: 100 * 1024 * 1024 + 1 }), /100 MiB/)

  for (const element of [
    { type: 'image', src: 'asset:123', clip: { range: [[0, 0], [100, 100]], shape: 'unknown' } },
    { type: 'shape', viewBox: [100, 100], path: 'M 0 0', pathFormula: 'unknown' },
    { type: 'chart', chartType: 'pie', themeColors: [], data: { labels: [], legends: [], series: [] } },
    { type: 'table', colWidths: [1], cellMinHeight: 10, data: [[{ id: 'cell', colspan: 1, rowspan: 1, text: '' }]] },
  ]) {
    const slides = [{ id: 'invalid', elements: [{ ...position, id: 'invalid', ...element }] }]
    assert.throws(() => parseCoursewareDocument(JSON.stringify({ ...document, slides })), /元素结构/)
  }
})

test('animation exchange validates atomically and preserves media and layout', async () => {
  const built = await build({ entryPoints: ['src/embed/animationExchange.ts'], alias: { '@': './src' }, bundle: true, write: false, platform: 'node', format: 'esm' })
  const { applyAnimations, fingerprint } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
  const document = { format_version: 1, width: 1000, height: 562.5, theme: {}, slides: [
    { id: 'page1', elements: [{ id: 'image1', src: 'asset:123', left: 20 }, { id: 'video1', src: 'https://example.com/video.mp4' }] },
  ] }
  const animation = { id: 'a1', elId: 'image1', type: 'in', effect: 'fadeIn', duration: 1000, trigger: 'click' }
  const patch = { format_version: 1, base_id: 'base', changes: [{ slide_id: 'page1', animations: [animation] }] }
  const result = applyAnimations(patch, 'base', document)
  assert.deepEqual(result.slides[0].elements, document.slides[0].elements)
  assert.equal(document.slides[0].animations, undefined)
  assert.deepEqual(result.slides[0].animations, [animation])
  assert.throws(() => applyAnimations(patch, 'different', document))
  for (const invalid of [{ elId: 'missing' }, { effect: 'unknown' }, { duration: -1 }, { trigger: 'auto' }, { src: 'changed' }]) {
    assert.throws(() => applyAnimations({ ...patch, changes: [{ slide_id: 'page1', animations: [{ ...animation, ...invalid }] }] }, 'base', document))
  }
  assert.throws(() => applyAnimations({ ...patch, changes: [...patch.changes, { slide_id: 'missing', animations: [] }] }, 'base', document))
  assert.equal(document.slides[0].animations, undefined)
  assert.deepEqual(applyAnimations({ ...patch, changes: [{ slide_id: 'page1', animations: [] }] }, 'base', result).slides[0].animations, [])
  assert.equal(await fingerprint(document), await fingerprint({ ...document, theme: {} }))
  assert.notEqual(await fingerprint(document), await fingerprint(result))
})

test('saved-state comparison ignores measured sizes and detects authored changes', async () => {
  const built = await build({ entryPoints: ['src/embed/editableSnapshot.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
  const { getEditableSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
  const document = { format_version: 1, width: 1000, height: 562.5, theme: {}, slides: [
    { id: 'page1', elements: [
      { id: 'horizontal', type: 'text', width: 240, height: 50, content: '<p>Text</p>' },
      { id: 'vertical', type: 'text', vertical: true, width: 50, height: 240 },
      { id: 'fixed', type: 'text', fixedHeight: true, width: 240, height: 50 },
      { id: 'table', type: 'table', width: 240, height: 50, rowHeights: [25, 25] },
    ] },
  ] }
  const measured = structuredClone(document)
  const [horizontal, vertical, fixed, table] = measured.slides[0].elements
  horizontal.height = 51
  vertical.width = 49
  table.height = 52
  const saved = getEditableSnapshot(document)
  assert.equal(getEditableSnapshot(measured), saved)
  assert.equal(horizontal.height, 51)

  for (const [element, property, value] of [
    [horizontal, 'content', '<p>Edited</p>'], [horizontal, 'width', 250],
    [vertical, 'height', 250], [fixed, 'height', 51], [table, 'rowHeights', [30, 25]],
  ]) {
    const previous = element[property]
    element[property] = value
    assert.notEqual(getEditableSnapshot(measured), saved, `${element.id}.${property}`)
    element[property] = previous
  }
})
