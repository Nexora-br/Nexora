const path = require('path')
const { Pool } = require('pg')
const { AsyncLocalStorage } = require('async_hooks')

const usingPostgres = Boolean(process.env.DATABASE_URL)
const sqlite3 = usingPostgres ? null : require('sqlite3').verbose()
const transactionContext = new AsyncLocalStorage()

let postgresPool = null
let postgresReady = Promise.resolve()
let postgresError = null

if (usingPostgres) {
	try {
		postgresPool = new Pool({
			connectionString: process.env.DATABASE_URL,
			ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
			connectionTimeoutMillis: 5000,
			idleTimeoutMillis: 30000,
			max: 20,
		})

		postgresPool.on('error', (error) => {
			postgresError = error
			console.error('PostgreSQL Pool Error:', error.message, error.code)
		})

		postgresPool.on('connect', () => {
			postgresError = null
			console.log('PostgreSQL connected successfully')
		})
	} catch (error) {
		postgresError = error
		console.error('Failed to create PostgreSQL Pool:', error.message)
	}
}

function postgresSql(sql) {
	const ignoredInsert = /\bINSERT OR IGNORE\b/i.test(sql)
	let next = sql
		.replace(/PRAGMA foreign_keys = ON;\s*/i, '')
		.replace(/INSERT OR IGNORE INTO roles \(id, name\) VALUES \('role-admin', 'ADMINISTRADOR'\);/i, "INSERT INTO roles (id, name) VALUES ('role-admin', 'ADMINISTRADOR') ON CONFLICT DO NOTHING;")
		.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
		.replace(/strftime\('%Y-%m', 'now'\)/gi, "to_char(CURRENT_TIMESTAMP, 'YYYY-MM')")
		.replace(/strftime\('%Y-%m', ([^)]+)\)/gi, "to_char($1::timestamp, 'YYYY-MM')")
		.replace(/strftime\('%d\/%m\/%Y', ([^)]+)\)/gi, "to_char($1::timestamp, 'DD/MM/YYYY')")
		.replace(/datetime\(([^)]+)\)\s*>=\s*datetime\('now'\)/gi, '$1::timestamp >= CURRENT_TIMESTAMP')
		.replace(/date\(([^)]+)\)\s*(>=|<=)\s*date\(\?\)/gi, 'CAST($1 AS DATE) $2 CAST(? AS DATE)')
		.replace(/"([A-Za-zÀ-ÿ ]+)"\s+AS/g, "'$1' AS")
	if (ignoredInsert && !/ON CONFLICT DO NOTHING/i.test(next)) next = `${next.trim().replace(/;$/, '')} ON CONFLICT DO NOTHING`
	let index = 0
	return next.replace(/\?/g, () => `$${++index}`)
}

function enqueuePostgres(work) {
	const queued = postgresReady.then(work)
	postgresReady = queued.catch(() => undefined)
	return queued
}

function postgresDatabase() {
	const execute = (sql, params) => {
		if (postgresError) {
			const error = new Error(`Database connection error: ${postgresError.message} (${postgresError.code})`)
			error.originalError = postgresError
			return Promise.reject(error)
		}
		const client = transactionContext.getStore()
		if (client) return client.query(postgresSql(sql), params)
		return enqueuePostgres(() => postgresPool.query(postgresSql(sql), params)).catch((error) => {
			console.error('PostgreSQL Query Error:', {
				code: error.code,
				message: error.message,
				detail: error.detail,
				sql: sql.substring(0, 100),
			})
			throw error
		})
	}
	return {
		exec(sql) {
			execute(sql).catch((error) => console.error('DB Exec Error:', error.message))
		},
		run(sql, params, callback) {
			if (typeof params === 'function') { callback = params; params = [] }
			execute(sql, params || []).then(
				(result) => callback?.call({ lastID: null, changes: result.rowCount }, null),
				(error) => { if (callback) callback.call({ lastID: null, changes: 0 }, error); else console.error('DB Run Error:', error.message) },
			)
			return this
		},
		get(sql, params, callback) {
			if (typeof params === 'function') { callback = params; params = [] }
			execute(sql, params || []).then((result) => callback?.(null, result.rows[0]), (error) => { if (callback) callback(error); else console.error('DB Get Error:', error.message) })
			return this
		},
		all(sql, params, callback) {
			if (typeof params === 'function') { callback = params; params = [] }
			execute(sql, params || []).then((result) => callback?.(null, result.rows), (error) => { if (callback) callback(error); else console.error('DB All Error:', error.message) })
			return this
		},
		close(callback) {
			if (!postgresPool) return callback?.(null)
			postgresPool.end().then(() => callback?.(null), (error) => { if (callback) callback(error); else console.error('DB Close Error:', error.message) })
		},
	}
}

const database = usingPostgres ? postgresDatabase() : new sqlite3.Database(process.env.NEXORA_DB_PATH || path.join(__dirname, 'nexora.sqlite'))

database.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, legal_name TEXT NOT NULL, trade_name TEXT NOT NULL, cnpj TEXT, email TEXT, phone TEXT, segment TEXT, zip_code TEXT, address TEXT, address_number TEXT, complement TEXT, district TEXT, city TEXT, state TEXT, website TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_cnpj_unique ON companies(cnpj) WHERE cnpj IS NOT NULL AND cnpj <> '';
CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS permissions (id TEXT PRIMARY KEY, module TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(module, action));
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), name TEXT NOT NULL, email TEXT NOT NULL, password_hash TEXT NOT NULL, phone TEXT, job_title TEXT, status TEXT NOT NULL DEFAULT 'ATIVO', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, email));
CREATE TABLE IF NOT EXISTS company_access_requests (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT NOT NULL, password_hash TEXT NOT NULL, phone TEXT, job_title TEXT, department TEXT, status TEXT NOT NULL DEFAULT 'PENDENTE', linked_user_id TEXT REFERENCES users(id), reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT, review_note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_company_access_requests_company_status ON company_access_requests(company_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_access_requests_pending_email ON company_access_requests(company_id, lower(trim(email))) WHERE status = 'PENDENTE';
CREATE TABLE IF NOT EXISTS user_roles (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_id TEXT NOT NULL REFERENCES roles(id), PRIMARY KEY(user_id, role_id));
CREATE TABLE IF NOT EXISTS role_permissions (role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE, PRIMARY KEY(role_id, permission_id));
CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, legal_name TEXT NOT NULL, trade_name TEXT, document TEXT, email TEXT, phone TEXT, address TEXT, city TEXT, state TEXT, notes TEXT, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, legal_name TEXT NOT NULL, trade_name TEXT, document TEXT, state_registration TEXT, email TEXT, phone TEXT, zip_code TEXT, address TEXT, address_number TEXT, complement TEXT, district TEXT, city TEXT, state TEXT, contact_name TEXT, category TEXT, payment_terms TEXT, bank TEXT, bank_branch TEXT, bank_account TEXT, pix_key TEXT, notes TEXT, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, code TEXT NOT NULL, name TEXT NOT NULL, client_id TEXT REFERENCES clients(id), contractor_document TEXT, location TEXT, city TEXT, state TEXT, start_date TEXT, end_date TEXT, actual_end_date TEXT, contracted_value REAL NOT NULL DEFAULT 0, expected_cost REAL NOT NULL DEFAULT 0, actual_cost REAL NOT NULL DEFAULT 0, progress REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'PLANEJAMENTO', description TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(company_id, code));
CREATE TABLE IF NOT EXISTS project_stages (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, responsible TEXT, start_date TEXT, end_date TEXT, progress REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'PENDENTE', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, project_id TEXT REFERENCES projects(id), created_by TEXT REFERENCES users(id), title TEXT NOT NULL, responsible TEXT, due_date TEXT, status TEXT NOT NULL DEFAULT 'ABERTA', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS task_recipients (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'PENDENTE', read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(task_id, recipient_user_id));
CREATE TABLE IF NOT EXISTS task_messages (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, sender_id TEXT NOT NULL REFERENCES users(id), message TEXT NOT NULL, message_type TEXT NOT NULL DEFAULT 'TEXTO', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_task_recipients_user ON task_recipients(company_id, recipient_user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_task_messages_thread ON task_messages(company_id, task_id, created_at);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, sku TEXT, name TEXT NOT NULL, category TEXT, unit TEXT NOT NULL DEFAULT 'UN', min_stock REAL NOT NULL DEFAULT 0, max_stock REAL, cost_unit REAL NOT NULL DEFAULT 0, supplier_id TEXT REFERENCES suppliers(id), archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), quantity REAL NOT NULL DEFAULT 0, reserved_quantity REAL NOT NULL DEFAULT 0, project_id TEXT REFERENCES projects(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS inventory_movements (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), project_id TEXT REFERENCES projects(id), type TEXT NOT NULL, quantity REAL NOT NULL, user_id TEXT REFERENCES users(id), note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS purchase_requests (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, number TEXT, project_id TEXT REFERENCES projects(id), requester_id TEXT REFERENCES users(id), cost_center TEXT, priority TEXT, requested_date TEXT, needed_date TEXT, justification TEXT, observations TEXT, status TEXT NOT NULL DEFAULT 'ABERTA', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS purchase_orders (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, number TEXT, supplier_id TEXT REFERENCES suppliers(id), project_id TEXT REFERENCES projects(id), status TEXT NOT NULL DEFAULT 'ABERTA', total REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS quotations (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, purchase_request_id TEXT REFERENCES purchase_requests(id), supplier_id TEXT REFERENCES suppliers(id), unit_price REAL NOT NULL DEFAULT 0, freight REAL NOT NULL DEFAULT 0, delivery_days INTEGER, payment_terms TEXT, valid_until TEXT, total REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ABERTA', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS accounts_payable (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, supplier_id TEXT REFERENCES suppliers(id), project_id TEXT REFERENCES projects(id), category TEXT, cost_center TEXT, description TEXT NOT NULL, document_number TEXT, issue_date TEXT, competence TEXT, due_date TEXT NOT NULL, amount REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, interest REAL NOT NULL DEFAULT 0, fine REAL NOT NULL DEFAULT 0, payment_method TEXT, bank_account TEXT, observations TEXT, status TEXT NOT NULL DEFAULT 'PENDENTE', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS accounts_receivable (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), client_id TEXT REFERENCES clients(id), project_id TEXT REFERENCES projects(id), category TEXT, revenue_center TEXT, description TEXT NOT NULL, document_number TEXT, issue_date TEXT, competence TEXT, due_date TEXT NOT NULL, amount REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, interest REAL NOT NULL DEFAULT 0, receipt_method TEXT, bank_account TEXT, observations TEXT, status TEXT NOT NULL DEFAULT 'PENDENTE', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS financial_transactions (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, project_id TEXT REFERENCES projects(id), user_id TEXT REFERENCES users(id), description TEXT NOT NULL, category TEXT, cost_center TEXT, amount REAL NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CONFIRMADA', transaction_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS cost_centers (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id), name TEXT NOT NULL, document TEXT, job_title TEXT, status TEXT NOT NULL DEFAULT 'ATIVO', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS employee_documents (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE, category TEXT NOT NULL, name TEXT NOT NULL, storage_path TEXT NOT NULL, file_size INTEGER NOT NULL DEFAULT 0, mime_type TEXT NOT NULL, issue_date TEXT, expires_at TEXT, notes TEXT, uploaded_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS employee_employment_history (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE, start_date TEXT NOT NULL, end_date TEXT NOT NULL, job_title TEXT, department TEXT, notes TEXT, recorded_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS project_team_allocations (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, employee_id TEXT NOT NULL REFERENCES employees(id), job_title TEXT, start_date TEXT NOT NULL, end_date TEXT, notes TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS equipment (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, code TEXT NOT NULL, name TEXT NOT NULL, type TEXT, brand TEXT, model TEXT, serial_number TEXT, year INTEGER, acquisition_date TEXT, value REAL NOT NULL DEFAULT 0, location TEXT, project_id TEXT REFERENCES projects(id), responsible TEXT, horometer REAL, mileage REAL, status TEXT NOT NULL DEFAULT 'DISPONIVEL', notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS field_activities (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, project_id TEXT REFERENCES projects(id), client_id TEXT REFERENCES clients(id), title TEXT NOT NULL, type TEXT, responsible TEXT, starts_at TEXT, ends_at TEXT, location TEXT, participants TEXT, description TEXT, status TEXT NOT NULL DEFAULT 'AGENDADA', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, project_id TEXT REFERENCES projects(id), client_id TEXT REFERENCES clients(id), number TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, starts_at TEXT, ends_at TEXT, status TEXT NOT NULL DEFAULT 'ATIVO', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS budgets (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, client_id TEXT REFERENCES clients(id), project_id TEXT REFERENCES projects(id), number TEXT NOT NULL, total REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'RASCUNHO', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, category TEXT, path TEXT, size INTEGER NOT NULL DEFAULT 0, mime_type TEXT, uploaded_by TEXT REFERENCES users(id), related_entity TEXT, related_id TEXT, archived INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS work_diaries (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), entry_type TEXT NOT NULL CHECK (entry_type IN ('ESTRUTURADO', 'PDF')), entry_date TEXT NOT NULL, weather TEXT, worker_count INTEGER NOT NULL DEFAULT 0, worker_details TEXT, equipment_used TEXT, equipment_notes TEXT, activities TEXT, occurrences TEXT, materials_received TEXT, observations TEXT, pdf_path TEXT, pdf_name TEXT, pdf_size INTEGER, photos TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id), title TEXT NOT NULL, body TEXT, read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id), action TEXT NOT NULL, module TEXT NOT NULL, record_id TEXT, old_value TEXT, new_value TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, company_id TEXT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE, plan TEXT NOT NULL DEFAULT 'NEXORA_PRO', status TEXT NOT NULL DEFAULT 'PENDENTE', amount REAL, payment_method TEXT, subscribed_at TEXT, next_charge_at TEXT, cancelled_at TEXT, renews_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscription_payments (id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, amount REAL NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'PAGAMENTO', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS product_categories (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, parent_id TEXT REFERENCES product_categories(id), archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS storage_locations (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, address TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS inventory_reservations (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id), project_id TEXT REFERENCES projects(id), quantity REAL NOT NULL, status TEXT NOT NULL DEFAULT 'ATIVA', user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS purchase_request_items (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, purchase_request_id TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE, product_id TEXT REFERENCES products(id), description TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'UN', needed_date TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS purchase_order_items (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE, product_id TEXT REFERENCES products(id), description TEXT NOT NULL, quantity REAL NOT NULL, received_quantity REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS maintenance_records (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, equipment_id TEXT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE, type TEXT NOT NULL, description TEXT, opened_at TEXT, scheduled_at TEXT, completed_at TEXT, responsible TEXT, supplier TEXT, cost REAL NOT NULL DEFAULT 0, horometer REAL, mileage REAL, parts_used TEXT, labor_cost REAL NOT NULL DEFAULT 0, next_due_at TEXT, observations TEXT, status TEXT NOT NULL DEFAULT 'AGENDADA', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);
CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_company_product ON inventory(company_id, product_id);
CREATE INDEX IF NOT EXISTS idx_financial_company_date ON financial_transactions(company_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_audit_company_created ON audit_logs(company_id, created_at);
INSERT OR IGNORE INTO roles (id, name) VALUES ('role-admin', 'ADMINISTRADOR');
`)
const permissionModules = ['dashboard', 'clients', 'projects', 'suppliers', 'purchases', 'quotations', 'inventory', 'finance', 'equipment', 'maintenance', 'agenda', 'documents', 'work_diary', 'employees', 'teams', 'reports', 'audit', 'users', 'settings', 'tasks', 'subscriptions']
const permissionActions = ['view', 'create', 'edit', 'delete', 'archive', 'approve', 'pay', 'receive', 'export', 'upload', 'download']
const defaultRoles = ['GESTOR', 'FINANCEIRO', 'COMPRAS', 'ESTOQUE', 'CAMPO', 'CONSULTA']
for (const roleName of ['ADMINISTRADOR', ...defaultRoles]) database.run('INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)', [`role-${roleName.toLowerCase()}`, roleName])
for (const module of permissionModules) for (const action of permissionActions) database.run('INSERT OR IGNORE INTO permissions (id, module, action) VALUES (?, ?, ?)', [`permission-${module}-${action}`, module, action])
for (const module of permissionModules) for (const action of permissionActions) database.run('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = ? AND p.module = ? AND p.action = ?', ['ADMINISTRADOR', module, action])
const roleRules = { GESTOR: ['view', 'create', 'edit', 'archive', 'approve'], FINANCEIRO: ['view', 'create', 'edit', 'pay', 'receive', 'export'], COMPRAS: ['view', 'create', 'edit', 'approve', 'receive', 'export'], ESTOQUE: ['view', 'create', 'edit', 'archive', 'receive'], CAMPO: ['view', 'create', 'edit'], CONSULTA: ['view'] }
for (const [roleName, actions] of Object.entries(roleRules)) for (const module of permissionModules.filter((item) => item !== 'employees')) for (const action of actions) database.run('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = ? AND p.module = ? AND p.action = ?', [roleName, module, action])
if (!usingPostgres) {
for (const column of ['segment', 'zip_code', 'address', 'address_number', 'complement', 'district', 'city', 'state', 'website']) database.run(`ALTER TABLE companies ADD COLUMN ${column} TEXT`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['department', 'email', 'phone', 'admission_date', 'termination_date', 'notes']) database.run(`ALTER TABLE employees ADD COLUMN ${column} TEXT`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
database.run('ALTER TABLE products ADD COLUMN archived INTEGER NOT NULL DEFAULT 0', (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['state_registration', 'zip_code', 'address', 'address_number', 'complement', 'district', 'contact_name', 'category', 'payment_terms', 'bank', 'bank_branch', 'bank_account', 'pix_key', 'archived']) database.run(`ALTER TABLE suppliers ADD COLUMN ${column} ${column === 'archived' ? 'INTEGER NOT NULL DEFAULT 0' : 'TEXT'}`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['number', 'cost_center', 'requested_date', 'needed_date', 'justification', 'observations']) database.run(`ALTER TABLE purchase_requests ADD COLUMN ${column} TEXT`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['number']) database.run(`ALTER TABLE purchase_orders ADD COLUMN ${column} TEXT`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['unit_price', 'freight', 'delivery_days', 'payment_terms', 'valid_until']) database.run(`ALTER TABLE quotations ADD COLUMN ${column} ${column === 'delivery_days' ? 'INTEGER' : column === 'unit_price' || column === 'freight' ? 'REAL' : 'TEXT'}`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['type', 'brand', 'model', 'serial_number', 'year', 'acquisition_date', 'value', 'location', 'responsible', 'horometer', 'mileage', 'notes']) database.run(`ALTER TABLE equipment ADD COLUMN ${column} ${['year'].includes(column) ? 'INTEGER' : ['value', 'horometer', 'mileage'].includes(column) ? 'REAL' : 'TEXT'}`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['client_id', 'responsible', 'ends_at', 'location', 'participants', 'description']) database.run(`ALTER TABLE field_activities ADD COLUMN ${column} TEXT`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['size', 'mime_type', 'uploaded_by', 'related_entity', 'related_id', 'archived']) database.run(`ALTER TABLE documents ADD COLUMN ${column} ${column === 'size' ? 'INTEGER NOT NULL DEFAULT 0' : column === 'archived' ? 'INTEGER NOT NULL DEFAULT 0' : 'TEXT'}`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['category', 'cost_center', 'document_number', 'issue_date', 'competence', 'discount', 'interest', 'fine', 'payment_method', 'bank_account', 'observations']) database.run(`ALTER TABLE accounts_payable ADD COLUMN ${column} ${['discount', 'interest', 'fine'].includes(column) ? 'REAL NOT NULL DEFAULT 0' : 'TEXT'}`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['category', 'revenue_center', 'document_number', 'issue_date', 'competence', 'discount', 'interest', 'receipt_method', 'bank_account', 'observations']) database.run(`ALTER TABLE accounts_receivable ADD COLUMN ${column} ${['discount', 'interest'].includes(column) ? 'REAL NOT NULL DEFAULT 0' : 'TEXT'}`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['opened_at', 'scheduled_at', 'completed_at', 'responsible', 'supplier', 'horometer', 'mileage', 'parts_used', 'labor_cost', 'observations']) database.run(`ALTER TABLE maintenance_records ADD COLUMN ${column} ${['horometer', 'mileage', 'labor_cost'].includes(column) ? 'REAL' : 'TEXT'}`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
for (const column of ['description', 'priority', 'archived', 'created_by']) database.run(`ALTER TABLE tasks ADD COLUMN ${column} ${column === 'archived' ? 'INTEGER NOT NULL DEFAULT 0' : 'TEXT'}`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
}
if (usingPostgres) for (const column of ['segment', 'zip_code', 'address', 'address_number', 'complement', 'district', 'city', 'state', 'website']) database.run(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS ${column} TEXT`, (error) => { if (error) console.error(error) })
const subscriptionColumns = [['amount', 'REAL'], ['payment_method', 'TEXT'], ['subscribed_at', 'TEXT'], ['next_charge_at', 'TEXT'], ['cancelled_at', 'TEXT']]
if (!usingPostgres) for (const [column, type] of subscriptionColumns) database.run(`ALTER TABLE subscriptions ADD COLUMN ${column} ${type}`, (error) => { if (error && !error.message.includes('duplicate column')) console.error(error) })
if (usingPostgres) for (const [column, type] of subscriptionColumns) database.run(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ${column} ${type}`, (error) => { if (error) console.error(error) })
if (usingPostgres) for (const column of ['department', 'email', 'phone', 'admission_date', 'termination_date', 'notes']) database.run(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS ${column} TEXT`, (error) => { if (error) console.error(error) })
if (usingPostgres) {
for (const [column, type] of [['description', 'TEXT'], ['priority', 'TEXT'], ['archived', 'INTEGER NOT NULL DEFAULT 0'], ['created_by', 'TEXT REFERENCES users(id)']]) database.run(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ${column} ${type}`, (error) => { if (error) console.error(error) })
}

function run(sql, params = []) { return new Promise((resolve, reject) => database.run(sql, params, function onRun(error) { if (error) reject(error); else resolve({ id: this.lastID, changes: this.changes }) })) }
function get(sql, params = []) { return new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row))) }
function all(sql, params = []) { return new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))) }
async function transaction(callback) {
	if (!usingPostgres) return run('BEGIN').then(() => callback()).then((result) => run('COMMIT').then(() => result)).catch((error) => run('ROLLBACK').then(() => { throw error }))
	const task = enqueuePostgres(async () => {
		const client = await postgresPool.connect()
		try {
			await client.query('BEGIN')
			const result = await transactionContext.run(client, callback)
			await client.query('COMMIT')
			return result
		} catch (error) {
			await client.query('ROLLBACK')
			throw error
		} finally { client.release() }
	})
	return task
}
function close() { return new Promise((resolve, reject) => database.close((error) => error ? reject(error) : resolve())) }

module.exports = { run, get, all, transaction, close }
