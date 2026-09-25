const express = require('express')
const multer = require('multer')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MAX_FILE_SIZE = 20 * 1024 * 1024
const categories = new Set(['CERTIFICADO', 'ASO', 'FICHA_ADMISSAO', 'CARTEIRA_TRABALHO', 'TERMO_RESPONSABILIDADE', 'ADVERTENCIA', 'OUTRO'])
const mimeExtensions = { 'application/pdf': ['.pdf'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] }

function createEmployeeRoutes({ db, auth, requirePermission, audit, uploadRoot, supabase, ensureStorageBucket }) {
  const router = express.Router()
  const upload = multer({
    storage: supabase ? multer.memoryStorage() : multer.diskStorage({
      destination(request, _file, callback) {
        const directory = path.join(uploadRoot, request.user.company_id, 'employees', 'incoming')
        try { fs.mkdirSync(directory, { recursive: true }); callback(null, directory) } catch (error) { callback(error) }
      },
      filename(_request, file, callback) { callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`) },
    }),
    limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 8, fieldSize: 32 * 1024 },
    fileFilter(_request, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase()
      callback(mimeExtensions[file.mimetype]?.includes(extension) ? null : new Error('Envie um PDF ou uma imagem JPG, PNG ou WebP.'), Boolean(mimeExtensions[file.mimetype]?.includes(extension)))
    },
  }).single('file')

  const permission = (action) => [auth, requirePermission('employees', action)]
  const handleUpload = (request, response, next) => upload(request, response, async (error) => {
    if (!error) return next()
    if (request.file?.path) await fs.promises.unlink(request.file.path).catch(() => {})
    response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'O arquivo deve ter até 20 MB.' : error.message || 'Não foi possível receber o arquivo.' })
  })
  const validDate = (value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
  const fileBuffer = (file) => file.buffer ? Promise.resolve(file.buffer) : fs.promises.readFile(file.path)
  const removeFile = async (filePath) => {
    if (!filePath) return
    if (supabase && filePath.startsWith('supabase:')) {
      const result = await supabase.storage.from('nexora-documents').remove([filePath.slice('supabase:'.length)])
      if (result.error) throw result.error
      return
    }
    await fs.promises.unlink(filePath).catch((error) => { if (error.code !== 'ENOENT') throw error })
  }
  async function saveFile(file, employeeId, companyId) {
    const extension = path.extname(file.originalname).toLowerCase()
    const filename = `${crypto.randomUUID()}${extension}`
    if (supabase) {
      await ensureStorageBucket()
      const storagePath = `${companyId}/employees/${employeeId}/${filename}`
      const stored = await supabase.storage.from('nexora-documents').upload(storagePath, await fileBuffer(file), { contentType: file.mimetype, upsert: false })
      if (stored.error) throw stored.error
      return `supabase:${storagePath}`
    }
    const directory = path.join(uploadRoot, companyId, 'employees', employeeId)
    await fs.promises.mkdir(directory, { recursive: true })
    const destination = path.join(directory, filename)
    await fs.promises.rename(file.path, destination)
    return destination
  }
  async function employee(employeeId, companyId) {
    return db.get('SELECT * FROM employees WHERE id = ? AND company_id = ?', [employeeId, companyId])
  }
  async function employeeDocument(documentId, companyId) {
    return db.get('SELECT d.* FROM employee_documents d JOIN employees e ON e.id = d.employee_id AND e.company_id = d.company_id WHERE d.id = ? AND d.company_id = ?', [documentId, companyId])
  }
  function publicDocument(document) {
    const { storage_path: _storagePath, ...metadata } = document
    return { ...metadata, download_url: `/api/employees/documents/${document.id}/download` }
  }
  async function validSignature(file) {
    const buffer = await fileBuffer(file)
    if (file.mimetype === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-'
    if (file.mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    if (file.mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    if (file.mimetype === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
    return false
  }

  router.get('/api/employees', ...permission('view'), async (request, response) => {
    try {
      const params = [request.user.company_id]
      const where = ['e.company_id = ?']
      const status = String(request.query.status || 'ATIVO').toUpperCase()
      if (status !== 'TODOS') { where.push('e.status = ?'); params.push(status === 'DEMITIDO' ? 'DEMITIDO' : 'ATIVO') }
      const search = String(request.query.search || '').trim()
      if (search) { where.push('(e.name LIKE ? OR e.document LIKE ? OR e.job_title LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`) }
      const employees = await db.all(`SELECT e.*, u.name AS linked_user_name, (SELECT COUNT(*) FROM employee_documents d WHERE d.employee_id = e.id AND d.company_id = e.company_id) AS document_count FROM employees e LEFT JOIN users u ON u.id = e.user_id AND u.company_id = e.company_id WHERE ${where.join(' AND ')} ORDER BY CASE WHEN e.status = 'ATIVO' THEN 0 ELSE 1 END, e.name ASC`, params)
      response.json(employees)
    } catch { response.status(500).json({ error: 'Não foi possível carregar os funcionários.' }) }
  })

  router.post('/api/employees', ...permission('create'), async (request, response) => {
    const data = request.body || {}
    const name = String(data.name || '').trim()
    if (!name) return response.status(400).json({ error: 'Informe o nome completo do funcionário.' })
    if (!validDate(data.admission_date)) return response.status(400).json({ error: 'Informe uma data de admissão válida.' })
    try {
      if (data.document && await db.get('SELECT id FROM employees WHERE company_id = ? AND document = ?', [request.user.company_id, String(data.document).trim()])) return response.status(409).json({ error: 'Já existe um funcionário com esse CPF.' })
      const id = crypto.randomUUID()
      await db.run('INSERT INTO employees (id, company_id, name, document, job_title, department, email, phone, admission_date, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, request.user.company_id, name, data.document || null, data.job_title || null, data.department || null, data.email || null, data.phone || null, data.admission_date || null, data.notes || null, 'ATIVO'])
      const created = await employee(id, request.user.company_id)
      await audit(request.user, 'ADMITIR', 'FUNCIONARIOS', id, null, { name, job_title: created.job_title, admission_date: created.admission_date })
      response.status(201).json(created)
    } catch (error) {
      if (error.message?.includes('UNIQUE')) return response.status(409).json({ error: 'Já existe um funcionário com esse CPF.' })
      response.status(500).json({ error: 'Não foi possível cadastrar o funcionário.' })
    }
  })

  router.get('/api/employees/:id', ...permission('view'), async (request, response) => {
    try {
      const record = await employee(request.params.id, request.user.company_id)
      if (!record) return response.status(404).json({ error: 'Funcionário não encontrado.' })
      const documents = await db.all('SELECT * FROM employee_documents WHERE employee_id = ? AND company_id = ? ORDER BY created_at DESC', [record.id, request.user.company_id])
      response.json({ ...record, documents: documents.map(publicDocument) })
    } catch { response.status(500).json({ error: 'Não foi possível carregar o cadastro do funcionário.' }) }
  })

  router.put('/api/employees/:id', ...permission('edit'), async (request, response) => {
    const data = request.body || {}
    const name = String(data.name || '').trim()
    if (!name) return response.status(400).json({ error: 'Informe o nome completo do funcionário.' })
    if (!validDate(data.admission_date)) return response.status(400).json({ error: 'Informe uma data de admissão válida.' })
    try {
      const previous = await employee(request.params.id, request.user.company_id)
      if (!previous) return response.status(404).json({ error: 'Funcionário não encontrado.' })
      if (data.document && await db.get('SELECT id FROM employees WHERE company_id = ? AND document = ? AND id <> ?', [request.user.company_id, String(data.document).trim(), previous.id])) return response.status(409).json({ error: 'Já existe um funcionário com esse CPF.' })
      await db.run('UPDATE employees SET name = ?, document = ?, job_title = ?, department = ?, email = ?, phone = ?, admission_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [name, data.document || null, data.job_title || null, data.department || null, data.email || null, data.phone || null, data.admission_date || null, data.notes || null, previous.id, request.user.company_id])
      const updated = await employee(previous.id, request.user.company_id)
      await audit(request.user, 'EDITAR', 'FUNCIONARIOS', previous.id, previous, updated)
      response.json(updated)
    } catch { response.status(500).json({ error: 'Não foi possível atualizar o cadastro do funcionário.' }) }
  })

  router.patch('/api/employees/:id/terminate', ...permission('edit'), async (request, response) => {
    const terminationDate = request.body?.termination_date
    if (!terminationDate || !validDate(terminationDate)) return response.status(400).json({ error: 'Informe uma data de desligamento válida.' })
    try {
      const previous = await employee(request.params.id, request.user.company_id)
      if (!previous) return response.status(404).json({ error: 'Funcionário não encontrado.' })
      await db.run("UPDATE employees SET status = 'DEMITIDO', termination_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [terminationDate, previous.id, request.user.company_id])
      const updated = await employee(previous.id, request.user.company_id)
      await audit(request.user, 'DEMITIR', 'FUNCIONARIOS', previous.id, { status: previous.status, termination_date: previous.termination_date }, { status: updated.status, termination_date: updated.termination_date })
      response.json(updated)
    } catch { response.status(500).json({ error: 'Não foi possível registrar o desligamento.' }) }
  })

  router.post('/api/employees/:id/documents', ...permission('upload'), handleUpload, async (request, response) => {
    const file = request.file
    if (!file) return response.status(400).json({ error: 'Selecione um arquivo para anexar.' })
    let savedPath
    try {
      const record = await employee(request.params.id, request.user.company_id)
      if (!record) { if (file.path) await fs.promises.unlink(file.path).catch(() => {}); return response.status(404).json({ error: 'Funcionário não encontrado.' }) }
      const category = String(request.body.category || '').toUpperCase()
      if (!categories.has(category)) { if (file.path) await fs.promises.unlink(file.path).catch(() => {}); return response.status(400).json({ error: 'Selecione uma categoria válida para o documento.' }) }
      if (file.size > MAX_FILE_SIZE || !(await validSignature(file))) { if (file.path) await fs.promises.unlink(file.path).catch(() => {}); return response.status(400).json({ error: 'O arquivo é inválido ou excede 20 MB.' }) }
      if (!validDate(request.body.issue_date) || !validDate(request.body.expires_at)) { if (file.path) await fs.promises.unlink(file.path).catch(() => {}); return response.status(400).json({ error: 'Confira as datas do documento.' }) }
      savedPath = await saveFile(file, record.id, request.user.company_id)
      const id = crypto.randomUUID()
      const name = path.basename(file.originalname).slice(0, 200)
      await db.run('INSERT INTO employee_documents (id, company_id, employee_id, category, name, storage_path, file_size, mime_type, issue_date, expires_at, notes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, request.user.company_id, record.id, category, name, savedPath, file.size, file.mimetype, request.body.issue_date || null, request.body.expires_at || null, String(request.body.notes || '').slice(0, 1000) || null, request.user.id])
      const document = await db.get('SELECT * FROM employee_documents WHERE id = ? AND company_id = ?', [id, request.user.company_id])
      await audit(request.user, 'ANEXAR_DOCUMENTO', 'FUNCIONARIOS', id, null, { employee_id: record.id, category, name })
      response.status(201).json(publicDocument(document))
    } catch {
      if (savedPath) await removeFile(savedPath).catch(() => {})
      else if (file.path) await fs.promises.unlink(file.path).catch(() => {})
      response.status(500).json({ error: 'Não foi possível anexar o documento.' })
    }
  })

  router.get('/api/employees/documents/:documentId/download', ...permission('view'), ...permission('download'), async (request, response) => {
    try {
      const document = await employeeDocument(request.params.documentId, request.user.company_id)
      if (!document) return response.status(404).json({ error: 'Documento não encontrado.' })
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Cache-Control', 'private, no-store')
      response.setHeader('Content-Type', document.mime_type)
      response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`)
      if (supabase && document.storage_path.startsWith('supabase:')) {
        const result = await supabase.storage.from('nexora-documents').download(document.storage_path.slice('supabase:'.length))
        if (result.error) return response.status(404).json({ error: 'O arquivo não está disponível.' })
        response.send(Buffer.from(await result.data.arrayBuffer()))
      } else fs.createReadStream(document.storage_path).on('error', () => { if (!response.headersSent) response.status(404).json({ error: 'O arquivo não está disponível.' }) }).pipe(response)
    } catch { if (!response.headersSent) response.status(500).json({ error: 'Não foi possível baixar o documento.' }) }
  })

  router.delete('/api/employees/documents/:documentId', ...permission('delete'), async (request, response) => {
    try {
      const document = await employeeDocument(request.params.documentId, request.user.company_id)
      if (!document) return response.status(404).json({ error: 'Documento não encontrado.' })
      await db.run('DELETE FROM employee_documents WHERE id = ? AND company_id = ?', [document.id, request.user.company_id])
      await removeFile(document.storage_path)
      await audit(request.user, 'EXCLUIR_DOCUMENTO', 'FUNCIONARIOS', document.id, { employee_id: document.employee_id, category: document.category, name: document.name }, null)
      response.status(204).end()
    } catch { response.status(500).json({ error: 'Não foi possível excluir o documento.' }) }
  })

  return router
}

module.exports = createEmployeeRoutes
