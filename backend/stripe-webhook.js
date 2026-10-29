const crypto = require('crypto')

function createStripeWebhookHandler({ stripe, webhookSecret, db }) {
  return async (request, response) => {
    if (!stripe || !webhookSecret) return response.status(503).json({ error: 'Webhook da Stripe não configurado.' })

    let event
    try {
      event = stripe.webhooks.constructEvent(request.body, request.headers['stripe-signature'], webhookSecret)
    } catch (error) {
      console.warn('Stripe webhook signature rejected:', error.message)
      return response.status(400).json({ error: 'Assinatura do webhook inválida.' })
    }

    async function localSubscription(stripeSubscriptionId, metadata = {}) {
      const localId = metadata.nexora_subscription_id
      if (localId) {
        const row = await db.get('SELECT id, company_id FROM subscriptions WHERE id = ?', [localId])
        if (row) return row
      }
      if (stripeSubscriptionId) return db.get('SELECT id, company_id FROM subscriptions WHERE stripe_subscription_id = ?', [stripeSubscriptionId])
      return null
    }

    async function syncSubscription(subscription) {
      const stripeSubscriptionId = subscription.id
      const local = await localSubscription(stripeSubscriptionId, subscription.metadata || {})
      if (!local) return null
      const states = { active: 'ATIVA', trialing: 'ATIVA', canceled: 'CANCELADA', incomplete_expired: 'EXPIRADA' }
      const status = states[subscription.status] || 'PENDENTE'
      const periodEnd = subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || null
      await db.run(`UPDATE subscriptions SET status = ?, stripe_customer_id = ?, stripe_subscription_id = ?, subscribed_at = COALESCE(subscribed_at, ?), next_charge_at = ?, cancelled_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
        status,
        customerId,
        stripeSubscriptionId,
        status === 'ATIVA' ? new Date((subscription.start_date || subscription.created) * 1000).toISOString() : null,
        status === 'ATIVA' && periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        status === 'CANCELADA' && subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
        local.id,
      ])
      return local
    }

    async function syncCheckoutSession(session) {
      if (session.payment_status === 'unpaid') return
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      if (!subscriptionId) return
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      await syncSubscription(subscription)
    }

    async function syncInvoice(invoice, status) {
      const subscriptionId = invoice.parent?.subscription_details?.subscription || invoice.subscription
      const stripeSubscriptionId = typeof subscriptionId === 'string' ? subscriptionId : subscriptionId?.id
      if (!stripeSubscriptionId) return
      const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
      const local = await localSubscription(stripeSubscriptionId, subscription.metadata || {})
      if (!local) return
      if (status === 'APROVADO') {
        await syncSubscription(subscription)
      } else {
        await db.run("UPDATE subscriptions SET status = 'PENDENTE', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [local.id])
      }

      const amount = Number(status === 'APROVADO' ? invoice.amount_paid : invoice.amount_due) / 100
      await db.run('INSERT INTO subscription_payments (id, subscription_id, company_id, amount, method, status, event_type, stripe_event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', [
        crypto.randomUUID(), local.id, local.company_id, amount, 'STRIPE', status, status === 'APROVADO' ? 'PAGAMENTO' : 'PAGAMENTO_FALHOU', event.id,
      ])
    }

    try {
      const object = event.data.object
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          await syncCheckoutSession(object)
          break
        case 'checkout.session.async_payment_failed': {
          const local = object.metadata?.nexora_subscription_id
            ? await localSubscription(null, object.metadata)
            : null
          if (local) await db.run("UPDATE subscriptions SET status = 'PENDENTE', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [local.id])
          break
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await syncSubscription(object)
          break
        case 'invoice.paid':
          await syncInvoice(object, 'APROVADO')
          break
        case 'invoice.payment_failed':
          await syncInvoice(object, 'RECUSADO')
          break
        default:
          break
      }
      response.json({ received: true })
    } catch (error) {
      console.error('Stripe webhook processing failed:', error)
      response.status(500).json({ error: 'Não foi possível processar o webhook.' })
    }
  }
}

module.exports = { createStripeWebhookHandler }
