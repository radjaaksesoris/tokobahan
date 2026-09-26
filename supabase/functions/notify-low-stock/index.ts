import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

interface LowStockProduct {
  id: string
  name: string
  stock: number
  min_stock: number
}

function isExpiredPushError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return false
  const statusCode = error.statusCode
  return typeof statusCode === 'number' && [404, 410].includes(statusCode)
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() || ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || ''
const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

const vapidSubject = Deno.env.get('VAPID_SUBJECT')
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  if (!supabase || !vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    return jsonResponse({ error: 'Push server secrets are not configured' }, 500)
  }

  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'Unauthorized' }, 401)
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) return jsonResponse({ error: 'Unauthorized' }, 401)

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return jsonResponse({ error: 'Unauthorized' }, 401)

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    if (profileError) return jsonResponse({ error: profileError.message }, 500)
    if (!profile || !['admin', 'cashier'].includes(profile.role)) {
      return jsonResponse({ error: 'Role tidak diizinkan mengirim notifikasi stok' }, 403)
    }
  } catch (error) {
    console.error('User verification failed:', error)
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  } catch (error) {
    console.error('VAPID configuration failed:', error)
    return jsonResponse({ error: 'VAPID configuration is invalid' }, 500)
  }

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, stock, min_stock')
    .eq('is_active', true)

  if (productsError) return jsonResponse({ error: productsError.message }, 500)

  const lowStock = (products || []).map((product): LowStockProduct => ({
    id: product.id,
    name: product.name,
    stock: Number(product.stock),
    min_stock: Number(product.min_stock),
  })).filter((product) => product.stock <= product.min_stock)
  if (lowStock.length === 0) return jsonResponse({ sent: 0 })

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
  if (subscriptionsError) return jsonResponse({ error: subscriptionsError.message }, 500)

  const cooldownSince = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: recentLogs, error: logsError } = await supabase
    .from('low_stock_notification_log')
    .select('product_id, subscription_id')
    .in('product_id', lowStock.map((product) => product.id))
    .gte('notified_at', cooldownSince)
  if (logsError) return jsonResponse({ error: logsError.message }, 500)

  const recentlyNotified = new Set(
    (recentLogs || []).map((log) => `${log.product_id}:${log.subscription_id}`),
  )

  let sent = 0
  let removed = 0
  for (const subscription of subscriptions || []) {
    for (const product of lowStock) {
      const notificationKey = `${product.id}:${subscription.id}`
      if (recentlyNotified.has(notificationKey)) continue
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
        const { error: logError } = await supabase.from('low_stock_notification_log').upsert({
          product_id: product.id,
          subscription_id: subscription.id,
          notified_at: new Date().toISOString(),
        }, { onConflict: 'product_id,subscription_id' })
        if (logError) {
          console.error('Notification log write failed:', logError)
          continue
        }
        recentlyNotified.add(notificationKey)
        sent += 1
      } catch (error) {
        if (isExpiredPushError(error)) {
          await supabase.from('push_subscriptions').delete().eq('id', subscription.id)
          removed += 1
          break
        } else {
          console.error('Push delivery failed:', error)
        }
      }
    }
  }

  return jsonResponse({ sent, removed })
})
