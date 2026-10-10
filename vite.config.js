// vite.config.js | https://vitejs.dev/config/
import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

const buildTimestamp = new Date();
const buildDateLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(buildTimestamp) + ' IST';

export default defineConfig({
    build: {
        assetsInlineLimit: 0,
        chunkSizeWarningLimit: 1500,
        rollupOptions: {
            output: {
                entryFileNames: `assets/js/[name]-[hash].js`,
                chunkFileNames: `assets/js/[name]-[hash].js`,
                assetFileNames: assetInfo => {
                    if (/(\.png)|(\.gif)|(\.webp)|(\.ico)$/.test(assetInfo.name)) {
                      return 'assets/images/[name]-[hash].[ext]'
                    }
                    if (/(\.ttf)|(\.woff2)$/.test(assetInfo.name)) {
                      return 'assets/fonts/[name]-[hash].[ext]'
                    }
                    return 'assets/[name]-[hash].[ext]'
                  }
            }
        }
    },
    plugins: [
        mkcert(),
        {
            name: 'app-build-version',
            transformIndexHtml(html) {
                return html
                    .replaceAll('%APP_BUILD_TIMESTAMP%', buildTimestamp.toISOString())
                    .replaceAll('%APP_BUILD_DATE%', buildDateLabel);
            },
        },
    ]
})
