import { resolveApiUrl } from '../apiConfig.js'

describe('apiConfig', () => {
  it('usa a URL configurada em produção mesmo quando o app não está em modo dev', () => {
    const url = resolveApiUrl({
      DEV: false,
      VITE_API_URL: 'https://api-exemplo.onrender.com/api',
    })

    expect(url).toBe('https://api-exemplo.onrender.com/api')
  })

  it('usa o valor padrão em ambiente sem configuração', () => {
    const url = resolveApiUrl({ DEV: false, VITE_API_URL: '' })

    expect(url).toBe('/api')
  })
})
