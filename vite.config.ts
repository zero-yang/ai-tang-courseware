import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'
import IconsResolver from 'unplugin-icons/resolver'
import Components from 'unplugin-vue-components/vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  if (!env.VITE_API_BASE_URL || !env.VITE_PARENT_ORIGINS) throw new Error('VITE_API_BASE_URL and VITE_PARENT_ORIGINS are required')
  if (!env.VITE_API_BASE_URL.startsWith('/') && !/^https?:\/\//.test(env.VITE_API_BASE_URL)) throw new Error('Invalid API URL')
  const parents = env.VITE_PARENT_ORIGINS.split(',')
  for (const origin of parents) {
    if (new URL(origin).origin !== origin || (mode !== 'development' && !origin.startsWith('https://'))) throw new Error('Invalid parent origin')
  }
  return {

    base: '',
    plugins: [
      vue(),
      {
        name: 'courseware-embedding-headers',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: '_headers', source: `/*\n  Content-Security-Policy: frame-ancestors ${parents.join(' ')}\n  X-Content-Type-Options: nosniff\n` })
        },
      },
      Components({
        dirs: [],
        resolvers: [
          IconsResolver({
            prefix: 'i',
            customCollections: ['custom'],
          }),
        ],
      }),
      Icons({
        compiler: 'vue3',
        autoInstall: false,
        customCollections: {
          custom: FileSystemIconLoader('src/assets/icons'),
        },
        scale: 1,
        defaultClass: 'i-icon',
      }),
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: false,
        }
      }
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `
          @import '@/assets/styles/variable.scss';
          @import '@/assets/styles/mixin.scss';
        `
        },
      },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    }
  }
})
