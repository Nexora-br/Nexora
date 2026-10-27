const fs = require('fs')
const path = require('path')
const sqlite3 = require('sqlite3')

const BATCH_SIZE = 200
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/

const sourcePath = path.resolve(process.argv[2] || process.env.NEXORA_DB_PATH || path.join(__dirname, 'nexora.sqlite'))

function openSqlite(file) {
  const database = new sqlite3.Database(file, sqlite3.OPEN_READONLY)
  const all = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows))))
  const close = () => new Promise((resolve) => database.close(() => resolve()))
  return { all, close }
}

function orderTables(tables, dependencies) {
  const pending = new Set(tables)
  const ordered = []
  const selfReferences = new Set()
  while (pending.size) {
    const ready = [...pending].filter((table) => [...(dependencies.get(table) || [])].every((parent) => parent === table || !pending.has(parent)))
    if (!ready.length) {
      for (const table of pending) selfReferences.add(table)
      ordered.push(...pending)
      break
    }
    for (const table of ready) {
      ordered.push(table)
      pending.delete(table)
    }
  }
  return { ordered, cyclic: selfReferences }
}

async function copyTable(client, db, table, columns, retryPasses) {
  const rows = await client.all(`SELECT ${columns.join(', ')} FROM ${table}`)
  if (!rows.length) return { total: 0, inserted: 0, failed: 0 }
  const columnList = columns.join(', ')
  const oneRow = columns.map(() => '?').join(', ')
  const sql = `INSERT OR IGNORE INTO ${table} (${columnList}) VALUES (${oneRow})`
  const sqlFor = (count) => `INSERT OR IGNORE INTO ${table} (${columnList}) VALUES ${Array.from({ length: count }, () => `(${oneRow})`).join(', ')}`
  const valuesOf = (row) => columns.map((column) => row[column])

  if (!retryPasses) {
    let inserted = 0
    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      const chunk = rows.slice(index, index + BATCH_SIZE)
      const result = await db.run(sqlFor(chunk.length), chunk.flatMap(valuesOf))
      inserted += result.changes || 0
    }
    return { total: rows.length, inserted, failed: 0 }
  }

  // Tabelas com auto-referência precisam de várias passadas: o filho só entra depois do pai.
  let pending = rows
  let inserted = 0
  for (let pass = 0; pass <= retryPasses && pending.length; pass += 1) {
    const failures = []
    for (const row of pending) {
      try {
        const result = await db.run(sql, valuesOf(row))
        inserted += result.changes || 0
      } catch {
        failures.push(row)
      }
    }
    if (failures.length === pending.length) break
    pending = failures
  }
  return { total: rows.length, inserted, failed: pending.length }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Defina DATABASE_URL com a string de conexão do PostgreSQL antes de migrar.')
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Arquivo SQLite não encontrado: ${sourcePath}`)
  }

  const db = require('./db')
  const client = openSqlite(sourcePath)

  const sourceTables = (await client.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"))
    .map((row) => row.name)
    .filter((table) => identifier.test(table))

  const foreignKeys = await db.all("SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace")
  const dependencies = new Map()
  for (const key of foreignKeys) {
    if (!dependencies.has(key.child)) dependencies.set(key.child, new Set())
    dependencies.get(key.child).add(key.parent)
  }

  const { ordered, cyclic } = orderTables(sourceTables, dependencies)
  const tableOrder = [...ordered.filter((table) => sourceTables.includes(table)), ...sourceTables.filter((table) => !ordered.includes(table))]
  const selfReferencing = new Set(foreignKeys.filter((key) => key.child === key.parent).map((key) => key.child))
  const retryTables = new Set([...selfReferencing, ...cyclic])
  const targetColumns = new Set((await db.all('SELECT column_name FROM information_schema.columns WHERE table_schema = ?', ['public'])).map((row) => row.column_name))

  console.log(`Migrando ${sourcePath}`)
  console.log(`Para: ${new URL(process.env.DATABASE_URL).host}${new URL(process.env.DATABASE_URL).pathname}`)
  console.log('')

  let totalInserted = 0
  let totalFailed = 0
  const problems = []

  for (const table of tableOrder) {
    const sourceColumns = (await client.all(`PRAGMA table_info(${table})`)).map((column) => column.name)
    const columns = sourceColumns.filter((column) => targetColumns.has(column))
    const skipped = sourceColumns.filter((column) => !targetColumns.has(column))

    if (!columns.length) {
      console.log(`- ${table}: nenhuma coluna compatível, ignorada`)
      continue
    }

    try {
      const stats = await copyTable(client, db, table, columns, retryTables.has(table) ? 5 : 0)
      totalInserted += stats.inserted
      totalFailed += stats.failed
      const note = [
        `${stats.inserted}/${stats.total} linhas`,
        skipped.length ? `${skipped.length} coluna(s) ausente(s) no destino: ${skipped.join(', ')}` : '',
        stats.failed ? `${stats.failed} linha(s) com erro` : '',
      ].filter(Boolean).join(', ')
      console.log(`- ${table}: ${note}`)
      if (stats.failed) problems.push(`${table}: ${stats.failed} linha(s) não migradas`)
    } catch (error) {
      problems.push(`${table}: ${error.message}`)
      console.log(`- ${table}: FALHOU (${error.message})`)
    }
  }

  await client.close()

  console.log('')
  console.log(`Linhas inseridas: ${totalInserted}`)
  if (problems.length) {
    console.log('Pendências:')
    for (const problem of problems) console.log(`- ${problem}`)
    process.exitCode = 1
  } else {
    console.log('Migração concluída sem erros.')
  }
  await db.close()
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
