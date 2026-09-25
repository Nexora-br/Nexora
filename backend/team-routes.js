const express = require('express')
const crypto = require('crypto')

function createTeamRoutes({ db, auth, requirePermission, audit }) {
  const router = express.Router()
  const permission = (action) => [auth, requirePermission('teams', action)]
  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }
  const previousDate = (value) => {
    const date = new Date(`${value}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() - 1)
    return date.toISOString().slice(0, 10)
  }

  router.get('/api/teams', ...permission('view'), async (request, response) => {
    try {
      const companyId = request.user.company_id
      const [projects, employees, allocations] = await Promise.all([
        db.all('SELECT id, code, name, location, status, start_date, end_date FROM projects WHERE company_id = ? ORDER BY name', [companyId]),
        db.all("SELECT id, name, job_title, department FROM employees WHERE company_id = ? AND status = 'ATIVO' ORDER BY name", [companyId]),
        db.all('SELECT a.*, e.name AS employee_name, p.name AS project_name, p.code AS project_code FROM project_team_allocations a JOIN employees e ON e.id = a.employee_id AND e.company_id = a.company_id JOIN projects p ON p.id = a.project_id AND p.company_id = a.company_id WHERE a.company_id = ? ORDER BY a.start_date DESC, e.name ASC', [companyId]),
      ])
      response.json({ projects, employees, allocations })
    } catch (error) { console.error(error); response.status(500).json({ error: 'Não foi possível carregar as equipes das obras.' }) }
  })

  router.post('/api/teams/allocations', ...permission('create'), async (request, response) => {
    const { project_id: projectId, employee_id: employeeId, start_date: startDate, end_date: endDate, job_title: jobTitle, notes } = request.body || {}
    if (!projectId || !employeeId || !validDate(startDate) || (endDate && !validDate(endDate))) return response.status(400).json({ error: 'Informe a obra, o funcionário e um período válido.' })
    if (endDate && endDate < startDate) return response.status(400).json({ error: 'A data de encerramento não pode ser anterior ao início da alocação.' })
    const companyId = request.user.company_id
    try {
      const [project, employee] = await Promise.all([
        db.get("SELECT id, name FROM projects WHERE id = ? AND company_id = ? AND status NOT IN ('FINALIZADO', 'CANCELADO')", [projectId, companyId]),
        db.get("SELECT id, name, status FROM employees WHERE id = ? AND company_id = ?", [employeeId, companyId]),
      ])
      if (!project) return response.status(404).json({ error: 'Selecione uma obra cadastrada e em andamento.' })
      if (!employee || employee.status !== 'ATIVO') return response.status(404).json({ error: 'Só é possível alocar funcionários ativos já cadastrados.' })

      const overlaps = await db.all("SELECT * FROM project_team_allocations WHERE company_id = ? AND employee_id = ? AND start_date <= ? AND COALESCE(end_date, '9999-12-31') >= ? ORDER BY start_date", [companyId, employeeId, endDate || '9999-12-31', startDate])
      const allocationId = crypto.randomUUID()
      const closed = []
      for (const current of overlaps) {
        if (current.project_id === projectId && current.end_date === null) return response.status(409).json({ error: 'Este funcionário já está alocado a esta obra.' })
        if (current.end_date === null && current.start_date < startDate) closed.push({ id: current.id, end_date: previousDate(startDate), project_id: current.project_id })
        else return response.status(409).json({ error: 'O período informado coincide com outra alocação deste funcionário. Ajuste as datas antes de continuar.' })
      }

      await db.transaction(async () => {
        for (const item of closed) await db.run('UPDATE project_team_allocations SET end_date = ? WHERE id = ? AND company_id = ?', [item.end_date, item.id, companyId])
        await db.run('INSERT INTO project_team_allocations (id, company_id, project_id, employee_id, job_title, start_date, end_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [allocationId, companyId, projectId, employeeId, String(jobTitle || '').trim() || employee.job_title || null, startDate, endDate || null, String(notes || '').trim() || null, request.user.id])
      })
      await audit(request.user, 'ALOCAR_FUNCIONARIO', 'EQUIPES', allocationId, null, { project_id: projectId, project_name: project.name, employee_id: employeeId, employee_name: employee.name, start_date: startDate, end_date: endDate || null, realocacao_de: closed })
      response.status(201).json({ id: allocationId, project_id: projectId, employee_id: employeeId, start_date: startDate, end_date: endDate || null })
    } catch (error) { console.error(error); response.status(500).json({ error: 'Não foi possível alocar o funcionário à obra.' }) }
  })

  router.patch('/api/teams/allocations/:id/end', ...permission('edit'), async (request, response) => {
    const endDate = request.body?.end_date
    if (!validDate(endDate)) return response.status(400).json({ error: 'Informe uma data válida para encerrar a alocação.' })
    try {
      const allocation = await db.get('SELECT a.*, e.name AS employee_name, p.name AS project_name FROM project_team_allocations a JOIN employees e ON e.id = a.employee_id AND e.company_id = a.company_id JOIN projects p ON p.id = a.project_id AND p.company_id = a.company_id WHERE a.id = ? AND a.company_id = ?', [request.params.id, request.user.company_id])
      if (!allocation) return response.status(404).json({ error: 'Alocação não encontrada.' })
      if (allocation.end_date) return response.status(409).json({ error: 'Esta alocação já foi encerrada.' })
      if (endDate < allocation.start_date) return response.status(400).json({ error: 'A data de encerramento não pode ser anterior ao início.' })
      await db.run('UPDATE project_team_allocations SET end_date = ? WHERE id = ? AND company_id = ?', [endDate, allocation.id, request.user.company_id])
      await audit(request.user, 'ENCERRAR_ALOCACAO', 'EQUIPES', allocation.id, { end_date: null }, { end_date: endDate, employee_name: allocation.employee_name, project_name: allocation.project_name })
      response.json({ ...allocation, end_date: endDate })
    } catch (error) { console.error(error); response.status(500).json({ error: 'Não foi possível encerrar a alocação.' }) }
  })

  return router
}

module.exports = createTeamRoutes
