const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const multer = require('multer')
const fs = require('fs')
const path = require('path')
const db = require('./db')
const createCrudRoutes = require('./crud-routes')
const { createAiProvider } = require('./ai-provider')

const app = express()
const port = process.env.PORT || 3333
const isProduction = process.env.NODE_ENV === 'production'
const jwtSecret = process.env.NEXORA_JWT_SECRET || (!isProduction ? 'nexora-development-secret-change-me' : (() => { throw new Error('NEXORA_JWT_SECRET deve ser configurado em produção.') })())
const frontendOrigin = process.env.FRONTEND_ORIGIN
app.use(cors(isProduction ? { origin: frontendOrigin, credentials: false } : { origin: true }))
app.use(express.json({ limit: '2mb' }))
const id = () => crypto.randomUUID()
const tokenFor = (user) => jwt.sign({ userId: user.id, companyId: user.company_id, role: user.role }, jwtSecret, { expiresIn: '12h' })
const paginationFor = (request) => { const requestedPage = Number.parseInt(request.query.page, 10); const requestedPageSize = Number.parseInt(request.query.pageSize, 10); const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1; const pageSize = Number.isFinite(requestedPageSize) ? Math.min(100, Math.max(1, requestedPageSize)) : 20; return { page, pageSize, offset: (page - 1) * pageSize, requested: request.query.page !== undefined || request.query.pageSize !== undefined } }
const sortFor = (request, fields, fallback = 'created_at') => ({ field: fields.includes(request.query.sort) ? request.query.sort : fallback, direction: request.query.direction === 'asc' ? 'ASC' : 'DESC' })
async function permissionsFor(user) { if (user.role === 'ADMINISTRADOR') return ['*.*']; const rows = await db.all('SELECT p.module, p.action FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?', [user.id]); return rows.map((row) => `${row.module}.${row.action}`) }
const cleanUser = (user, permissions = user.permissions || []) => ({ id: user.id, name: user.name, email: user.email, companyId: user.company_id, role: user.role, permissions })
const errorResponse = (response, error) => { console.error(error); response.status(500).json({ error: 'Não foi possível concluir a operação.' }) }
const uploadRoot = process.env.NEXORA_STORAGE_PATH || path.join(__dirname, 'storage')
const upload = multer({ storage: multer.diskStorage({ destination: (request, _file, callback) => { const directory = path.join(uploadRoot, request.user.company_id); fs.mkdirSync(directory, { recursive: true }); callback(null, directory) }, filename: (_request, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`) }), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_request, file, callback) => callback(null, ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype)) })

async function auth(request, response, next) {
  try {
    const header = request.headers.authorization || ''
    if (!header.startsWith('Bearer ')) return response.status(401).json({ error: 'Autenticação necessária.' })
    const payload = jwt.verify(header.slice(7), jwtSecret)
    const user = await db.get('SELECT u.*, r.name AS role FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id WHERE u.id = ? AND u.company_id = ? AND u.status = ?', [payload.userId, payload.companyId, 'ATIVO'])
    if (!user) return response.status(401).json({ error: 'Sessão inválida.' })
    user.permissions = await permissionsFor(user)
    request.user = user
    next()
  } catch (_error) { response.status(401).json({ error: 'Sessão inválida ou expirada.' }) }
}
function requireRole(...allowedRoles) { return (request, response, next) => allowedRoles.includes(request.user.role) ? next() : response.status(403).json({ error: 'Seu perfil não possui permissão para esta ação.' }) }
function requirePermission(module, action) { return (request, response, next) => { const permissions = request.user.permissions || []; if (request.user.role === 'ADMINISTRADOR' || permissions.includes('*.*') || permissions.includes(`${module}.${action}`)) return next(); return response.status(403).json({ error: 'Você não possui permissão para realizar esta ação.' }) } }
function requireAdministrator(request, response, next) { return request.user.role === 'ADMINISTRADOR' ? next() : response.status(403).json({ error: 'Apenas administradores podem gerenciar usuários e permissões.' }) }
async function audit(user, action, module, recordId, oldValue = null, newValue = null) { await db.run('INSERT INTO audit_logs (id, company_id, user_id, action, module, record_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id(), user.company_id, user.id, action, module, recordId, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null]) }
const routePermission = (request) => { const path = request.path; const module = path.startsWith('/api/dashboard') || path.startsWith('/api/global-search') ? 'dashboard' : path.startsWith('/api/accounts-') ? 'finance' : path.startsWith('/api/transactions') || path.startsWith('/api/cost-centers') ? 'finance' : path.startsWith('/api/purchase-') ? 'purchases' : path.startsWith('/api/quotations') ? 'quotations' : path.startsWith('/api/inventory') || path.startsWith('/api/products') || path.startsWith('/api/categories') || path.startsWith('/api/storage-locations') ? 'inventory' : path.startsWith('/api/suppliers') ? 'suppliers' : path.startsWith('/api/clients') ? 'clients' : path.startsWith('/api/projects') ? 'projects' : path.startsWith('/api/equipment') ? 'equipment' : path.startsWith('/api/maintenance') ? 'maintenance' : path.startsWith('/api/field-activities') ? 'agenda' : path.startsWith('/api/documents') ? 'documents' : path.startsWith('/api/audit-logs') ? 'audit' : path.startsWith('/api/users') ? 'users' : null; if (!module) return null; if (request.method === 'GET') return [module, path.endsWith('/export') ? 'export' : path.endsWith('/download') ? 'download' : 'view']; if (path.endsWith('/archive')) return [module, 'archive']; if (path.endsWith('/pay')) return [module, 'pay']; if (path.endsWith('/receive')) return [module, 'receive']; if (request.method === 'POST' && (path.includes('/approve') || path.includes('/select'))) return [module, 'approve']; if (request.method === 'POST') return [module, 'create']; if (request.method === 'PUT' || request.method === 'PATCH') return [module, 'edit']; if (request.method === 'DELETE') return [module, 'delete']; return null }
app.use((request, response, next) => { if (request.path.startsWith('/api/auth') || request.path === '/api/health') return next(); const permission = routePermission(request); if (!permission) return next(); auth(request, response, () => requirePermission(permission[0], permission[1])(request, response, next)) })

app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'nexora-api', database: 'sqlite' }))

const MAX_AI_MESSAGE_LENGTH = 500
const aiModuleMap = {
  finance: ['finance', 'view'],
  projects: ['projects', 'view'],
  inventory: ['inventory', 'view'],
  purchases: ['purchases', 'view'],
  equipment: ['equipment', 'view'],
  maintenance: ['maintenance', 'view'],
  agenda: ['agenda', 'view'],
  documents: ['documents', 'view'],
  dashboard: ['dashboard', 'view'],
}

function sanitizeAiMessage(message) {
  const text = String(message || '').trim()
  if (!text) return { ok: false, status: 400, error: 'Pergunta inválida para consulta do Nexora AI.' }
  if (text.length > MAX_AI_MESSAGE_LENGTH) return { ok: false, status: 413, error: 'Pergunta excede o limite permitido de 500 caracteres.' }
  if (/(select\s+.*\s+from|insert\s+into|update\s+set|delete\s+from|drop\s+table|union\s+select|;|--)/i.test(text)) return { ok: false, status: 400, error: 'Pergunta inválida para consulta de leitura.' }
  return { ok: true, text }
}

function interpretAiQuestion(message) {
  const text = String(message || '').toLowerCase()
  const contains = (...keywords) => keywords.some((keyword) => text.includes(keyword))
  if (contains('receber', 'crédito', 'cobrança') && !contains('pagar')) return { module: 'finance', query: 'accounts_receivable', period: 'mes_atual', action: 'summary' }
  if (contains('pagar', 'pagamento') && !contains('receber')) return { module: 'finance', query: 'accounts_payable', period: 'mes_atual', action: 'summary' }
  if (contains('projeto') && contains('ativo')) return { module: 'projects', query: 'active_projects', period: 'ativa', action: 'summary' }
  if (contains('projeto') && contains('custo')) return { module: 'projects', query: 'project_costs', period: 'geral', action: 'summary' }
  if (contains('estoque') || contains('pouco estoque') || contains('produto') && contains('quantidade')) return { module: 'inventory', query: 'stock_summary', period: 'geral', action: 'summary' }
  if (contains('compra') || contains('compras') || contains('pedido')) return { module: 'purchases', query: 'pending_purchases', period: 'geral', action: 'summary' }
  if (contains('equipamento') && contains('manutenção')) return { module: 'equipment', query: 'equipment_maintenance', period: 'geral', action: 'summary' }
  if (contains('manutenção') || contains('manutenc')) return { module: 'maintenance', query: 'open_maintenance', period: 'geral', action: 'summary' }
  if (contains('compromisso') || contains('hoje') || contains('amanhã') || contains('agenda') || contains('visita') || contains('reunião') || contains('inspeção') || contains('entrega') || contains('instalação')) return { module: 'agenda', query: 'agenda_today', period: 'atual', action: 'summary' }
  if (contains('documento') || contains('arquivos')) return { module: 'documents', query: 'document_summary', period: 'geral', action: 'summary' }
  return { module: 'dashboard', query: 'dashboard_summary', period: 'geral', action: 'summary' }
}

async function getAiDashboardSummary(companyId) {
  const [projects, receivable, payable, inventory, purchases, equipment, maintenance, documents, activities] = await Promise.all([
    db.get("SELECT COUNT(*) AS total FROM projects WHERE company_id = ? AND status NOT IN ('FINALIZADO', 'CANCELADO')", [companyId]),
    db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM accounts_receivable WHERE company_id = ? AND status != 'RECEBIDA'", [companyId]),
    db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM accounts_payable WHERE company_id = ? AND status != 'PAGA'", [companyId]),
    db.get('SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory WHERE company_id = ?', [companyId]),
    db.get("SELECT COUNT(*) AS total FROM purchase_requests WHERE company_id = ? AND status NOT IN ('APROVADA', 'CANCELADA', 'RECEBIDA')", [companyId]),
    db.get("SELECT COUNT(*) AS total FROM equipment WHERE company_id = ? AND status IN ('EM_MANUTENCAO', 'MANUTENCAO')", [companyId]),
    db.get("SELECT COUNT(*) AS total FROM maintenance_records WHERE company_id = ? AND status IN ('AGENDADA', 'EM_ANDAMENTO')", [companyId]),
    db.get('SELECT COUNT(*) AS total FROM documents WHERE company_id = ? AND archived = 0', [companyId]),
    db.get("SELECT COUNT(*) AS total FROM field_activities WHERE company_id = ? AND status = 'AGENDADA'", [companyId])
  ])
  return {
    type: 'dashboard_summary',
    summary: {
      projectCount: Number(projects?.total || 0),
      receivableTotal: Number(receivable?.total || 0),
      payableTotal: Number(payable?.total || 0),
      inventoryTotal: Number(inventory?.total || 0),
      pendingPurchases: Number(purchases?.total || 0),
      equipmentMaintenanceCount: Number(equipment?.total || 0),
      maintenanceOpenCount: Number(maintenance?.total || 0),
      documentCount: Number(documents?.total || 0),
      agendaCount: Number(activities?.total || 0),
    },
  }
}

async function getAiAccountsReceivable(companyId, period) {
  const month = period === 'mes_atual' ? "strftime('%Y-%m', 'now')" : undefined
  const rows = await db.all(`SELECT id, description, amount, due_date, status FROM accounts_receivable WHERE company_id = ? AND status != 'RECEBIDA' ${month ? `AND strftime('%Y-%m', due_date) = ${month}` : ''} ORDER BY due_date ASC LIMIT 10`, [companyId])
  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  return { type: 'accounts_receivable_summary', period, total, rows }
}

async function getAiAccountsPayable(companyId, period) {
  const month = period === 'mes_atual' ? "strftime('%Y-%m', 'now')" : undefined
  const rows = await db.all(`SELECT id, description, amount, due_date, status FROM accounts_payable WHERE company_id = ? AND status != 'PAGA' ${month ? `AND strftime('%Y-%m', due_date) = ${month}` : ''} ORDER BY due_date ASC LIMIT 10`, [companyId])
  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  return { type: 'accounts_payable_summary', period, total, rows }
}

async function getAiProjects(companyId, query) {
  if (query === 'active_projects') {
    const rows = await db.all("SELECT id, name, code, status, progress, location FROM projects WHERE company_id = ? AND status NOT IN ('FINALIZADO', 'CANCELADO') ORDER BY start_date DESC LIMIT 10", [companyId])
    return { type: 'active_projects_summary', summary: { projectCount: rows.length }, projects: rows }
  }
  const rows = await db.all('SELECT id, name, code, status, progress, actual_cost, expected_cost FROM projects WHERE company_id = ? ORDER BY actual_cost DESC LIMIT 10', [companyId])
  return { type: 'project_costs_summary', summary: { projectCount: rows.length }, projects: rows }
}

async function getAiInventory(companyId) {
  const rows = await db.all(`SELECT i.id, p.name AS product_name, p.category, i.quantity, i.reserved_quantity, p.min_stock, p.unit, i.project_id FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.company_id = ? ORDER BY i.quantity ASC LIMIT 10`, [companyId])
  const lowStock = rows.filter((row) => Number(row.quantity) <= Number(row.min_stock || 0))
  return { type: 'stock_summary', summary: { totalItems: rows.length, lowStockCount: lowStock.length, totalQuantity: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0) }, rows }
}

async function getAiPurchases(companyId) {
  const rows = await db.all("SELECT id, number, justification, status, requested_date, needed_date FROM purchase_requests WHERE company_id = ? AND status NOT IN ('APROVADA', 'CANCELADA', 'RECEBIDA') ORDER BY created_at DESC LIMIT 10", [companyId])
  return { type: 'pending_purchases_summary', summary: { pendingCount: rows.length }, rows }
}

async function getAiEquipment(companyId) {
  const rows = await db.all("SELECT id, name, code, status, type, location FROM equipment WHERE company_id = ? AND status IN ('EM_MANUTENCAO', 'MANUTENCAO') ORDER BY updated_at DESC LIMIT 10", [companyId])
  return { type: 'equipment_maintenance_summary', summary: { inMaintenanceCount: rows.length }, rows }
}

async function getAiMaintenance(companyId) {
  const rows = await db.all("SELECT m.id, m.type, m.status, e.name AS equipment_name, m.scheduled_at FROM maintenance_records m LEFT JOIN equipment e ON e.id = m.equipment_id WHERE m.company_id = ? AND m.status IN ('AGENDADA', 'EM_ANDAMENTO') ORDER BY m.scheduled_at ASC LIMIT 10", [companyId])
  return { type: 'open_maintenance_summary', summary: { openCount: rows.length }, rows }
}

async function getAiAgenda(companyId) {
  const rows = await db.all("SELECT id, title, type, starts_at, status, location FROM field_activities WHERE company_id = ? AND status = 'AGENDADA' ORDER BY starts_at ASC LIMIT 10", [companyId])
  return { type: 'agenda_summary', summary: { agendaCount: rows.length }, rows }
}

async function getAiDocuments(companyId) {
  const rows = await db.all('SELECT id, name, category, size, created_at FROM documents WHERE company_id = ? AND archived = 0 ORDER BY created_at DESC LIMIT 10', [companyId])
  return { type: 'document_summary', summary: { documentCount: rows.length }, rows }
}

async function buildAiContext(companyId, intent) {
  const handlers = {
    dashboard_summary: () => getAiDashboardSummary(companyId),
    accounts_receivable: () => getAiAccountsReceivable(companyId, intent.period),
    accounts_payable: () => getAiAccountsPayable(companyId, intent.period),
    active_projects: () => getAiProjects(companyId, 'active_projects'),
    project_costs: () => getAiProjects(companyId, 'costs'),
    stock_summary: () => getAiInventory(companyId),
    pending_purchases: () => getAiPurchases(companyId),
    equipment_maintenance: () => getAiEquipment(companyId),
    open_maintenance: () => getAiMaintenance(companyId),
    agenda_today: () => getAiAgenda(companyId),
    document_summary: () => getAiDocuments(companyId),
  }
  const handler = handlers[intent.query]
  if (!handler) return { type: 'dashboard_summary', summary: { projectCount: 0 }, rows: [] }
  return handler()
}

async function createAiAnswer(companyId, message, request) {
  const intent = interpretAiQuestion(message)
  const context = await buildAiContext(companyId, intent)
  const provider = createAiProvider()
  const prompt = 'Você é o Nexora AI, assistente de leitura. Responda em português, de forma objetiva, usando apenas os dados do contexto. NUNCA invente números ou registros. Se não houver dados, diga que não há registros.'
  if (provider.name === 'puter') {
    return {
      provider: 'puter',
      prompt,
      context,
      companyId,
      scope: { module: intent.module, query: intent.query, period: intent.period },
      summary: { ...(context.summary || {}), ...(context.projects ? { projects: context.projects } : {}), ...(context.rows ? { rows: context.rows } : {}) },
      contextType: context.type,
    }
  }
  const result = await provider.generate({
    context,
    userMessage: message,
    systemPrompt: prompt,
  })
  const answer = result?.answer && String(result.answer).trim() ? result.answer : buildFallbackAiAnswer(intent, context)
  const summary = { ...(context.summary || {}), ...(context.projects ? { projects: context.projects } : {}), ...(context.rows ? { rows: context.rows } : {}) }
  return {
    answer,
    companyId,
    scope: { module: intent.module, query: intent.query, period: intent.period },
    summary,
    contextType: context.type,
  }
}

function buildFallbackAiAnswer(intent, context) {
  const type = context?.type || 'dashboard_summary'
  if (type === 'accounts_receivable_summary') {
    const total = Number(context.total || 0)
    return total > 0 ? `Você tem R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a receber.` : 'Não há valores a receber no período informado.'
  }
  if (type === 'accounts_payable_summary') {
    const total = Number(context.total || 0)
    return total > 0 ? `Você tem R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a pagar.` : 'Não há valores a pagar no período informado.'
  }
  if (type === 'active_projects_summary') {
    const count = Number(context.summary?.projectCount || 0)
    return count > 0 ? `Há ${count} projeto(s) ativo(s) na empresa.` : 'Não há projetos ativos no momento.'
  }
  if (type === 'stock_summary') {
    const count = Number(context.summary?.lowStockCount || 0)
    return count > 0 ? `Seu estoque tem ${count} item(ns) com baixa disponibilidade.` : 'Seu estoque está estável no momento.'
  }
  if (type === 'pending_purchases_summary') {
    const count = Number(context.summary?.pendingCount || 0)
    return count > 0 ? `Há ${count} compra(s) pendente(s).` : 'Não há compras pendentes.'
  }
  if (type === 'equipment_maintenance_summary') {
    const count = Number(context.summary?.inMaintenanceCount || 0)
    return count > 0 ? `Há ${count} equipamento(s) em manutenção.` : 'Não há equipamentos em manutenção.'
  }
  if (type === 'open_maintenance_summary') {
    const count = Number(context.summary?.openCount || 0)
    return count > 0 ? `Há ${count} manutenção(ões) aberta(s).` : 'Não há manutenções abertas.'
  }
  if (type === 'agenda_summary') {
    const count = Number(context.summary?.agendaCount || 0)
    return count > 0 ? `Há ${count} compromisso(s) agendado(s).` : 'Não há compromissos agendados.'
  }
  if (type === 'document_summary') {
    const count = Number(context.summary?.documentCount || 0)
    return count > 0 ? `Você tem ${count} documento(s) cadastrados.` : 'Não há documentos cadastrados.'
  }
  const projectCount = Number(context.summary?.projectCount || 0)
  return projectCount > 0 ? `A empresa possui ${projectCount} projeto(s) em andamento.` : 'Não há dados disponíveis para o resumo da empresa.'
}

app.post('/api/auth/register', async (request, response) => { try { const { companyName, legalName, cnpj, userName, email, password } = request.body; if (!companyName || !userName || !email || !password) return response.status(400).json({ error: 'Empresa, administrador, e-mail e senha são obrigatórios.' }); const companyId = id(); const userId = id(); const passwordHash = await bcrypt.hash(password, 12); await db.transaction(async () => { await db.run('INSERT INTO companies (id, legal_name, trade_name, cnpj, email) VALUES (?, ?, ?, ?, ?)', [companyId, legalName || companyName, companyName, cnpj || null, email]); const role = await db.get('SELECT id FROM roles WHERE name = ?', ['ADMINISTRADOR']); await db.run('INSERT INTO users (id, company_id, name, email, password_hash, job_title) VALUES (?, ?, ?, ?, ?, ?)', [userId, companyId, userName, email.toLowerCase(), passwordHash, 'Administrador']); await db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id]); await db.run('INSERT INTO subscriptions (id, company_id, plan) VALUES (?, ?, ?)', [id(), companyId, 'PROFISSIONAL']) }); const user = await db.get('SELECT u.*, r.name AS role FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.id = ?', [userId]); response.status(201).json({ token: tokenFor(user), user: cleanUser(user, ['*.*']), company: { id: companyId, name: companyName } }) } catch (error) { if (error.message.includes('UNIQUE')) return response.status(409).json({ error: 'Este e-mail já está cadastrado.' }); errorResponse(response, error) } })
app.post('/api/auth/login', async (request, response) => { try { const user = await db.get('SELECT u.*, r.name AS role FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id WHERE u.email = ? AND u.status = ?', [String(request.body.email || '').toLowerCase(), 'ATIVO']); if (!user || !(await bcrypt.compare(request.body.password || '', user.password_hash))) return response.status(401).json({ error: 'E-mail ou senha inválidos.' }); user.permissions = await permissionsFor(user); const company = await db.get('SELECT id, trade_name AS name FROM companies WHERE id = ?', [user.company_id]); await audit(user, 'LOGIN', 'AUTH', user.id); response.json({ token: tokenFor(user), user: cleanUser(user), company }) } catch (error) { errorResponse(response, error) } })
app.post('/api/auth/change-password', auth, async (request, response) => { try { const passwordHash = await bcrypt.hash(request.body.password, 12); await db.run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [passwordHash, request.user.id, request.user.company_id]); response.json({ ok: true }) } catch (error) { errorResponse(response, error) } })

app.get('/api/dashboard', auth, async (request, response) => { try { const companyId = request.user.company_id; const [projects, field, payable, receivable, stock, maintenance, purchases, documents, transactions] = await Promise.all([db.get("SELECT COUNT(*) AS total FROM projects WHERE company_id = ? AND status NOT IN ('FINALIZADO', 'CANCELADO')", [companyId]), db.get("SELECT COUNT(*) AS total FROM field_activities WHERE company_id = ? AND status = 'AGENDADA'", [companyId]), db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM accounts_payable WHERE company_id = ? AND status = 'PENDENTE'", [companyId]), db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM accounts_receivable WHERE company_id = ? AND status = 'PENDENTE'", [companyId]), db.get('SELECT COALESCE(SUM(quantity), 0) AS total, COALESCE(SUM(reserved_quantity), 0) AS reserved FROM inventory WHERE company_id = ?', [companyId]), db.get("SELECT COUNT(*) AS total FROM maintenance_records WHERE company_id = ? AND status IN ('AGENDADA', 'EM_ANDAMENTO')", [companyId]), db.get("SELECT COUNT(*) AS total FROM purchase_requests WHERE company_id = ? AND status NOT IN ('APROVADA', 'CANCELADA')", [companyId]), db.get('SELECT COUNT(*) AS total FROM documents WHERE company_id = ? AND archived = 0', [companyId]), db.get("SELECT COALESCE(SUM(CASE WHEN type = 'ENTRADA' THEN amount ELSE 0 END), 0) AS income, COALESCE(SUM(CASE WHEN type = 'SAIDA' THEN amount ELSE 0 END), 0) AS expense FROM financial_transactions WHERE company_id = ? AND status = 'CONFIRMADA'", [companyId])]); response.json({ stats: [{ label: 'Projetos em andamento', value: String(projects.total), detail: 'Dados atualizados agora', tone: 'blue', icon: 'Factory' }, { label: 'Obras em campo', value: String(field.total), detail: 'Atividades agendadas', tone: 'orange', icon: 'Truck' }, { label: 'Estoque comprometido', value: `${stock.total ? Math.round((stock.reserved / stock.total) * 100) : 0}%`, detail: 'Reservas reais', tone: 'green', icon: 'Warehouse' }, { label: 'A receber', value: `R$ ${Number(receivable.total).toLocaleString('pt-BR')}`, detail: 'Contas pendentes', tone: 'purple', icon: 'ClipboardList' }], financial: { payable: payable.total, receivable: receivable.total, income: transactions.income, expense: transactions.expense, result: transactions.income - transactions.expense }, operational: { openMaintenance: maintenance.total, pendingPurchases: purchases.total, documents: documents.total }, companyId }) } catch (error) { errorResponse(response, error) } })
app.get('/api/projects', auth, async (request, response) => { try { const pagination = paginationFor(request); const params = [request.user.company_id]; const where = ['company_id = ?']; if (request.query.search) { where.push('(name LIKE ? OR code LIKE ? OR location LIKE ?)'); const term = `%${request.query.search}%`; params.push(term, term, term) } if (request.query.status) { where.push('status = ?'); params.push(request.query.status) } if (request.query.from) { where.push('date(start_date) >= date(?)'); params.push(request.query.from) } if (request.query.to) { where.push('date(end_date) <= date(?)'); params.push(request.query.to) } const { field, direction } = sortFor(request, ['name', 'code', 'status', 'start_date', 'end_date', 'created_at']); const count = await db.get(`SELECT COUNT(*) AS total FROM projects WHERE ${where.join(' AND ')}`, params); const rows = await db.all(`SELECT id, code, name, contractor_document AS contractorDocument, location, start_date AS startDate, end_date AS endDate, progress, status, CASE WHEN end_date IS NULL THEN 'A definir' ELSE strftime('%d/%m/%Y', end_date) END AS due, CASE status WHEN 'EM_EXECUCAO' THEN 'blue' WHEN 'EM_MONTAGEM' THEN 'orange' ELSE 'green' END AS tone FROM projects WHERE ${where.join(' AND ')} ORDER BY ${field} ${direction} LIMIT ? OFFSET ?`, [...params, pagination.pageSize, pagination.offset]); response.json(pagination.requested ? { data: rows, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: count.total, totalPages: Math.ceil(count.total / pagination.pageSize) } } : rows) } catch (error) { errorResponse(response, error) } })
app.post('/api/projects', auth, requireRole('ADMINISTRADOR', 'DIRETOR', 'GERENTE', 'SUPERVISOR'), async (request, response) => { try { const body = request.body; if (!body.name) return response.status(400).json({ error: 'Nome da obra é obrigatório.' }); const project = { id: id(), code: body.code || `NX-${Date.now().toString().slice(-4)}`, name: body.name, contractorDocument: body.contractorDocument || null, location: body.location || null, startDate: body.startDate || null, endDate: body.endDate || null, progress: Number(body.progress || 0), status: body.status || 'PLANEJAMENTO' }; await db.run('INSERT INTO projects (id, company_id, code, name, contractor_document, location, start_date, end_date, progress, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [project.id, request.user.company_id, project.code, project.name, project.contractorDocument, project.location, project.startDate, project.endDate, project.progress, project.status]); await audit(request.user, 'CRIAR', 'PROJETOS', project.id, null, project); response.status(201).json(project) } catch (error) { errorResponse(response, error) } })
app.put('/api/projects/:id', auth, requireRole('ADMINISTRADOR', 'DIRETOR', 'GERENTE', 'SUPERVISOR'), async (request, response) => { try { const previous = await db.get('SELECT * FROM projects WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id]); if (!previous) return response.status(404).json({ error: 'Projeto não encontrado.' }); const next = { ...previous, ...request.body }; await db.run('UPDATE projects SET name = ?, contractor_document = ?, location = ?, start_date = ?, end_date = ?, progress = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [next.name, next.contractorDocument, next.location, next.startDate, next.endDate, next.progress, next.status, previous.id, request.user.company_id]); await audit(request.user, 'EDITAR', 'PROJETOS', previous.id, previous, next); response.json(next) } catch (error) { errorResponse(response, error) } })
app.get('/api/clients', auth, async (request, response) => { try { const pagination = paginationFor(request); const params = [request.user.company_id]; const where = ['company_id = ?', 'archived = 0']; if (request.query.search) { where.push('(legal_name LIKE ? OR trade_name LIKE ? OR document LIKE ? OR city LIKE ?)'); const term = `%${request.query.search}%`; params.push(term, term, term, term) } if (request.query.document) { where.push('document LIKE ?'); params.push(`%${request.query.document}%`) } if (request.query.city) { where.push('city = ?'); params.push(request.query.city) } const { field, direction } = sortFor(request, ['legal_name', 'trade_name', 'city', 'created_at']); const count = await db.get(`SELECT COUNT(*) AS total FROM clients WHERE ${where.join(' AND ')}`, params); const rows = await db.all(`SELECT * FROM clients WHERE ${where.join(' AND ')} ORDER BY ${field} ${direction} LIMIT ? OFFSET ?`, [...params, pagination.pageSize, pagination.offset]); response.json(pagination.requested ? { data: rows, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: count.total, totalPages: Math.ceil(count.total / pagination.pageSize) } } : rows) } catch (error) { errorResponse(response, error) } })
app.post('/api/clients', auth, requireRole('ADMINISTRADOR', 'DIRETOR', 'GERENTE', 'COMERCIAL'), async (request, response) => { try { const client = { id: id(), ...request.body }; if (!client.legal_name) return response.status(400).json({ error: 'Razão social é obrigatória.' }); await db.run('INSERT INTO clients (id, company_id, legal_name, trade_name, document, email, phone, address, city, state, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [client.id, request.user.company_id, client.legal_name, client.trade_name, client.document, client.email, client.phone, client.address, client.city, client.state, client.notes]); await audit(request.user, 'CRIAR', 'CLIENTES', client.id, null, client); response.status(201).json(client) } catch (error) { errorResponse(response, error) } })
app.put('/api/clients/:id', auth, requireRole('ADMINISTRADOR', 'DIRETOR', 'GERENTE', 'COMERCIAL'), async (request, response) => { try { const previous = await db.get('SELECT * FROM clients WHERE id = ? AND company_id = ? AND archived = 0', [request.params.id, request.user.company_id]); if (!previous) return response.status(404).json({ error: 'Cliente não encontrado.' }); const next = { ...previous, ...request.body }; await db.run('UPDATE clients SET legal_name = ?, trade_name = ?, document = ?, email = ?, phone = ?, address = ?, city = ?, state = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [next.legal_name, next.trade_name, next.document, next.email, next.phone, next.address, next.city, next.state, next.notes, previous.id, request.user.company_id]); const updated = await db.get('SELECT * FROM clients WHERE id = ? AND company_id = ?', [previous.id, request.user.company_id]); await audit(request.user, 'EDITAR', 'CLIENTES', previous.id, previous, updated); response.json(updated) } catch (error) { errorResponse(response, error) } })
app.post('/api/clients/:id/archive', auth, requireRole('ADMINISTRADOR', 'DIRETOR', 'GERENTE', 'COMERCIAL'), async (request, response) => { try { const previous = await db.get('SELECT * FROM clients WHERE id = ? AND company_id = ? AND archived = 0', [request.params.id, request.user.company_id]); if (!previous) return response.status(404).json({ error: 'Cliente não encontrado.' }); await db.run('UPDATE clients SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [previous.id, request.user.company_id]); await audit(request.user, 'ARQUIVAR', 'CLIENTES', previous.id, previous, { ...previous, archived: 1 }); response.json({ ok: true }) } catch (error) { errorResponse(response, error) } })
app.delete('/api/clients/:id', auth, requireRole('ADMINISTRADOR'), async (request, response) => { try { const previous = await db.get('SELECT * FROM clients WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id]); if (!previous) return response.status(404).json({ error: 'Cliente não encontrado.' }); await db.run('DELETE FROM clients WHERE id = ? AND company_id = ?', [previous.id, request.user.company_id]); await audit(request.user, 'EXCLUIR', 'CLIENTES', previous.id, previous, null); response.status(204).end() } catch (error) { errorResponse(response, error) } })
app.get('/api/audit-logs', auth, async (request, response) => { try { const pagination = paginationFor(request); const params = [request.user.company_id]; const where = ['a.company_id = ?']; if (request.query.module) { where.push('a.module = ?'); params.push(request.query.module) } if (request.query.action) { where.push('a.action = ?'); params.push(request.query.action) } if (request.query.recordId) { where.push('a.record_id = ?'); params.push(request.query.recordId) } if (request.query.from) { where.push('date(a.created_at) >= date(?)'); params.push(request.query.from) } if (request.query.to) { where.push('date(a.created_at) <= date(?)'); params.push(request.query.to) } const count = await db.get(`SELECT COUNT(*) AS total FROM audit_logs a WHERE ${where.join(' AND ')}`, params); const rows = await db.all(`SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id AND u.company_id = a.company_id WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, [...params, pagination.pageSize, pagination.offset]); response.json(pagination.requested || Object.keys(request.query).length ? { data: rows, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: count.total, totalPages: Math.ceil(count.total / pagination.pageSize) } } : rows) } catch (error) { errorResponse(response, error) } })
app.get('/api/audit-logs/by-entity/:recordId', auth, async (request, response) => { try { const params = [request.user.company_id, request.params.recordId]; const where = ['a.company_id = ?', 'a.record_id = ?']; if (request.query.module) { where.push('a.module = ?'); params.push(request.query.module) } const rows = await db.all(`SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id AND u.company_id = a.company_id WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC`, params); response.json(rows) } catch (error) { errorResponse(response, error) } })
app.get('/api/global-search', auth, async (request, response) => { try { const term = `%${String(request.query.q || '')}%`; const companyId = request.user.company_id; const [projects, clients, products, suppliers, equipment, documents, activities, payables] = await Promise.all([db.all('SELECT id, name, code, "Projetos" AS category FROM projects WHERE company_id = ? AND (name LIKE ? OR code LIKE ?) LIMIT 10', [companyId, term, term]), db.all('SELECT id, legal_name AS name, "Clientes" AS category FROM clients WHERE company_id = ? AND (legal_name LIKE ? OR trade_name LIKE ?) LIMIT 10', [companyId, term, term]), db.all('SELECT id, name, "Produtos" AS category FROM products WHERE company_id = ? AND name LIKE ? LIMIT 10', [companyId, term]), db.all('SELECT id, legal_name AS name, "Fornecedores" AS category FROM suppliers WHERE company_id = ? AND (legal_name LIKE ? OR trade_name LIKE ?) LIMIT 10', [companyId, term, term]), db.all('SELECT id, name, code, "Equipamentos" AS category FROM equipment WHERE company_id = ? AND (name LIKE ? OR code LIKE ?) LIMIT 10', [companyId, term, term]), db.all('SELECT id, name, "Documentos" AS category FROM documents WHERE company_id = ? AND archived = 0 AND name LIKE ? LIMIT 10', [companyId, term]), db.all('SELECT id, title AS name, "Agenda" AS category FROM field_activities WHERE company_id = ? AND title LIKE ? LIMIT 10', [companyId, term]), db.all('SELECT id, description AS name, "Financeiro" AS category FROM accounts_payable WHERE company_id = ? AND description LIKE ? LIMIT 10', [companyId, term])]); response.json([...projects, ...clients, ...products, ...suppliers, ...equipment, ...documents, ...activities, ...payables]) } catch (error) { errorResponse(response, error) } })

app.post('/api/documents/upload', auth, upload.single('file'), async (request, response) => { try { if (!request.file) return response.status(400).json({ error: 'Arquivo inválido ou ausente.' }); const document = { id: id(), name: request.body.name || request.file.originalname, category: request.body.category || 'Outros', path: request.file.path, size: request.file.size, mimeType: request.file.mimetype, relatedEntity: request.body.related_entity || null, relatedId: request.body.related_id || null }; await db.run('INSERT INTO documents (id, company_id, name, category, path, size, mime_type, uploaded_by, related_entity, related_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [document.id, request.user.company_id, document.name, document.category, document.path, document.size, document.mimeType, request.user.id, document.relatedEntity, document.relatedId]); await audit(request.user, 'UPLOAD', 'DOCUMENTOS', document.id, null, document); response.status(201).json({ ...document, downloadUrl: `/api/documents/${document.id}/download` }) } catch (error) { errorResponse(response, error) } })
app.get('/api/documents/:id/download', auth, async (request, response) => { try { const document = await db.get('SELECT * FROM documents WHERE id = ? AND company_id = ? AND archived = 0', [request.params.id, request.user.company_id]); if (!document || !fs.existsSync(document.path)) return response.status(404).json({ error: 'Documento não encontrado.' }); await audit(request.user, 'DOWNLOAD', 'DOCUMENTOS', document.id); response.download(document.path, document.name) } catch (error) { errorResponse(response, error) } })
app.post('/api/documents/:id/archive', auth, requireRole('ADMINISTRADOR', 'DIRETOR', 'GERENTE'), async (request, response) => { try { const document = await db.get('SELECT * FROM documents WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id]); if (!document) return response.status(404).json({ error: 'Documento não encontrado.' }); await db.run('UPDATE documents SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [document.id, request.user.company_id]); await audit(request.user, 'ARQUIVAR', 'DOCUMENTOS', document.id, document, { ...document, archived: 1 }); response.json({ ok: true }) } catch (error) { errorResponse(response, error) } })

app.get('/api/dashboard/overview', auth, async (request, response) => {
  try {
    const companyId = request.user.company_id
    const canViewFinance = request.user.role === 'ADMINISTRADOR' || (request.user.permissions || []).includes('*.*') || (request.user.permissions || []).includes('finance.view')
    const [projects, field, stock, maintenance, purchases, documents, tasks, overdueProjects, upcomingActivities, criticalStock, pendingPurchases, upcomingMaintenance, recentDocuments] = await Promise.all([
      db.get("SELECT COUNT(*) AS total FROM projects WHERE company_id = ? AND status NOT IN ('FINALIZADO', 'CANCELADO')", [companyId]),
      db.get("SELECT COUNT(*) AS total FROM field_activities WHERE company_id = ? AND status = 'AGENDADA'", [companyId]),
      db.get('SELECT COALESCE(SUM(quantity), 0) AS total, COALESCE(SUM(reserved_quantity), 0) AS reserved FROM inventory WHERE company_id = ?', [companyId]),
      db.get("SELECT COUNT(*) AS total FROM maintenance_records WHERE company_id = ? AND status IN ('AGENDADA', 'EM_ANDAMENTO')", [companyId]),
      db.get("SELECT COUNT(*) AS total FROM purchase_requests WHERE company_id = ? AND status NOT IN ('APROVADA', 'CANCELADA', 'RECEBIDA')", [companyId]),
      db.get('SELECT COUNT(*) AS total FROM documents WHERE company_id = ? AND archived = 0', [companyId]),
      db.get("SELECT COUNT(*) AS total FROM tasks WHERE company_id = ? AND status NOT IN ('CONCLUIDA', 'CANCELADA')", [companyId]),
      db.get("SELECT COUNT(*) AS total FROM projects WHERE company_id = ? AND status NOT IN ('FINALIZADO', 'CANCELADO') AND end_date IS NOT NULL AND date(end_date) < date('now')", [companyId]),
      db.all("SELECT id, title, type, starts_at, status FROM field_activities WHERE company_id = ? AND status = 'AGENDADA' AND starts_at IS NOT NULL AND datetime(starts_at) >= datetime('now') ORDER BY starts_at ASC LIMIT 5", [companyId]),
      db.all('SELECT i.id, p.name AS product_name, i.quantity, p.min_stock, p.unit FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.company_id = ? AND i.quantity <= p.min_stock ORDER BY i.quantity ASC LIMIT 5', [companyId]),
      db.all("SELECT id, number, justification, status, needed_date FROM purchase_requests WHERE company_id = ? AND status NOT IN ('APROVADA', 'CANCELADA', 'RECEBIDA') ORDER BY needed_date ASC LIMIT 5", [companyId]),
      db.all("SELECT m.id, m.type, m.status, m.scheduled_at, e.name AS equipment_name FROM maintenance_records m JOIN equipment e ON e.id = m.equipment_id WHERE m.company_id = ? AND m.status IN ('AGENDADA', 'EM_ANDAMENTO') ORDER BY m.scheduled_at ASC LIMIT 5", [companyId]),
      db.all('SELECT id, name, category, size, created_at FROM documents WHERE company_id = ? AND archived = 0 ORDER BY created_at DESC LIMIT 5', [companyId]),
    ])
    const result = {
      companyId,
      stats: [
        { label: 'Projetos em andamento', value: String(projects.total), detail: 'Dados reais da empresa', tone: 'blue', icon: 'Factory' },
        { label: 'Obras em campo', value: String(field.total), detail: 'Atividades agendadas', tone: 'orange', icon: 'Truck' },
        { label: 'Estoque comprometido', value: `${stock.total ? Math.round((stock.reserved / stock.total) * 100) : 0}%`, detail: 'Reservas reais', tone: 'green', icon: 'Warehouse' },
        { label: 'Manutenções abertas', value: String(maintenance.total), detail: 'Equipamentos acompanhados', tone: 'amber', icon: 'Wrench' },
      ],
      operational: { activeProjects: Number(projects.total || 0), overdueProjects: Number(overdueProjects.total || 0), pendingPurchases: Number(purchases.total || 0), pendingTasks: Number(tasks.total || 0), openMaintenance: Number(maintenance.total || 0), activeDocuments: Number(documents.total || 0), upcomingActivities, criticalStock, pendingPurchases, upcomingMaintenance, recentDocuments },
    }
    if (canViewFinance) {
      const [payable, receivable, transactions] = await Promise.all([
        db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM accounts_payable WHERE company_id = ? AND status = 'PENDENTE'", [companyId]),
        db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM accounts_receivable WHERE company_id = ? AND status = 'PENDENTE'", [companyId]),
        db.get("SELECT COALESCE(SUM(CASE WHEN type = 'ENTRADA' THEN amount ELSE 0 END), 0) AS income, COALESCE(SUM(CASE WHEN type = 'SAIDA' THEN amount ELSE 0 END), 0) AS expense FROM financial_transactions WHERE company_id = ? AND status = 'CONFIRMADA'", [companyId]),
      ])
      result.financial = { payable: Number(payable.total || 0), receivable: Number(receivable.total || 0), projectedBalance: Number(receivable.total || 0) - Number(payable.total || 0), income: Number(transactions.income || 0), expense: Number(transactions.expense || 0) }
    }
    response.json(result)
  } catch (error) { errorResponse(response, error) }
})

app.get('/api/tasks', auth, requirePermission('tasks', 'view'), async (request, response) => {
  try {
    const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(request.query.pageSize, 10) || 20))
    const params = [request.user.company_id]
    const where = ['t.company_id = ?', 't.archived = 0']
    if (request.query.search) { const term = `%${request.query.search}%`; where.push('(t.title LIKE ? OR t.description LIKE ? OR t.responsible LIKE ?)'); params.push(term, term, term) }
    if (request.query.status) { where.push('t.status = ?'); params.push(request.query.status) }
    if (request.query.priority) { where.push('t.priority = ?'); params.push(request.query.priority) }
    if (request.query.project_id) { where.push('t.project_id = ?'); params.push(request.query.project_id) }
    if (request.query.responsible) { where.push('t.responsible = ?'); params.push(request.query.responsible) }
    if (request.query.from) { where.push('date(t.due_date) >= date(?)'); params.push(request.query.from) }
    if (request.query.to) { where.push('date(t.due_date) <= date(?)'); params.push(request.query.to) }
    const sortFields = ['title', 'status', 'priority', 'due_date', 'created_at', 'updated_at']
    const sort = sortFields.includes(request.query.sort) ? request.query.sort : 'created_at'
    const direction = request.query.direction === 'asc' ? 'ASC' : 'DESC'
    const count = await db.get(`SELECT COUNT(*) AS total FROM tasks t WHERE ${where.join(' AND ')}`, params)
    const rows = await db.all(`SELECT t.*, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id WHERE ${where.join(' AND ')} ORDER BY t.${sort} ${direction} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize])
    response.json({ data: rows, pagination: { page, pageSize, total: count.total, totalPages: Math.ceil(count.total / pageSize) } })
  } catch (error) { errorResponse(response, error) }
})
app.get('/api/tasks/:id', auth, requirePermission('tasks', 'view'), async (request, response) => { try { const task = await db.get('SELECT t.*, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id WHERE t.id = ? AND t.company_id = ?', [request.params.id, request.user.company_id]); if (!task) return response.status(404).json({ error: 'Tarefa não encontrada.' }); response.json(task) } catch (error) { errorResponse(response, error) } })
app.post('/api/tasks', auth, requirePermission('tasks', 'create'), async (request, response) => { try { const body = request.body || {}; if (!body.title) return response.status(400).json({ error: 'Título da tarefa é obrigatório.' }); const task = { id: id(), project_id: body.project_id || null, title: body.title, responsible: body.responsible || null, due_date: body.due_date || null, status: body.status || 'PENDENTE', priority: body.priority || 'MEDIA', description: body.description || null, archived: 0 }; await db.run('INSERT INTO tasks (id, company_id, project_id, title, responsible, due_date, status, priority, description, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [task.id, request.user.company_id, task.project_id, task.title, task.responsible, task.due_date, task.status, task.priority, task.description, task.archived]); const created = await db.get('SELECT * FROM tasks WHERE id = ? AND company_id = ?', [task.id, request.user.company_id]); await audit(request.user, 'CRIAR', 'TAREFAS', task.id, null, created); response.status(201).json(created) } catch (error) { errorResponse(response, error) } })
app.put('/api/tasks/:id', auth, requirePermission('tasks', 'edit'), async (request, response) => { try { const previous = await db.get('SELECT * FROM tasks WHERE id = ? AND company_id = ? AND archived = 0', [request.params.id, request.user.company_id]); if (!previous) return response.status(404).json({ error: 'Tarefa não encontrada.' }); const next = { ...previous, ...request.body }; await db.run('UPDATE tasks SET project_id = ?, title = ?, responsible = ?, due_date = ?, status = ?, priority = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [next.project_id || null, next.title, next.responsible || null, next.due_date || null, next.status, next.priority, next.description || null, request.params.id, request.user.company_id]); const updated = await db.get('SELECT * FROM tasks WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id]); await audit(request.user, 'EDITAR', 'TAREFAS', request.params.id, previous, updated); response.json(updated) } catch (error) { errorResponse(response, error) } })
app.patch('/api/tasks/:id/status', auth, requirePermission('tasks', 'edit'), async (request, response) => { try { const status = request.body?.status; if (!['PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'].includes(status)) return response.status(400).json({ error: 'Status inválido.' }); const previous = await db.get('SELECT * FROM tasks WHERE id = ? AND company_id = ? AND archived = 0', [request.params.id, request.user.company_id]); if (!previous) return response.status(404).json({ error: 'Tarefa não encontrada.' }); await db.run('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, request.params.id, request.user.company_id]); const updated = { ...previous, status }; await audit(request.user, status === 'CONCLUIDA' ? 'CONCLUIR' : status === 'PENDENTE' && previous.status === 'CONCLUIDA' ? 'REABRIR' : 'ALTERAR_STATUS', 'TAREFAS', request.params.id, previous, updated); response.json(updated) } catch (error) { errorResponse(response, error) } })
app.post('/api/tasks/:id/archive', auth, requirePermission('tasks', 'archive'), async (request, response) => { try { const previous = await db.get('SELECT * FROM tasks WHERE id = ? AND company_id = ? AND archived = 0', [request.params.id, request.user.company_id]); if (!previous) return response.status(404).json({ error: 'Tarefa não encontrada.' }); await db.run('UPDATE tasks SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id]); await audit(request.user, 'ARQUIVAR', 'TAREFAS', request.params.id, previous, { ...previous, archived: 1 }); response.json({ ok: true }) } catch (error) { errorResponse(response, error) } })
app.delete('/api/tasks/:id', auth, requirePermission('tasks', 'delete'), async (request, response) => { try { const previous = await db.get('SELECT * FROM tasks WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id]); if (!previous) return response.status(404).json({ error: 'Tarefa não encontrada.' }); await db.run('DELETE FROM tasks WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id]); await audit(request.user, 'EXCLUIR', 'TAREFAS', request.params.id, previous, null); response.status(204).end() } catch (error) { errorResponse(response, error) } })

app.get('/api/projects/:id/overview', auth, requirePermission('projects', 'view'), async (request, response) => {
  try {
    const companyId = request.user.company_id
    const project = await db.get('SELECT p.*, c.legal_name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id AND c.company_id = p.company_id WHERE p.id = ? AND p.company_id = ?', [request.params.id, companyId])
    if (!project) return response.status(404).json({ error: 'Projeto não encontrado.' })
    const [tasks, documents, payables, receivables, audit] = await Promise.all([
      db.all('SELECT * FROM tasks WHERE project_id = ? AND company_id = ? AND archived = 0 ORDER BY due_date ASC, created_at DESC', [project.id, companyId]),
      db.all("SELECT id, name, category, size, mime_type, created_at, uploaded_by FROM documents WHERE related_id = ? AND company_id = ? AND archived = 0 ORDER BY created_at DESC", [project.id, companyId]),
      request.user.role === 'ADMINISTRADOR' || (request.user.permissions || []).includes('*.*') || (request.user.permissions || []).includes('finance.view') ? db.all('SELECT id, description, amount, due_date, status FROM accounts_payable WHERE project_id = ? AND company_id = ? ORDER BY due_date ASC', [project.id, companyId]) : Promise.resolve([]),
      request.user.role === 'ADMINISTRADOR' || (request.user.permissions || []).includes('*.*') || (request.user.permissions || []).includes('finance.view') ? db.all('SELECT id, description, amount, due_date, status FROM accounts_receivable WHERE project_id = ? AND company_id = ? ORDER BY due_date ASC', [project.id, companyId]) : Promise.resolve([]),
      db.all('SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id AND u.company_id = a.company_id WHERE a.record_id = ? AND a.company_id = ? ORDER BY a.created_at DESC', [project.id, companyId]),
    ])
    response.json({ project, tasks, documents, financial: { payables, receivables }, audit })
  } catch (error) { errorResponse(response, error) }
})

app.post('/api/ai/chat', auth, async (request, response) => {
  try {
    const content = sanitizeAiMessage(request.body?.message)
    if (!content.ok) return response.status(content.status).json({ error: content.error })

    const intent = interpretAiQuestion(content.text)
    const permission = aiModuleMap[intent.module] || ['dashboard', 'view']
    const explicitPermission = `${permission[0]}.${permission[1]}`
    const isAdmin = request.user.role === 'ADMINISTRADOR'
    const hasWildcard = (request.user.permissions || []).includes('*.*')
    const hasPermission = (request.user.permissions || []).includes(explicitPermission)
    const isConsultOnlyFinance = request.user.role === 'CONSULTA' && intent.module === 'finance'
    const allowed = isAdmin || hasWildcard || hasPermission
    if (!allowed || isConsultOnlyFinance) return response.status(403).json({ error: `Você não possui permissão para consultar informações ${intent.module === 'finance' ? 'financeiras' : 'deste módulo'}.` })

    const result = await createAiAnswer(request.user.company_id, content.text, request)
    await db.run('INSERT INTO audit_logs (id, company_id, user_id, action, module, record_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id(), request.user.company_id, request.user.id, 'CONSULTAR', 'AI', null, null, JSON.stringify({ question: content.text.slice(0, 255), intent: intent.query })])
    response.json(result)
  } catch (error) {
    console.error('Nexora AI error:', error)
    response.json({ answer: 'Não foi possível consultar o Nexora AI agora.', companyId: request.user?.company_id, scope: { module: 'dashboard', query: 'dashboard_summary', period: 'geral' }, summary: {}, contextType: 'error' })
  }
})

app.get('/api/users', auth, requireAdministrator, async (request, response) => {
  try {
    const search = `%${String(request.query.search || '').trim()}%`
    const users = await db.all(`SELECT u.id, u.name, u.email, u.phone, u.job_title, u.status, u.created_at, u.updated_at, r.id AS role_id, r.name AS role_name FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id WHERE u.company_id = ? AND (u.name LIKE ? OR u.email LIKE ?) ORDER BY u.created_at DESC`, [request.user.company_id, search, search])
    response.json(users)
  } catch (error) { errorResponse(response, error) }
})

app.post('/api/users', auth, requireAdministrator, async (request, response) => {
  try {
    const { name, email, password, phone, job_title: jobTitle, role_id: roleId } = request.body || {}
    if (!name || !email || !password || !roleId) return response.status(400).json({ error: 'Nome, e-mail, senha e perfil são obrigatórios.' })
    const role = await db.get('SELECT id, name FROM roles WHERE id = ?', [roleId])
    if (!role) return response.status(400).json({ error: 'Perfil inválido.' })
    const userId = id()
    const passwordHash = await bcrypt.hash(String(password), 12)
    await db.transaction(async () => {
      await db.run('INSERT INTO users (id, company_id, name, email, password_hash, phone, job_title) VALUES (?, ?, ?, ?, ?, ?, ?)', [userId, request.user.company_id, name, String(email).toLowerCase(), passwordHash, phone || null, jobTitle || null])
      await db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id])
    })
    const created = await db.get('SELECT u.id, u.name, u.email, u.phone, u.job_title, u.status, u.created_at, u.updated_at, r.id AS role_id, r.name AS role_name FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.id = ? AND u.company_id = ?', [userId, request.user.company_id])
    await audit(request.user, 'CRIAR', 'USUARIOS', userId, null, created)
    response.status(201).json(created)
  } catch (error) { if (error.message.includes('UNIQUE')) return response.status(409).json({ error: 'Este e-mail já está cadastrado nesta empresa.' }); errorResponse(response, error) }
})

app.put('/api/users/:id', auth, requireAdministrator, async (request, response) => {
  try {
    const previous = await db.get('SELECT u.id, u.name, u.email, u.phone, u.job_title, u.status, u.created_at, u.updated_at, r.id AS role_id, r.name AS role_name FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id WHERE u.id = ? AND u.company_id = ?', [request.params.id, request.user.company_id])
    if (!previous) return response.status(404).json({ error: 'Usuário não encontrado.' })
    const { name, email, phone, job_title: jobTitle, role_id: roleId } = request.body || {}
    const role = await db.get('SELECT id, name FROM roles WHERE id = ?', [roleId])
    if (!name || !email || !role) return response.status(400).json({ error: 'Nome, e-mail e perfil válido são obrigatórios.' })
    await db.transaction(async () => {
      await db.run('UPDATE users SET name = ?, email = ?, phone = ?, job_title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [name, String(email).toLowerCase(), phone || null, jobTitle || null, request.params.id, request.user.company_id])
      await db.run('DELETE FROM user_roles WHERE user_id = ?', [request.params.id])
      await db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [request.params.id, role.id])
    })
    const updated = await db.get('SELECT u.id, u.name, u.email, u.phone, u.job_title, u.status, u.created_at, u.updated_at, r.id AS role_id, r.name AS role_name FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.id = ? AND u.company_id = ?', [request.params.id, request.user.company_id])
    await audit(request.user, 'EDITAR', 'USUARIOS', request.params.id, previous, updated)
    response.json(updated)
  } catch (error) { if (error.message.includes('UNIQUE')) return response.status(409).json({ error: 'Este e-mail já está cadastrado nesta empresa.' }); errorResponse(response, error) }
})

app.patch('/api/users/:id/status', auth, requireAdministrator, async (request, response) => {
  try {
    if (request.params.id === request.user.id) return response.status(400).json({ error: 'Não é possível alterar o próprio status.' })
    const status = request.body?.status
    if (!['ATIVO', 'INATIVO'].includes(status)) return response.status(400).json({ error: 'Status inválido.' })
    const previous = await db.get('SELECT id, name, email, status FROM users WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id])
    if (!previous) return response.status(404).json({ error: 'Usuário não encontrado.' })
    await db.run('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, request.params.id, request.user.company_id])
    const updated = { ...previous, status }
    await audit(request.user, 'STATUS', 'USUARIOS', request.params.id, previous, updated)
    response.json(updated)
  } catch (error) { errorResponse(response, error) }
})

app.post('/api/users/:id/reset-password', auth, requireAdministrator, async (request, response) => {
  try {
    const password = String(request.body?.password || '')
    if (password.length < 8) return response.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' })
    const user = await db.get('SELECT id, name, email FROM users WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id])
    if (!user) return response.status(404).json({ error: 'Usuário não encontrado.' })
    await db.run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [await bcrypt.hash(password, 12), request.params.id, request.user.company_id])
    await audit(request.user, 'REDEFINIR_SENHA', 'USUARIOS', request.params.id, { id: user.id, email: user.email }, { id: user.id, email: user.email })
    response.json({ ok: true })
  } catch (error) { errorResponse(response, error) }
})

app.get('/api/roles', auth, requireAdministrator, async (_request, response) => { try { response.json(await db.all('SELECT id, name, created_at FROM roles ORDER BY CASE name WHEN \'ADMINISTRADOR\' THEN 0 ELSE 1 END, name')) } catch (error) { errorResponse(response, error) } })
app.get('/api/permissions', auth, requireAdministrator, async (_request, response) => { try { response.json(await db.all('SELECT id, module, action FROM permissions ORDER BY module, action')) } catch (error) { errorResponse(response, error) } })
app.get('/api/roles/:id/permissions', auth, requireAdministrator, async (request, response) => { try { const role = await db.get('SELECT id, name FROM roles WHERE id = ?', [request.params.id]); if (!role) return response.status(404).json({ error: 'Perfil não encontrado.' }); response.json({ role, permissions: await db.all('SELECT p.id, p.module, p.action FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? ORDER BY p.module, p.action', [role.id]) }) } catch (error) { errorResponse(response, error) } })
app.put('/api/roles/:id/permissions', auth, requireAdministrator, async (request, response) => { try { const role = await db.get('SELECT id, name FROM roles WHERE id = ?', [request.params.id]); if (!role) return response.status(404).json({ error: 'Perfil não encontrado.' }); const permissionIds = Array.isArray(request.body?.permission_ids) ? request.body.permission_ids : []; const allowed = await db.all(`SELECT id FROM permissions WHERE id IN (${permissionIds.map(() => '?').join(',') || "''"})`, permissionIds); const nextIds = allowed.map((permission) => permission.id); const previous = await db.all('SELECT permission_id FROM role_permissions WHERE role_id = ? ORDER BY permission_id', [role.id]); await db.transaction(async () => { await db.run('DELETE FROM role_permissions WHERE role_id = ?', [role.id]); for (const permissionId of nextIds) await db.run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [role.id, permissionId]) }); await audit(request.user, 'EDITAR_PERMISSOES', 'PERFIS', role.id, { permission_ids: previous.map((item) => item.permission_id) }, { permission_ids: nextIds }); response.json({ role, permission_ids: nextIds }) } catch (error) { errorResponse(response, error) } })
app.get('/api/users/:id/permissions', auth, requireAdministrator, async (request, response) => { try { const user = await db.get('SELECT id, name, company_id FROM users WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id]); if (!user) return response.status(404).json({ error: 'Usuário não encontrado.' }); response.json({ user: { id: user.id, name: user.name }, permissions: await db.all('SELECT p.id, p.module, p.action FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ? ORDER BY p.module, p.action', [user.id]) }) } catch (error) { errorResponse(response, error) } })
app.get('/api/access-audit', auth, requireAdministrator, async (request, response) => { try { response.json(await db.all("SELECT a.id, a.company_id, a.user_id, a.action, a.module, a.record_id, a.old_value, a.new_value, a.created_at, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id AND u.company_id = a.company_id WHERE a.company_id = ? AND a.module IN ('USUARIOS', 'PERFIS') ORDER BY a.created_at DESC LIMIT 200", [request.user.company_id])) } catch (error) { errorResponse(response, error) } })

app.use(createCrudRoutes({ db, auth, requireRole, audit }))

if (require.main === module) {
  if (isProduction && !frontendOrigin) throw new Error('FRONTEND_ORIGIN deve ser configurado em produção.')
  const server = app.listen(port, () => console.log(`Nexora API running on port ${port}`))
  let shuttingDown = false
  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Nexora API shutting down (${signal})`)
    server.close(async (error) => {
      if (error) { console.error('HTTP server shutdown error:', error.message); process.exitCode = 1 }
      try { await db.close() } catch (dbError) { console.error('Database shutdown error:', dbError.message); process.exitCode = 1 }
      process.exit()
    })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
module.exports = { app }
