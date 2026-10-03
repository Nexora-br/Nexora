# Migração de Vercel para GitHub Pages - Relatório de Mudanças

> **Nota (03/10/2026):** este relatório documenta a migração como foi planejada originalmente. O workflow final em produção é `.github/workflows/static.yml` (não `deploy.yml`, que foi removido por ser redundante), e o CORS do backend (`backend/config.js`) libera apenas a origem exata configurada em `FRONTEND_ORIGIN`, sem suporte automático a `*.github.io` — ajuste `FRONTEND_ORIGIN` no Render para a origem completa do GitHub Pages.

## ✅ Mudanças Realizadas

### 1. **Removido vercel.json**
- ❌ Arquivo deletado: `vercel.json`
- **Motivo**: GitHub Pages é hospedagem estática pura; não suporta rewrites ou configuração similar a Vercel.

### 2. **Criado GitHub Actions Workflow**
- ✅ Arquivo: `.github/workflows/deploy.yml`
- **Funcionalidade**:
  - Deploy automático ao push em `main`
  - Build com Vite usando Node.js 20
  - Usa secret `VITE_API_URL` para configurar URL do backend
  - Upload de artifacts para GitHub Pages
  - Deploy apenas em push para main (não em PRs)

### 3. **Criado 404.html para SPA Routing**
- ✅ Arquivo: `frontend/public/404.html`
- **Funcionalidade**: 
  - Redireciona 404s para `index.html` (padrão GitHub Pages)
  - Preserva rota solicitada em `sessionStorage`
  - Permite React Router funcionar em GitHub Pages

### 4. **Atualizado frontend/src/main.jsx**
- ✅ Adicionado código de redirect
- **Funcionalidade**: 
  - Restaura rota original do redirect 404.html
  - Limpa sessionStorage após restaurar

### 5. **Atualizado backend/config.js (CORS)**
- ✅ Adicionado suporte automático para domínios `*.github.io`
- **Mudanças**:
  ```javascript
  // Permite GitHub Pages domains (*.github.io)
  if (origin.endsWith('.github.io')) return callback(null, true)
  ```
- **Benefício**: Elimina necessidade de adicionar cada URL de GitHub Pages manualmente

### 6. **Atualizado README.md**
- ✅ Documentação de deploy substituída
- **Novo processo**:
  1. Set `VITE_API_URL` secret no GitHub
  2. Habilitar GitHub Pages nas settings (source: GitHub Actions)
  3. Backend com `FRONTEND_ORIGIN=https://<username>.github.io`
  4. Deploy automático ao push para main

### 7. **Atualizado .env.example**
- ✅ Exemplos refletem GitHub Pages + Render
- **Novos valores de exemplo**:
  - `FRONTEND_ORIGIN=https://<username>.github.io`
  - `VITE_API_URL=https://<backend>.onrender.com/api`

## 🔧 Como Usar

### Setup no GitHub

1. **Settings → Secrets and variables → Actions**
   - Adicionar Secret: `VITE_API_URL`
   - Valor: `https://<seu-backend>.onrender.com/api`

2. **Settings → Pages**
   - Source: Deploy from a branch
   - Branch: gh-pages (criado automaticamente)
   - ✅ Deployment automático habilitado

3. **Push para main**
   - GitHub Actions roda automaticamente
   - Frontend é deployed em: `https://<username>.github.io`

### Setup no Backend (Render)

Variáveis de ambiente:
```
FRONTEND_ORIGIN=https://<username>.github.io
VITE_API_URL=https://<seu-backend>.onrender.com/api
```

## ⚠️ Pontos de Atenção

1. **GitHub Pages URL**: 
   - Padrão: `https://<username>.github.io`
   - Para repo: `https://` + username + `.github.io/` + repo_name
   - Ajustar `FRONTEND_ORIGIN` conforme configuração

2. **CORS**: 
   - Backend aceita `*.github.io` automaticamente
   - Sem necessidade de whitelist manual

3. **Secrets do GitHub**:
   - `VITE_API_URL` é obrigatório para build do frontend
   - Sem ele, usa fallback `/api` (não funciona em GitHub Pages)

4. **Cache de Build**:
   - GitHub Actions usa cache de node_modules
   - Para limpar, ir em Actions → Clear all caches

## 🚀 Próximos Passos

1. Commit das mudanças: `git commit -m "Migrar frontend de Vercel para GitHub Pages"`
2. Adicionar secrets no GitHub
3. Push para main
4. Verificar em https://<username>.github.io

## 📝 Arquivos Modificados

- ❌ Deletado: `vercel.json`
- ✅ Criado: `.github/workflows/deploy.yml`
- ✅ Criado: `frontend/public/404.html`
- ✅ Modificado: `frontend/src/main.jsx`
- ✅ Modificado: `backend/config.js`
- ✅ Modificado: `README.md`
- ✅ Modificado: `.env.example`

## ✅ Verificação

- [x] Compatibilidade SPA (React Router)
- [x] CORS com domínios GitHub Pages
- [x] GitHub Actions workflow
- [x] Documentação atualizada
- [x] Variáveis de ambiente configuradas
