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
  let courseReply = '42'
  const parent = { postMessage(message, origin) {
    assert.equal(origin, 'http://parent.test')
    messages.push(message)
    if (message.type === 'TOKEN_REQUEST') {
      queueMicrotask(() => dispatch({ ...message,
        type: 'TOKEN', payload: { token: 'test-only-token', expires_in: 300 } }))
    }
    if (message.type === 'COURSE_REQUEST') {
      queueMicrotask(() => {
        dispatch({ ...message, requestId: 'stale-request', type: 'COURSE', payload: { courseId: '99' } })
        dispatch({ ...message, type: courseReply ? 'COURSE' : 'COURSE_ERROR', payload: { courseId: courseReply } })
      })
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
  // Draft association is explicit, coalesced, and can be retried after failure.
  assert.equal(messages.filter(message => message.type === 'COURSE_REQUEST').length, 0)
  assert.deepEqual(await Promise.all([client.requestCourse(), client.requestCourse()]), ['42', '42'])
  assert.equal(messages.filter(message => message.type === 'COURSE_REQUEST').length, 1)
  courseReply = ''
  await assert.rejects(client.requestCourse(), /课程草稿创建失败/)
  courseReply = 'invalid-id'
  await assert.rejects(client.requestCourse(), /课程草稿创建失败/)
  courseReply = '43'
  assert.equal(await client.requestCourse(), '43')
  assert.deepEqual(await Promise.all([client.getToken(), client.getToken()]), ['test-only-token', 'test-only-token'])
  assert.equal(messages.filter(message => message.type === 'TOKEN_REQUEST').length, 1)

  const originalFetch = globalThis.fetch
  const assets = new Map()
  let failedUpload = false
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith('http://api.test')) return await originalFetch(url, init)
    assert.equal(init.headers.Authorization, 'Bearer test-only-token')
    assert.equal(init.credentials, 'omit')
    if (init.method === 'POST') {
      if (failedUpload) return Response.json({ message: 'storage unavailable' }, { status: 503 })
      const id = String(assets.size + 1)
      assets.set(id, init.body)
      return Response.json({ id, reference: `asset:${id}` }, { status: 201 })
    }
    return new Response(assets.get(String(url).split('/').pop()))
  }
  try {
    const source = { title: 'Media test', slides: [{ elements: [
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
    const hydrated = await media.hydrate(persisted)
    const mediaUrl = hydrated.slides[0].elements[0].src
    assert.match(mediaUrl, /^blob:/)
    assert.deepEqual(new Uint8Array(await (await originalFetch(mediaUrl)).arrayBuffer()), new Uint8Array([1, 2, 3]))
    assert.deepEqual(await media.persist(hydrated), persisted)
    assert.equal(assets.size, 2)
    failedUpload = true
    const failed = { slides: [{ src: 'data:audio/wav;base64,BwgJ' }] }
    await assert.rejects(media.persist(failed), /storage unavailable/)
    assert.match(failed.slides[0].src, /^data:/)
    failedUpload = false
    await media.persist(failed)
    assert.equal(assets.size, 3)
    media.dispose()
    await assert.rejects(originalFetch(mediaUrl))
  }
  finally {
    globalThis.fetch = originalFetch 
  }
})

test('animation exchange validates atomically and preserves media and layout', async () => {
  const built = await build({ entryPoints: ['src/embed/animationExchange.ts'], alias: { '@': './src' }, bundle: true, write: false, platform: 'node', format: 'esm' })
  const { applyAnimations, fingerprint } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
  const document = { format_version: 1, title: '示例', width: 1000, height: 562.5, theme: {}, slides: [
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
