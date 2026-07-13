// Glow Tape push sender: a localhost-only HTTP shim around the web-push
// library. PocketBase hooks POST batches here; this signs the VAPID JWT and
// encrypts payloads (ES256 + aes128gcm — not possible inside PocketBase's
// JSVM). Never exposed beyond 127.0.0.1.
//
// Env (shared /etc/glowtape/env):
//   GLOWTAPE_VAPID_PUBLIC / GLOWTAPE_VAPID_PRIVATE  — see DEPLOY.md to generate
//   GLOWTAPE_VAPID_SUBJECT — defaults to mailto:callboard@glowtape.net

import http from 'node:http'
import webpush from 'web-push'

const PUB = process.env.GLOWTAPE_VAPID_PUBLIC || ''
const PRIV = process.env.GLOWTAPE_VAPID_PRIVATE || ''
const SUBJECT = process.env.GLOWTAPE_VAPID_SUBJECT || 'mailto:callboard@glowtape.net'

const configured = !!(PUB && PRIV)
if (configured) {
  webpush.setVapidDetails(SUBJECT, PUB, PRIV)
} else {
  console.warn('glowtape-push: VAPID keys not set — replying 503 until they are (see DEPLOY.md)')
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/send') {
    res.writeHead(404)
    res.end()
    return
  }
  if (!configured) {
    res.writeHead(503)
    res.end()
    return
  }
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 5_000_000) req.destroy()
  })
  req.on('end', async () => {
    try {
      const { items } = JSON.parse(body)
      const results = await Promise.all(
        items.map(async (item) => {
          try {
            await webpush.sendNotification(item.subscription, JSON.stringify(item.payload), {
              TTL: 4 * 3600,
            })
            return { ok: true }
          } catch (err) {
            // 404/410 = the browser dropped the subscription; tell PB to forget it
            const gone = err.statusCode === 404 || err.statusCode === 410
            if (!gone) console.warn('glowtape-push: send failed', err.statusCode || err.message)
            return { ok: false, gone }
          }
        }),
      )
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ results }))
    } catch {
      res.writeHead(400)
      res.end()
    }
  })
})

server.listen(8666, '127.0.0.1', () => {
  console.log(`glowtape-push listening on 127.0.0.1:8666 (configured: ${configured})`)
})
