const express = require('express')
const PDFDocument = require('pdfkit')

const nrCatalog = [
  ['NR-01', 'Disposições Gerais e Gerenciamento de Riscos Ocupacionais'],
  ['NR-05', 'Comissão Interna de Prevenção de Acidentes e de Assédio'],
  ['NR-06', 'Equipamentos de Proteção Individual'],
  ['NR-10', 'Segurança em Instalações e Serviços em Eletricidade'],
  ['NR-11', 'Transporte, Movimentação, Armazenagem e Manuseio de Materiais'],
  ['NR-12', 'Segurança no Trabalho em Máquinas e Equipamentos'],
  ['NR-18', 'Segurança e Saúde no Trabalho na Indústria da Construção'],
  ['NR-20', 'Segurança e Saúde no Trabalho com Inflamáveis e Combustíveis'],
  ['NR-33', 'Segurança e Saúde nos Trabalhos em Espaços Confinados'],
  ['NR-35', 'Trabalho em Altura'],
]
const catalog = new Map(nrCatalog)
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

function createSafetyRoutes({ db, auth, requirePermission, audit }) {
  const router = express.Router()
  const permission = (action) => [auth, requirePermission('safety_certificates', action)]

  router.get('/api/safety/employees', ...permission('view'), async (request, response) => {
    try {
      response.json(await db.all('SELECT id, name, document, job_title, department, email, phone, status FROM employees WHERE company_id = ? ORDER BY CASE status WHEN \'ATIVO\' THEN 0 ELSE 1 END, name', [request.user.company_id]))
    } catch { response.status(500).json({ error: 'Não foi possível carregar os funcionários.' }) }
  })

  router.get('/api/safety/certificates', ...permission('view'), async (request, response) => {
    try {
      const rows = await db.all('SELECT c.*, e.name AS employee_name, e.document AS employee_document FROM safety_certificates c JOIN employees e ON e.id = c.employee_id AND e.company_id = c.company_id WHERE c.company_id = ? ORDER BY c.issue_date DESC, c.created_at DESC', [request.user.company_id])
      response.json(rows)
    } catch { response.status(500).json({ error: 'Não foi possível carregar os certificados.' }) }
  })

  router.post('/api/safety/certificates', ...permission('create'), async (request, response) => {
    const employeeId = String(request.body?.employee_id || '')
    const issueDate = String(request.body?.issue_date || '')
    const expiresAt = request.body?.expires_at ? String(request.body.expires_at) : null
    const instructorName = String(request.body?.instructor_name || '').trim().slice(0, 160)
    const instructorRegistration = String(request.body?.instructor_registration || '').trim().slice(0, 100) || null
    const certificates = Array.isArray(request.body?.certificates) ? request.body.certificates : []
    if (!employeeId || !validDate(issueDate) || (expiresAt && !validDate(expiresAt)) || !instructorName || !certificates.length || certificates.length > nrCatalog.length) return response.status(400).json({ error: 'Confira o funcionário, as datas, o responsável e as NRs selecionadas.' })
    const employee = await db.get('SELECT id, name FROM employees WHERE id = ? AND company_id = ?', [employeeId, request.user.company_id])
    if (!employee) return response.status(404).json({ error: 'Funcionário não encontrado nesta empresa.' })
    const unique = new Set()
    const items = []
    for (const item of certificates) {
      const nrCode = String(item?.nr_code || '').toUpperCase()
      const courseName = catalog.get(nrCode)
      const hours = Number(item?.workload_hours)
      if (!courseName || unique.has(nrCode) || !Number.isFinite(hours) || hours <= 0 || hours > 1000) return response.status(400).json({ error: 'Uma NR ou carga horária selecionada é inválida.' })
      unique.add(nrCode)
      items.push({ nrCode, courseName, hours, content: String(item?.content || '').trim().slice(0, 4000) || null })
    }
    try {
      const created = []
      await db.transaction(async () => {
        for (const item of items) {
          const id = require('crypto').randomUUID()
          await db.run('INSERT INTO safety_certificates (id, company_id, employee_id, nr_code, course_name, workload_hours, issue_date, expires_at, instructor_name, instructor_registration, content, issued_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, request.user.company_id, employee.id, item.nrCode, item.courseName, item.hours, issueDate, expiresAt, instructorName, instructorRegistration, item.content, request.user.id])
          created.push(await db.get('SELECT c.*, e.name AS employee_name, e.document AS employee_document FROM safety_certificates c JOIN employees e ON e.id = c.employee_id AND e.company_id = c.company_id WHERE c.id = ? AND c.company_id = ?', [id, request.user.company_id]))
        }
      })
      await audit(request.user, 'EMITIR_CERTIFICADOS', 'SEGURANCA', employee.id, null, { certificates: created.map(({ id, nr_code }) => ({ id, nr_code })) })
      response.status(201).json(created)
    } catch (error) { console.error(error); response.status(500).json({ error: 'Não foi possível emitir os certificados.' }) }
  })

  router.get('/api/safety/certificates/:id/download', ...permission('export'), async (request, response) => {
    try {
      const certificate = await db.get('SELECT c.*, e.name AS employee_name, e.document AS employee_document, co.name AS company_name FROM safety_certificates c JOIN employees e ON e.id = c.employee_id AND e.company_id = c.company_id JOIN companies co ON co.id = c.company_id WHERE c.id = ? AND c.company_id = ?', [request.params.id, request.user.company_id])
      if (!certificate) return response.status(404).json({ error: 'Certificado não encontrado.' })
      const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 54 })
      const chunks = []
      pdf.on('data', (chunk) => chunks.push(chunk))
      pdf.on('end', () => {
        response.setHeader('Content-Type', 'application/pdf')
        response.setHeader('Content-Disposition', `attachment; filename="certificado-${certificate.nr_code.toLowerCase()}-${certificate.id}.pdf"`)
        response.setHeader('Cache-Control', 'private, no-store')
        response.send(Buffer.concat(chunks))
      })
      pdf.rect(24, 24, 794, 547).lineWidth(2).strokeColor('#1682a7').stroke()
      pdf.fontSize(12).fillColor('#1682a7').text(String(certificate.company_name).toUpperCase(), { align: 'center' })
      pdf.moveDown(1.5).fontSize(28).fillColor('#17394c').text('CERTIFICADO DE PARTICIPAÇÃO', { align: 'center' })
      pdf.moveDown(1.2).fontSize(14).fillColor('#405965').text('Certificamos que', { align: 'center' })
      pdf.moveDown(0.5).fontSize(25).fillColor('#17394c').text(certificate.employee_name, { align: 'center' })
      if (certificate.employee_document) pdf.moveDown(0.25).fontSize(11).fillColor('#71858f').text(`CPF: ${certificate.employee_document}`, { align: 'center' })
      pdf.moveDown(0.8).fontSize(14).fillColor('#405965').text(`concluiu o treinamento ${certificate.nr_code} — ${certificate.course_name}`, { align: 'center', width: 680, align: 'center' })
      pdf.moveDown(0.6).fontSize(12).text(`Carga horária: ${certificate.workload_hours} hora(s)`, { align: 'center' })
      if (certificate.content) pdf.moveDown(0.8).fontSize(11).text(`Conteúdo programático: ${certificate.content}`, { align: 'center', width: 680 })
      pdf.moveDown(1.2).fontSize(12).text(`Data de emissão: ${new Date(`${certificate.issue_date}T12:00:00`).toLocaleDateString('pt-BR')}${certificate.expires_at ? `   •   Validade até: ${new Date(`${certificate.expires_at}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}`, { align: 'center' })
      pdf.moveDown(2).fontSize(12).fillColor('#17394c').text(certificate.instructor_name, { align: 'center' })
      pdf.fontSize(10).fillColor('#71858f').text(certificate.instructor_registration ? `Responsável pelo treinamento · ${certificate.instructor_registration}` : 'Responsável pelo treinamento', { align: 'center' })
      pdf.end()
    } catch (error) { console.error(error); if (!response.headersSent) response.status(500).json({ error: 'Não foi possível gerar o arquivo do certificado.' }) }
  })

  return router
}

module.exports = { createSafetyRoutes, nrCatalog }
