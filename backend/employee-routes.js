const express = require('express')
const multer = require('multer')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { admissionDocuments, admissionDocumentKeys, makePdf } = require('./admission-documents')

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
  const enabledDocuments = async (companyId) => {
    const company = await db.get('SELECT admission_document_keys FROM companies WHERE id = ?', [companyId])
    try { return (JSON.parse(company?.admission_document_keys || '[]')).filter((key) => admissionDocumentKeys.has(key)) } catch { return [] }
  }
  const employeeForUser = (record, user) => {
    if (user.role === 'ADMINISTRADOR' || user.permissions?.includes('*.*') || user.permissions?.includes('employees.download')) return record
    const { home_address: _address, home_address_number: _number, home_complement: _complement, home_district: _district, home_city: _city, home_state: _state, ...visible } = record
    return visible
  }
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
  async function folder(folderId, companyId) {
    return db.get('SELECT * FROM employee_document_folders WHERE id = ? AND company_id = ?', [folderId, companyId])
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
      if (search) { where.push('(e.name LIKE ? OR e.document LIKE ? OR e.job_title LIKE ? OR e.registration_number LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`) }
      const today = new Date().toISOString().slice(0, 10)
      const cutoff = new Date(`${today}T00:00:00.000Z`)
      cutoff.setUTCDate(cutoff.getUTCDate() + 30)
      const expirationParams = [today, today, today, cutoff.toISOString().slice(0, 10), today, cutoff.toISOString().slice(0, 10)]
      const employees = await db.all(`SELECT e.*, u.name AS linked_user_name, ((SELECT COUNT(*) FROM employee_documents d WHERE d.employee_id = e.id AND d.company_id = e.company_id) + (SELECT COUNT(*) FROM safety_certificates c WHERE c.employee_id = e.id AND c.company_id = e.company_id)) AS document_count, ((SELECT COUNT(*) FROM employee_documents d WHERE d.employee_id = e.id AND d.company_id = e.company_id AND d.expires_at IS NOT NULL AND d.expires_at < ?) + (SELECT COUNT(*) FROM safety_certificates c WHERE c.employee_id = e.id AND c.company_id = e.company_id AND c.expires_at IS NOT NULL AND c.expires_at < ?)) AS expired_document_count, ((SELECT COUNT(*) FROM employee_documents d WHERE d.employee_id = e.id AND d.company_id = e.company_id AND d.expires_at IS NOT NULL AND d.expires_at BETWEEN ? AND ?) + (SELECT COUNT(*) FROM safety_certificates c WHERE c.employee_id = e.id AND c.company_id = e.company_id AND c.expires_at IS NOT NULL AND c.expires_at BETWEEN ? AND ?)) AS expiring_document_count FROM employees e LEFT JOIN users u ON u.id = e.user_id AND u.company_id = e.company_id WHERE ${where.join(' AND ')} ORDER BY CASE WHEN e.status = 'ATIVO' THEN 0 ELSE 1 END, e.name ASC`, [...expirationParams.slice(0, 2), ...expirationParams.slice(2), ...params])
      response.json(employees.map((record) => employeeForUser(record, request.user)))
    } catch (error) { console.error('Employees list:', error); response.status(500).json({ error: 'Não foi possível carregar os funcionários.' }) }
  })

  router.get('/api/employees/admission-documents', ...permission('view'), async (request, response) => {
    try {
      const enabled = new Set(await enabledDocuments(request.user.company_id))
      response.json(admissionDocuments.filter(({ key }) => enabled.has(key)))
    } catch { response.status(500).json({ error: 'Não foi possível carregar os modelos de admissão.' }) }
  })

  router.post('/api/employees', ...permission('create'), async (request, response) => {
    const data = request.body || {}
    const name = String(data.name || '').trim()
    const registrationNumber = String(data.registration_number || '').trim()
    if (!name) return response.status(400).json({ error: 'Informe o nome completo do funcionário.' })
    if (!registrationNumber) return response.status(400).json({ error: 'Informe a matrícula do funcionário.' })
    if (name.length > 160 || registrationNumber.length > 60) return response.status(400).json({ error: 'Confira o tamanho do nome e da matrícula.' })
    if (!validDate(data.admission_date)) return response.status(400).json({ error: 'Informe uma data de admissão válida.' })
    const generated = []
    let committed = false
    try {
      if (data.document && await db.get('SELECT id FROM employees WHERE company_id = ? AND document = ?', [request.user.company_id, String(data.document).trim()])) return response.status(409).json({ error: 'Já existe um funcionário com esse CPF.' })
      if (await db.get('SELECT id FROM employees WHERE company_id = ? AND registration_number = ?', [request.user.company_id, registrationNumber])) return response.status(409).json({ error: 'Esta matrícula já está cadastrada nesta empresa.' })
      const enabled = new Set(await enabledDocuments(request.user.company_id))
      const requestedKeys = Array.isArray(data.generate_documents) ? [...new Set(data.generate_documents.map(String))] : []
      if (requestedKeys.some((key) => !enabled.has(key))) return response.status(400).json({ error: 'Selecione somente modelos habilitados nas configurações da empresa.' })
      if (requestedKeys.includes('termo_lgpd') && ![data.home_address, data.home_city, data.home_state].every((value) => String(value || '').trim())) return response.status(400).json({ error: 'Preencha o endereço residencial, município e UF para gerar o termo LGPD.' })
      const company = await db.get('SELECT * FROM companies WHERE id = ?', [request.user.company_id])
      if (requestedKeys.includes('conta_salario') && !String(company.salary_bank_name || '').trim()) return response.status(400).json({ error: 'Configure o banco da conta salário nos dados da empresa.' })
      if (requestedKeys.includes('reembolso') && ['reimbursement_dinner', 'reimbursement_lunch', 'reimbursement_breakfast'].some((field) => company[field] === null || company[field] === undefined)) return response.status(400).json({ error: 'Configure os valores de reembolso nos dados da empresa.' })
      const id = crypto.randomUUID()
      const employeeData = { ...data, id, name, registration_number: registrationNumber, status: 'ATIVO' }
      for (const key of requestedKeys) {
        const pdf = await makePdf(key, employeeData, company, data.admission_date)
        const template = admissionDocuments.find((item) => item.key === key)
        const documentId = crypto.randomUUID()
        const filename = `${documentId}.pdf`
        let storagePath
        if (supabase) {
          await ensureStorageBucket()
          storagePath = `${request.user.company_id}/employees/${id}/${filename}`
          const stored = await supabase.storage.from('nexora-documents').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
          if (stored.error) throw stored.error
          storagePath = `supabase:${storagePath}`
        } else {
          const directory = path.join(uploadRoot, request.user.company_id, 'employees', id)
          await fs.promises.mkdir(directory, { recursive: true })
          storagePath = path.join(directory, filename)
          await fs.promises.writeFile(storagePath, pdf)
        }
        generated.push({ id: documentId, employee_id: id, category: 'FICHA_ADMISSAO', name: `${template.label} - ${name}.pdf`, storage_path: storagePath, file_size: pdf.length, mime_type: 'application/pdf', issue_date: data.admission_date, uploaded_by: request.user.id, buffer: pdf })
      }
      await db.transaction(async () => {
        await db.run('INSERT INTO employees (id, company_id, name, document, job_title, department, email, phone, admission_date, notes, status, registration_number, home_address, home_address_number, home_complement, home_district, home_city, home_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, request.user.company_id, name, data.document || null, data.job_title || null, data.department || null, data.email || null, data.phone || null, data.admission_date || null, data.notes || null, 'ATIVO', registrationNumber, data.home_address || null, data.home_address_number || null, data.home_complement || null, data.home_district || null, data.home_city || null, data.home_state || null])
        for (const document of generated) await db.run('INSERT INTO employee_documents (id, company_id, employee_id, category, name, storage_path, file_size, mime_type, issue_date, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [document.id, request.user.company_id, id, document.category, document.name, document.storage_path, document.file_size, document.mime_type, document.issue_date, document.uploaded_by])
      })
      committed = true
      const created = await employee(id, request.user.company_id)
      await audit(request.user, 'ADMITIR', 'FUNCIONARIOS', id, null, { name, job_title: created.job_title, admission_date: created.admission_date, registration_number: created.registration_number, generated_documents: generated.map(({ name: documentName }) => documentName) })
      for (const document of generated) delete document.buffer
      const visible = employeeForUser(created, request.user)
      visible.generated_documents = generated.map(publicDocument)
      response.status(201).json(visible)
    } catch (error) {
      console.error('Employee admission:', error)
      if (!committed) for (const document of generated) {
        if (supabase && document.storage_path.startsWith('supabase:')) await supabase.storage.from('nexora-documents').remove([document.storage_path.slice('supabase:'.length)]).catch(() => {})
        else if (!supabase) await fs.promises.unlink(document.storage_path).catch(() => {})
      }
      if (error.message?.includes('registration_number')) return response.status(409).json({ error: 'Esta matrícula já está cadastrada nesta empresa.' })
      if (error.message?.includes('UNIQUE')) return response.status(409).json({ error: 'Já existe um funcionário com esse CPF.' })
      response.status(500).json({ error: 'Não foi possível cadastrar o funcionário.' })
    }
  })

  router.get('/api/employees/:id', ...permission('view'), async (request, response) => {
    try {
      const record = await employee(request.params.id, request.user.company_id)
      if (!record) return response.status(404).json({ error: 'Funcionário não encontrado.' })
      const certificateCount = await db.get('SELECT COUNT(*) AS total FROM safety_certificates WHERE employee_id = ? AND company_id = ?', [record.id, request.user.company_id])
      if (Number(certificateCount?.total || 0) > 0) {
        let certificateFolder = await db.get('SELECT id FROM employee_document_folders WHERE employee_id = ? AND company_id = ? AND name = ? AND parent_id IS NULL', [record.id, request.user.company_id, 'Certificados'])
        if (!certificateFolder) { const folderId = crypto.randomUUID(); await db.run('INSERT INTO employee_document_folders (id, company_id, employee_id, parent_id, name) VALUES (?, ?, ?, NULL, ?)', [folderId, request.user.company_id, record.id, 'Certificados']); certificateFolder = { id: folderId } }
        await db.run('UPDATE safety_certificates SET folder_id = ? WHERE employee_id = ? AND company_id = ? AND folder_id IS NULL', [certificateFolder.id, record.id, request.user.company_id])
      }
      const [documents, employmentHistory, folders, certificates] = await Promise.all([
        db.all('SELECT * FROM employee_documents WHERE employee_id = ? AND company_id = ? ORDER BY created_at DESC', [record.id, request.user.company_id]),
        db.all('SELECT * FROM employee_employment_history WHERE employee_id = ? AND company_id = ? ORDER BY start_date DESC, created_at DESC', [record.id, request.user.company_id]),
        db.all('SELECT * FROM employee_document_folders WHERE employee_id = ? AND company_id = ? ORDER BY name ASC', [record.id, request.user.company_id]),
        db.all('SELECT id, nr_code, course_name, workload_hours, issue_date, expires_at, folder_id, created_at FROM safety_certificates WHERE employee_id = ? AND company_id = ? ORDER BY issue_date DESC, created_at DESC', [record.id, request.user.company_id]),
      ])
      const employeeDocuments = documents.map(publicDocument)
      const certificateDocuments = certificates.map((certificate) => ({ id: `certificate-${certificate.id}`, safety_certificate_id: certificate.id, category: 'CERTIFICADO', name: `${certificate.nr_code} - ${certificate.course_name}.pdf`, file_size: 0, mime_type: 'application/pdf', issue_date: certificate.issue_date, expires_at: certificate.expires_at, folder_id: certificate.folder_id, created_at: certificate.created_at }))
      response.json({ ...employeeForUser(record, request.user), documents: [...employeeDocuments, ...certificateDocuments], employment_history: employmentHistory, folders })
    } catch { response.status(500).json({ error: 'Não foi possível carregar o cadastro do funcionário.' }) }
  })

  router.put('/api/employees/:id', ...permission('edit'), async (request, response) => {
    const data = request.body || {}
    const name = String(data.name || '').trim()
    const registrationNumber = String(data.registration_number || '').trim()
    if (!name) return response.status(400).json({ error: 'Informe o nome completo do funcionário.' })
    if (!validDate(data.admission_date)) return response.status(400).json({ error: 'Informe uma data de admissão válida.' })
    try {
      const previous = await employee(request.params.id, request.user.company_id)
      if (!previous) return response.status(404).json({ error: 'Funcionário não encontrado.' })
      if (data.document && await db.get('SELECT id FROM employees WHERE company_id = ? AND document = ? AND id <> ?', [request.user.company_id, String(data.document).trim(), previous.id])) return response.status(409).json({ error: 'Já existe um funcionário com esse CPF.' })
      if (registrationNumber && await db.get('SELECT id FROM employees WHERE company_id = ? AND registration_number = ? AND id <> ?', [request.user.company_id, registrationNumber, previous.id])) return response.status(409).json({ error: 'Esta matrícula já está cadastrada nesta empresa.' })
      await db.run('UPDATE employees SET name = ?, document = ?, job_title = ?, department = ?, email = ?, phone = ?, admission_date = ?, notes = ?, registration_number = ?, home_address = ?, home_address_number = ?, home_complement = ?, home_district = ?, home_city = ?, home_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [name, data.document || null, data.job_title || null, data.department || null, data.email || null, data.phone || null, data.admission_date || null, data.notes || null, registrationNumber || previous.registration_number || null, data.home_address === undefined ? previous.home_address : data.home_address || null, data.home_address_number === undefined ? previous.home_address_number : data.home_address_number || null, data.home_complement === undefined ? previous.home_complement : data.home_complement || null, data.home_district === undefined ? previous.home_district : data.home_district || null, data.home_city === undefined ? previous.home_city : data.home_city || null, data.home_state === undefined ? previous.home_state : data.home_state || null, previous.id, request.user.company_id])
      const updated = await employee(previous.id, request.user.company_id)
      await audit(request.user, 'EDITAR', 'FUNCIONARIOS', previous.id, previous, updated)
      response.json(employeeForUser(updated, request.user))
    } catch { response.status(500).json({ error: 'Não foi possível atualizar o cadastro do funcionário.' }) }
  })

  router.patch('/api/employees/:id/terminate', ...permission('edit'), async (request, response) => {
    const terminationDate = request.body?.termination_date
    if (!terminationDate || !validDate(terminationDate)) return response.status(400).json({ error: 'Informe uma data de desligamento válida.' })
    try {
      const previous = await employee(request.params.id, request.user.company_id)
      if (!previous) return response.status(404).json({ error: 'Funcionário não encontrado.' })
      if (previous.status === 'DEMITIDO') return response.status(409).json({ error: 'Este funcionário já está demitido.' })
      if (previous.admission_date && terminationDate < previous.admission_date.slice(0, 10)) return response.status(400).json({ error: 'A data de desligamento não pode ser anterior à admissão.' })
      await db.transaction(async () => {
        if (previous.admission_date) await db.run('INSERT INTO employee_employment_history (id, company_id, employee_id, start_date, end_date, job_title, department, notes, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), request.user.company_id, previous.id, previous.admission_date.slice(0, 10), terminationDate, previous.job_title || null, previous.department || null, previous.notes || null, request.user.id])
        await db.run("UPDATE employees SET status = 'DEMITIDO', termination_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [terminationDate, previous.id, request.user.company_id])
      })
      const updated = await employee(previous.id, request.user.company_id)
      await audit(request.user, 'DEMITIR', 'FUNCIONARIOS', previous.id, { status: previous.status, termination_date: previous.termination_date }, { status: updated.status, termination_date: updated.termination_date })
      response.json(employeeForUser(updated, request.user))
    } catch { response.status(500).json({ error: 'Não foi possível registrar o desligamento.' }) }
  })

  router.patch('/api/employees/:id/rehire', ...permission('create'), async (request, response) => {
    const admissionDate = request.body?.admission_date
    if (!admissionDate || !validDate(admissionDate)) return response.status(400).json({ error: 'Informe uma data de readmissão válida.' })
    const companyId = request.user.company_id
    try {
      const previous = await employee(request.params.id, companyId)
      if (!previous) return response.status(404).json({ error: 'Funcionário não encontrado.' })
      if (previous.status !== 'DEMITIDO') return response.status(409).json({ error: 'A readmissão está disponível apenas para funcionários demitidos.' })
      if (previous.termination_date && admissionDate <= previous.termination_date.slice(0, 10)) return response.status(400).json({ error: 'A nova admissão deve ocorrer após a data do desligamento anterior.' })
      await db.transaction(async () => {
        if (previous.admission_date && previous.termination_date) {
          const oldAdmission = previous.admission_date.slice(0, 10)
          const oldTermination = previous.termination_date.slice(0, 10)
          const existing = await db.get('SELECT id FROM employee_employment_history WHERE employee_id = ? AND company_id = ? AND start_date = ? AND end_date = ?', [previous.id, companyId, oldAdmission, oldTermination])
          if (!existing) await db.run('INSERT INTO employee_employment_history (id, company_id, employee_id, start_date, end_date, job_title, department, notes, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), companyId, previous.id, oldAdmission, oldTermination, previous.job_title || null, previous.department || null, previous.notes || null, request.user.id])
        }
        await db.run("UPDATE employees SET status = 'ATIVO', admission_date = ?, termination_date = NULL, job_title = ?, department = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?", [admissionDate, String(request.body?.job_title || '').trim() || previous.job_title || null, String(request.body?.department || '').trim() || previous.department || null, previous.id, companyId])
      })
      const updated = await employee(previous.id, companyId)
      await audit(request.user, 'READMITIR', 'FUNCIONARIOS', previous.id, { status: previous.status, termination_date: previous.termination_date }, { status: updated.status, admission_date: updated.admission_date })
      response.json(employeeForUser(updated, request.user))
    } catch (error) {
      console.error(error)
      response.status(500).json({ error: 'Não foi possível readmitir o funcionário.' })
    }
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
      const folderId = request.body.folder_id ? String(request.body.folder_id) : null
      if (folderId && !(await folder(folderId, request.user.company_id))) { if (file.path) await fs.promises.unlink(file.path).catch(() => {}); return response.status(400).json({ error: 'Pasta inválida.' }) }
      savedPath = await saveFile(file, record.id, request.user.company_id)
      const id = crypto.randomUUID()
      const name = path.basename(file.originalname).slice(0, 200)
      await db.run('INSERT INTO employee_documents (id, company_id, employee_id, category, name, storage_path, file_size, mime_type, issue_date, expires_at, notes, uploaded_by, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, request.user.company_id, record.id, category, name, savedPath, file.size, file.mimetype, request.body.issue_date || null, request.body.expires_at || null, String(request.body.notes || '').slice(0, 1000) || null, request.user.id, folderId])
      const document = await db.get('SELECT * FROM employee_documents WHERE id = ? AND company_id = ?', [id, request.user.company_id])
      await audit(request.user, 'ANEXAR_DOCUMENTO', 'FUNCIONARIOS', id, null, { employee_id: record.id, category, name })
      response.status(201).json(publicDocument(document))
    } catch {
      if (savedPath) await removeFile(savedPath).catch(() => {})
      else if (file.path) await fs.promises.unlink(file.path).catch(() => {})
      response.status(500).json({ error: 'Não foi possível anexar o documento.' })
    }
  })

  router.post('/api/employees/:id/folders', ...permission('upload'), async (request, response) => {
    const name = String(request.body?.name || '').trim().slice(0, 120)
    if (!name) return response.status(400).json({ error: 'Informe o nome da pasta.' })
    try {
      const record = await employee(request.params.id, request.user.company_id)
      if (!record) return response.status(404).json({ error: 'Funcionário não encontrado.' })
      let parentId = request.body?.parent_id ? String(request.body.parent_id) : null
      if (parentId) {
        const parent = await folder(parentId, request.user.company_id)
        if (!parent || parent.employee_id !== record.id) return response.status(400).json({ error: 'Pasta-pai inválida.' })
      }
      const id = crypto.randomUUID()
      await db.run('INSERT INTO employee_document_folders (id, company_id, employee_id, parent_id, name, created_by) VALUES (?, ?, ?, ?, ?, ?)', [id, request.user.company_id, record.id, parentId, name, request.user.id])
      const created = await folder(id, request.user.company_id)
      await audit(request.user, 'CRIAR_PASTA', 'FUNCIONARIOS', id, null, { employee_id: record.id, name, parent_id: parentId })
      response.status(201).json(created)
    } catch { response.status(500).json({ error: 'Não foi possível criar a pasta.' }) }
  })

  router.patch('/api/employees/folders/:folderId', ...permission('edit'), async (request, response) => {
    const name = String(request.body?.name || '').trim().slice(0, 120)
    if (!name) return response.status(400).json({ error: 'Informe o nome da pasta.' })
    try {
      const previous = await folder(request.params.folderId, request.user.company_id)
      if (!previous) return response.status(404).json({ error: 'Pasta não encontrada.' })
      await db.run('UPDATE employee_document_folders SET name = ? WHERE id = ? AND company_id = ?', [name, previous.id, request.user.company_id])
      const updated = await folder(previous.id, request.user.company_id)
      await audit(request.user, 'RENOMEAR_PASTA', 'FUNCIONARIOS', previous.id, { name: previous.name }, { name: updated.name })
      response.json(updated)
    } catch { response.status(500).json({ error: 'Não foi possível renomear a pasta.' }) }
  })

  router.delete('/api/employees/folders/:folderId', ...permission('delete'), async (request, response) => {
    try {
      const existing = await folder(request.params.folderId, request.user.company_id)
      if (!existing) return response.status(404).json({ error: 'Pasta não encontrada.' })
      const counts = await db.get('SELECT (SELECT COUNT(*) FROM employee_documents WHERE folder_id = ?) + (SELECT COUNT(*) FROM employee_document_folders WHERE parent_id = ?) AS total', [existing.id, existing.id])
      if (Number(counts?.total || 0) > 0) return response.status(409).json({ error: 'A pasta precisa estar vazia para ser excluída.' })
      await db.run('DELETE FROM employee_document_folders WHERE id = ? AND company_id = ?', [existing.id, request.user.company_id])
      await audit(request.user, 'EXCLUIR_PASTA', 'FUNCIONARIOS', existing.id, { employee_id: existing.employee_id, name: existing.name }, null)
      response.status(204).end()
    } catch { response.status(500).json({ error: 'Não foi possível excluir a pasta.' }) }
  })

  router.patch('/api/employees/documents/:documentId', ...permission('upload'), async (request, response) => {
    try {
      const document = await employeeDocument(request.params.documentId, request.user.company_id)
      if (!document) return response.status(404).json({ error: 'Documento não encontrado.' })
      const folderId = request.body?.folder_id ? String(request.body.folder_id) : null
      if (folderId) {
        const target = await folder(folderId, request.user.company_id)
        if (!target || target.employee_id !== document.employee_id) return response.status(400).json({ error: 'Pasta inválida.' })
      }
      await db.run('UPDATE employee_documents SET folder_id = ? WHERE id = ? AND company_id = ?', [folderId, document.id, request.user.company_id])
      const updated = await db.get('SELECT * FROM employee_documents WHERE id = ? AND company_id = ?', [document.id, request.user.company_id])
      await audit(request.user, 'MOVER_DOCUMENTO', 'FUNCIONARIOS', document.id, { folder_id: document.folder_id }, { folder_id: updated.folder_id })
      response.json(publicDocument(updated))
    } catch { response.status(500).json({ error: 'Não foi possível mover o documento.' }) }
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
