# Troubleshooting - Erro PostgreSQL e Banco de Dados

## Erro: "O servidor da Nexora está temporariamente indisponível"

### Causa Raiz
**Código de Erro: 28P01** = Falha de autenticação PostgreSQL

Possíveis causas:
1. ❌ Credenciais DATABASE_URL inválidas ou expiradas
2. ❌ Usuário PostgreSQL foi deletado
3. ❌ Senha do banco de dados expirou
4. ❌ IP do servidor não está whitelistado
5. ❌ Database foi deletado

---

## ✅ Soluções

### 1. Verificar Conexão

> **Nota:** este projeto não possui um endpoint `/api/diagnostics`. Para confirmar a causa, use os logs do Render (solução abaixo) ou teste a `DATABASE_URL` diretamente com `psql` (ver seção "Testar Conexão Diretamente").

Verifique nos **logs do Render** se aparece o código de erro "28P01" logo após o deploy ou em requisições de login — isso confirma falha de autenticação no PostgreSQL. Se confirmado, veja a solução 2.

### 2. Verificar/Atualizar DATABASE_URL no Render

1. **Render Dashboard** → Seu serviço Nexora
2. **Environment** → Verificar `DATABASE_URL`
3. Se estiver vencida ou incorreta, obter nova URL do provedor PostgreSQL
4. Atualizar e fazer **deploy novo**

### 3. Se Estiver Usando Supabase

Verificar:
- ✅ Projeto Supabase ainda existe
- ✅ Database não foi deletado
- ✅ Pool de conexões tem limite disponível
- ✅ Credenciais não expiraram

**Gerar nova connection string:**
1. Supabase Dashboard → Settings → Database
2. Connection string → Copiar URI com credenciais novas
3. Atualizar no Render

### 4. Alternativa: Reverter para SQLite

Se PostgreSQL não está funcionando, pode usar SQLite (mais simples):

1. **Render Dashboard** → Environment
2. **Remover** `DATABASE_URL`
3. **Deploy novo**
4. Backend usará SQLite automaticamente em `backend/nexora.sqlite`

⚠️ **Nota:** SQLite é mais lento e não escala bem. Use apenas para desenvolvimento/testes.

### 5. Verificar Logs do Render

1. **Render Dashboard** → Seu serviço → **Logs**
2. Procurar por:
   - `PostgreSQL connected successfully` (verde = OK)
   - `Database connection error` (vermelho = problema)
   - `code: '28P01'` (erro de autenticação)

---

## 🧪 Teste Local

Para testar conexão PostgreSQL localmente:

```bash
# Instale psql (PostgreSQL client)
# Windows: https://www.postgresql.org/download/windows/
# Mac: brew install postgresql
# Linux: sudo apt install postgresql-client

# Teste a conexão
psql "postgresql://user:password@host:port/database" -c "SELECT 1"
```

Se falhar com erro 28P01, as credenciais estão incorretas.

---

## 📋 Checklist de Resolução

- [ ] Verificou os logs do Render
- [ ] Validou `DATABASE_URL` no Render
- [ ] Confirmou credenciais no provedor PostgreSQL
- [ ] Fez deploy novo após atualizar variáveis
- [ ] Limpou cache/logs do Render (se necessário)
- [ ] Testou login no frontend

---

## 🆘 Se Ainda Não Funcionar

1. Compartilhe os **logs do Render** (último erro FATAL)
2. Verifique se `DATABASE_URL` começa com `postgresql://`
3. Considere reverter para SQLite temporariamente para isolar o problema
