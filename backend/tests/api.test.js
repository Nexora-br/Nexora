const test = require('node:test')
process.env.NODE_ENV = 'test'
process.env.NEXORA_ENABLE_SIMULATED_BILLING = 'true'
const assert = require('node:assert/strict')
const request = require('supertest')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const database = require('../db')
const { app } = require('../server')
const { createAiProvider } = require('../ai-provider')

let cnpjSequence = Date.now() % 1000000000000
function nextValidCnpj() {
  const base = String(cnpjSequence++).padStart(12, '0')
  const digit = (value, weights) => { const sum = [...value].reduce((total, character, index) => total + Number(character) * weights[index], 0); const remainder = sum % 11; return remainder < 2 ? 0 : 11 - remainder }
  const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const second = digit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base}${first}${second}`
}

async function register(companyName) {
  const email = `${companyName.toLowerCase().replace(/[^a-z]/g, '')}-${Date.now()}@test.local`
  const response = await request(app).post('/api/auth/register').send({ companyName, legalName: companyName, cnpj: nextValidCnpj(), userName: 'Administrador', email, password: 'senha123-TESTE' })
  assert.equal(response.status, 201)
  return response.body
}

async function addRecipient(companyId) {
  const role = await database.get('SELECT id FROM roles WHERE name = ?', ['GESTOR'])
  const userId = crypto.randomUUID()
  await database.run('INSERT INTO users (id, company_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?)', [userId, companyId, 'Destinatário', `destinatario-${userId}@test.local`, await bcrypt.hash('senha123', 4)])
  await database.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id])
  return userId
}

test('bloqueia endpoints protegidos sem token', async () => {
  const response = await request(app).get('/api/projects')
  assert.equal(response.status, 401)
})

test('perfil CONSULTA visualiza, mas não cria, e bloqueia financeiro sem permissão', async () => {
  const admin = await register('Empresa Permissoes')
  const role = await database.get('SELECT id FROM roles WHERE name = ?', ['CONSULTA'])
  const userId = crypto.randomUUID()
  const email = `consulta-${Date.now()}@test.local`
  await database.run('INSERT INTO users (id, company_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?)', [userId, admin.company.id, 'Consulta', email, await bcrypt.hash('senha123', 4)])
  await database.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id])
  const login = await request(app).post('/api/auth/login').send({ email, password: 'senha123' })
  assert.equal(login.status, 200)
  const headers = { Authorization: `Bearer ${login.body.token}` }
  assert.equal((await request(app).get('/api/projects').set(headers)).status, 200)
  assert.equal((await request(app).post('/api/clients').set(headers).send({ legal_name: 'Não permitido' })).status, 403)
  assert.equal((await request(app).get('/api/accounts-payable').set(headers)).status, 200)
  const blockedRoleId = crypto.randomUUID()
  await database.run('INSERT INTO roles (id, name) VALUES (?, ?)', [blockedRoleId, `SEM_ACESSO_${Date.now()}`])
  const blockedUserId = crypto.randomUUID()
  const blockedEmail = `sem-acesso-${Date.now()}@test.local`
  await database.run('INSERT INTO users (id, company_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?)', [blockedUserId, admin.company.id, 'Sem acesso', blockedEmail, await bcrypt.hash('senha123', 4)])
  await database.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [blockedUserId, blockedRoleId])
  const blockedLogin = await request(app).post('/api/auth/login').send({ email: blockedEmail, password: 'senha123' })
  assert.equal((await request(app).get('/api/accounts-payable').set('Authorization', `Bearer ${blockedLogin.body.token}`)).status, 403)
})

test('isola projetos entre empresas', async () => {
  const first = await register('Empresa Isolada A')
  const second = await register('Empresa Isolada B')
  const created = await request(app).post('/api/projects').set('Authorization', `Bearer ${first.token}`).send({ name: 'Obra exclusiva A' })
  assert.equal(created.status, 201)
  const otherProjects = await request(app).get('/api/projects').set('Authorization', `Bearer ${second.token}`)
  assert.equal(otherProjects.status, 200)
  assert.equal(otherProjects.body.some((project) => project.name === 'Obra exclusiva A'), false)
})

test('simulador inicia sem assinatura automática e isola assinaturas e pagamentos por empresa', async () => {
  const first = await register('Empresa Assinatura A')
  const second = await register('Empresa Assinatura B')
  const firstHeaders = { Authorization: `Bearer ${first.token}` }
  const secondHeaders = { Authorization: `Bearer ${second.token}` }

  assert.equal((await database.get('SELECT id FROM subscriptions WHERE company_id = ?', [first.company.id])), undefined)
  assert.equal((await request(app).get('/api/subscription').set(firstHeaders)).body.subscription, null)
  const checkout = await request(app).post('/api/subscription/checkout').set(firstHeaders).send({ method: 'CARTAO', cardNumber: 'nao-deve-ser-recebido', cvv: '123' })
  assert.equal(checkout.status, 201)
  assert.equal(checkout.body.subscription.status, 'ATIVA')
  assert.equal(checkout.body.subscription.amount, 500)
  assert.equal(checkout.body.subscription.payment_method, 'CARTAO')
  assert.ok(checkout.body.subscription.next_charge_at)
  assert.equal(checkout.body.payments[0].status, 'APROVADO')
  assert.equal(Object.hasOwn(checkout.body, 'cardNumber'), false)
  assert.equal((await request(app).get('/api/subscription').set(secondHeaders)).body.subscription, null)
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM subscription_payments WHERE company_id = ?', [second.company.id])).count, 0)
})

test('verificação opcional identifica empresas sem assinatura sem bloquear o administrador', async () => {
  const session = await register('Empresa Verificacao Plano')
  const role = await database.get('SELECT id FROM roles WHERE name = ?', ['GESTOR'])
  const userId = crypto.randomUUID()
  const email = `gerente-${Date.now()}@test.local`
  await database.run('INSERT INTO users (id, company_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?)', [userId, session.company.id, 'Gerente', email, await bcrypt.hash('senha123', 4)])
  await database.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id])
  const login = await request(app).post('/api/auth/login').send({ email, password: 'senha123' })
  assert.equal(login.status, 200)
  const original = process.env.NEXORA_ENFORCE_SUBSCRIPTIONS
  process.env.NEXORA_ENFORCE_SUBSCRIPTIONS = 'true'
  try {
    assert.equal((await request(app).get('/api/projects').set('Authorization', `Bearer ${login.body.token}`)).status, 402)
    assert.equal((await request(app).get('/api/projects').set('Authorization', `Bearer ${session.token}`)).status, 200)
    assert.equal((await request(app).get('/api/subscription').set('Authorization', `Bearer ${login.body.token}`)).status, 200)
  } finally {
    if (original === undefined) delete process.env.NEXORA_ENFORCE_SUBSCRIPTIONS
    else process.env.NEXORA_ENFORCE_SUBSCRIPTIONS = original
  }
})

test('administrador pode simular pendência, aprovação, recusa, renovação, cancelamento e expiração', async () => {
  const session = await register('Empresa Ciclo Assinatura')
  const headers = { Authorization: `Bearer ${session.token}` }
  let result = await request(app).post('/api/subscription/admin-action').set(headers).send({ action: 'CRIAR_COBRANCA', method: 'PIX' })
  assert.equal(result.status, 200)
  assert.equal(result.body.subscription.status, 'PENDENTE')
  assert.equal(result.body.payments[0].status, 'PENDENTE')
  result = await request(app).post('/api/subscription/admin-action').set(headers).send({ action: 'APROVAR_PAGAMENTO' })
  assert.equal(result.body.subscription.status, 'ATIVA')
  result = await request(app).post('/api/subscription/admin-action').set(headers).send({ action: 'RENOVAR', method: 'BOLETO' })
  assert.equal(result.body.subscription.status, 'ATIVA')
  assert.equal(result.body.subscription.payment_method, 'BOLETO')
  assert.ok(result.body.payments.some((payment) => payment.event_type === 'RENOVACAO'))
  result = await request(app).post('/api/subscription/admin-action').set(headers).send({ action: 'CANCELAR' })
  assert.equal(result.body.subscription.status, 'CANCELADA')
  assert.equal(result.body.subscription.next_charge_at, null)
  result = await request(app).post('/api/subscription/admin-action').set(headers).send({ action: 'EXPIRAR' })
  assert.equal(result.body.subscription.status, 'EXPIRADA')

  const declined = await register('Empresa Pagamento Recusado')
  const declinedHeaders = { Authorization: `Bearer ${declined.token}` }
  await request(app).post('/api/subscription/admin-action').set(declinedHeaders).send({ action: 'CRIAR_COBRANCA', method: 'PIX' })
  result = await request(app).post('/api/subscription/admin-action').set(declinedHeaders).send({ action: 'RECUSAR_PAGAMENTO' })
  assert.equal(result.body.subscription.status, 'PENDENTE')
  assert.equal(result.body.payments[0].status, 'RECUSADO')
})

test('persiste produto, entrada e saldo por movimentação', async () => {
  const session = await register('Empresa Estoque')
  const headers = { Authorization: `Bearer ${session.token}` }
  const product = await request(app).post('/api/products').set(headers).send({ name: 'Parafuso M16', category: 'Fixação', unit: 'UN' })
  assert.equal(product.status, 201)
  const movement = await request(app).post('/api/inventory/movements').set(headers).send({ product_id: product.body.id, type: 'ENTRADA', quantity: 500 })
  assert.equal(movement.status, 201)
  assert.equal(movement.body.balance, 500)
  const withdrawal = await request(app).post('/api/inventory/movements').set(headers).send({ product_id: product.body.id, type: 'SAIDA', quantity: 100 })
  assert.equal(withdrawal.status, 201)
  assert.equal(withdrawal.body.balance, 400)
  const history = await request(app).get('/api/inventory/movements').set(headers)
  assert.equal(history.body.length, 2)
})

test('persiste conta a pagar e atualiza dashboard', async () => {
  const session = await register('Empresa Financeiro')
  const headers = { Authorization: `Bearer ${session.token}` }
  const payable = await request(app).post('/api/accounts-payable').set(headers).send({ description: 'Frete de montagem', due_date: '2026-10-01', amount: 12500 })
  assert.equal(payable.status, 201)
  const dashboard = await request(app).get('/api/dashboard').set(headers)
  assert.equal(dashboard.status, 200)
  assert.equal(dashboard.body.financial.payable, 12500)
})

test('registra auditoria ao criar fornecedor', async () => {
  const session = await register('Empresa Auditoria')
  const headers = { Authorization: `Bearer ${session.token}` }
  const supplier = await request(app).post('/api/suppliers').set(headers).send({ legal_name: 'Fornecedor Teste Ltda.' })
  assert.equal(supplier.status, 201)
  const logs = await request(app).get('/api/audit-logs').set(headers)
  assert.equal(logs.body.some((log) => log.action === 'CRIAR' && log.module === 'SUPPLIERS'), true)
})

test('clientes usam CRUD persistente e não atravessam tenants', async () => {
  const first = await register('Empresa Clientes A')
  const second = await register('Empresa Clientes B')
  const headers = { Authorization: `Bearer ${first.token}` }
  const created = await request(app).post('/api/clients').set(headers).send({ legal_name: 'Cliente Real A', city: 'Rio Verde' })
  assert.equal(created.status, 201)
  const updated = await request(app).put(`/api/clients/${created.body.id}`).set(headers).send({ legal_name: 'Cliente Atualizado A', city: 'Sorriso' })
  assert.equal(updated.status, 200)
  const otherRead = await request(app).get('/api/clients').set('Authorization', `Bearer ${second.token}`)
  assert.equal(otherRead.body.some((client) => client.id === created.body.id), false)
  const archived = await request(app).post(`/api/clients/${created.body.id}/archive`).set(headers).send()
  assert.equal(archived.status, 200)
  const logs = await request(app).get('/api/audit-logs').set(headers)
  assert.equal(logs.body.some((log) => log.module === 'CLIENTES' && log.action === 'EDITAR'), true)
})

test('receber ordem de compra gera entrada automaticamente', async () => {
  const session = await register('Empresa Compras')
  const headers = { Authorization: `Bearer ${session.token}` }
  const product = await request(app).post('/api/products').set(headers).send({ name: 'Eletrodo 6013', unit: 'CX' })
  const order = await request(app).post('/api/purchase-orders').set(headers).send({ total: 900 })
  const item = await request(app).post(`/api/purchase-orders/${order.body.id}/items`).set(headers).send({ product_id: product.body.id, description: 'Eletrodo 6013', quantity: 12, unit_price: 75 })
  assert.equal(item.status, 201)
  const received = await request(app).post(`/api/purchase-orders/${order.body.id}/receive`).set(headers).send()
  assert.equal(received.status, 200)
  const duplicate = await request(app).post(`/api/purchase-orders/${order.body.id}/receive`).set(headers).send()
  assert.equal(duplicate.status, 409)
  const stock = await request(app).get('/api/inventory').set(headers)
  assert.equal(stock.body[0].quantity, 12)
})

test('pagar conta gera transação financeira na mesma operação', async () => {
  const session = await register('Empresa Pagamentos')
  const headers = { Authorization: `Bearer ${session.token}` }
  const account = await request(app).post('/api/accounts-payable').set(headers).send({ description: 'Serviço de solda', due_date: '2026-10-10', amount: 2400 })
  assert.equal(account.status, 201)
  const paid = await request(app).post(`/api/accounts-payable/${account.body.id}/pay`).set(headers).send({ amount: 2400, paid_date: '2026-09-21' })
  assert.equal(paid.status, 200)
  const transactions = await request(app).get('/api/transactions').set(headers)
  assert.equal(transactions.body.some((transaction) => transaction.type === 'SAIDA' && transaction.amount === 2400), true)
})

test('faz upload e download de documento dentro do tenant', async () => {
  const session = await register('Empresa Documentos')
  const headers = { Authorization: `Bearer ${session.token}` }
  const uploaded = await request(app).post('/api/documents/upload').set(headers).field('category', 'Contratos').attach('file', Buffer.from('NEXORA TESTE'), 'contrato.txt')
  assert.equal(uploaded.status, 400)
  const validUpload = await request(app).post('/api/documents/upload').set(headers).field('category', 'Contratos').attach('file', Buffer.from('%PDF-1.4 Nexora'), { filename: 'contrato.pdf', contentType: 'application/pdf' })
  assert.equal(validUpload.status, 201)
  const downloaded = await request(app).get(`/api/documents/${validUpload.body.id}/download`).set(headers)
  assert.equal(downloaded.status, 200)
})

test('cria equipamento, manutenção e atividade de agenda', async () => {
  const session = await register('Empresa Campo')
  const headers = { Authorization: `Bearer ${session.token}` }
  const equipment = await request(app).post('/api/equipment').set(headers).send({ code: 'EQ-001', name: 'Lixadeira', type: 'Ferramenta', status: 'DISPONIVEL' })
  assert.equal(equipment.status, 201)
  const maintenance = await request(app).post('/api/maintenance').set(headers).send({ equipment_id: equipment.body.id, type: 'PREVENTIVA', description: 'Revisão', cost: 120 })
  assert.equal(maintenance.status, 201)
  const activity = await request(app).post('/api/field-activities').set(headers).send({ title: 'Visita técnica', type: 'Visita técnica', starts_at: '2026-09-21T08:30' })
  assert.equal(activity.status, 201)
})

test('pagina e filtra fornecedores por cidade', async () => {
  const session = await register('Empresa Fornecedores')
  const headers = { Authorization: `Bearer ${session.token}` }
  await request(app).post('/api/suppliers').set(headers).send({ legal_name: 'Fornecedor Rio Verde', city: 'Rio Verde' })
  await request(app).post('/api/suppliers').set(headers).send({ legal_name: 'Fornecedor Sorriso', city: 'Sorriso' })
  const result = await request(app).get('/api/suppliers?page=1&pageSize=1&city=Rio%20Verde').set(headers)
  assert.equal(result.status, 200)
  assert.equal(result.body.pagination.total, 1)
  assert.equal(result.body.data[0].city, 'Rio Verde')
})

test('pagina e filtra clientes no banco sem atravessar tenants', async () => {
  const first = await register('Empresa Clientes Paginados A')
  const second = await register('Empresa Clientes Paginados B')
  const firstHeaders = { Authorization: `Bearer ${first.token}` }
  const secondHeaders = { Authorization: `Bearer ${second.token}` }
  await request(app).post('/api/clients').set(firstHeaders).send({ legal_name: 'Cliente Rio Verde', document: '111', city: 'Rio Verde' })
  await request(app).post('/api/clients').set(firstHeaders).send({ legal_name: 'Cliente Sorriso', document: '222', city: 'Sorriso' })
  await request(app).post('/api/clients').set(secondHeaders).send({ legal_name: 'Cliente Outro Tenant', city: 'Rio Verde' })
  const result = await request(app).get('/api/clients?search=Rio%20Verde&page=1&pageSize=999&sort=company_id').set(firstHeaders)
  assert.equal(result.status, 200)
  assert.equal(result.body.pagination.pageSize, 100)
  assert.equal(result.body.pagination.total, 1)
  assert.equal(result.body.data[0].legal_name, 'Cliente Rio Verde')
  const otherTenant = await request(app).get('/api/clients?search=Rio%20Verde&page=1&pageSize=100').set(secondHeaders)
  assert.equal(otherTenant.body.pagination.total, 1)
  assert.equal(otherTenant.body.data[0].legal_name, 'Cliente Outro Tenant')
})

test('filtra histórico por entidade e mantém isolamento do tenant', async () => {
  const first = await register('Empresa Historico A')
  const second = await register('Empresa Historico B')
  const firstHeaders = { Authorization: `Bearer ${first.token}` }
  const secondHeaders = { Authorization: `Bearer ${second.token}` }
  const client = await request(app).post('/api/clients').set(firstHeaders).send({ legal_name: 'Cliente com histórico' })
  const history = await request(app).get(`/api/audit-logs/by-entity/${client.body.id}?module=CLIENTES`).set(firstHeaders)
  assert.equal(history.status, 200)
  assert.equal(history.body.some((log) => log.record_id === client.body.id && log.module === 'CLIENTES'), true)
  const otherHistory = await request(app).get(`/api/audit-logs/by-entity/${client.body.id}`).set(secondHeaders)
  assert.equal(otherHistory.status, 200)
  assert.equal(otherHistory.body.length, 0)
})

test('seleciona cotação vencedora e cria ordem sem alterar outras cotações', async () => {
  const session = await register('Empresa Cotacoes')
  const headers = { Authorization: `Bearer ${session.token}` }
  const supplierA = await request(app).post('/api/suppliers').set(headers).send({ legal_name: 'Fornecedor A' })
  const supplierB = await request(app).post('/api/suppliers').set(headers).send({ legal_name: 'Fornecedor B' })
  const purchase = await request(app).post('/api/purchase-requests').set(headers).send({ justification: 'Comprar chapas' })
  const quoteA = await request(app).post('/api/quotations').set(headers).send({ purchase_request_id: purchase.body.id, supplier_id: supplierA.body.id, unit_price: 100, total: 1000 })
  const quoteB = await request(app).post('/api/quotations').set(headers).send({ purchase_request_id: purchase.body.id, supplier_id: supplierB.body.id, unit_price: 120, total: 1200 })
  const selected = await request(app).post(`/api/quotations/${quoteA.body.id}/select`).set(headers).send()
  assert.equal(selected.status, 201)
  const quotes = await request(app).get(`/api/quotations/compare/${purchase.body.id}`).set(headers)
  assert.equal(quotes.body.find((quote) => quote.id === quoteA.body.id).status, 'SELECIONADA')
  assert.equal(quotes.body.find((quote) => quote.id === quoteB.body.id).status, 'RECUSADA')
})

test('exporta fornecedor em CSV, Excel e PDF dentro do tenant', async () => {
  const session = await register('Empresa Exportacao')
  const headers = { Authorization: `Bearer ${session.token}` }
  await request(app).post('/api/suppliers').set(headers).send({ legal_name: 'Fornecedor Exportado' })
  for (const format of ['csv', 'xlsx', 'pdf']) { const response = await request(app).get(`/api/suppliers/export?format=${format}`).set(headers); assert.equal(response.status, 200); assert.match(response.headers['content-type'], format === 'csv' ? /text\/csv/ : format === 'pdf' ? /application\/pdf/ : /ms-excel/) }
})

test('usuário autorizado consulta financeiro via Nexora AI', async () => {
  const session = await register('Empresa AI Financeira')
  const headers = { Authorization: `Bearer ${session.token}` }
  await request(app).post('/api/accounts-receivable').set(headers).send({ description: 'Cobrança de obra', due_date: '2026-09-25', amount: 1250 })
  await request(app).post('/api/accounts-payable').set(headers).send({ description: 'Compra de lona', due_date: '2026-09-30', amount: 780 })
  const response = await request(app).post('/api/ai/chat').set(headers).send({ message: 'Quanto tenho para receber este mês?' })
  assert.equal(response.status, 200)
  assert.match(response.body.answer.toLowerCase(), /receber|receb|1250|setembro/i)
  assert.equal(response.body.scope?.module, 'finance')
})

test('usuário sem permissão de financeiro recebe resposta controlada do Nexora AI', async () => {
  const session = await register('Empresa AI Bloqueada')
  const roleId = `role-dashboard-no-finance-${Date.now()}`
  await database.run('INSERT INTO roles (id, name) VALUES (?, ?)', [roleId, `DASHBOARD_SEM_FINANCE_${Date.now()}`])
  const dashboardView = await database.get('SELECT id FROM permissions WHERE module = ? AND action = ?', ['dashboard', 'view'])
  await database.run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, dashboardView.id])
  const userId = crypto.randomUUID()
  const email = `ai-consulta-${Date.now()}@test.local`
  await database.run('INSERT INTO users (id, company_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?)', [userId, session.company.id, 'Consulta AI', email, await bcrypt.hash('senha123', 4)])
  await database.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId])
  const login = await request(app).post('/api/auth/login').send({ email, password: 'senha123' })
  const response = await request(app).post('/api/ai/chat').set('Authorization', `Bearer ${login.body.token}`).send({ message: 'Quanto tenho para pagar?' })
  assert.equal(response.status, 403)
  assert.match(response.body.error.toLowerCase(), /permissão|financeiro/i)
})

test('company_id do corpo é ignorado e a sessão define o tenant', async () => {
  const session = await register('Empresa AI Tenant')
  const headers = { Authorization: `Bearer ${session.token}` }
  await request(app).post('/api/accounts-receivable').set(headers).send({ description: 'Receita do tenant', due_date: '2026-09-28', amount: 990 })
  const response = await request(app).post('/api/ai/chat').set(headers).send({ message: 'Quanto tenho para receber?', company_id: 'empresa-externa', user_id: 'hack' })
  assert.equal(response.status, 200)
  assert.equal(response.body.companyId, session.company.id)
  assert.doesNotMatch(response.body.answer, /empresa-externa|hack/i)
})

test('usuário de uma empresa nunca recebe dados de outra empresa', async () => {
  const first = await register('Empresa AI A')
  const second = await register('Empresa AI B')
  const firstHeaders = { Authorization: `Bearer ${first.token}` }
  const secondHeaders = { Authorization: `Bearer ${second.token}` }
  await request(app).post('/api/projects').set(firstHeaders).send({ name: 'Obra Empresa A', status: 'EM_EXECUCAO' })
  await request(app).post('/api/projects').set(secondHeaders).send({ name: 'Obra Empresa B', status: 'EM_EXECUCAO' })
  const response = await request(app).post('/api/ai/chat').set(firstHeaders).send({ message: 'Quais projetos estão ativos?' })
  assert.equal(response.status, 200)
  assert.equal(response.body.summary?.projectCount, 1)
  assert.equal(Array.isArray(response.body.summary?.projects), true)
  assert.equal(response.body.summary?.projects.some((project) => project.name === 'Obra Empresa B'), false)
})

test('consulta de estoque, compras e manutenção do Nexora AI funcione com dados reais', async () => {
  const session = await register('Empresa AI Operacional')
  const headers = { Authorization: `Bearer ${session.token}` }
  const product = await request(app).post('/api/products').set(headers).send({ name: 'Cabo 4mm', category: 'Elétrica', unit: 'M' })
  await request(app).post('/api/inventory/movements').set(headers).send({ product_id: product.body.id, type: 'ENTRADA', quantity: 120, note: 'Recebimento inicial' })
  await request(app).post('/api/purchase-requests').set(headers).send({ justification: 'Comprar mais cabos', status: 'PENDENTE' })
  const project = await request(app).post('/api/projects').set(headers).send({ name: 'Obra AI', status: 'EM_EXECUCAO' })
  await request(app).post('/api/equipment').set(headers).send({ code: 'EQ-SAFE-1', name: 'Compactador', status: 'EM_MANUTENCAO' })
  await request(app).post('/api/maintenance').set(headers).send({ equipment_id: 'unknown', type: 'PREVENTIVA', description: 'Revisão de filtro' })
  const response = await request(app).post('/api/ai/chat').set(headers).send({ message: 'Como está meu estoque e quais equipamentos estão em manutenção?' })
  assert.equal(response.status, 200)
  assert.match(response.body.answer.toLowerCase(), /estoque|manutenc|compactador|cabo/i)
  assert.equal(response.body.scope?.module, 'inventory')
})

test('resposta apropriada quando não há dados e erro do provider é tratado', async () => {
  const session = await register('Empresa AI Vazia')
  const headers = { Authorization: `Bearer ${session.token}` }
  const emptyResponse = await request(app).post('/api/ai/chat').set(headers).send({ message: 'Quais projetos estão ativos?' })
  assert.equal(emptyResponse.status, 200)
  assert.match(emptyResponse.body.answer.toLowerCase(), /nenhum|não há|ativos/i)
  const original = process.env.AI_PROVIDER
  process.env.AI_PROVIDER = 'broken'
  const errorResponse = await request(app).post('/api/ai/chat').set(headers).send({ message: 'Quanto tenho para receber?' })
  assert.equal(errorResponse.status, 200)
  assert.match(errorResponse.body.answer.toLowerCase(), /não foi possível consultar|erro/i)
  if (original === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = original
})

test('provider PUTER é reconhecido sem AI_API_KEY e mantém contrato de leitura segura', async () => {
  const originalProvider = process.env.AI_PROVIDER
  const originalApiKey = process.env.AI_API_KEY
  delete process.env.AI_API_KEY
  process.env.AI_PROVIDER = 'puter'

  const provider = createAiProvider()
  assert.equal(provider.name, 'puter')

  if (originalProvider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = originalProvider
  if (originalApiKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = originalApiKey
})

test('SQL arbitrário e pergunta excessivamente grande são rejeitados', async () => {
  const session = await register('Empresa AI Segurança')
  const headers = { Authorization: `Bearer ${session.token}` }
  const badSql = await request(app).post('/api/ai/chat').set(headers).send({ message: "SELECT * FROM users WHERE company_id = 'x'; --" })
  assert.equal(badSql.status, 400)
  assert.match(badSql.body.error.toLowerCase(), /pergunta|invalida|consultar/i)
  const huge = 'x'.repeat(6000)
  const large = await request(app).post('/api/ai/chat').set(headers).send({ message: huge })
  assert.equal(large.status, 413)
})

test('administrador gerencia usuários, perfis, permissões e auditoria no próprio tenant', async () => {
  const admin = await register('Empresa Administracao')
  const headers = { Authorization: `Bearer ${admin.token}` }
  const roles = await request(app).get('/api/roles').set(headers)
  assert.equal(roles.status, 200)
  const consulta = roles.body.find((role) => role.name === 'CONSULTA')
  assert.ok(consulta)
  const created = await request(app).post('/api/users').set(headers).send({ name: 'Usuário Operacional', email: `operacional-${Date.now()}@test.local`, password: 'senha123-TESTE', role_id: consulta.id })
  assert.equal(created.status, 201)
  assert.equal(Object.hasOwn(created.body, 'password_hash'), false)
  const users = await request(app).get('/api/users?search=Operacional').set(headers)
  assert.equal(users.status, 200)
  assert.equal(users.body.some((user) => user.id === created.body.id && user.role_name === 'CONSULTA'), true)
  const updated = await request(app).put(`/api/users/${created.body.id}`).set(headers).send({ name: 'Usuário Atualizado', email: created.body.email, phone: '62999999999', job_title: 'Campo', role_id: consulta.id })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.name, 'Usuário Atualizado')
  assert.equal((await request(app).patch(`/api/users/${created.body.id}/status`).set(headers).send({ status: 'INATIVO' })).status, 200)
  assert.equal((await request(app).post(`/api/users/${created.body.id}/reset-password`).set(headers).send({ password: 'novaSenha123' })).status, 200)
  const permissionList = await request(app).get('/api/permissions').set(headers)
  assert.equal(permissionList.status, 200)
  const rolePermissions = await request(app).get(`/api/roles/${consulta.id}/permissions`).set(headers)
  assert.equal(rolePermissions.status, 200)
  const audit = await request(app).get('/api/access-audit').set(headers)
  assert.equal(audit.status, 200)
  assert.equal(audit.body.some((entry) => entry.record_id === created.body.id && entry.module === 'USUARIOS'), true)
  assert.equal(JSON.stringify(audit.body).includes('senha123'), false)
})

test('usuário sem administração recebe 403 e usuários de outro tenant ficam isolados', async () => {
  const first = await register('Empresa Admin A')
  const second = await register('Empresa Admin B')
  const firstUsers = await request(app).get('/api/users').set('Authorization', `Bearer ${first.token}`)
  assert.equal(firstUsers.status, 200)
  const role = await database.get('SELECT id FROM roles WHERE name = ?', ['CONSULTA'])
  const userId = crypto.randomUUID()
  const email = `sem-admin-${Date.now()}@test.local`
  await database.run('INSERT INTO users (id, company_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?)', [userId, first.company.id, 'Sem admin', email, await bcrypt.hash('senha123', 4)])
  await database.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id])
  const login = await request(app).post('/api/auth/login').send({ email, password: 'senha123' })
  assert.equal((await request(app).get('/api/users').set('Authorization', `Bearer ${login.body.token}`)).status, 403)
  const secondUsers = await request(app).get('/api/users').set('Authorization', `Bearer ${second.token}`)
  assert.equal(secondUsers.body.some((user) => user.id === userId), false)
  assert.equal((await request(app).get('/api/users').set('Authorization', `Bearer ${first.token}`).query({ company_id: second.company.id })).body.every((user) => user.company_id === undefined), true)
})

test('dashboard overview retorna indicadores reais e oculta financeiro sem permissão', async () => {
  const admin = await register('Empresa Dashboard 6.1')
  const headers = { Authorization: `Bearer ${admin.token}` }
  await request(app).post('/api/projects').set(headers).send({ name: 'Projeto Dashboard', status: 'EM_EXECUCAO', endDate: '2026-09-01' })
  await request(app).post('/api/accounts-payable').set(headers).send({ description: 'Conta dashboard', due_date: '2026-10-01', amount: 500 })
  const overview = await request(app).get('/api/dashboard/overview').set(headers)
  assert.equal(overview.status, 200)
  assert.equal(overview.body.companyId, admin.company.id)
  assert.ok(overview.body.operational.activeProjects >= 1)
  assert.equal(overview.body.financial.payable, 500)

  const roleId = `role-dashboard-no-finance-${Date.now()}`
  await database.run('INSERT INTO roles (id, name) VALUES (?, ?)', [roleId, `DASHBOARD_SEM_FINANCE_${Date.now()}`])
  const dashboardView = await database.get('SELECT id FROM permissions WHERE module = ? AND action = ?', ['dashboard', 'view'])
  await database.run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, dashboardView.id])
  const userId = crypto.randomUUID()
  const email = `dashboard-consulta-${Date.now()}@test.local`
  await database.run('INSERT INTO users (id, company_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?)', [userId, admin.company.id, 'Consulta Dashboard', email, await bcrypt.hash('senha123', 4)])
  await database.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId])
  const login = await request(app).post('/api/auth/login').send({ email, password: 'senha123' })
  const restricted = await request(app).get('/api/dashboard/overview').set('Authorization', `Bearer ${login.body.token}`)
  assert.equal(restricted.status, 200)
  assert.equal(Object.hasOwn(restricted.body, 'financial'), false)
})

test('tarefas têm CRUD, filtros, status, paginação, auditoria e isolamento por tenant', async () => {
  const first = await register('Empresa Tarefas A')
  const second = await register('Empresa Tarefas B')
  const recipientId = await addRecipient(first.company.id)
  const headers = { Authorization: `Bearer ${first.token}` }
  const created = await request(app).post('/api/tasks').set(headers).send({ title: 'Conferir instalação', description: 'Validar checklist', recipient_ids: [recipientId], responsible: 'Equipe Campo', due_date: '2026-09-30', priority: 'ALTA', status: 'PENDENTE' })
  assert.equal(created.status, 201)
  const listed = await request(app).get('/api/tasks?folder=sent&search=checklist&page=1&pageSize=1&sort=due_date').set(headers)
  assert.equal(listed.status, 200)
  assert.equal(listed.body.data.length, 1)
  assert.equal(listed.body.data[0].id, created.body.id)
  assert.equal((await request(app).get(`/api/tasks/${created.body.id}`).set(headers)).status, 200)
  const recipient = await database.get('SELECT email FROM users WHERE id = ?', [recipientId])
  const recipientSession = await request(app).post('/api/auth/login').send({ email: recipient.email, password: 'senha123' })
  assert.equal(recipientSession.status, 200)
  const recipientHeaders = { Authorization: `Bearer ${recipientSession.body.token}` }
  assert.equal((await request(app).post(`/api/tasks/${created.body.id}/messages`).set(recipientHeaders).send({ message: 'Recebido pela equipe.' })).status, 201)
  assert.equal((await request(app).patch(`/api/tasks/${created.body.id}/status`).set(recipientHeaders).send({ status: 'EM_ANDAMENTO' })).status, 200)
  assert.equal((await request(app).get('/api/tasks?folder=sent&search=checklist').set(headers)).body.data.length, 1)
  assert.equal((await request(app).post(`/api/tasks/${created.body.id}/cancel`).set(headers).send()).status, 200)
  const other = await request(app).get('/api/tasks').set('Authorization', `Bearer ${second.token}`)
  assert.equal(other.body.data.some((task) => task.id === created.body.id), false)
  const audit = await request(app).get(`/api/audit-logs?module=TAREFAS&recordId=${created.body.id}`).set(headers)
  assert.equal(audit.body.data.some((entry) => entry.action === 'ENVIAR_SOLICITACAO'), true)
  assert.equal(audit.body.data.some((entry) => entry.action === 'CANCELAR_SOLICITACAO'), true)
})

test('overview de projeto retorna relacionamentos reais e respeita tenant/financeiro', async () => {
  const first = await register('Empresa Projetos Overview A')
  const second = await register('Empresa Projetos Overview B')
  const headers = { Authorization: `Bearer ${first.token}` }
  const recipientId = await addRecipient(first.company.id)
  const project = await request(app).post('/api/projects').set(headers).send({ name: 'Projeto Detalhado', status: 'EM_EXECUCAO' })
  await request(app).post('/api/tasks').set(headers).send({ project_id: project.body.id, title: 'Tarefa do projeto', description: 'Descrição da tarefa', recipient_ids: [recipientId] })
  await request(app).post('/api/accounts-payable').set(headers).send({ project_id: project.body.id, description: 'Custo do projeto', due_date: '2026-10-01', amount: 300 })
  const overview = await request(app).get(`/api/projects/${project.body.id}/overview`).set(headers)
  assert.equal(overview.status, 200)
  assert.equal(overview.body.project.id, project.body.id)
  assert.equal(overview.body.tasks.length, 1)
  assert.equal(overview.body.financial.payables[0].amount, 300)
  assert.equal((await request(app).get(`/api/projects/${project.body.id}/overview`).set('Authorization', `Bearer ${second.token}`)).status, 404)
})

