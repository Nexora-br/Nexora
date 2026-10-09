const express = require('express')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function createClientPortalRoutes({ db, jwtSecret, loginRateLimit, auth, requireRole, audit, uploadRoot, supabase }) {
  const router = express.Router()
  const id = () => crypto.randomUUID()
  const portalManagers = ['ADMINISTRADOR', 'DIRETOR', 'GERENTE', 'GESTOR', 'SUPERVISOR']
  const fileMime = (name) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf' }[path.extname(name || '').toLowerCase()] || 'application/octet-stream')

  async function portalAuth(request, response, next) {
    try {
      const header = request.headers.authorization || ''
      if (!header.startsWith('Bearer ')) return response.status(401).json({ error: 'Entre no portal do cliente.' })
      const payload = jwt.verify(header.slice(7), jwtSecret)
      if (payload.portal !== true || !payload.portalUserId || !payload.companyId || !payload.clientId) return response.status(401).json({ error: 'Sessão do portal inválida.' })
      const user = await db.get("SELECT u.id, u.company_id, u.client_id, u.name, u.email, u.status, c.archived AS client_archived FROM client_portal_users u JOIN clients c ON c.id = u.client_id AND c.company_id = u.company_id WHERE u.id = ? AND u.company_id = ? AND u.client_id = ? AND u.status = 'ATIVO'", [payload.portalUserId, payload.companyId, payload.clientId])
      if (!user || user.client_archived) return response.status(401).json({ error: 'Acesso ao portal desativado.' })
      request.portalUser = user
      next()
    } catch { response.status(401).json({ error: 'Sessão do portal inválida ou expirada.' }) }
  }

  async function ownedProject(user, projectId) {
    return db.get("SELECT id, name, code, client_id, location, city, state, start_date, end_date, progress, status, updated_at FROM projects WHERE id = ? AND company_id = ? AND client_id = ?", [projectId, user.company_id, user.client_id])
  }
  async function streamPrivateFile(response, filePath, name, mime, inline = false) {
    response.type(mime || fileMime(name))
    response.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(path.basename(name || 'arquivo'))}"`)
    if (supabase && filePath?.startsWith('supabase:')) {
      const { data, error } = await supabase.storage.from('nexora-documents').download(filePath.slice('supabase:'.length))
      if (error) return response.status(404).json({ error: 'Arquivo indisponível.' })
      return response.send(Buffer.from(await data.arrayBuffer()))
    }
    if (!filePath || !fs.existsSync(filePath)) return response.status(404).json({ error: 'Arquivo indisponível.' })
    return response.sendFile(path.resolve(filePath))
  }

  router.post('/api/client-portal/auth/login', loginRateLimit, async (request, response) => {
    try {
      const email = String(request.body?.email || '').trim().toLowerCase().slice(0, 254)
      const password = String(request.body?.password || '').slice(0, 200)
      if (!email || !password) return response.status(400).json({ error: 'Informe e-mail e senha.' })
      const matches = await db.all("SELECT u.*, c.trade_name, c.legal_name FROM client_portal_users u JOIN clients c ON c.id = u.client_id AND c.company_id = u.company_id WHERE lower(u.email) = ? AND u.status = 'ATIVO' AND c.archived = 0 ORDER BY u.created_at DESC LIMIT 2", [email])
      if (matches.length > 1) return response.status(409).json({ error: 'Este e-mail está vinculado a mais de um cliente. Peça à equipe da empresa para revisar os acessos.' })
      const user = matches[0]
      if (!user || !(await bcrypt.compare(password, user.password_hash))) return response.status(401).json({ error: 'E-mail ou senha inválidos.' })
      const token = jwt.sign({ portal: true, portalUserId: user.id, companyId: user.company_id, clientId: user.client_id }, jwtSecret, { expiresIn: '8h' })
      response.json({ token, user: { name: user.name, clientName: user.trade_name || user.legal_name } })
    } catch { response.status(500).json({ error: 'Não foi possível entrar no portal.' }) }
  })

  router.get('/api/client-portal/me', portalAuth, async (request, response) => {
    const user = request.portalUser
    const client = await db.get('SELECT trade_name, legal_name FROM clients WHERE id = ? AND company_id = ?', [user.client_id, user.company_id])
    response.json({ user: { name: user.name, email: user.email }, clientName: client?.trade_name || client?.legal_name || '' })
  })
  router.get('/api/client-portal/projects', portalAuth, async (request, response) => {
    const projects = await db.all("SELECT id, name, code, location, city, state, start_date, end_date, progress, status, updated_at FROM projects WHERE company_id = ? AND client_id = ? ORDER BY updated_at DESC", [request.portalUser.company_id, request.portalUser.client_id])
    response.json(projects)
  })
  router.get('/api/client-portal/projects/:projectId', portalAuth, async (request, response) => {
    try {
      const project = await ownedProject(request.portalUser, request.params.projectId)
      if (!project) return response.status(404).json({ error: 'Obra não encontrada.' })
      const [diaries, documents, stages] = await Promise.all([
        db.all("SELECT id, entry_date, entry_type, activities, photos, pdf_name, pdf_size FROM work_diaries WHERE project_id = ? AND company_id = ? AND portal_visible = 1 ORDER BY entry_date DESC", [project.id, request.portalUser.company_id]),
        db.all("SELECT id, name, category, size, mime_type, created_at FROM documents WHERE portal_project_id = ? AND company_id = ? AND portal_visible = 1 AND archived = 0 ORDER BY created_at DESC", [project.id, request.portalUser.company_id]),
        db.all('SELECT id, name, progress, status, start_date, end_date FROM project_stages WHERE project_id = ? AND company_id = ? ORDER BY created_at', [project.id, request.portalUser.company_id]),
      ])
      const safeDiaries = diaries.map((entry) => {
        let photos = []
        try { photos = (typeof entry.photos === 'string' ? JSON.parse(entry.photos || '[]') : entry.photos || []).map((photo, index) => ({ id: String(index), name: path.basename(photo.name || `Foto ${index + 1}`), url: `/api/client-portal/projects/${project.id}/diaries/${entry.id}/photos/${index}` })) } catch {}
        return { id: entry.id, entry_date: entry.entry_date, activities: entry.activities, photos, has_pdf: entry.entry_type === 'PDF' && Boolean(entry.pdf_name), pdf_name: entry.entry_type === 'PDF' ? entry.pdf_name : null }
      })
      response.json({ project, stages, diaries: safeDiaries, documents })
    } catch { response.status(500).json({ error: 'Não foi possível carregar esta obra.' }) }
  })
  router.get('/api/client-portal/projects/:projectId/documents/:documentId', portalAuth, async (request, response) => {
    try {
      const project = await ownedProject(request.portalUser, request.params.projectId)
      if (!project) return response.status(404).json({ error: 'Arquivo não encontrado.' })
      const doc = await db.get('SELECT path, name, mime_type FROM documents WHERE id = ? AND company_id = ? AND portal_project_id = ? AND portal_visible = 1 AND archived = 0', [request.params.documentId, request.portalUser.company_id, project.id])
      if (!doc) return response.status(404).json({ error: 'Arquivo não encontrado.' })
      return streamPrivateFile(response, doc.path, doc.name, doc.mime_type)
    } catch { return response.status(500).json({ error: 'Não foi possível baixar o arquivo.' }) }
  })
  router.get('/api/client-portal/projects/:projectId/diaries/:diaryId/pdf', portalAuth, async (request, response) => {
    const project = await ownedProject(request.portalUser, request.params.projectId)
    if (!project) return response.status(404).json({ error: 'Arquivo não encontrado.' })
    const diary = await db.get('SELECT pdf_path, pdf_name FROM work_diaries WHERE id = ? AND project_id = ? AND company_id = ? AND portal_visible = 1 AND entry_type = ?', [request.params.diaryId, project.id, request.portalUser.company_id, 'PDF'])
    if (!diary?.pdf_path) return response.status(404).json({ error: 'Arquivo não encontrado.' })
    return streamPrivateFile(response, diary.pdf_path, diary.pdf_name, 'application/pdf')
  })
  router.get('/api/client-portal/projects/:projectId/diaries/:diaryId/photos/:photoIndex', portalAuth, async (request, response) => {
    const project = await ownedProject(request.portalUser, request.params.projectId)
    if (!project) return response.status(404).json({ error: 'Foto não encontrada.' })
    const diary = await db.get('SELECT photos FROM work_diaries WHERE id = ? AND project_id = ? AND company_id = ? AND portal_visible = 1', [request.params.diaryId, project.id, request.portalUser.company_id])
    let photos = []
    try { photos = typeof diary?.photos === 'string' ? JSON.parse(diary.photos || '[]') : diary?.photos || [] } catch {}
    const photo = photos[Number(request.params.photoIndex)]
    if (!photo?.path || !Number.isInteger(Number(request.params.photoIndex))) return response.status(404).json({ error: 'Foto não encontrada.' })
    return streamPrivateFile(response, photo.path, photo.name, photo.mimeType, true)
  })
  router.get('/api/client-portal/approvals', portalAuth, async (request, response) => {
    const rows = await db.all('SELECT a.id, a.project_id, p.name AS project_name, a.title, a.description, a.status, a.response_note, a.created_at, a.reviewed_at FROM client_portal_approvals a JOIN projects p ON p.id = a.project_id AND p.company_id = a.company_id WHERE a.company_id = ? AND a.client_id = ? ORDER BY a.created_at DESC', [request.portalUser.company_id, request.portalUser.client_id])
    response.json(rows)
  })
  router.post('/api/client-portal/approvals', loginRateLimit, portalAuth, async (request, response) => {
    const project = await ownedProject(request.portalUser, request.body?.project_id)
    const title = String(request.body?.title || '').trim().slice(0, 160)
    const description = String(request.body?.description || '').trim().slice(0, 3000)
    if (!project) return response.status(400).json({ error: 'Selecione uma obra vinculada à sua conta.' })
    if (!title) return response.status(400).json({ error: 'Informe o que precisa de aprovação.' })
    const approvalId = id()
    await db.run('INSERT INTO client_portal_approvals (id, company_id, client_id, project_id, portal_user_id, title, description) VALUES (?, ?, ?, ?, ?, ?, ?)', [approvalId, request.portalUser.company_id, request.portalUser.client_id, project.id, request.portalUser.id, title, description || null])
    response.status(201).json({ id: approvalId, project_id: project.id, project_name: project.name, title, description, status: 'PENDENTE', created_at: new Date().toISOString() })
  })

  // Internal company staff manage client portal access through normal client permissions.
  router.get('/api/clients/:clientId/portal-users', auth, requireRole('ADMINISTRADOR'), async (request, response) => {
    const client = await db.get('SELECT id FROM clients WHERE id = ? AND company_id = ?', [request.params.clientId, request.user.company_id])
    if (!client) return response.status(404).json({ error: 'Cliente não encontrado.' })
    response.json(await db.all('SELECT id, name, email, status, created_at FROM client_portal_users WHERE client_id = ? AND company_id = ? ORDER BY created_at DESC', [client.id, request.user.company_id]))
  })
  router.post('/api/clients/:clientId/portal-users', auth, requireRole('ADMINISTRADOR'), async (request, response) => {
    try {
      const client = await db.get('SELECT id FROM clients WHERE id = ? AND company_id = ? AND archived = 0', [request.params.clientId, request.user.company_id])
      const name = String(request.body?.name || '').trim().slice(0, 120)
      const email = String(request.body?.email || '').trim().toLowerCase().slice(0, 254)
      const password = String(request.body?.password || '')
      if (!client) return response.status(404).json({ error: 'Cliente não encontrado.' })
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) return response.status(400).json({ error: 'Informe nome, e-mail válido e senha com pelo menos 12 caracteres.' })
      if (await db.get('SELECT id FROM client_portal_users WHERE lower(email) = ?', [email])) return response.status(409).json({ error: 'Este e-mail já possui um acesso de cliente no Nexora.' })
      const userId = id()
      await db.run('INSERT INTO client_portal_users (id, company_id, client_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?, ?)', [userId, request.user.company_id, client.id, name, email, await bcrypt.hash(password, 12)])
      await audit(request.user, 'CRIAR_ACESSO_PORTAL', 'CLIENTES', userId, null, { client_id: client.id, name, email })
      response.status(201).json({ id: userId, name, email, status: 'ATIVO' })
    } catch (error) {
      response.status(error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === '23505' ? 409 : 500).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === '23505' ? 'Este e-mail já possui acesso para este cliente.' : 'Não foi possível criar o acesso.' })
    }
  })
  router.patch('/api/clients/:clientId/portal-users/:userId', auth, requireRole('ADMINISTRADOR'), async (request, response) => {
    const user = await db.get('SELECT * FROM client_portal_users WHERE id = ? AND client_id = ? AND company_id = ?', [request.params.userId, request.params.clientId, request.user.company_id])
    if (!user) return response.status(404).json({ error: 'Acesso não encontrado.' })
    const status = request.body?.status === 'INATIVO' ? 'INATIVO' : 'ATIVO'
    const password = String(request.body?.password || '')
    if (password && password.length < 12) return response.status(400).json({ error: 'A senha precisa ter pelo menos 12 caracteres.' })
    await db.run('UPDATE client_portal_users SET status = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND client_id = ? AND company_id = ?', [status, password ? await bcrypt.hash(password, 12) : user.password_hash, user.id, user.client_id, user.company_id])
    await audit(request.user, password ? 'ATUALIZAR_ACESSO_PORTAL' : status === 'ATIVO' ? 'ATIVAR_ACESSO_PORTAL' : 'DESATIVAR_ACESSO_PORTAL', 'CLIENTES', user.id, { status: user.status }, { status, password_changed: Boolean(password) })
    response.json({ id: user.id, name: user.name, email: user.email, status })
  })

  // The releasing company chooses explicitly which internal materials can be seen by the client.
  router.patch('/api/work-diaries/:id/portal-visibility', auth, requireRole(...portalManagers), async (request, response) => {
    const diary = await db.get('SELECT d.*, p.client_id FROM work_diaries d JOIN projects p ON p.id = d.project_id AND p.company_id = d.company_id WHERE d.id = ? AND d.company_id = ?', [request.params.id, request.user.company_id])
    if (!diary) return response.status(404).json({ error: 'Diário não encontrado.' })
    const visible = request.body?.visible === true || request.body?.visible === 1
    if (visible && !diary.client_id) return response.status(400).json({ error: 'Vincule um cliente à obra antes de liberar o diário.' })
    await db.run('UPDATE work_diaries SET portal_visible = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [visible ? 1 : 0, diary.id, request.user.company_id])
    await audit(request.user, visible ? 'LIBERAR_PORTAL' : 'BLOQUEAR_PORTAL', 'DIARIO_DE_OBRA', diary.id, { portal_visible: diary.portal_visible }, { portal_visible: visible ? 1 : 0 })
    response.json({ ok: true, portal_visible: visible ? 1 : 0 })
  })
  router.patch('/api/documents/:id/portal-visibility', auth, requireRole(...portalManagers), async (request, response) => {
    const doc = await db.get('SELECT * FROM documents WHERE id = ? AND company_id = ? AND archived = 0', [request.params.id, request.user.company_id])
    if (!doc) return response.status(404).json({ error: 'Documento não encontrado.' })
    const visible = request.body?.visible === true || request.body?.visible === 1
    const projectId = String(request.body?.project_id || '')
    const project = visible ? await db.get('SELECT id FROM projects WHERE id = ? AND company_id = ? AND client_id IS NOT NULL', [projectId, request.user.company_id]) : null
    if (visible && !project) return response.status(400).json({ error: 'Selecione uma obra vinculada a um cliente.' })
    await db.run('UPDATE documents SET portal_visible = ?, portal_project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [visible ? 1 : 0, visible ? project.id : null, doc.id, request.user.company_id])
    await audit(request.user, visible ? 'LIBERAR_PORTAL' : 'BLOQUEAR_PORTAL', 'DOCUMENTOS', doc.id, { portal_visible: doc.portal_visible, portal_project_id: doc.portal_project_id }, { portal_visible: visible ? 1 : 0, portal_project_id: visible ? project.id : null })
    response.json({ ok: true, portal_visible: visible ? 1 : 0, portal_project_id: visible ? project.id : null })
  })
  router.get('/api/client-portal/internal/approvals', auth, requireRole(...portalManagers), async (request, response) => {
    response.json(await db.all('SELECT a.*, c.trade_name AS client_name, c.legal_name, p.name AS project_name, u.name AS requester_name FROM client_portal_approvals a JOIN clients c ON c.id = a.client_id AND c.company_id = a.company_id JOIN projects p ON p.id = a.project_id AND p.company_id = a.company_id JOIN client_portal_users u ON u.id = a.portal_user_id WHERE a.company_id = ? ORDER BY CASE WHEN a.status = ? THEN 0 ELSE 1 END, a.created_at DESC', [request.user.company_id, 'PENDENTE']))
  })
  router.patch('/api/client-portal/internal/approvals/:id', auth, requireRole(...portalManagers), async (request, response) => {
    const approval = await db.get('SELECT * FROM client_portal_approvals WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id])
    if (!approval) return response.status(404).json({ error: 'Solicitação não encontrada.' })
    if (approval.status !== 'PENDENTE') return response.status(409).json({ error: 'Esta solicitação já foi respondida.' })
    const status = ['APROVADA', 'REJEITADA'].includes(request.body?.status) ? request.body.status : null
    if (!status) return response.status(400).json({ error: 'Escolha aprovar ou rejeitar a solicitação.' })
    const note = String(request.body?.response_note || '').trim().slice(0, 2000) || null
    await db.run('UPDATE client_portal_approvals SET status = ?, response_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [status, note, request.user.id, approval.id, request.user.company_id])
    await audit(request.user, status === 'APROVADA' ? 'APROVAR_SOLICITACAO_CLIENTE' : 'REJEITAR_SOLICITACAO_CLIENTE', 'PORTAL_CLIENTE', approval.id, approval, { ...approval, status, response_note: note })
    response.json({ ok: true, status, response_note: note })
  })
  return router
}

module.exports = createClientPortalRoutes
