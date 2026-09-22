const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const db = require('./db')

async function seed() {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const projectId = crypto.randomUUID()
  const passwordHash = await bcrypt.hash('nexora123', 12)
  await db.run('INSERT OR IGNORE INTO companies (id, legal_name, trade_name, email) VALUES (?, ?, ?, ?)', [companyId, 'Nexora Grãos Demo Ltda.', 'Nexora Grãos Demo', 'demo@nexora.local'])
  const role = await db.get('SELECT id FROM roles WHERE name = ?', ['ADMINISTRADOR'])
  await db.run('INSERT OR IGNORE INTO users (id, company_id, name, email, password_hash, job_title) VALUES (?, ?, ?, ?, ?, ?)', [userId, companyId, 'Administrador Demo', 'demo@nexora.local', passwordHash, 'Administrador'])
  await db.run('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id])
  await db.run('INSERT OR IGNORE INTO subscriptions (id, company_id, plan) VALUES (?, ?, ?)', [crypto.randomUUID(), companyId, 'PROFISSIONAL'])
  await db.run('INSERT OR IGNORE INTO projects (id, company_id, code, name, location, city, state, start_date, end_date, contracted_value, expected_cost, progress, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [projectId, companyId, 'NX-DEMO-01', 'Obra Demo Nexora', 'Rio Verde, GO', 'Rio Verde', 'GO', '2026-09-01', '2026-12-20', 250000, 170000, 35, 'EM_EXECUCAO'])
  console.log('Seed criado: demo@nexora.local / nexora123')
}

seed().catch((error) => { console.error(error); process.exitCode = 1 })
