require('dotenv').config()
const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const multer = require('multer')
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const { config, buildCorsOptions } = require('./config')
const db = require('./db')
const createCrudRoutes = require('./crud-routes')
const createFinanceRoutes = require('./finance-routes')
const createWorkDiaryRoutes = require('./work-diary-routes')
const createEmployeeRoutes = require('./employee-routes')
const { createSafetyRoutes } = require('./safety-routes')
const { admissionDocumentKeys, admissionDocuments, makePdf } = require('./admission-documents')
const createTeamRoutes = require('./team-routes')
const createTaskRoutes = require('./task-routes')
const { createSubscriptionRoutes } = require('./subscription-routes')
const { createAiProvider } = require('./ai-provider')

const app = express()
const port = config.port
const isProduction = config.isProduction
const jwtSecret = process.env.NEXORA_JWT_SECRET || (!isProduction ? 'nexora-development-secret-change-me' : (() => { throw new Error('NEXORA_JWT_SECRET deve ser configurado em produção.') })())
const frontendOrigin = config.frontendOrigin
app.disable('x-powered-by')
if (isProduction) app.set('trust proxy', 1)
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (isProduction) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  if (response.req.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store')
  next()
})
app.use(cors(buildCorsOptions({ frontendOrigin, isProduction })))
app.use(express.json({ limit: '2mb' }))
const requestWindows = new Map()
function limitRequests({ windowMs, max, message }) {
  return (request, response, next) => {
    const now = Date.now()
    const key = `${request.path}:${request.ip || request.socket.remoteAddress || 'unknown'}`
    let entry = requestWindows.get(key)
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + windowMs }
    if (!requestWindows.has(key) && requestWindows.size >= 5000) {
      for (const [storedKey, stored] of requestWindows) if (stored.resetAt <= now) requestWindows.delete(storedKey)
      if (requestWindows.size >= 5000) return response.status(429).json({ error: message })
    }
    entry.count += 1
    requestWindows.set(key, entry)
    response.setHeader('RateLimit-Limit', String(max))
    response.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)))
    response.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))
    if (entry.count > max) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))))
      return response.status(429).json({ error: message })
    }
    next()
  }
}
const loginRateLimit = limitRequests({ windowMs: 15 * 60 * 1000, max: 15, message: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' })
const registrationRateLimit = limitRequests({ windowMs: 60 * 60 * 1000, max: process.env.NODE_ENV === 'test' ? 100 : 5, message: 'Muitas tentativas de cadastro. Tente novamente mais tarde.' })
const id = () => crypto.randomUUID()
const tokenFor = (user) => jwt.sign({ userId: user.id, companyId: user.company_id, role: user.role }, jwtSecret, { expiresIn: '12h' })
const paginationFor = (request) => { const requestedPage = Number.parseInt(request.query.page, 10); const requestedPageSize = Number.parseInt(request.query.pageSize, 10); const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1; const pageSize = Number.isFinite(requestedPageSize) ? Math.min(100, Math.max(1, requestedPageSize)) : 20; return { page, pageSize, offset: (page - 1) * pageSize, requested: request.query.page !== undefined || request.query.pageSize !== undefined } }
const sortFor = (request, fields, fallback = 'created_at') => ({ field: fields.includes(request.query.sort) ? request.query.sort : fallback, direction: request.query.direction === 'asc' ? 'ASC' : 'DESC' })
async function permissionsFor(user) { if (user.role === 'ADMINISTRADOR') return ['*.*']; const rows = await db.all('SELECT p.module, p.action FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?', [user.id]); return rows.map((row) => `${row.module}.${row.action}`) }
const cleanUser = (user, permissions = user.permissions || []) => ({ id: user.id, name: user.name, email: user.email, companyId: user.company_id, role: user.role, permissions })
const errorResponse = (response, error) => { console.error(error); response.status(500).json({ error: 'Não foi possível concluir a operação.' }) }
const uploadRoot = process.env.NEXORA_STORAGE_PATH || path.join(__dirname, 'storage')
const storageBucket = 'nexora-documents'
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY) : null
let storageReady
async function ensureStorageBucket() {
  if (!supabase) return false
  if (!storageReady) storageReady = supabase.storage.getBucket(storageBucket).then(async ({ data, error }) => { if (data) return true; if (error && !/not found/i.test(error.message || '')) throw error; const created = await supabase.storage.createBucket(storageBucket, { public: false }); if (created.error && !/already exists/i.test(created.error.message || '')) throw created.error; return true })
  return storageReady
}
const allowedUploadTypes = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
}
const upload = multer({
  storage: supabase ? multer.memoryStorage() : multer.diskStorage({
    destination: (request, _file, callback) => {
      const directory = path.join(uploadRoot, request.user.company_id)
      fs.mkdirSync(directory, { recursive: true })
      callback(null, directory)
    },
    filename: (_request, file, callback) => callback(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8, fieldSize: 32 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, Boolean(allowedUploadTypes[file.mimetype]?.includes(path.extname(file.originalname).toLowerCase()))),
})
async function hasValidUploadSignature(file) {
  const buffer = file.buffer || await fs.promises.readFile(file.path)
  if (file.mimetype === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-'
  if (file.mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (file.mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
  return false
}

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
const routePermission = (request) => { const path = request.path; const module = path.startsWith('/api/dashboard') || path.startsWith('/api/global-search') ? 'dashboard' : path.startsWith('/api/subscription') ? null : path.startsWith('/api/work-diaries') ? 'work_diary' : path.startsWith('/api/employees') ? 'employees' : path.startsWith('/api/teams') ? 'teams' : path.startsWith('/api/finance') ? 'finance' : path.startsWith('/api/accounts-') ? 'finance' : path.startsWith('/api/transactions') || path.startsWith('/api/cost-centers') ? 'finance' : path.startsWith('/api/purchase-') ? 'purchases' : path.startsWith('/api/quotations') ? 'quotations' : path.startsWith('/api/inventory') || path.startsWith('/api/products') || path.startsWith('/api/categories') || path.startsWith('/api/storage-locations') ? 'inventory' : path.startsWith('/api/suppliers') ? 'suppliers' : path.startsWith('/api/clients') ? 'clients' : path.startsWith('/api/projects') ? 'projects' : path.startsWith('/api/equipment') ? 'equipment' : path.startsWith('/api/maintenance') ? 'maintenance' : path.startsWith('/api/field-activities') ? 'agenda' : path.startsWith('/api/documents') ? 'documents' : path.startsWith('/api/audit-logs') ? 'audit' : path.startsWith('/api/users') ? 'users' : null; if (!module) return null; if (module === 'employees' && path.endsWith('/rehire')) return [module, 'create']; if (request.method === 'POST' && module === 'documents' && path.endsWith('/upload')) return [module, 'upload']; if (module === 'employees' && request.method === 'POST' && path.includes('/documents')) return [module, 'upload']; if (request.method === 'GET') return [module, path.endsWith('/export') ? 'export' : path.endsWith('/download') ? 'download' : 'view']; if (path.endsWith('/archive')) return [module, 'archive']; if (path.endsWith('/pay')) return [module, 'pay']; if (path.endsWith('/receive')) return [module, 'receive']; if (request.method === 'POST' && (path.includes('/approve') || path.includes('/select'))) return [module, 'approve']; if (request.method === 'POST') return [module, 'create']; if (request.method === 'PUT' || request.method === 'PATCH') return [module, 'edit']; if (request.method === 'DELETE') return [module, 'delete']; return null }
async function enforceActiveSubscription(request, response, next) {
  const enabled = process.env.NEXORA_ENFORCE_SUBSCRIPTIONS === 'true' || (process.env.NODE_ENV !== 'test' && process.env.NEXORA_ENABLE_SIMULATED_BILLING === 'true')
  if (!enabled || request.path.startsWith('/api/subscription') || (process.env.NODE_ENV === 'test' && request.user.role === 'ADMINISTRADOR')) return next()
  try {
    const active = await db.get("SELECT id FROM subscriptions WHERE company_id = ? AND status = 'ATIVA' AND next_charge_at > ?", [request.user.company_id, new Date().toISOString()])
    if (!active) return response.status(402).json({ error: 'A empresa precisa ativar uma assinatura para acessar o Nexora.' })
    next()
  } catch (error) { console.error(error); response.status(503).json({ error: 'Não foi possível verificar a assinatura da empresa.' }) }
}
app.use((request, response, next) => { if (request.path.startsWith('/api/auth') || request.path === '/api/health') return next(); const permission = routePermission(request); if (!permission) return next(); auth(request, response, () => requirePermission(permission[0], permission[1])(request, response, () => { request.subscriptionEnforcementHandled = true; enforceActiveSubscription(request, response, next) })) })
app.use('/api', (request, response, next) => { if (request.subscriptionEnforcementHandled || request.path.startsWith('/auth') || request.path === '/health' || request.path.startsWith('/subscription') || !request.headers.authorization?.startsWith('Bearer ')) return next(); auth(request, response, () => enforceActiveSubscription(request, response, next)) })

app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'nexora-api', database: process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite local', commit: process.env.RENDER_GIT_COMMIT || null }))

const admissionPreviewData = {
  employee: {
    name: 'João da Silva', document: '000.000.000-00', job_title: 'Auxiliar de montagem', department: 'Montagem',
    registration_number: '0001', admission_date: '2026-01-15', home_address: 'Rua das Flores', home_address_number: '45',
    home_district: 'Centro', home_city: 'Goiânia', home_state: 'GO',
  },
  company: {
    legal_name: 'Empresa Exemplo Ltda.', trade_name: 'Empresa Exemplo', cnpj: '00.000.000/0001-00',
    address: 'Avenida Exemplo', address_number: '100', district: 'Centro', city: 'Goiânia', state: 'GO',
    salary_bank_name: 'Banco Exemplo', reimbursement_dinner: 45, reimbursement_lunch: 35, reimbursement_breakfast: 20,
  },
}
const admissionPreviewCache = new Map()
app.get('/api/admission-documents/:key/preview', async (request, response) => {
  const { key } = request.params
  if (!admissionDocumentKeys.has(key)) return response.status(404).json({ error: 'Modelo de admissão não encontrado.' })
  try {
    let preview = admissionPreviewCache.get(key)
    if (!preview) {
      preview = await makePdf(key, admissionPreviewData.employee, admissionPreviewData.company, admissionPreviewData.employee.admission_date, { preview: true })
      admissionPreviewCache.set(key, preview)
    }
    response.type('application/pdf').set('Content-Disposition', `inline; filename="previa-${key}.pdf"`).send(preview)
  } catch (error) {
    console.error('Admission document preview:', error)
    response.status(500).json({ error: 'Não foi possível gerar a prévia deste documento.' })
  }
})

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

function normalizeCnpj(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '') }
function validCnpj(value) {
  const cnpj = normalizeCnpj(value)
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^([A-Z0-9])\1{13}$/.test(cnpj)) return false
  const digit = (base, weights) => { const sum = [...base].reduce((total, character, index) => total + (character.charCodeAt(0) - 48) * weights[index], 0); const remainder = sum % 11; return remainder < 2 ? 0 : 11 - remainder }
  const first = digit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const second = digit(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return cnpj.endsWith(`${first}${second}`)
}

app.post('/api/auth/register', registrationRateLimit, async (request, response) => {
  try {
    const { companyName, legalName, cnpj, userName, email, password, phone, segment, zip_code, address, address_number, complement, district, city, state, website } = request.body || {}
    const normalizedEmail = String(email || '').trim().toLowerCase()
    const normalizedCompany = String(companyName || legalName || '').trim()
    const normalizedLegalName = String(legalName || companyName || '').trim()
    const normalizedCnpj = normalizeCnpj(cnpj)
    const normalizedZipCode = String(zip_code || '').replace(/\D/g, '')
    const normalizedState = String(state || '').trim().toUpperCase()
    const normalizedName = String(userName || '').trim()
    const companyEmail = String(request.body?.company_email || email || '').trim().toLowerCase()
    const documentKeys = Array.isArray(request.body?.admission_document_keys) ? [...new Set(request.body.admission_document_keys.map(String))] : []
    const logoDataUrl = String(request.body?.admission_logo_data_url || '')
    const salaryBankName = String(request.body?.salary_bank_name || '').trim().slice(0, 120) || null
    const reimbursement = ['dinner', 'lunch', 'breakfast'].map((key) => request.body?.[`reimbursement_${key}`] === '' || request.body?.[`reimbursement_${key}`] === undefined ? null : Number(request.body[`reimbursement_${key}`]))
    if (documentKeys.some((key) => !admissionDocumentKeys.has(key))) return response.status(400).json({ error: 'Um ou mais modelos de admissão selecionados são inválidos.' })
    if (logoDataUrl && (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(logoDataUrl) || Buffer.byteLength(logoDataUrl, 'utf8') > 1400000)) return response.status(400).json({ error: 'Envie a logo em PNG ou JPG com até 1 MB.' })
    if (reimbursement.some((value) => value !== null && (!Number.isFinite(value) || value < 0 || value > 100000))) return response.status(400).json({ error: 'Confira os valores de reembolso informados.' })
    if (documentKeys.includes('conta_salario') && !salaryBankName) return response.status(400).json({ error: 'Informe o banco da conta salário para habilitar esse documento.' })
    if (documentKeys.includes('reembolso') && reimbursement.some((value) => value === null)) return response.status(400).json({ error: 'Informe os três valores de reembolso para habilitar esse documento.' })
    const requiredCompanyFields = [normalizedCompany, normalizedLegalName, normalizedCnpj, normalizedName, normalizedEmail]
    if (requiredCompanyFields.some((value) => !String(value || '').trim()) || !password) return response.status(400).json({ error: 'Preencha os dados da empresa e da pessoa administradora.' })
    if (!validCnpj(normalizedCnpj)) return response.status(400).json({ error: 'Informe um CNPJ válido.' })
    if (normalizedZipCode && normalizedZipCode.length !== 8) return response.status(400).json({ error: 'Informe um CEP válido com 8 números.' })
    if (normalizedState && !/^[A-Z]{2}$/.test(normalizedState)) return response.status(400).json({ error: 'Informe uma UF válida com duas letras.' })
    if (normalizedCompany.length > 160 || normalizedLegalName.length > 180 || normalizedName.length > 160 || normalizedEmail.length > 254 || companyEmail.length > 254 || String(phone || '').length > 32 || String(segment || '').length > 100 || String(address || '').length > 180 || String(address_number || '').length > 30 || String(complement || '').length > 120 || String(district || '').length > 120 || String(city || '').length > 120 || String(website || '').length > 200) return response.status(400).json({ error: 'Um ou mais campos excedem o tamanho permitido.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return response.status(400).json({ error: 'Informe um endereço de e-mail válido.' })
    if (companyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyEmail)) return response.status(400).json({ error: 'Informe um e-mail comercial válido.' })
    if (String(password).length < 12 || Buffer.byteLength(String(password), 'utf8') > 72) return response.status(400).json({ error: 'A senha deve ter pelo menos 12 caracteres e no máximo 72 bytes.' })
    const existingCompanies = await db.all('SELECT id, cnpj FROM companies WHERE cnpj IS NOT NULL')
    if (existingCompanies.some((company) => normalizeCnpj(company.cnpj) === normalizedCnpj)) return response.status(409).json({ error: 'Já existe uma empresa com este CNPJ. Use “Solicitar acesso à empresa”.' })
    const companyId = id()
    const userId = id()
    const passwordHash = await bcrypt.hash(String(password), 12)
    await db.transaction(async () => {
      await db.run('INSERT INTO companies (id, legal_name, trade_name, cnpj, email, phone, segment, zip_code, address, address_number, complement, district, city, state, website, admission_logo_data_url, admission_document_keys, salary_bank_name, reimbursement_dinner, reimbursement_lunch, reimbursement_breakfast) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [companyId, normalizedLegalName, normalizedCompany, normalizedCnpj, companyEmail || normalizedEmail, String(phone || '').trim() || null, String(segment || '').trim() || null, normalizedZipCode || null, String(address || '').trim() || null, String(address_number || '').trim() || null, String(complement || '').trim() || null, String(district || '').trim() || null, String(city || '').trim() || null, normalizedState || null, String(website || '').trim() || null, logoDataUrl || null, JSON.stringify(documentKeys), salaryBankName, ...reimbursement])
      const role = await db.get('SELECT id FROM roles WHERE name = ?', ['ADMINISTRADOR'])
      await db.run('INSERT INTO users (id, company_id, name, email, password_hash, job_title) VALUES (?, ?, ?, ?, ?, ?)', [userId, companyId, normalizedName, normalizedEmail, passwordHash, 'Administrador'])
      await db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id])
    })
    const user = await db.get('SELECT u.*, r.name AS role FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.id = ?', [userId])
    response.status(201).json({ token: tokenFor(user), user: cleanUser(user, ['*.*']), company: { id: companyId, name: normalizedCompany } })
  } catch (error) {
    if (error.code === '23505' || error.message.includes('idx_companies_cnpj_unique') || error.message.includes('companies.cnpj')) return response.status(409).json({ error: 'Já existe uma empresa com este CNPJ. Use “Solicitar acesso à empresa”.' })
    if (error.message.includes('UNIQUE')) return response.status(409).json({ error: 'Este e-mail já está cadastrado nesta empresa.' })
    errorResponse(response, error)
  }
})
app.post('/api/auth/join-request', registrationRateLimit, async (request, response) => {
  try {
    const { name, email, password, phone, job_title: jobTitle, department } = request.body || {}
    const cnpj = normalizeCnpj(request.body?.cnpj)
    const normalizedEmail = String(email || '').trim().toLowerCase()
    const normalizedName = String(name || '').trim()
    if (!validCnpj(cnpj) || !normalizedName || !normalizedEmail || !password) return response.status(400).json({ error: 'Informe um CNPJ válido, seu nome, e-mail e senha.' })
    if (normalizedName.length > 160 || normalizedEmail.length > 254 || String(phone || '').length > 32 || String(jobTitle || '').length > 120 || String(department || '').length > 120) return response.status(400).json({ error: 'Um ou mais campos excedem o tamanho permitido.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return response.status(400).json({ error: 'Informe um endereço de e-mail válido.' })
    if (String(password).length < 12 || Buffer.byteLength(String(password), 'utf8') > 72) return response.status(400).json({ error: 'A senha deve ter pelo menos 12 caracteres e no máximo 72 bytes.' })
    const companies = await db.all('SELECT id, cnpj FROM companies WHERE cnpj IS NOT NULL')
    const company = companies.find((row) => normalizeCnpj(row.cnpj) === cnpj)
    if (!company) return response.status(404).json({ error: 'Não encontramos uma empresa com este CNPJ. Se ela ainda não usa o Nexora, escolha “Criar uma empresa”.' })
    const existingUser = await db.get('SELECT id FROM users WHERE company_id = ? AND lower(trim(email)) = ?', [company.id, normalizedEmail])
    if (existingUser) return response.status(409).json({ error: 'Este e-mail já tem acesso a essa empresa. Tente entrar na sua conta.' })
    const duplicate = await db.get("SELECT id FROM company_access_requests WHERE company_id = ? AND lower(trim(email)) = ? AND status = 'PENDENTE'", [company.id, normalizedEmail])
    if (duplicate) return response.status(409).json({ error: 'Já existe um pedido pendente com este e-mail para a empresa.' })
    const requestId = id()
    await db.run('INSERT INTO company_access_requests (id, company_id, name, email, password_hash, phone, job_title, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [requestId, company.id, normalizedName, normalizedEmail, await bcrypt.hash(String(password), 12), String(phone || '').trim() || null, String(jobTitle || '').trim() || null, String(department || '').trim() || null])
    response.status(202).json({ id: requestId, status: 'PENDENTE', message: 'Pedido enviado. Um administrador da empresa precisa aprovar seu acesso.' })
  } catch (error) { if (error.code === '23505' || error.message.includes('idx_company_access_requests_pending_email')) return response.status(409).json({ error: 'Já existe um pedido pendente com este e-mail para a empresa.' }); errorResponse(response, error) }
})
app.post('/api/auth/login', loginRateLimit, async (request, response) => {
  try {
    const email = String(request.body?.email || '').trim().toLowerCase()
    const password = String(request.body?.password || '')
    if (!email || !password || email.length > 254 || Buffer.byteLength(password, 'utf8') > 72) return response.status(401).json({ error: 'E-mail ou senha inválidos.' })
    const candidates = await db.all("SELECT u.*, (SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id ORDER BY CASE r.name WHEN 'ADMINISTRADOR' THEN 0 ELSE 1 END LIMIT 1) AS role FROM users u WHERE lower(trim(u.email)) = ? AND u.status = ? ORDER BY u.created_at ASC", [email, 'ATIVO'])
    let user = null
    for (const candidate of candidates) {
      if (await bcrypt.compare(password, candidate.password_hash)) { user = candidate; break }
    }
    if (!user) return response.status(401).json({ error: 'E-mail ou senha inválidos.' })
    user.permissions = await permissionsFor(user)
    const company = await db.get('SELECT id, trade_name AS name FROM companies WHERE id = ?', [user.company_id])
    if (!company) return response.status(401).json({ error: 'E-mail ou senha inválidos.' })
    await audit(user, 'LOGIN', 'AUTH', user.id)
    response.json({ token: tokenFor(user), user: cleanUser(user), company })
  } catch (error) { errorResponse(response, error) }
})
app.post('/api/auth/change-password', auth, async (request, response) => {
  try {
    const currentPassword = String(request.body?.currentPassword || '')
    const password = String(request.body?.password || '')
    if (!currentPassword || !await bcrypt.compare(currentPassword, request.user.password_hash)) return response.status(401).json({ error: 'A senha atual está incorreta.' })
    if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) return response.status(400).json({ error: 'A nova senha deve ter pelo menos 12 caracteres e no máximo 72 bytes.' })
    if (password === currentPassword) return response.status(400).json({ error: 'Escolha uma senha diferente da atual.' })
    const passwordHash = await bcrypt.hash(password, 12)
    await db.run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [passwordHash, request.user.id, request.user.company_id])
    response.json({ ok: true })
  } catch (error) { errorResponse(response, error) }
})

app.get('/api/dashboard', auth, async (request, response) => {
  try {
    const companyId = request.user.company_id
    const permissions = request.user.permissions || []
    const can = (module) => request.user.role === 'ADMINISTRADOR' || permissions.includes('*.*') || permissions.includes(module + '.view')
    const [projects, field, payable, receivable, stock, maintenance, purchases, documents, transactions] = await Promise.all([
      can('projects') ? db.get("SELECT COUNT(*) AS total FROM projects WHERE company_id = ? AND status NOT IN ('FINALIZADO', 'CANCELADO')", [companyId]) : Promise.resolve({ total: 0 }),
      can('agenda') ? db.get("SELECT COUNT(*) AS total FROM field_activities WHERE company_id = ? AND status = 'AGENDADA'", [companyId]) : Promise.resolve({ total: 0 }),
      can('finance') ? db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM accounts_payable WHERE company_id = ? AND status = 'PENDENTE'", [companyId]) : Promise.resolve({ total: 0 }),
      can('finance') ? db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM accounts_receivable WHERE company_id = ? AND status = 'PENDENTE'", [companyId]) : Promise.resolve({ total: 0 }),
      can('inventory') ? db.get('SELECT COALESCE(SUM(quantity), 0) AS total, COALESCE(SUM(reserved_quantity), 0) AS reserved FROM inventory WHERE company_id = ?', [companyId]) : Promise.resolve({ total: 0, reserved: 0 }),
      can('maintenance') ? db.get("SELECT COUNT(*) AS total FROM maintenance_records WHERE company_id = ? AND status IN ('AGENDADA', 'EM_ANDAMENTO')", [companyId]) : Promise.resolve({ total: 0 }),
      can('purchases') ? db.get("SELECT COUNT(*) AS total FROM purchase_requests WHERE company_id = ? AND status NOT IN ('APROVADA', 'CANCELADA')", [companyId]) : Promise.resolve({ total: 0 }),
      can('documents') ? db.get('SELECT COUNT(*) AS total FROM documents WHERE company_id = ? AND archived = 0', [companyId]) : Promise.resolve({ total: 0 }),
      can('finance') ? db.get("SELECT COALESCE(SUM(CASE WHEN type = 'ENTRADA' THEN amount ELSE 0 END), 0) AS income, COALESCE(SUM(CASE WHEN type = 'SAIDA' THEN amount ELSE 0 END), 0) AS expense FROM financial_transactions WHERE company_id = ? AND status = 'CONFIRMADA'", [companyId]) : Promise.resolve({ income: 0, expense: 0 }),
    ])
    const stats = []
    if (can('projects')) stats.push({ label: 'Projetos em andamento', value: String(projects.total), detail: 'Dados atualizados agora', tone: 'blue', icon: 'Factory' })
    if (can('agenda')) stats.push({ label: 'Obras em campo', value: String(field.total), detail: 'Atividades agendadas', tone: 'orange', icon: 'Truck' })
    if (can('inventory')) stats.push({ label: 'Estoque comprometido', value: (stock.total ? Math.round((stock.reserved / stock.total) * 100) : 0) + '%', detail: 'Reservas reais', tone: 'green', icon: 'Warehouse' })
    if (can('finance')) stats.push({ label: 'A receber', value: 'R$ ' + Number(receivable.total).toLocaleString('pt-BR'), detail: 'Contas pendentes', tone: 'purple', icon: 'ClipboardList' })
    const operational = {}
    if (can('maintenance')) operational.openMaintenance = maintenance.total
    if (can('purchases')) operational.pendingPurchases = purchases.total
    if (can('documents')) operational.documents = documents.total
    response.json({ stats, ...(can('finance') ? { financial: { payable: payable.total, receivable: receivable.total, income: transactions.income, expense: transactions.expense, result: transactions.income - transactions.expense } } : {}), operational, companyId })
  } catch (error) { errorResponse(response, error) }
})
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
app.get('/api/global-search', auth, async (request, response) => {
  try {
    const query = String(request.query.q || '').trim().slice(0, 100)
    if (query.length < 2) return response.json([])
    const term = '%' + query + '%'
    const companyId = request.user.company_id
    const [projects, clients, products, suppliers, equipment, documents, activities, payables] = await Promise.all([
      db.all('SELECT id, name, code, "Projetos" AS category FROM projects WHERE company_id = ? AND (name LIKE ? OR code LIKE ?) LIMIT 10', [companyId, term, term]),
      db.all('SELECT id, legal_name AS name, "Clientes" AS category FROM clients WHERE company_id = ? AND (legal_name LIKE ? OR trade_name LIKE ?) LIMIT 10', [companyId, term, term]),
      db.all('SELECT id, name, "Produtos" AS category FROM products WHERE company_id = ? AND name LIKE ? LIMIT 10', [companyId, term]),
      db.all('SELECT id, legal_name AS name, "Fornecedores" AS category FROM suppliers WHERE company_id = ? AND (legal_name LIKE ? OR trade_name LIKE ?) LIMIT 10', [companyId, term, term]),
      db.all('SELECT id, name, code, "Equipamentos" AS category FROM equipment WHERE company_id = ? AND (name LIKE ? OR code LIKE ?) LIMIT 10', [companyId, term, term]),
      db.all('SELECT id, name, "Documentos" AS category FROM documents WHERE company_id = ? AND archived = 0 AND name LIKE ? LIMIT 10', [companyId, term]),
      db.all('SELECT id, title AS name, "Agenda" AS category FROM field_activities WHERE company_id = ? AND title LIKE ? LIMIT 10', [companyId, term]),
      db.all('SELECT id, description AS name, "Financeiro" AS category FROM accounts_payable WHERE company_id = ? AND description LIKE ? LIMIT 10', [companyId, term, term]),
    ])
    const permissions = request.user.permissions || []
    const allowed = (module) => request.user.role === 'ADMINISTRADOR' || permissions.includes('*.*') || permissions.includes(module + '.view')
    const modules = { Projetos: 'projects', Clientes: 'clients', Produtos: 'inventory', Fornecedores: 'suppliers', Equipamentos: 'equipment', Documentos: 'documents', Agenda: 'agenda', Financeiro: 'finance' }
    response.json([...projects, ...clients, ...products, ...suppliers, ...equipment, ...documents, ...activities, ...payables].filter((item) => allowed(modules[item.category])))
  } catch (error) { errorResponse(response, error) }
})
app.post('/api/documents/upload', auth, upload.single('file'), async (request, response) => { try { if (!request.file) return response.status(400).json({ error: 'Arquivo inválido ou ausente.' }); if (!(await hasValidUploadSignature(request.file))) { if (request.file.path) await fs.promises.unlink(request.file.path).catch(() => {}); return response.status(400).json({ error: 'O conteúdo do arquivo não corresponde ao tipo permitido.' }) } const scope = request.body.scope === 'contracts' ? 'contracts' : 'company'; if (scope === 'contracts' && (request.file.mimetype !== 'application/pdf' || path.extname(request.file.originalname).toLowerCase() !== '.pdf')) { if (request.file.path) await fs.promises.unlink(request.file.path).catch(() => {}); return response.status(400).json({ error: 'Contratos devem ser enviados em PDF.' }) } const folderId = request.body.folder_id || null; if (folderId && !await db.get('SELECT id FROM document_folders WHERE id = ? AND company_id = ? AND scope = ?', [folderId, request.user.company_id, scope])) return response.status(400).json({ error: 'Pasta inválida.' }); const document = { id: id(), name: request.body.name || request.file.originalname, category: request.body.category || (scope === 'contracts' ? 'Contrato' : 'Documento da empresa'), path: request.file.path, size: request.file.size, mimeType: request.file.mimetype, relatedEntity: request.body.related_entity || null, relatedId: request.body.related_id || null, scope, folder_id: folderId }; if (supabase) { await ensureStorageBucket(); const storagePath = `${request.user.company_id}/${document.id}${path.extname(request.file.originalname).toLowerCase()}`; const stored = await supabase.storage.from(storageBucket).upload(storagePath, request.file.buffer, { contentType: document.mimeType, upsert: false }); if (stored.error) throw stored.error; document.path = `supabase:${storagePath}` } await db.run('INSERT INTO documents (id, company_id, name, category, path, size, mime_type, uploaded_by, related_entity, related_id, scope, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [document.id, request.user.company_id, document.name, document.category, document.path, document.size, document.mimeType, request.user.id, document.relatedEntity, document.relatedId, document.scope, document.folder_id]); await audit(request.user, 'UPLOAD', 'DOCUMENTOS', document.id, null, document); response.status(201).json({ ...document, downloadUrl: `/api/documents/${document.id}/download` }) } catch (error) { errorResponse(response, error) } })
app.get('/api/documents/:id/download', auth, async (request, response) => { try { const document = await db.get('SELECT * FROM documents WHERE id = ? AND company_id = ? AND archived = 0', [request.params.id, request.user.company_id]); if (!document) return response.status(404).json({ error: 'Documento não encontrado.' }); await audit(request.user, 'DOWNLOAD', 'DOCUMENTOS', document.id); if (supabase && document.path?.startsWith('supabase:')) { const file = await supabase.storage.from(storageBucket).download(document.path.slice('supabase:'.length)); if (file.error) throw file.error; response.type(document.mime_type || 'application/octet-stream'); response.attachment(document.name); return response.send(Buffer.from(await file.data.arrayBuffer())) } if (!fs.existsSync(document.path)) return response.status(404).json({ error: 'Documento não encontrado.' }); response.download(document.path, document.name) } catch (error) { errorResponse(response, error) } })
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
      db.get("SELECT COUNT(*) AS total FROM tasks WHERE company_id = ? AND created_by IS NULL AND archived = 0 AND status NOT IN ('CONCLUIDA', 'CANCELADA')", [companyId]),
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

app.get('/api/company', auth, requireAdministrator, async (request, response) => {
  try {
    const company = await db.get('SELECT id, legal_name, trade_name, cnpj, email, phone, segment, zip_code, address, address_number, complement, district, city, state, website, admission_logo_data_url, admission_document_keys, salary_bank_name, reimbursement_dinner, reimbursement_lunch, reimbursement_breakfast FROM companies WHERE id = ?', [request.user.company_id])
    if (!company) return response.status(404).json({ error: 'Empresa não encontrada.' })
    try { company.admission_document_keys = JSON.parse(company.admission_document_keys || '[]').filter((key) => admissionDocumentKeys.has(key)) } catch { company.admission_document_keys = [] }
    response.json(company)
  } catch (error) { errorResponse(response, error) }
})

app.put('/api/company', auth, requireAdministrator, async (request, response) => {
  try {
    const body = request.body || {}
    const legalName = String(body.legal_name || '').trim()
    const tradeName = String(body.trade_name || '').trim()
    const cnpj = normalizeCnpj(body.cnpj)
    const email = String(body.email || '').trim().toLowerCase()
    const zipCode = String(body.zip_code || '').replace(/\D/g, '')
    const state = String(body.state || '').trim().toUpperCase()
    if (!legalName || !tradeName || !validCnpj(cnpj) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Informe razão social, nome fantasia, CNPJ válido e e-mail comercial.' })
    if (body.zip_code && zipCode.length !== 8) return response.status(400).json({ error: 'Se informar o CEP, use os 8 números válidos.' })
    if (body.state && !/^[A-Z]{2}$/.test(state)) return response.status(400).json({ error: 'Informe uma UF válida com duas letras.' })
    if (legalName.length > 180 || tradeName.length > 160 || email.length > 254 || String(body.phone || '').length > 32 || String(body.segment || '').length > 100) return response.status(400).json({ error: 'Um ou mais campos excedem o tamanho permitido.' })
    const documentKeys = Array.isArray(body.admission_document_keys) ? [...new Set(body.admission_document_keys.map(String))] : []
    if (documentKeys.some((key) => !admissionDocumentKeys.has(key))) return response.status(400).json({ error: 'Um ou mais modelos de admissão selecionados são inválidos.' })
    const logoDataUrl = body.admission_logo_data_url === undefined ? null : String(body.admission_logo_data_url || '')
    if (logoDataUrl && (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(logoDataUrl) || Buffer.byteLength(logoDataUrl, 'utf8') > 1400000)) return response.status(400).json({ error: 'Envie a logo em PNG ou JPG com até 1 MB.' })
    if (logoDataUrl === '') return response.status(400).json({ error: 'A logo enviada está vazia. Envie PNG ou JPG com até 1 MB.' })
    const salaryBankName = String(body.salary_bank_name || '').trim().slice(0, 120) || null
    const reimbursement = ['dinner', 'lunch', 'breakfast'].map((key) => body[`reimbursement_${key}`] === '' || body[`reimbursement_${key}`] === null || body[`reimbursement_${key}`] === undefined ? null : Number(body[`reimbursement_${key}`]))
    if (reimbursement.some((value) => value !== null && (!Number.isFinite(value) || value < 0 || value > 100000))) return response.status(400).json({ error: 'Confira os valores de reembolso informados.' })
    if (documentKeys.includes('conta_salario') && !salaryBankName) return response.status(400).json({ error: 'Informe o banco da conta salário para habilitar esse documento.' })
    if (documentKeys.includes('reembolso') && reimbursement.some((value) => value === null)) return response.status(400).json({ error: 'Informe os três valores de reembolso para habilitar esse documento.' })
    const companies = await db.all('SELECT id, cnpj FROM companies WHERE id <> ? AND cnpj IS NOT NULL', [request.user.company_id])
    if (companies.some((company) => normalizeCnpj(company.cnpj) === cnpj)) return response.status(409).json({ error: 'Este CNPJ já está cadastrado em outra empresa Nexora.' })
    const previous = await db.get('SELECT id, legal_name, trade_name, cnpj, email, phone, segment, zip_code, address, address_number, complement, district, city, state, website FROM companies WHERE id = ?', [request.user.company_id])
    if (!previous) return response.status(404).json({ error: 'Empresa não encontrada.' })
    await db.run('UPDATE companies SET legal_name = ?, trade_name = ?, cnpj = ?, email = ?, phone = ?, segment = ?, zip_code = ?, address = ?, address_number = ?, complement = ?, district = ?, city = ?, state = ?, website = ?, admission_logo_data_url = COALESCE(?, admission_logo_data_url), admission_document_keys = ?, salary_bank_name = ?, reimbursement_dinner = ?, reimbursement_lunch = ?, reimbursement_breakfast = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [legalName, tradeName, cnpj, email, String(body.phone || '').trim() || null, String(body.segment || '').trim() || null, zipCode || null, String(body.address || '').trim() || null, String(body.address_number || '').trim() || null, String(body.complement || '').trim() || null, String(body.district || '').trim() || null, String(body.city || '').trim() || null, state || null, String(body.website || '').trim() || null, logoDataUrl, JSON.stringify(documentKeys), salaryBankName, ...reimbursement, request.user.company_id])
    const updated = await db.get('SELECT id, legal_name, trade_name, cnpj, email, phone, segment, zip_code, address, address_number, complement, district, city, state, website, admission_logo_data_url, admission_document_keys, salary_bank_name, reimbursement_dinner, reimbursement_lunch, reimbursement_breakfast FROM companies WHERE id = ?', [request.user.company_id])
    updated.admission_document_keys = documentKeys
    const auditPrevious = { ...previous, admission_document_keys: null, admission_logo_data_url: Boolean(request.body?.admission_logo_data_url) }
    const auditUpdated = { ...updated, admission_logo_data_url: Boolean(updated.admission_logo_data_url) }
    await audit(request.user, 'ATUALIZAR_CADASTRO_EMPRESA', 'EMPRESA', request.user.company_id, auditPrevious, auditUpdated)
    response.json(updated)
  } catch (error) { if (error.code === '23505' || error.message.includes('idx_companies_cnpj_unique') || error.message.includes('companies.cnpj')) return response.status(409).json({ error: 'Este CNPJ já está cadastrado em outra empresa Nexora.' }); errorResponse(response, error) }
})

app.get('/api/company-access-requests', auth, requireAdministrator, async (request, response) => {
  try {
    const status = ['PENDENTE', 'APROVADA', 'RECUSADA'].includes(request.query.status) ? request.query.status : null
    const rows = await db.all(`SELECT r.id, r.company_id, r.name, r.email, r.phone, r.job_title, r.department, r.status, r.reviewed_by, r.reviewed_at, r.review_note, r.linked_user_id, r.created_at, u.name AS reviewer_name FROM company_access_requests r LEFT JOIN users u ON u.id = r.reviewed_by AND u.company_id = r.company_id WHERE r.company_id = ? ${status ? 'AND r.status = ?' : ''} ORDER BY CASE r.status WHEN 'PENDENTE' THEN 0 ELSE 1 END, r.created_at DESC`, status ? [request.user.company_id, status] : [request.user.company_id])
    response.json(rows)
  } catch (error) { errorResponse(response, error) }
})

app.post('/api/company-access-requests/:id/decision', auth, requireAdministrator, async (request, response) => {
  try {
    const decision = String(request.body?.decision || '')
    const accessRequest = await db.get("SELECT * FROM company_access_requests WHERE id = ? AND company_id = ? AND status = 'PENDENTE'", [request.params.id, request.user.company_id])
    if (!accessRequest) return response.status(404).json({ error: 'Pedido pendente não encontrado.' })
    if (decision === 'RECUSAR') {
      const note = String(request.body?.note || '').trim().slice(0, 500) || null
      await db.run("UPDATE company_access_requests SET status = 'RECUSADA', password_hash = '', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND status = 'PENDENTE'", [request.user.id, note, accessRequest.id, request.user.company_id])
      await audit(request.user, 'RECUSAR_ACESSO', 'SOLICITACOES_ENTRADA', accessRequest.id, { status: 'PENDENTE' }, { status: 'RECUSADA', note })
      return response.json({ id: accessRequest.id, status: 'RECUSADA' })
    }
    if (decision !== 'APROVAR') return response.status(400).json({ error: 'Escolha aprovar ou recusar o pedido.' })
    const roleName = String(request.body?.role || 'CONSULTA').toUpperCase()
    if (roleName === 'ADMINISTRADOR') return response.status(400).json({ error: 'O perfil de administrador não pode ser atribuído por este fluxo.' })
    const role = await db.get('SELECT id, name FROM roles WHERE name = ?', [roleName])
    if (!role) return response.status(400).json({ error: 'Selecione um perfil válido.' })
    const existing = await db.get('SELECT id FROM users WHERE company_id = ? AND lower(trim(email)) = ?', [request.user.company_id, accessRequest.email])
    if (existing) return response.status(409).json({ error: 'Este e-mail já possui uma conta nesta empresa.' })
    const userId = id()
    await db.transaction(async () => {
      await db.run('INSERT INTO users (id, company_id, name, email, password_hash, phone, job_title) VALUES (?, ?, ?, ?, ?, ?, ?)', [userId, request.user.company_id, accessRequest.name, accessRequest.email, accessRequest.password_hash, accessRequest.phone, accessRequest.job_title])
      await db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id])
      const claim = await db.run("UPDATE company_access_requests SET status = 'APROVADA', password_hash = '', linked_user_id = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND status = 'PENDENTE'", [userId, request.user.id, accessRequest.id, request.user.company_id])
      if (!claim.changes) throw new Error('Este pedido já foi analisado.')
    })
    await audit(request.user, 'APROVAR_ACESSO', 'SOLICITACOES_ENTRADA', accessRequest.id, { status: 'PENDENTE' }, { status: 'APROVADA', user_id: userId, role: role.name })
    response.json({ id: accessRequest.id, status: 'APROVADA', user_id: userId, role: role.name })
  } catch (error) { if (error.message.includes('UNIQUE')) return response.status(409).json({ error: 'Este e-mail já possui uma conta nesta empresa.' }); if (error.message.includes('já foi analisado')) return response.status(409).json({ error: error.message }); errorResponse(response, error) }
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
    if (String(password).length < 12 || Buffer.byteLength(String(password), 'utf8') > 72) return response.status(400).json({ error: 'A senha deve ter pelo menos 12 caracteres e no máximo 72 bytes.' })
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
    if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) return response.status(400).json({ error: 'A senha deve ter pelo menos 12 caracteres e no máximo 72 bytes.' })
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

app.use(createEmployeeRoutes({ db, auth, requirePermission, audit, uploadRoot, supabase, ensureStorageBucket }))
app.use(createSafetyRoutes({ db, auth, requirePermission, audit }))
app.use(createTeamRoutes({ db, auth, requirePermission, audit }))
app.use(createTaskRoutes({ db, auth, requirePermission, audit }))
app.use(createCrudRoutes({ db, auth, requireRole, audit }))
app.use(createFinanceRoutes({ db, auth, requireRole, audit, id }))
app.use(createWorkDiaryRoutes({ db, auth, requirePermission, audit, uploadRoot, supabase, ensureStorageBucket }))
app.use(createSubscriptionRoutes({ express, db, auth, requirePermission, requireRole, audit, id, enabled: () => process.env.NODE_ENV === 'test' || process.env.NEXORA_ENABLE_SIMULATED_BILLING === 'true' }))

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
