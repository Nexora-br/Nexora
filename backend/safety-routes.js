const express = require('express')
const PDFDocument = require('pdfkit')
const path = require('path')

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
const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const dateLong = (value) => { const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number); return `${day} de ${monthNames[month - 1]} de ${year}` }
function companySite(company) { const address = [company.address, company.address_number, company.district].filter(Boolean).join(', '); const city = [company.city, company.state].filter(Boolean).join('/'); const detail = [address, city].filter(Boolean).join(' - '); return detail ? `${company.trade_name} - ${detail}` : company.trade_name }
function drawCenteredFit(pdf, value, x, y, width, maxSize = 15, minSize = 9) { let size = maxSize; pdf.font('Helvetica-Bold'); while (size > minSize && pdf.widthOfString(value, { size }) > width - 8) size -= 0.5; pdf.fontSize(size).text(value, x, y, { width, align: 'center', lineBreak: false }) }
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

function createSafetyRoutes({ db, auth, requirePermission, audit }) {
  const router = express.Router()
  const permission = (action) => [auth, requirePermission('safety_certificates', action)]
  const canDownloadEmployeeCertificate = (request, response, next) => { const permissions = request.user.permissions || []; if (request.user.role === 'ADMINISTRADOR' || permissions.includes('*.*') || permissions.includes('safety_certificates.export') || permissions.includes('employees.download')) return next(); return response.status(403).json({ error: 'Você não tem permissão para baixar este certificado.' }) }

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
    const technicalEmployee = await db.get("SELECT name FROM employees WHERE company_id = ? AND status = 'ATIVO' AND LOWER(COALESCE(job_title, '')) LIKE '%seguran%' ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, name LIMIT 1", [request.user.company_id, request.user.id])
    const instructorName = String(technicalEmployee?.name || request.user.name || '').trim().slice(0, 160)
    const instructorRegistration = null
    const certificates = Array.isArray(request.body?.certificates) ? request.body.certificates : []
    if (!employeeId || !validDate(issueDate) || (expiresAt && !validDate(expiresAt)) || !instructorName || !certificates.length || certificates.length > nrCatalog.length) return response.status(400).json({ error: 'Confira o funcionário, as datas e as NRs selecionadas.' })
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
      items.push({ nrCode, courseName, hours, content: courseName })
    }
    try {
      const created = []
      await db.transaction(async () => {
        let certificateFolder = await db.get('SELECT id FROM employee_document_folders WHERE employee_id = ? AND company_id = ? AND name = ? AND parent_id IS NULL', [employee.id, request.user.company_id, 'Certificados'])
        if (!certificateFolder) { const folderId = require('crypto').randomUUID(); await db.run('INSERT INTO employee_document_folders (id, company_id, employee_id, parent_id, name, created_by) VALUES (?, ?, ?, NULL, ?, ?)', [folderId, request.user.company_id, employee.id, 'Certificados', request.user.id]); certificateFolder = { id: folderId } }
        for (const item of items) {
          const id = require('crypto').randomUUID()
          await db.run('INSERT INTO safety_certificates (id, company_id, employee_id, nr_code, course_name, workload_hours, issue_date, expires_at, instructor_name, instructor_registration, content, issued_by, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, request.user.company_id, employee.id, item.nrCode, item.courseName, item.hours, issueDate, expiresAt, instructorName, instructorRegistration, item.content, request.user.id, certificateFolder.id])
          created.push(await db.get('SELECT c.*, e.name AS employee_name, e.document AS employee_document FROM safety_certificates c JOIN employees e ON e.id = c.employee_id AND e.company_id = c.company_id WHERE c.id = ? AND c.company_id = ?', [id, request.user.company_id]))
        }
      })
      await audit(request.user, 'EMITIR_CERTIFICADOS', 'SEGURANCA', employee.id, null, { certificates: created.map(({ id, nr_code }) => ({ id, nr_code })) })
      response.status(201).json(created)
    } catch (error) { console.error(error); response.status(500).json({ error: 'Não foi possível emitir os certificados.' }) }
  })

  router.get('/api/safety/certificates/:id/download', auth, canDownloadEmployeeCertificate, async (request, response) => {
    try {
      const certificate = await db.get('SELECT c.*, e.name AS employee_name, e.document AS employee_document, co.trade_name AS company_name, co.legal_name, co.address, co.address_number, co.district, co.city, co.state FROM safety_certificates c JOIN employees e ON e.id = c.employee_id AND e.company_id = c.company_id JOIN companies co ON co.id = c.company_id WHERE c.id = ? AND c.company_id = ?', [request.params.id, request.user.company_id])
      if (!certificate) return response.status(404).json({ error: 'Certificado não encontrado.' })
      const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false })
      const chunks = []
      pdf.on('data', (chunk) => chunks.push(chunk))
      pdf.on('end', () => {
        response.setHeader('Content-Type', 'application/pdf')
        response.setHeader('Content-Disposition', `attachment; filename="certificado-${certificate.nr_code.toLowerCase()}-${certificate.id}.pdf"`)
        response.setHeader('Cache-Control', 'private, no-store')
        response.send(Buffer.concat(chunks))
      })
      pdf.addPage({ size: 'A4', layout: 'landscape', margin: 0 })
      const pageWidth = pdf.page.width
      const pageHeight = pdf.page.height
      pdf.image(path.join(__dirname, 'assets', 'certificate-template.png'), 0, 0, { width: pageWidth, height: pageHeight })
      const scaleX = pageWidth / 2000
      const scaleY = pageHeight / 1414
      pdf.image(path.join(__dirname, 'assets', 'certificate-medal-center.png'), 176 * scaleX, 189 * scaleY, { width: 138 * scaleX, height: 138 * scaleY })
      const fullDate = dateLong(certificate.issue_date)
      const site = companySite(certificate)
      const narrative = `Certificamos que ${certificate.employee_name} concluiu com aproveitamento satisfatório o “Curso básico de ${certificate.nr_code}, ${certificate.course_name}”, realizado no dia ${fullDate} nas dependências do estabelecimento ${site}, ${fullDate}.`
      // The white fields cover the editable placeholders in the supplied artwork.
      pdf.fillColor('#fbfbfc').rect(92, 322, pageWidth - 184, 91).fill()
      const narrativeWidth = pageWidth - 206
      let bodySize = 13.4
      pdf.font('Helvetica')
      while (bodySize > 11 && pdf.heightOfString(narrative, { width: narrativeWidth, fontSize: bodySize, lineGap: 2 }) > 78) bodySize -= 0.4
      pdf.fillColor('#152638').fontSize(bodySize).text(narrative, 103, 330, { width: narrativeWidth, height: 78, align: 'center', lineGap: 2, paragraphGap: 0 })
      pdf.fillColor('#fbfbfc').rect(187, 425, 215, 60).fill()
      pdf.fillColor('#fbfbfc').rect(423, 420, 235, 69).fill()
      pdf.fillColor('#173d62')
      pdf.font('Helvetica-Bold').fillColor('#523815').fontSize(12).text(certificate.nr_code, 73, 101, { width: 60, align: 'center', lineBreak: false })
      drawCenteredFit(pdf, certificate.company_name || certificate.legal_name, 190, 443, 220, 15, 9)
      drawCenteredFit(pdf, certificate.instructor_name, 428, 439, 225, 14, 9)
      pdf.end()
    } catch (error) { console.error(error); if (!response.headersSent) response.status(500).json({ error: 'Não foi possível gerar o arquivo do certificado.' }) }
  })

  return router
}

module.exports = { createSafetyRoutes, nrCatalog }
