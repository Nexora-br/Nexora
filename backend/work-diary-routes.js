const express = require('express')
const multer = require('multer')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const PDF_LIMIT = 20 * 1024 * 1024
const PHOTO_LIMIT = 5 * 1024 * 1024
const PHOTO_COUNT = 8

function createWorkDiaryRoutes({ db, auth, requirePermission, audit, uploadRoot, supabase, ensureStorageBucket }) {
  const router = express.Router()
  const storage = supabase ? multer.memoryStorage() : multer.diskStorage({
    destination(request, _file, callback) {
      const directory = path.join(uploadRoot, request.user.company_id, 'work-diaries', 'incoming')
      try { fs.mkdirSync(directory, { recursive: true }); callback(null, directory) } catch (error) { callback(error) }
    },
    filename(_request, file, callback) { callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`) },
  })
  const upload = multer({
    storage,
    limits: { fileSize: PDF_LIMIT, files: PHOTO_COUNT + 1, fields: 20, fieldSize: 1024 * 1024 },
    fileFilter(_request, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase()
      const validPdf = file.fieldname === 'pdf' && extension === '.pdf' && file.mimetype === 'application/pdf'
      const validPhoto = file.fieldname === 'photos' && ['.jpg', '.jpeg', '.png', '.webp'].includes(extension) && ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      callback(validPdf || validPhoto ? null : new Error('Envie um PDF válido ou imagens JPG, PNG e WebP.'))
    },
  }).fields([{ name: 'pdf', maxCount: 1 }, { name: 'photos', maxCount: PHOTO_COUNT }])

  const withFiles = (request, response, next) => upload(request, response, (error) => {
    if (!error) return next()
    const tooLarge = error.code === 'LIMIT_FILE_SIZE'
    const tooMany = error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
    cleanupIncoming(request.files).finally(() => response.status(400).json({ error: tooLarge ? 'O PDF deve ter até 20 MB e cada foto até 5 MB.' : tooMany ? `Anexe no máximo ${PHOTO_COUNT} fotos.` : error.message || 'Não foi possível receber os arquivos.' }))
  })

  function dateIsValid(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  }
  function fileBuffer(file) {
    if (file.buffer) return Promise.resolve(file.buffer)
    return fs.promises.readFile(file.path)
  }
  async function validSignature(file, kind) {
    const buffer = await fileBuffer(file)
    if (kind === 'pdf') return buffer.subarray(0, 5).toString() === '%PDF-'
    if (file.mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    if (file.mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    if (file.mimetype === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
    return false
  }
  async function saveFile(file, projectId, kind) {
    const extension = path.extname(file.originalname).toLowerCase()
    const filename = `${crypto.randomUUID()}${extension}`
    const key = path.posix.join(String(projectId), kind, filename)
    if (supabase) {
      await ensureStorageBucket()
      const result = await supabase.storage.from('nexora-documents').upload(`${file.companyId}/work-diaries/${key}`, await fileBuffer(file), { contentType: file.mimetype, upsert: false })
      if (result.error) throw result.error
      return { path: `supabase:${file.companyId}/work-diaries/${key}`, name: path.basename(file.originalname), size: file.size, mimeType: file.mimetype, id: crypto.randomUUID() }
    }
    const targetDirectory = path.join(uploadRoot, file.companyId, 'work-diaries', String(projectId), kind)
    await fs.promises.mkdir(targetDirectory, { recursive: true })
    const target = path.join(targetDirectory, filename)
    await fs.promises.rename(file.path, target)
    return { path: target, name: path.basename(file.originalname), size: file.size, mimeType: file.mimetype, id: crypto.randomUUID() }
  }
  async function removeFile(filePath) {
    if (!filePath) return
    if (supabase && filePath.startsWith('supabase:')) {
      const result = await supabase.storage.from('nexora-documents').remove([filePath.slice('supabase:'.length)])
      if (result.error) throw result.error
      return
    }
    await fs.promises.unlink(filePath).catch((error) => { if (error.code !== 'ENOENT') throw error })
  }
  async function cleanupIncoming(files = {}) {
    for (const file of [...(files.pdf || []), ...(files.photos || [])]) if (file.path) await fs.promises.unlink(file.path).catch(() => {})
  }
  function parseBody(request, response) {
    try { return JSON.parse(request.body.data || '{}') } catch { response.status(400).json({ error: 'Os dados do diário estão inválidos.' }); return null }
  }
  async function getProject(projectId, companyId) {
    return db.get('SELECT id, name FROM projects WHERE id = ? AND company_id = ?', [projectId, companyId])
  }
  async function getEntry(entryId, companyId) {
    return db.get('SELECT d.*, u.name AS author_name, p.name AS project_name FROM work_diaries d JOIN users u ON u.id = d.author_id AND u.company_id = d.company_id JOIN projects p ON p.id = d.project_id AND p.company_id = d.company_id WHERE d.id = ? AND d.company_id = ?', [entryId, companyId])
  }
  function storedPhotos(entry) { return typeof entry.photos === 'string' ? JSON.parse(entry.photos || '[]') : entry.photos || [] }
  function publicEntry(entry) {
    const result = { ...entry, photos: storedPhotos(entry).map(({ path: _path, ...photo }) => photo), equipment_used: typeof entry.equipment_used === 'string' ? JSON.parse(entry.equipment_used || '[]') : entry.equipment_used || [], has_pdf: Boolean(entry.pdf_path) }
    delete result.pdf_path
    return result
  }
  async function validatedEquipment(equipment, companyId) {
    if (!Array.isArray(equipment)) return []
    const ids = [...new Set(equipment.map((item) => String(item).slice(0, 80)).filter(Boolean))].slice(0, 50)
    if (!ids.length) return []
    const rows = await db.all(`SELECT id, name, code FROM equipment WHERE company_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [companyId, ...ids])
    return rows.map((item) => ({ id: item.id, name: `${item.code ? `${item.code} · ` : ''}${item.name}` }))
  }
  function recordValues(data, files, existing = null) {
    const pdf = files.pdf?.[0]
    return {
      entry_date: data.entry_date,
      weather: data.weather || null,
      worker_count: Math.max(0, Math.min(10000, Number.parseInt(data.worker_count, 10) || 0)),
      worker_details: data.worker_details || null,
      equipment_notes: data.equipment_notes || null,
      activities: data.activities || null,
      occurrences: data.occurrences || null,
      materials_received: data.materials_received || null,
      observations: data.observations || null,
      pdf_path: pdf ? null : existing?.pdf_path || null,
      pdf_name: pdf ? path.basename(pdf.originalname) : existing?.pdf_name || null,
      pdf_size: pdf ? pdf.size : existing?.pdf_size || null,
    }
  }
  async function persistIncoming(request, projectId, entryType, existing = null) {
    const incomingPdf = request.files?.pdf?.[0]
    const incomingPhotos = request.files?.photos || []
    const fileList = [...(incomingPdf ? [incomingPdf] : []), ...incomingPhotos]
    for (const file of fileList) file.companyId = request.user.company_id
    if (incomingPdf && (incomingPdf.size > PDF_LIMIT || !(await validSignature(incomingPdf, 'pdf')))) throw Object.assign(new Error('O arquivo não é um PDF válido de até 20 MB.'), { status: 400 })
    for (const file of incomingPhotos) if (file.size > PHOTO_LIMIT || !(await validSignature(file, 'photo'))) throw Object.assign(new Error('Uma das imagens é inválida ou excede 5 MB.'), { status: 400 })
    if (entryType === 'PDF' && !incomingPdf && !existing?.pdf_path) throw Object.assign(new Error('Anexe o arquivo PDF do diário.'), { status: 400 })
    const uploaded = []
    try {
      const pdf = incomingPdf ? await saveFile(incomingPdf, projectId, 'pdf') : null
      if (pdf) uploaded.push(pdf)
      const photos = []
      for (const file of incomingPhotos) { const photo = await saveFile(file, projectId, 'photos'); uploaded.push(photo); photos.push(photo) }
      return { pdf, photos, uploaded }
    } catch (error) { await Promise.all(uploaded.map((file) => removeFile(file.path).catch(() => {}))); throw error }
  }
  function attachPermissions(handler, action) { return [auth, requirePermission('work_diary', action), handler] }

  router.get('/api/work-diaries/projects', ...attachPermissions(async (request, response) => {
    try { response.json(await db.all('SELECT id, name, code, status FROM projects WHERE company_id = ? ORDER BY name ASC', [request.user.company_id])) }
    catch { response.status(500).json({ error: 'Não foi possível carregar as obras.' }) }
  }, 'view'))

  router.get('/api/work-diaries', ...attachPermissions(async (request, response) => {
    try {
      const projectId = String(request.query.project_id || '')
      if (!projectId) return response.status(400).json({ error: 'Selecione uma obra para consultar o diário.' })
      if (!await getProject(projectId, request.user.company_id)) return response.status(404).json({ error: 'Obra não encontrada.' })
      const rows = await db.all('SELECT d.id, d.project_id, d.author_id, d.entry_type, d.entry_date, d.weather, d.worker_count, d.activities, d.observations, d.pdf_name, d.pdf_size, d.created_at, d.updated_at, u.name AS author_name FROM work_diaries d JOIN users u ON u.id = d.author_id AND u.company_id = d.company_id WHERE d.project_id = ? AND d.company_id = ? ORDER BY d.entry_date DESC, d.created_at DESC', [projectId, request.user.company_id])
      response.json(rows)
    } catch (error) { response.status(500).json({ error: 'Não foi possível carregar os diários desta obra.' }) }
  }, 'view'))

  router.get('/api/work-diaries/:id', ...attachPermissions(async (request, response) => {
    try { const entry = await getEntry(request.params.id, request.user.company_id); if (!entry) return response.status(404).json({ error: 'Registro de diário não encontrado.' }); response.json(publicEntry(entry)) }
    catch { response.status(500).json({ error: 'Não foi possível carregar o registro.' }) }
  }, 'view'))

  router.post('/api/work-diaries/:projectId', auth, requirePermission('work_diary', 'create'), withFiles, async (request, response) => {
    let uploaded = []
    try {
      const data = parseBody(request, response); if (!data) { await cleanupIncoming(request.files); return }
      const project = await getProject(request.params.projectId, request.user.company_id)
      if (!project) { await cleanupIncoming(request.files); return response.status(404).json({ error: 'Obra não encontrada.' }) }
      if (!dateIsValid(data.entry_date)) { await cleanupIncoming(request.files); return response.status(400).json({ error: 'Informe uma data válida para o registro.' }) }
      if (!['ESTRUTURADO', 'PDF'].includes(data.entry_type)) { await cleanupIncoming(request.files); return response.status(400).json({ error: 'Escolha criar o diário no sistema ou anexar um PDF.' }) }
      const stored = await persistIncoming(request, project.id, data.entry_type)
      uploaded = stored.uploaded
      const id = crypto.randomUUID()
      const equipment = await validatedEquipment(data.equipment_used, request.user.company_id)
      const values = recordValues(data, request.files)
      values.pdf_path = stored.pdf?.path || null; values.pdf_name = stored.pdf?.name || null; values.pdf_size = stored.pdf?.size || null
      const photos = stored.photos
      await db.run('INSERT INTO work_diaries (id, company_id, project_id, author_id, entry_type, entry_date, weather, worker_count, worker_details, equipment_used, equipment_notes, activities, occurrences, materials_received, observations, pdf_path, pdf_name, pdf_size, photos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, request.user.company_id, project.id, request.user.id, data.entry_type, values.entry_date, values.weather, values.worker_count, values.worker_details, JSON.stringify(equipment), values.equipment_notes, values.activities, values.occurrences, values.materials_received, values.observations, values.pdf_path, values.pdf_name, values.pdf_size, JSON.stringify(photos)])
      await audit(request.user, 'CRIAR', 'DIARIO_DE_OBRA', id, null, { project_id: project.id, entry_date: values.entry_date, entry_type: data.entry_type })
      response.status(201).json(publicEntry({ ...values, id, project_id: project.id, author_id: request.user.id, author_name: request.user.name, entry_type: data.entry_type, equipment_used: equipment, photos, created_at: new Date().toISOString() }))
    } catch (error) { await Promise.all(uploaded.map((file) => removeFile(file.path).catch(() => {}))); await cleanupIncoming(request.files); response.status(error.status || 500).json({ error: error.message || 'Não foi possível salvar o diário.' }) }
  })

  router.put('/api/work-diaries/:id', auth, requirePermission('work_diary', 'edit'), withFiles, async (request, response) => {
    let uploaded = []
    try {
      const existing = await getEntry(request.params.id, request.user.company_id)
      if (!existing) { await cleanupIncoming(request.files); return response.status(404).json({ error: 'Registro de diário não encontrado.' }) }
      const data = parseBody(request, response); if (!data) { await cleanupIncoming(request.files); return }
      if (!dateIsValid(data.entry_date)) { await cleanupIncoming(request.files); return response.status(400).json({ error: 'Informe uma data válida para o registro.' }) }
      if (data.entry_type !== existing.entry_type) { await cleanupIncoming(request.files); return response.status(400).json({ error: 'O tipo do registro não pode ser alterado.' }) }
      const stored = await persistIncoming(request, existing.project_id, existing.entry_type, existing)
      uploaded = stored.uploaded
      const equipment = await validatedEquipment(data.equipment_used, request.user.company_id)
      const values = recordValues(data, request.files, existing)
      if (stored.pdf) { values.pdf_path = stored.pdf.path; values.pdf_name = stored.pdf.name; values.pdf_size = stored.pdf.size }
      const oldPhotos = storedPhotos(existing)
      const photos = [...oldPhotos, ...stored.photos]
      await db.run('UPDATE work_diaries SET entry_date = ?, weather = ?, worker_count = ?, worker_details = ?, equipment_used = ?, equipment_notes = ?, activities = ?, occurrences = ?, materials_received = ?, observations = ?, pdf_path = ?, pdf_name = ?, pdf_size = ?, photos = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?', [values.entry_date, values.weather, values.worker_count, values.worker_details, JSON.stringify(equipment), values.equipment_notes, values.activities, values.occurrences, values.materials_received, values.observations, values.pdf_path, values.pdf_name, values.pdf_size, JSON.stringify(photos), existing.id, request.user.company_id])
      if (stored.pdf && existing.pdf_path) await removeFile(existing.pdf_path).catch(() => {})
      await audit(request.user, 'EDITAR', 'DIARIO_DE_OBRA', existing.id, { entry_date: existing.entry_date, entry_type: existing.entry_type }, { entry_date: values.entry_date, entry_type: existing.entry_type })
      const updated = await getEntry(existing.id, request.user.company_id)
      response.json(publicEntry(updated))
    } catch (error) { await Promise.all(uploaded.map((file) => removeFile(file.path).catch(() => {}))); await cleanupIncoming(request.files); response.status(error.status || 500).json({ error: error.message || 'Não foi possível atualizar o diário.' }) }
  })

  router.delete('/api/work-diaries/:id', ...attachPermissions(async (request, response) => {
    try {
      const entry = await getEntry(request.params.id, request.user.company_id)
      if (!entry) return response.status(404).json({ error: 'Registro de diário não encontrado.' })
      const details = storedPhotos(entry)
      await db.run('DELETE FROM work_diaries WHERE id = ? AND company_id = ?', [entry.id, request.user.company_id])
      await Promise.all([entry.pdf_path, ...details.map((photo) => photo.path)].filter(Boolean).map((filePath) => removeFile(filePath).catch(() => {})))
      await audit(request.user, 'EXCLUIR', 'DIARIO_DE_OBRA', entry.id, { project_id: entry.project_id, entry_date: entry.entry_date, entry_type: entry.entry_type }, null)
      response.status(204).end()
    } catch { response.status(500).json({ error: 'Não foi possível excluir o registro.' }) }
  }, 'delete'))

  router.get('/api/work-diaries/:id/file', ...attachPermissions(async (request, response) => {
    try {
      const entry = await getEntry(request.params.id, request.user.company_id)
      if (!entry) return response.status(404).json({ error: 'Registro de diário não encontrado.' })
      const kind = request.query.kind === 'photo' ? 'photo' : 'pdf'
      const photo = kind === 'photo' ? storedPhotos(entry).find((item) => item.id === request.query.photo_id) : null
      const file = kind === 'photo' ? photo : (entry.entry_type === 'PDF' ? { path: entry.pdf_path, name: entry.pdf_name, mimeType: 'application/pdf' } : null)
      if (!file?.path) return response.status(404).json({ error: 'Arquivo não encontrado.' })
      await audit(request.user, 'DOWNLOAD', 'DIARIO_DE_OBRA', entry.id)
      const inline = request.query.inline === '1'
      const safeName = String(file.name || 'diario').replace(/[\r\n"]/g, '_')
      response.setHeader('Content-Type', file.mimeType || 'application/octet-stream')
      response.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`)
      if (supabase && file.path.startsWith('supabase:')) {
        const stored = await supabase.storage.from('nexora-documents').download(file.path.slice('supabase:'.length))
        if (stored.error) throw stored.error
        return response.send(Buffer.from(await stored.data.arrayBuffer()))
      }
      if (!fs.existsSync(file.path)) return response.status(404).json({ error: 'Arquivo não encontrado.' })
      response.sendFile(path.resolve(file.path))
    } catch (error) { if (!response.headersSent) response.status(500).json({ error: 'Não foi possível abrir o arquivo.' }) }
  }, 'view'))

  return router
}

module.exports = createWorkDiaryRoutes
