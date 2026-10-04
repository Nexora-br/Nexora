const express = require('express')

const financeRoles = ['ADMINISTRADOR', 'DIRETOR', 'GERENTE', 'SUPERVISOR', 'FINANCEIRO']
const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

function createFinanceRoutes({ db, auth, requireRole, audit, id }) {
  const router = express.Router()
  const finance = [auth, requireRole(...financeRoles)]

  router.get('/api/finance/settlements', ...finance, async (request, response) => {
    try {
      const where = ['s.company_id = ?']
      const params = [request.user.company_id]
      if (request.query.from) { if (!validDate(request.query.from)) return response.status(400).json({ error: 'Data inicial inválida.' }); where.push('s.settlement_date >= ?'); params.push(request.query.from) }
      if (request.query.to) { if (!validDate(request.query.to)) return response.status(400).json({ error: 'Data final inválida.' }); where.push('s.settlement_date <= ?'); params.push(request.query.to) }
      if (request.query.account_type && ['PAGAR', 'RECEBER'].includes(request.query.account_type)) { where.push('s.account_type = ?'); params.push(request.query.account_type) }
      const rows = await db.all(`SELECT s.*, COALESCE((SELECT a.description FROM accounts_payable a WHERE s.account_type = 'PAGAR' AND a.id = s.account_id AND a.company_id = s.company_id), (SELECT a.description FROM accounts_receivable a WHERE s.account_type = 'RECEBER' AND a.id = s.account_id AND a.company_id = s.company_id)) AS account_description FROM account_settlements s WHERE ${where.join(' AND ')} ORDER BY s.settlement_date DESC, s.created_at DESC LIMIT 1000`, params)
      response.json(rows)
    } catch (error) { console.error('Finance settlements:', error); response.status(500).json({ error: 'Não foi possível consultar as baixas.' }) }
  })

  router.post('/api/finance/settlements', ...finance, async (request, response) => {
    try {
      const { account_type: accountType, account_id: accountId } = request.body || {}
      const amount = roundMoney(request.body?.amount)
      const settlementDate = request.body?.settlement_date || new Date().toISOString().slice(0, 10)
      if (!['PAGAR', 'RECEBER'].includes(accountType) || !accountId) return response.status(400).json({ error: 'Selecione uma conta válida para baixar.' })
      if (!Number.isFinite(amount) || amount <= 0) return response.status(400).json({ error: 'Informe um valor de baixa maior que zero.' })
      if (!validDate(settlementDate)) return response.status(400).json({ error: 'Data de baixa inválida.' })
      const table = accountType === 'PAGAR' ? 'accounts_payable' : 'accounts_receivable'
      const account = await db.get(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`, [accountId, request.user.company_id])
      if (!account) return response.status(404).json({ error: 'Lançamento financeiro não encontrado.' })
      const previous = await db.get('SELECT COALESCE(SUM(amount), 0) AS settled FROM account_settlements WHERE company_id = ? AND account_type = ? AND account_id = ?', [request.user.company_id, accountType, accountId])
      const remaining = roundMoney(Number(account.amount) - Number(previous?.settled || 0))
      if (amount > remaining + 0.01) return response.status(400).json({ error: `O valor excede o saldo em aberto de R$ ${remaining.toFixed(2)}.` })
      const settlementId = id()
      const transactionId = id()
      const flowType = accountType === 'PAGAR' ? 'SAIDA' : 'ENTRADA'
      const transactionDate = settlementDate
      await db.transaction(async () => {
        await db.run('INSERT INTO financial_transactions (id, company_id, project_id, user_id, description, category, cost_center, amount, type, status, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [transactionId, request.user.company_id, account.project_id || null, request.user.id, `${accountType === 'PAGAR' ? 'Pagamento' : 'Recebimento'}: ${account.description}`, account.category || (accountType === 'PAGAR' ? 'CONTAS_A_PAGAR' : 'CONTAS_A_RECEBER'), account.cost_center || null, amount, flowType, 'CONFIRMADA', transactionDate])
        await db.run('INSERT INTO account_settlements (id, company_id, account_type, account_id, amount, settlement_date, payment_method, bank_account, reference, notes, transaction_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [settlementId, request.user.company_id, accountType, accountId, amount, settlementDate, request.body.payment_method || null, request.body.bank_account || null, request.body.reference || null, request.body.notes || null, transactionId, request.user.id])
        const settledTotal = roundMoney(Number(previous?.settled || 0) + amount)
        const status = settledTotal >= Number(account.amount) - 0.01 ? (accountType === 'PAGAR' ? 'PAGA' : 'RECEBIDA') : 'PARCIAL'
        await db.run(`UPDATE ${table} SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`, [status, accountId, request.user.company_id])
      })
      const settlement = await db.get('SELECT * FROM account_settlements WHERE id = ? AND company_id = ?', [settlementId, request.user.company_id])
      await audit(request.user, accountType === 'PAGAR' ? 'BAIXAR_PAGAMENTO' : 'BAIXAR_RECEBIMENTO', 'FINANCEIRO', settlementId, null, settlement)
      response.status(201).json(settlement)
    } catch (error) { console.error('Finance settlement:', error); response.status(500).json({ error: 'Não foi possível registrar a baixa.' }) }
  })

  router.get('/api/finance/statements', ...finance, async (request, response) => {
    try { response.json(await db.all('SELECT s.*, (SELECT COUNT(*) FROM bank_statement_entries e WHERE e.statement_id = s.id AND e.company_id = s.company_id) AS entry_count, (SELECT COUNT(*) FROM bank_statement_entries e WHERE e.statement_id = s.id AND e.company_id = s.company_id AND e.transaction_id IS NOT NULL) AS matched_count FROM bank_statements s WHERE s.company_id = ? ORDER BY s.period_end DESC, s.created_at DESC LIMIT 300', [request.user.company_id])) }
    catch (error) { console.error('Finance statements:', error); response.status(500).json({ error: 'Não foi possível consultar os extratos.' }) }
  })

  router.post('/api/finance/statements', ...finance, async (request, response) => {
    try {
      const body = request.body || {}
      const entries = Array.isArray(body.entries) ? body.entries : []
      if (!String(body.bank_account || '').trim()) return response.status(400).json({ error: 'Informe a conta bancária.' })
      if (!validDate(body.period_start) || !validDate(body.period_end) || body.period_start > body.period_end) return response.status(400).json({ error: 'Informe um período válido para o extrato.' })
      if (!Number.isFinite(Number(body.opening_balance)) || !Number.isFinite(Number(body.closing_balance))) return response.status(400).json({ error: 'Informe os saldos inicial e final do extrato.' })
      if (entries.length > 10000) return response.status(413).json({ error: 'O extrato excede o limite de 10.000 movimentações.' })
      for (const entry of entries) if (!validDate(entry.date) || entry.date < body.period_start || entry.date > body.period_end || !String(entry.description || '').trim() || !Number.isFinite(Number(entry.amount)) || Number(entry.amount) === 0) return response.status(400).json({ error: 'O extrato contém uma movimentação inválida.' })
      const statementId = id()
      let imported = 0
      let duplicates = 0
      await db.transaction(async () => {
        await db.run('INSERT INTO bank_statements (id, company_id, bank_account, source, period_start, period_end, opening_balance, closing_balance, imported_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [statementId, request.user.company_id, String(body.bank_account).trim(), body.source === 'OFX' ? 'OFX' : 'MANUAL', body.period_start, body.period_end, roundMoney(body.opening_balance), roundMoney(body.closing_balance), request.user.id])
        for (const entry of entries) {
          const externalId = String(entry.external_id || '').trim() || null
          if (externalId) {
            const duplicate = await db.get('SELECT e.id FROM bank_statement_entries e JOIN bank_statements s ON s.id = e.statement_id AND s.company_id = e.company_id WHERE e.company_id = ? AND e.external_id = ? AND s.bank_account = ?', [request.user.company_id, externalId, String(body.bank_account).trim()])
            if (duplicate) { duplicates += 1; continue }
          }
          await db.run('INSERT INTO bank_statement_entries (id, company_id, statement_id, external_id, entry_date, description, amount) VALUES (?, ?, ?, ?, ?, ?, ?)', [id(), request.user.company_id, statementId, externalId, entry.date, String(entry.description).trim().slice(0, 500), roundMoney(entry.amount)])
          imported += 1
        }
      })
      const created = await db.get('SELECT * FROM bank_statements WHERE id = ? AND company_id = ?', [statementId, request.user.company_id])
      await audit(request.user, 'IMPORTAR_EXTRATO', 'FINANCEIRO', statementId, null, { ...created, imported, duplicates })
      response.status(201).json({ ...created, imported, duplicates })
    } catch (error) { console.error('Finance statement import:', error); response.status(500).json({ error: 'Não foi possível importar o extrato.' }) }
  })

  router.get('/api/finance/statements/:statementId', ...finance, async (request, response) => {
    try {
      const statement = await db.get('SELECT * FROM bank_statements WHERE id = ? AND company_id = ?', [request.params.statementId, request.user.company_id])
      if (!statement) return response.status(404).json({ error: 'Extrato não encontrado.' })
      const entries = await db.all('SELECT e.*, t.description AS matched_description, t.amount AS matched_amount, t.type AS matched_type FROM bank_statement_entries e LEFT JOIN financial_transactions t ON t.id = e.transaction_id AND t.company_id = e.company_id WHERE e.statement_id = ? AND e.company_id = ? ORDER BY e.entry_date, e.created_at', [statement.id, request.user.company_id])
      response.json({ ...statement, entries })
    } catch (error) { console.error('Finance statement detail:', error); response.status(500).json({ error: 'Não foi possível abrir o extrato.' }) }
  })

  router.post('/api/finance/statements/:statementId/entries', ...finance, async (request, response) => {
    try {
      const statement = await db.get("SELECT * FROM bank_statements WHERE id = ? AND company_id = ? AND status = 'ABERTA'", [request.params.statementId, request.user.company_id])
      if (!statement) return response.status(404).json({ error: 'Extrato aberto não encontrado.' })
      const { date, description } = request.body || {}
      const amount = roundMoney(request.body?.amount)
      if (!validDate(date) || date < statement.period_start || date > statement.period_end || !String(description || '').trim() || !Number.isFinite(amount) || amount === 0) return response.status(400).json({ error: 'Preencha data, descrição e valor válido dentro do período do extrato.' })
      const entryId = id()
      await db.run('INSERT INTO bank_statement_entries (id, company_id, statement_id, entry_date, description, amount) VALUES (?, ?, ?, ?, ?, ?)', [entryId, request.user.company_id, statement.id, date, String(description).trim().slice(0, 500), amount])
      await audit(request.user, 'ADICIONAR_MOVIMENTO_EXTRATO', 'FINANCEIRO', entryId, null, { statement_id: statement.id, date, description, amount })
      response.status(201).json(await db.get('SELECT * FROM bank_statement_entries WHERE id = ? AND company_id = ?', [entryId, request.user.company_id]))
    } catch (error) { console.error('Finance manual entry:', error); response.status(500).json({ error: 'Não foi possível incluir a movimentação.' }) }
  })

  router.get('/api/finance/statements/:statementId/candidates/:entryId', ...finance, async (request, response) => {
    try {
      const entry = await db.get('SELECT * FROM bank_statement_entries WHERE id = ? AND statement_id = ? AND company_id = ?', [request.params.entryId, request.params.statementId, request.user.company_id])
      if (!entry) return response.status(404).json({ error: 'Movimentação do extrato não encontrada.' })
      const type = Number(entry.amount) < 0 ? 'SAIDA' : 'ENTRADA'
      const amount = Math.abs(Number(entry.amount))
      const date = new Date(`${entry.entry_date}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() - 7)
      const from = date.toISOString().slice(0, 10)
      date.setUTCDate(date.getUTCDate() + 14)
      const to = date.toISOString().slice(0, 10)
      const rows = await db.all("SELECT t.* FROM financial_transactions t WHERE t.company_id = ? AND t.type = ? AND ABS(t.amount - ?) <= 0.01 AND t.transaction_date >= ? AND t.transaction_date <= ? AND NOT EXISTS (SELECT 1 FROM bank_statement_entries e WHERE e.company_id = t.company_id AND e.transaction_id = t.id) ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT 30", [request.user.company_id, type, amount, from, to])
      response.json(rows)
    } catch (error) { console.error('Finance candidates:', error); response.status(500).json({ error: 'Não foi possível sugerir correspondências.' }) }
  })

  router.post('/api/finance/statements/:statementId/entries/:entryId/reconcile', ...finance, async (request, response) => {
    try {
      const statement = await db.get("SELECT * FROM bank_statements WHERE id = ? AND company_id = ? AND status = 'ABERTA'", [request.params.statementId, request.user.company_id])
      const entry = await db.get('SELECT * FROM bank_statement_entries WHERE id = ? AND statement_id = ? AND company_id = ?', [request.params.entryId, request.params.statementId, request.user.company_id])
      if (!statement || !entry) return response.status(404).json({ error: 'Extrato ou movimentação aberta não encontrada.' })
      if (entry.transaction_id) return response.status(409).json({ error: 'Esta movimentação já está conciliada.' })
      let transactionId = request.body?.transaction_id
      let transaction
      await db.transaction(async () => {
        if (request.body?.create_transaction === true) {
          transactionId = id()
          const type = Number(entry.amount) < 0 ? 'SAIDA' : 'ENTRADA'
          await db.run('INSERT INTO financial_transactions (id, company_id, user_id, description, category, amount, type, status, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [transactionId, request.user.company_id, request.user.id, entry.description, 'CONCILIACAO_MANUAL', Math.abs(Number(entry.amount)), type, 'CONFIRMADA', entry.entry_date])
        }
        transaction = await db.get('SELECT * FROM financial_transactions WHERE id = ? AND company_id = ?', [transactionId, request.user.company_id])
        if (!transaction) throw Object.assign(new Error('Selecione um lançamento financeiro válido.'), { statusCode: 400 })
        const correctType = Number(entry.amount) < 0 ? 'SAIDA' : 'ENTRADA'
        if (transaction.type !== correctType || Math.abs(Number(transaction.amount) - Math.abs(Number(entry.amount))) > 0.01) throw Object.assign(new Error('O valor e o tipo do lançamento precisam corresponder ao extrato.'), { statusCode: 400 })
        const linked = await db.get('SELECT id FROM bank_statement_entries WHERE company_id = ? AND transaction_id = ?', [request.user.company_id, transaction.id])
        if (linked) throw Object.assign(new Error('Este lançamento já foi conciliado com outro movimento.'), { statusCode: 409 })
        await db.run('UPDATE bank_statement_entries SET transaction_id = ?, reconciled_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [transaction.id, entry.id, request.user.company_id])
      })
      await audit(request.user, 'CONCILIAR_MOVIMENTO', 'FINANCEIRO', entry.id, entry, { ...entry, transaction_id: transaction.id })
      response.json({ ok: true, entry_id: entry.id, transaction_id: transaction.id })
    } catch (error) { response.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Não foi possível conciliar a movimentação.' }) }
  })

  router.post('/api/finance/statements/:statementId/close', ...finance, async (request, response) => {
    try {
      const statement = await db.get("SELECT * FROM bank_statements WHERE id = ? AND company_id = ? AND status = 'ABERTA'", [request.params.statementId, request.user.company_id])
      if (!statement) return response.status(404).json({ error: 'Extrato aberto não encontrado.' })
      const summary = await db.get('SELECT COUNT(*) AS total, SUM(CASE WHEN transaction_id IS NOT NULL THEN 1 ELSE 0 END) AS matched, COALESCE(SUM(amount), 0) AS movement_total FROM bank_statement_entries WHERE statement_id = ? AND company_id = ?', [statement.id, request.user.company_id])
      const calculatedBalance = roundMoney(Number(statement.opening_balance) + Number(summary.movement_total || 0))
      const difference = roundMoney(Number(statement.closing_balance) - calculatedBalance)
      if (Number(summary.total || 0) === 0) return response.status(400).json({ error: 'Adicione movimentações antes de fechar o extrato.' })
      if (Number(summary.matched || 0) !== Number(summary.total)) return response.status(409).json({ error: 'Ainda existem movimentações sem conciliar.' })
      if (Math.abs(difference) > 0.01) return response.status(409).json({ error: `O saldo do extrato diverge em R$ ${difference.toFixed(2)}. Confira as movimentações.` })
      await db.run("UPDATE bank_statements SET status = 'CONCILIADA', reconciled_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND status = 'ABERTA'", [statement.id, request.user.company_id])
      await audit(request.user, 'FECHAR_CONCILIACAO', 'FINANCEIRO', statement.id, statement, { ...statement, status: 'CONCILIADA', difference })
      response.json({ ok: true, status: 'CONCILIADA', difference })
    } catch (error) { console.error('Finance close statement:', error); response.status(500).json({ error: 'Não foi possível encerrar a conciliação.' }) }
  })

  router.get('/api/finance/reports/reconciled', ...finance, async (request, response) => {
    try {
      const { from, to } = request.query
      if (!validDate(from) || !validDate(to) || from > to) return response.status(400).json({ error: 'Informe um período válido para o relatório.' })
      const entries = await db.all("SELECT e.*, s.bank_account, s.period_start, s.period_end, t.description AS transaction_description, t.category, t.type FROM bank_statement_entries e JOIN bank_statements s ON s.id = e.statement_id AND s.company_id = e.company_id JOIN financial_transactions t ON t.id = e.transaction_id AND t.company_id = e.company_id WHERE e.company_id = ? AND s.status = 'CONCILIADA' AND e.entry_date >= ? AND e.entry_date <= ? ORDER BY e.entry_date, e.created_at", [request.user.company_id, from, to])
      const statementIds = [...new Set(entries.map((entry) => entry.statement_id))]
      const statements = statementIds.length
        ? await db.all(`SELECT * FROM bank_statements WHERE company_id = ? AND id IN (${statementIds.map(() => '?').join(',')}) ORDER BY period_start, bank_account`, [request.user.company_id, ...statementIds])
        : []
      const totals = entries.reduce((sum, entry) => { if (Number(entry.amount) >= 0) sum.income += Number(entry.amount); else sum.expense += Math.abs(Number(entry.amount)); return sum }, { income: 0, expense: 0 })
      response.json({ from, to, statements, entries, totals: { income: roundMoney(totals.income), expense: roundMoney(totals.expense), net: roundMoney(totals.income - totals.expense) } })
    } catch (error) { console.error('Finance reconciled report:', error); response.status(500).json({ error: 'Não foi possível gerar o relatório conciliado.' }) }
  })

  return router
}

module.exports = createFinanceRoutes
