const sqlite3 = require('sqlite3').verbose()
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const path = require('path')

const dbPath = path.join(__dirname, 'nexora.sqlite')
const db = new sqlite3.Database(dbPath)

async function hashPassword(password) {
  return bcrypt.hash(password, 12)
}

async function addUser() {
  try {
    const email = 'gaviaomontagem@hotmail.com'
    const password = '@Di10202010@Is10202010'
    const name = 'Gávião Montagem'

    console.log('🔍 Conectando ao banco de dados...')

    // Verificar se usuário existe
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id, email FROM users WHERE lower(email) = lower(?)', [email], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })

    if (user) {
      console.log(`✅ Usuário encontrado: ${user.email}`)
      console.log('   Atualizando senha...')

      const passwordHash = await hashPassword(password)
      await new Promise((resolve, reject) => {
        db.run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [passwordHash, user.id], (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
      console.log('✅ Senha atualizada com sucesso!')
      db.close()
      process.exit(0)
    }

    console.log('📝 Usuário não encontrado. Criando novo...')

    const companyId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    const passwordHash = await hashPassword(password)

    console.log('  → Criando empresa...')
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO companies (id, legal_name, trade_name, email) VALUES (?, ?, ?, ?)',
        [companyId, 'Gávião Montagem LTDA', 'Gávião Montagem', email],
        (err) => err ? reject(err) : resolve()
      )
    })

    console.log('  → Criando usuário...')
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (id, company_id, name, email, password_hash, job_title, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, companyId, name, email, passwordHash, 'Administrador', 'ATIVO'],
        (err) => err ? reject(err) : resolve()
      )
    })

    console.log('  → Atribuindo role ADMINISTRADOR...')
    const role = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM roles WHERE name = ?', ['ADMINISTRADOR'], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })

    if (role) {
      await new Promise((resolve, reject) => {
        db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id], (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }

    console.log('  → Criando assinatura...')
    const nextCharge = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO subscriptions (id, company_id, plan, status, next_charge_at) VALUES (?, ?, ?, ?, ?)',
        [crypto.randomUUID(), companyId, 'PROFISSIONAL', 'ATIVA', nextCharge],
        (err) => err ? reject(err) : resolve()
      )
    })

    console.log(`\n✅ SUCESSO! Usuário criado com sucesso!`)
    console.log(`\n📊 Dados de Acesso:`)
    console.log(`   📧 Email:  ${email}`)
    console.log(`   🔑 Senha:  ${password}`)
    console.log(`   🏢 Empresa: Gávião Montagem LTDA`)
    console.log(`\n🚀 Faça login no frontend agora!`)

    db.close()
    process.exit(0)
  } catch (error) {
    console.error(`\n❌ ERRO: ${error.message}`)
    db.close()
    process.exitCode = 1
  }
}

addUser()
