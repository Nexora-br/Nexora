const PLAN = 'NEXORA_PRO'
const MONTHLY_AMOUNT = 500
const PAYMENT_METHODS = new Set(['CARTAO', 'PIX', 'BOLETO'])
const PAYMENT_METHOD_LABELS = { CARTAO: 'Cartão', PIX: 'PIX', BOLETO: 'Boleto' }

function addOneMonth(value) {
  const date = new Date(value)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + 1)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.toISOString()
}

function createSubscriptionRoutes({ express, db, auth, requirePermission, requireRole, audit, id, enabled, stripe, stripePriceId, frontendOrigin }) {
  const router = express.Router()
  const requireSimulator = (_request, response, next) => enabled()
    ? next()
    : response.status(404).json({ error: 'O simulador de assinaturas está desativado neste ambiente.' })
  const requireBilling = (_request, response, next) => enabled() || stripe
    ? next()
    : response.status(404).json({ error: 'A cobrança de assinaturas não está configurada.' })

  async function currentSubscription(companyId) {
    const subscription = await db.get('SELECT id, company_id, plan, status, amount, payment_method, subscribed_at, next_charge_at, cancelled_at, created_at, updated_at FROM subscriptions WHERE company_id = ?', [companyId])
    if (!subscription) return null
    const hasPayment = await db.get('SELECT id FROM subscription_payments WHERE company_id = ? AND subscription_id = ? LIMIT 1', [companyId, subscription.id])
    // Ignore legacy rows that were created automatically at company registration without a real payment.
    return hasPayment || subscription.amount !== null || subscription.subscribed_at ? subscription : null
  }

  async function ensureSubscription(companyId, fields = {}) {
    const existing = await db.get('SELECT id, status, amount, payment_method, subscribed_at, next_charge_at, cancelled_at FROM subscriptions WHERE company_id = ?', [companyId])
    const subscriptionId = existing?.id || id()
    const choose = (key, fallback) => Object.hasOwn(fields, key) ? fields[key] : fallback
    const values = {
      plan: PLAN,
      status: choose('status', existing?.status ?? 'PENDENTE'),
      amount: choose('amount', existing?.amount ?? MONTHLY_AMOUNT),
      payment_method: choose('method', existing?.payment_method ?? 'PIX'),
      subscribed_at: choose('subscribedAt', existing?.subscribed_at ?? null),
      next_charge_at: choose('nextChargeAt', existing?.next_charge_at ?? null),
      cancelled_at: choose('cancelledAt', existing?.cancelled_at ?? null),
    }
    if (existing) {
      await db.run('UPDATE subscriptions SET plan = ?, status = ?, amount = ?, payment_method = ?, subscribed_at = ?, next_charge_at = ?, cancelled_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [values.plan, values.status, values.amount, values.payment_method, values.subscribed_at, values.next_charge_at, values.cancelled_at, subscriptionId, companyId])
    } else {
      await db.run('INSERT INTO subscriptions (id, company_id, plan, status, amount, payment_method, subscribed_at, next_charge_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [subscriptionId, companyId, values.plan, values.status, values.amount, values.payment_method, values.subscribed_at, values.next_charge_at, values.cancelled_at])
    }
    return { id: subscriptionId, company_id: companyId, ...values }
  }

  async function recordEvent(subscription, method, status, eventType = 'PAGAMENTO', amount = MONTHLY_AMOUNT) {
    const payment = { id: id(), subscription_id: subscription.id, company_id: subscription.company_id, amount, method, status, event_type: eventType }
    await db.run('INSERT INTO subscription_payments (id, subscription_id, company_id, amount, method, status, event_type) VALUES (?, ?, ?, ?, ?, ?, ?)', [payment.id, payment.subscription_id, payment.company_id, payment.amount, payment.method, payment.status, payment.event_type])
    return payment
  }

  async function responseData(companyId) {
    const subscription = await currentSubscription(companyId)
    const payments = subscription
      ? await db.all('SELECT id, subscription_id, company_id, amount, method, status, event_type, created_at FROM subscription_payments WHERE company_id = ? AND subscription_id = ? ORDER BY created_at DESC LIMIT 50', [companyId, subscription.id])
      : []
    return { subscription, payments, plan: { id: PLAN, name: 'Nexora Pro', amount: MONTHLY_AMOUNT, currency: 'BRL', interval: 'month' } }
  }

  router.get('/api/subscription', auth, requireBilling, async (request, response) => {
    try { response.json(await responseData(request.user.company_id)) } catch (error) { console.error(error); response.status(500).json({ error: 'Não foi possível carregar a assinatura.' }) }
  })

  router.post('/api/subscription/stripe-checkout', auth, requireRole('ADMINISTRADOR'), async (request, response) => {
    try {
      if (!stripe) return response.status(503).json({ error: 'Configure STRIPE_SECRET_KEY no servidor para ativar o Checkout.' })
      if (!stripePriceId || stripePriceId === 'price_...') return response.status(503).json({ error: 'Configure STRIPE_PRICE_ID com o preço mensal do Nexora Pro.' })
      const price = await stripe.prices.retrieve(stripePriceId)
      if (!price.active || price.currency !== 'brl' || price.unit_amount !== MONTHLY_AMOUNT * 100 || price.recurring?.interval !== 'month') {
        return response.status(400).json({ error: 'O Price ID precisa estar ativo e corresponder ao Nexora Pro mensal de R$ 500,00.' })
      }
      const companyId = request.user.company_id
      const current = await currentSubscription(companyId)
      if (current?.status === 'ATIVA') return response.status(409).json({ error: 'Esta empresa já possui uma assinatura ativa.' })

      const existing = await db.get('SELECT id, stripe_customer_id, stripe_checkout_session_id FROM subscriptions WHERE company_id = ?', [companyId])
      const subscriptionId = existing?.id || id()
      if (existing?.stripe_checkout_session_id) {
        const previousSession = await stripe.checkout.sessions.retrieve(existing.stripe_checkout_session_id)
        if (previousSession.status === 'open' && previousSession.url) return response.json({ url: previousSession.url })
      }
      await ensureSubscription(companyId, { status: 'PENDENTE', amount: MONTHLY_AMOUNT, method: 'STRIPE', subscribedAt: null, nextChargeAt: null, cancelledAt: null })
      const baseUrl = `${String(frontendOrigin || 'http://localhost:5173').replace(/\/+$/, '')}/Nexora/`
      const session = await stripe.checkout.sessions.create({
        ui_mode: 'hosted_page',
        mode: 'subscription',
        billing_address_collection: 'auto',
        phone_number_collection: { enabled: true },
        automatic_tax: { enabled: false },
        allow_promotion_codes: false,
        payment_method_collection: 'always',
        submit_type: 'auto',
        name_collection: {
          individual: { enabled: true, optional: true },
          business: { enabled: true, optional: true },
        },
        integration_identifier: 'hosted_web_0001',
        origin_context: 'web',
        success_url: `${baseUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}?checkout=cancelled`,
        line_items: [{ price: stripePriceId, quantity: 1 }],
        ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : { customer_email: request.user.email }),
        client_reference_id: companyId,
        metadata: { company_id: companyId, nexora_subscription_id: subscriptionId },
        subscription_data: { metadata: { company_id: companyId, nexora_subscription_id: subscriptionId } },
      })
      await db.run('UPDATE subscriptions SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [session.id, subscriptionId, companyId])
      response.status(201).json({ url: session.url })
    } catch (error) {
      console.error('Stripe Checkout session creation failed:', error)
      response.status(502).json({ error: 'Não foi possível iniciar o Checkout da Stripe.' })
    }
  })

  router.post('/api/subscription/checkout', auth, requireRole('ADMINISTRADOR'), requireSimulator, async (request, response) => {
    try {
      const method = String(request.body?.method || '').toUpperCase()
      if (!PAYMENT_METHODS.has(method)) return response.status(400).json({ error: 'Escolha cartão, PIX ou boleto para a simulação.' })
      const companyId = request.user.company_id
      const current = await currentSubscription(companyId)
      if (current?.status === 'ATIVA') return response.status(409).json({ error: 'Esta empresa já possui uma assinatura ativa.' })
      const now = new Date().toISOString()
      let subscription
      await db.transaction(async () => {
        subscription = await ensureSubscription(companyId, { status: 'ATIVA', amount: MONTHLY_AMOUNT, method, subscribedAt: now, nextChargeAt: addOneMonth(now), cancelledAt: null })
        await recordEvent(subscription, method, 'APROVADO')
      })
      await audit(request.user, 'ASSINATURA_SIMULADA', 'ASSINATURAS', subscription.id, current, { status: 'ATIVA', amount: MONTHLY_AMOUNT, method })
      response.status(201).json(await responseData(companyId))
    } catch (error) { console.error(error); response.status(500).json({ error: 'Não foi possível concluir a simulação de pagamento.' }) }
  })

  router.post('/api/subscription/admin-action', auth, requireRole('ADMINISTRADOR'), requireSimulator, async (request, response) => {
    try {
      const action = String(request.body?.action || '').toUpperCase()
      const method = String(request.body?.method || '').toUpperCase()
      const validActions = new Set(['CRIAR_COBRANCA', 'APROVAR_PAGAMENTO', 'RECUSAR_PAGAMENTO', 'CANCELAR', 'EXPIRAR', 'RENOVAR'])
      if (!validActions.has(action)) return response.status(400).json({ error: 'Escolha uma ação de simulação válida.' })
      if (method && !PAYMENT_METHODS.has(method)) return response.status(400).json({ error: 'Método de pagamento inválido.' })
      const companyId = request.user.company_id
      const before = await currentSubscription(companyId)
      const now = new Date().toISOString()
      let subscription = before
      let event = null
      await db.transaction(async () => {
        if (action === 'CRIAR_COBRANCA') {
          const chosenMethod = method || before?.payment_method || 'PIX'
          subscription = await ensureSubscription(companyId, { status: before?.status === 'ATIVA' ? 'ATIVA' : 'PENDENTE', amount: MONTHLY_AMOUNT, method: chosenMethod })
          event = await recordEvent(subscription, chosenMethod, 'PENDENTE')
        } else if (action === 'APROVAR_PAGAMENTO' || action === 'RECUSAR_PAGAMENTO') {
          const pending = await db.get("SELECT id, method, amount FROM subscription_payments WHERE company_id = ? AND status = 'PENDENTE' ORDER BY created_at DESC LIMIT 1", [companyId])
          const chosenMethod = pending?.method || method || before?.payment_method || 'PIX'
          if (action === 'APROVAR_PAGAMENTO' && !pending) throw Object.assign(new Error('Não existe uma cobrança pendente para aprovar.'), { status: 409 })
          if (action === 'RECUSAR_PAGAMENTO' && pending) {
            await db.run("UPDATE subscription_payments SET status = 'RECUSADO' WHERE id = ? AND company_id = ?", [pending.id, companyId])
            event = { id: pending.id, status: 'RECUSADO', amount: pending.amount, method: chosenMethod }
          } else if (action === 'RECUSAR_PAGAMENTO') event = await recordEvent(subscription || await ensureSubscription(companyId, { status: 'PENDENTE' }), chosenMethod, 'RECUSADO')
          if (action === 'APROVAR_PAGAMENTO') {
            await db.run("UPDATE subscription_payments SET status = 'APROVADO' WHERE id = ? AND company_id = ?", [pending.id, companyId])
            event = { id: pending.id, status: 'APROVADO', amount: pending.amount, method: chosenMethod }
          }
          if (action === 'APROVAR_PAGAMENTO') {
            const subscribedAt = before?.subscribed_at || now
            subscription = await ensureSubscription(companyId, { status: 'ATIVA', amount: event.amount || MONTHLY_AMOUNT, method: chosenMethod, subscribedAt, nextChargeAt: addOneMonth(before?.next_charge_at && new Date(before.next_charge_at) > new Date(now) ? before.next_charge_at : now), cancelledAt: null })
          }
        } else if (action === 'CANCELAR' || action === 'EXPIRAR') {
          if (!before) throw Object.assign(new Error('Esta empresa ainda não possui uma assinatura.'), { status: 404 })
          const status = action === 'CANCELAR' ? 'CANCELADA' : 'EXPIRADA'
          subscription = await ensureSubscription(companyId, { status, nextChargeAt: null, cancelledAt: action === 'CANCELAR' ? now : before.cancelled_at })
          event = await recordEvent(subscription, before.payment_method || 'PIX', 'REGISTRADO', action, Number(before.amount || MONTHLY_AMOUNT))
        } else if (action === 'RENOVAR') {
          const chosenMethod = method || before?.payment_method || 'PIX'
          const subscribedAt = before?.subscribed_at || now
          const nextChargeAt = addOneMonth(before?.next_charge_at && new Date(before.next_charge_at) > new Date(now) ? before.next_charge_at : now)
          subscription = await ensureSubscription(companyId, { status: 'ATIVA', amount: MONTHLY_AMOUNT, method: chosenMethod, subscribedAt, nextChargeAt, cancelledAt: null })
          event = await recordEvent(subscription, chosenMethod, 'APROVADO', 'RENOVACAO')
        }
      })
      await audit(request.user, `SIMULACAO_${action}`, 'ASSINATURAS', subscription?.id || event?.id, before, { action, status: subscription?.status, event })
      response.json(await responseData(companyId))
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.message })
      console.error(error)
      response.status(500).json({ error: 'Não foi possível atualizar a simulação da assinatura.' })
    }
  })

  return router
}

module.exports = { createSubscriptionRoutes, addOneMonth, PAYMENT_METHODS, PAYMENT_METHOD_LABELS }
