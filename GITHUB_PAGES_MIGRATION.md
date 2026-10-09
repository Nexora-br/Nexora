# Publicação do Nexora

## Frontend

O frontend é compilado e publicado no GitHub Pages pelo workflow
`.github/workflows/static.yml` quando há push para `main`.

- Site: `https://nexora-br.github.io/Nexora/`
- O workflow aceita o secret `VITE_API_URL`; se ele não estiver configurado, usa
  `https://nexora-backend-w7aa.onrender.com/api`.
- A base `/Nexora/` e a página `404.html` preservam o funcionamento da aplicação
  React no GitHub Pages.

## Backend

O backend é executado no Render a partir de `backend/`, conforme `render.yaml`.
O serviço precisa manter as variáveis de ambiente definidas no painel do Render,
especialmente `NEXORA_JWT_SECRET` e a conexão persistente com o banco.

`FRONTEND_ORIGIN` deve usar a origem `https://nexora-br.github.io` sem o caminho
`/Nexora/`. O código também permite essa origem explicitamente em produção para
que a aplicação continue acessível se a configuração do serviço estiver atrasada.

## Atualizações

Um push em `main` inicia a publicação do frontend no GitHub Pages e o deploy
automático do backend no Render. Os dois serviços podem concluir em momentos
diferentes; verifique o workflow do GitHub Actions e o deploy do serviço
`nexora-backend` no Render antes de validar mudanças que dependem da API.
