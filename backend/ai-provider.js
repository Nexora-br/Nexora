let puter = null
try {
  const puterModule = require('@heyputer/puter.js')
  puter = puterModule?.puter || null
} catch (error) {
  console.warn('[ai-provider] Puter.js indisponível; usando fallback local para manter o backend estável em nuvem.')
}

function buildLocalReadOnlyProvider() {
  return {
    name: 'local-readonly',
    async generate({ context, userMessage, systemPrompt }) {
      const summary = context?.summary || {}
      const text = String(userMessage || '').toLowerCase()
      const answer = (() => {
        if (context?.type === 'accounts_receivable_summary') {
          const total = Number(context.total || 0)
          return total > 0 ? `Você tem R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a receber.` : 'Não há valores a receber no período informado.'
        }
        if (context?.type === 'accounts_payable_summary') {
          const total = Number(context.total || 0)
          return total > 0 ? `Você tem R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a pagar.` : 'Não há valores a pagar no período informado.'
        }
        if (context?.type === 'stock_summary') {
          const lowStock = Number(summary.lowStockCount || 0)
          return lowStock > 0 ? `Seu estoque tem ${lowStock} item(ns) com baixa disponibilidade.` : 'Seu estoque está estável no momento.'
        }
        if (context?.type === 'pending_purchases_summary') {
          const pending = Number(summary.pendingCount || 0)
          return pending > 0 ? `Há ${pending} compra(s) pendente(s).` : 'Não há compras pendentes.'
        }
        if (context?.type === 'equipment_maintenance_summary') {
          const maintenance = Number(summary.inMaintenanceCount || 0)
          return maintenance > 0 ? `Há ${maintenance} equipamento(s) em manutenção.` : 'Não há equipamentos em manutenção.'
        }
        if (context?.type === 'open_maintenance_summary') {
          const count = Number(summary.openCount || 0)
          return count > 0 ? `Há ${count} manutenção(ões) aberta(s).` : 'Não há manutenções abertas.'
        }
        if (context?.type === 'agenda_summary') {
          const count = Number(summary.agendaCount || 0)
          return count > 0 ? `Há ${count} compromisso(s) agendado(s).` : 'Não há compromissos agendados.'
        }
        if (context?.type === 'document_summary') {
          const count = Number(summary.documentCount || 0)
          return count > 0 ? `Você possui ${count} documento(s) cadastrados.` : 'Não há documentos cadastrados.'
        }
        if (summary.projectCount > 0) {
          return `A empresa possui ${summary.projectCount} projeto(s) em andamento.`
        }
        if (text.includes('estoque')) return 'Seu estoque está estável no momento.'
        if (text.includes('pagar') || text.includes('pagamento')) return 'Não há valores a pagar no período informado.'
        if (text.includes('receber') || text.includes('receita')) return 'Não há valores a receber no período informado.'
        return 'Não há dados disponíveis para responder esta pergunta com segurança.'
      })()

      return {
        answer,
        provider: 'local-readonly',
        context,
        userMessage,
        systemPrompt,
      }
    },
  }
}

async function callPuter({ systemPrompt, userMessage, context }) {
  if (!puter || !puter.ai || typeof puter.ai.chat !== 'function') {
    throw new Error('Puter.js não está disponível neste ambiente.')
  }

  const response = await puter.ai.chat(
    `${systemPrompt}\n\nContexto:\n${JSON.stringify({ question: userMessage, context }, null, 2)}`,
    { model: 'openai/gpt-5.5', temperature: 0.1, max_tokens: 300, stream: false }
  )

  const answer = response?.message?.content ?? response?.content ?? response?.text ?? response
  if (!answer || !String(answer).trim()) {
    throw new Error('Puter provider returned an empty answer.')
  }

  return {
    answer: String(answer).trim(),
    provider: 'puter',
    context,
    userMessage,
    systemPrompt,
  }
}

async function callOpenAi({ apiKey, systemPrompt, userMessage, context }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({
          question: userMessage,
          context,
        }, null, 2) },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI provider error: ${response.status} ${errorText}`)
  }

  const payload = await response.json()
  const answer = payload?.choices?.[0]?.message?.content
  if (!answer || !String(answer).trim()) {
    throw new Error('OpenAI provider returned an empty answer.')
  }

  return { answer: String(answer).trim(), provider: 'openai', context, userMessage, systemPrompt }
}

function createAiProvider() {
  const providerName = (process.env.AI_PROVIDER || 'local').toLowerCase()

  if (providerName === 'local' || providerName === 'mock' || providerName === 'none' || providerName === 'test') {
    return buildLocalReadOnlyProvider()
  }

  if (providerName === 'broken') {
    throw new Error('Provider AI indisponível.')
  }

  if (providerName === 'puter') {
    if (!puter || !puter.ai || typeof puter.ai.chat !== 'function') {
      console.warn('[ai-provider] Provider Puter indisponível; usando fallback local.')
      return buildLocalReadOnlyProvider()
    }

    return {
      name: 'puter',
      async generate({ context, userMessage, systemPrompt }) {
        return callPuter({ context, userMessage, systemPrompt })
      },
    }
  }

  if (providerName === 'openai') {
    if (!process.env.AI_API_KEY) {
      throw new Error('AI_API_KEY não configurada.')
    }

    return {
      name: 'openai',
      async generate({ context, userMessage, systemPrompt }) {
        return callOpenAi({ apiKey: process.env.AI_API_KEY, context, userMessage, systemPrompt })
      },
    }
  }

  if (!process.env.AI_API_KEY) {
    throw new Error('AI_API_KEY não configurada.')
  }

  return {
    name: providerName,
    async generate() {
      throw new Error(`Provider ${providerName} não implementado nesta fase.`)
    },
  }
}

module.exports = { createAiProvider }
