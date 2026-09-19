import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const vapidSubject = Deno.env.get('VAPID_SUBJECT')
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')

if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
  throw new Error('VAPID secrets are not configured')
}

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })
  const token = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, stock, min_stock')
    .eq('is_active', true)

  if (productsError) return Response.json({ error: productsError.message }, { status: 500 })

  const lowStock = (products || []).filter((product) => Number(product.stock) <= Number(product.min_stock))
  if (lowStock.length === 0) return Response.json({ sent: 0 })

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
  if (subscriptionsError) return Response.json({ error: subscriptionsError.message }, { status: 500 })

  let sent = 0
  for (const subscription of subscriptions || []) {
    for (const product of lowStock) {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, JSON.stringify({
          title: `Stok menipis: ${product.name}`,
          body: `Tersisa ${product.stock}, minimum stok ${product.min_stock}.`,
          tag: `low-stock-${product.id}`,
          url: '/',
        }))
        sent += 1
      } catch (error) {
        if (error instanceof webpush.WebPushError && [404, 410].includes(error.statusCode)) {
          await supabase.from('push_subscriptions').delete().eq('id', subscription.id)
        } else {
          console.error('Push delivery failed:', error)
        }
      }
    }
  }

  return Response.json({ sent })
})
