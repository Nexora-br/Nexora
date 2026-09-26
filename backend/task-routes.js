const express = require('express')
const crypto = require('crypto')

const REQUEST_STATES = ['PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA']
const validDate = (value) => {
  if (!value) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function createTaskRoutes({ db, auth, requirePermission, audit }) {
  const router = express.Router()
  const id = () => crypto.randomUUID()
  const taskAccess = (action) => [auth, requirePermission('tasks', action)]

  async function getTask(taskId, companyId) {
    return db.get('SELECT t.*, p.name AS project_name, u.name AS sender_name, u.email AS sender_email FROM tasks t JOIN users u ON u.id = t.created_by AND u.company_id = t.company_id LEFT JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id WHERE t.id = ? AND t.company_id = ? AND t.archived = 0', [taskId, companyId])
  }

  async function isParticipant(taskId, userId, companyId) {
    const task = await db.get('SELECT id, created_by, status FROM tasks WHERE id = ? AND company_id = ? AND archived = 0', [taskId, companyId])
    if (!task) return null
    if (task.created_by === userId) return { task, isSender: true }
    const recipient = await db.get('SELECT id FROM task_recipients WHERE task_id = ? AND company_id = ? AND recipient_user_id = ?', [taskId, companyId, userId])
    return recipient ? { task, isSender: false } : null
  }

  router.get('/api/tasks/users', ...taskAccess('view'), async (request, response) => {
    try {
      const users = await db.all("SELECT id, name, email, job_title FROM users WHERE company_id = ? AND status = 'ATIVO' AND id <> ? ORDER BY name ASC", [request.user.company_id, request.user.id])
      response.json(users)
    } catch (error) { response.status(500).json({ error: 'Não foi possível carregar as pessoas da empresa.' }) }
  })

  router.get('/api/tasks', ...taskAccess('view'), async (request, response) => {
    try {
      const folder = request.query.folder === 'sent' ? 'sent' : 'inbox'
      const query = String(request.query.search || '').trim().slice(0, 100)
      const companyId = request.user.company_id
      const userId = request.user.id
      const filter = folder === 'sent'
        ? 't.created_by = ?'
        : 'EXISTS (SELECT 1 FROM task_recipients own WHERE own.task_id = t.id AND own.company_id = t.company_id AND own.recipient_user_id = ?)'
      const params = [companyId, userId]
      let searchFilter = ''
      if (query) {
        searchFilter = ' AND (t.title LIKE ? OR t.description LIKE ? OR sender.name LIKE ?)'
        params.push(`%${query}%`, `%${query}%`, `%${query}%`)
      }
      const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit, 10) || 100))
      const rows = await db.all(`SELECT t.id, t.title, t.description, t.project_id, p.name AS project_name, t.due_date, t.status, t.created_at, t.updated_at, sender.id AS sender_id, sender.name AS sender_name, sender.email AS sender_email, mine.status AS recipient_status, mine.read_at, (SELECT COUNT(*) FROM task_recipients r WHERE r.task_id = t.id AND r.company_id = t.company_id) AS recipient_count, (SELECT COUNT(*) FROM task_recipients r WHERE r.task_id = t.id AND r.company_id = t.company_id AND r.read_at IS NULL) AS unread_count FROM tasks t JOIN users sender ON sender.id = t.created_by AND sender.company_id = t.company_id LEFT JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id LEFT JOIN task_recipients mine ON mine.task_id = t.id AND mine.company_id = t.company_id AND mine.recipient_user_id = ? WHERE t.company_id = ? AND t.archived = 0 AND ${filter}${searchFilter} ORDER BY t.updated_at DESC, t.created_at DESC LIMIT ?`, [userId, companyId, userId, ...(query ? [`%${query}%`, `%${query}%`, `%${query}%`] : []), limit])
      for (const row of rows) {
        const recipients = await db.all('SELECT u.name FROM task_recipients r JOIN users u ON u.id = r.recipient_user_id AND u.company_id = r.company_id WHERE r.task_id = ? AND r.company_id = ? ORDER BY u.name ASC', [row.id, companyId])
        row.recipient_names = recipients.map((recipient) => recipient.name)
      }
      const [inboxCount, unreadCount, sentCount] = await Promise.all([
        db.get('SELECT COUNT(*) AS total FROM task_recipients WHERE company_id = ? AND recipient_user_id = ?', [companyId, userId]),
        db.get('SELECT COUNT(*) AS total FROM task_recipients WHERE company_id = ? AND recipient_user_id = ? AND read_at IS NULL', [companyId, userId]),
        db.get('SELECT COUNT(*) AS total FROM tasks WHERE company_id = ? AND created_by = ? AND archived = 0', [companyId, userId]),
      ])
      response.json({ data: rows, counts: { inbox: Number(inboxCount?.total || 0), unread: Number(unreadCount?.total || 0), sent: Number(sentCount?.total || 0) } })
    } catch (error) { response.status(500).json({ error: 'Não foi possível carregar a caixa de solicitações.' }) }
  })

  router.post('/api/tasks', ...taskAccess('create'), async (request, response) => {
    try {
      const body = request.body || {}
      const title = String(body.title || '').trim()
      const description = String(body.description || '').trim()
      const recipientIds = [...new Set(Array.isArray(body.recipient_ids) ? body.recipient_ids.map(String) : [])]
      if (!title || title.length > 180) return response.status(400).json({ error: 'Informe um assunto com até 180 caracteres.' })
      if (!description || description.length > 12000) return response.status(400).json({ error: 'Escreva a solicitação, com até 12.000 caracteres.' })
      if (!recipientIds.length || recipientIds.length > 20 || recipientIds.includes(request.user.id)) return response.status(400).json({ error: 'Selecione de 1 a 20 outras pessoas da empresa.' })
      if (!validDate(body.due_date)) return response.status(400).json({ error: 'Informe uma data limite válida.' })
      const recipients = await db.all(`SELECT id, name FROM users WHERE company_id = ? AND status = 'ATIVO' AND id IN (${recipientIds.map(() => '?').join(',')})`, [request.user.company_id, ...recipientIds])
      if (recipients.length !== recipientIds.length) return response.status(400).json({ error: 'Uma ou mais pessoas selecionadas não estão ativas na empresa.' })
      let projectId = null
      if (body.project_id) {
        const project = await db.get('SELECT id FROM projects WHERE id = ? AND company_id = ?', [String(body.project_id), request.user.company_id])
        if (!project) return response.status(400).json({ error: 'A obra selecionada não pertence à empresa.' })
        projectId = project.id
      }
      const taskId = id()
      const recipientsLabel = recipients.map((recipient) => recipient.name).join(', ')
      await db.transaction(async () => {
        await db.run('INSERT INTO tasks (id, company_id, project_id, created_by, title, responsible, due_date, status, priority, description, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [taskId, request.user.company_id, projectId, request.user.id, title, recipientsLabel, body.due_date || null, 'PENDENTE', 'MEDIA', description, 0])
        for (const recipientId of recipientIds) await db.run('INSERT INTO task_recipients (id, company_id, task_id, recipient_user_id) VALUES (?, ?, ?, ?)', [id(), request.user.company_id, taskId, recipientId])
      })
      await audit(request.user, 'ENVIAR_SOLICITACAO', 'TAREFAS', taskId, null, { title, recipient_ids: recipientIds, project_id: projectId, due_date: body.due_date || null })
      response.status(201).json({ id: taskId })
    } catch (error) {
      console.error('Create internal request:', error)
      response.status(500).json({ error: 'Não foi possível enviar a solicitação.' })
    }
  })

  router.get('/api/tasks/:id', ...taskAccess('view'), async (request, response) => {
    try {
      const participant = await isParticipant(request.params.id, request.user.id, request.user.company_id)
      if (!participant) return response.status(404).json({ error: 'Solicitação não encontrada.' })
      if (!participant.isSender) await db.run('UPDATE task_recipients SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE task_id = ? AND company_id = ? AND recipient_user_id = ?', [request.params.id, request.user.company_id, request.user.id])
      const task = await getTask(request.params.id, request.user.company_id)
      const [recipients, messages] = await Promise.all([
        db.all('SELECT r.recipient_user_id AS id, u.name, u.email, u.job_title, r.status, r.read_at, r.created_at FROM task_recipients r JOIN users u ON u.id = r.recipient_user_id AND u.company_id = r.company_id WHERE r.task_id = ? AND r.company_id = ? ORDER BY u.name ASC', [task.id, request.user.company_id]),
        db.all('SELECT m.id, m.sender_id AS user_id, u.name AS user_name, m.message, m.message_type, m.created_at FROM task_messages m JOIN users u ON u.id = m.sender_id AND u.company_id = m.company_id WHERE m.task_id = ? AND m.company_id = ? ORDER BY m.created_at ASC, m.id ASC', [task.id, request.user.company_id]),
      ])
      const initialMessage = { id: `initial-${task.id}`, user_id: task.created_by, user_name: task.sender_name, message: task.description, message_type: 'INICIAL', created_at: task.created_at }
      response.json({ ...task, recipients, messages: [initialMessage, ...messages], is_sender: participant.isSender, recipient_status: recipients.find((recipient) => recipient.id === request.user.id)?.status || null })
    } catch (error) { response.status(500).json({ error: 'Não foi possível abrir esta solicitação.' }) }
  })

  router.post('/api/tasks/:id/messages', ...taskAccess('edit'), async (request, response) => {
    try {
      const participant = await isParticipant(request.params.id, request.user.id, request.user.company_id)
      if (!participant) return response.status(404).json({ error: 'Solicitação não encontrada.' })
      if (participant.task.status === 'CANCELADA') return response.status(409).json({ error: 'Esta solicitação foi cancelada.' })
      const message = String(request.body?.message || '').trim()
      if (!message || message.length > 12000) return response.status(400).json({ error: 'Escreva uma resposta com até 12.000 caracteres.' })
      const messageId = id()
      await db.transaction(async () => {
        await db.run('INSERT INTO task_messages (id, company_id, task_id, sender_id, message, message_type) VALUES (?, ?, ?, ?, ?, ?)', [messageId, request.user.company_id, request.params.id, request.user.id, message, 'TEXTO'])
        await db.run('UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [request.params.id, request.user.company_id])
        await db.run('UPDATE task_recipients SET read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE task_id = ? AND company_id = ? AND recipient_user_id = ?', [request.params.id, request.user.company_id, request.user.id])
      })
      await audit(request.user, 'RESPONDER_SOLICITACAO', 'TAREFAS', request.params.id, null, { message_id: messageId })
      response.status(201).json({ id: messageId })
    } catch (error) { response.status(500).json({ error: 'Não foi possível enviar a resposta.' }) }
  })

  router.patch('/api/tasks/:id/status', ...taskAccess('edit'), async (request, response) => {
    try {
      const nextStatus = String(request.body?.status || '')
      if (!REQUEST_STATES.includes(nextStatus)) return response.status(400).json({ error: 'Selecione um estado válido.' })
      const participant = await isParticipant(request.params.id, request.user.id, request.user.company_id)
      if (!participant) return response.status(404).json({ error: 'Solicitação não encontrada.' })
      if (participant.isSender) return response.status(403).json({ error: 'Somente os destinatários podem atualizar o andamento desta solicitação.' })
      if (participant.task.status === 'CANCELADA') return response.status(409).json({ error: 'Esta solicitação foi cancelada.' })
      await db.transaction(async () => {
        await db.run('UPDATE task_recipients SET status = ?, read_at = COALESCE(read_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE task_id = ? AND company_id = ? AND recipient_user_id = ?', [nextStatus, request.params.id, request.user.company_id, request.user.id])
        const summary = await db.get("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'CONCLUIDA' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN status = 'EM_ANDAMENTO' THEN 1 ELSE 0 END) AS in_progress FROM task_recipients WHERE task_id = ? AND company_id = ?", [request.params.id, request.user.company_id])
        const overall = Number(summary.completed || 0) === Number(summary.total || 0) ? 'CONCLUIDA' : Number(summary.in_progress || 0) > 0 ? 'EM_ANDAMENTO' : 'PENDENTE'
        await db.run('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [overall, request.params.id, request.user.company_id])
        await db.run('INSERT INTO task_messages (id, company_id, task_id, sender_id, message, message_type) VALUES (?, ?, ?, ?, ?, ?)', [id(), request.user.company_id, request.params.id, request.user.id, `Andamento atualizado para ${nextStatus}.`, 'SISTEMA'])
      })
      await audit(request.user, 'ATUALIZAR_SOLICITACAO', 'TAREFAS', request.params.id, null, { status: nextStatus })
      response.json({ status: nextStatus })
    } catch (error) { response.status(500).json({ error: 'Não foi possível atualizar o andamento.' }) }
  })

  router.post('/api/tasks/:id/cancel', ...taskAccess('edit'), async (request, response) => {
    try {
      const participant = await isParticipant(request.params.id, request.user.id, request.user.company_id)
      if (!participant) return response.status(404).json({ error: 'Solicitação não encontrada.' })
      if (!participant.isSender) return response.status(403).json({ error: 'Somente quem enviou pode cancelar a solicitação.' })
      if (participant.task.status === 'CANCELADA') return response.status(409).json({ error: 'A solicitação já foi cancelada.' })
      await db.transaction(async () => {
        await db.run('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', ['CANCELADA', request.params.id, request.user.company_id])
        await db.run('INSERT INTO task_messages (id, company_id, task_id, sender_id, message, message_type) VALUES (?, ?, ?, ?, ?, ?)', [id(), request.user.company_id, request.params.id, request.user.id, 'Solicitação cancelada por quem enviou.', 'SISTEMA'])
      })
      await audit(request.user, 'CANCELAR_SOLICITACAO', 'TAREFAS', request.params.id, null, { status: 'CANCELADA' })
      response.json({ status: 'CANCELADA' })
    } catch (error) { response.status(500).json({ error: 'Não foi possível cancelar a solicitação.' }) }
  })

  return router
}

module.exports = createTaskRoutes
