import { useRef, useState } from 'react'

export function normalizeCnpj(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isValidCnpj(value) {
  const cnpj = normalizeCnpj(value)
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^([A-Z0-9])\1{13}$/.test(cnpj)) return false
  const digit = (base, weights) => {
    const sum = [...base].reduce((total, character, index) => total + (character.charCodeAt(0) - 48) * weights[index], 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  const first = digit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const second = digit(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return cnpj.endsWith(`${first}${second}`)
}

async function getPublicData(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(response.status === 404 ? 'Cadastro não encontrado na consulta pública.' : 'Não foi possível consultar os dados públicos agora.')
  const data = await response.json()
  if (data?.message || data?.errors) throw new Error('Não foi possível consultar os dados públicos agora.')
  return data
}

export async function lookupCompany(cnpj, signal) {
  const normalized = normalizeCnpj(cnpj)
  if (!isValidCnpj(normalized)) throw new Error('Digite um CNPJ válido para consultar os dados da empresa.')
  const data = await getPublicData(`https://brasilapi.com.br/api/cnpj/v1/${normalized}`, signal)
  const phone = data.ddd_telefone_1 || data.ddd_telefone_2 || ''
  const street = [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(' ')
  return {
    legal_name: data.razao_social,
    trade_name: data.nome_fantasia,
    company_email: data.email,
    email: data.email,
    company_phone: phone,
    phone,
    zip_code: String(data.cep || '').replace(/\D/g, ''),
    address: street,
    address_number: data.numero,
    complement: data.complemento,
    district: data.bairro,
    city: data.municipio,
    state: data.uf,
    segment: data.cnae_fiscal_descricao,
  }
}

export async function lookupAddress(zipCode, signal) {
  const normalized = String(zipCode || '').replace(/\D/g, '')
  if (normalized.length !== 8) throw new Error('Digite um CEP com 8 números para consultar o endereço.')
  const data = await getPublicData(`https://brasilapi.com.br/api/cep/v2/${normalized}`, signal)
  return {
    zip_code: normalized,
    address: data.street,
    district: data.neighborhood,
    city: data.city,
    state: data.state,
  }
}

export function applyLookupToForm(form, values, previousValues) {
  if (!form) return
  for (const [name, rawValue] of Object.entries(values)) {
    const value = String(rawValue || '').trim()
    const field = form.elements.namedItem(name)
    if (!value || !field || !('value' in field)) continue
    const current = String(field.value || '').trim()
    if (current && current !== String(previousValues[name] || '').trim()) continue
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    previousValues[name] = value
  }
}


export function useBusinessAutofill() {
  const formRef = useRef(null)
  const previousValues = useRef({})
  const requestIds = useRef({ cnpj: 0, zip_code: 0 })
  const [lookupState, setLookupState] = useState({ busy: false, message: '', error: false })

  async function lookup(kind, rawValue) {
    const value = String(rawValue || '').trim()
    if (kind === 'cnpj' && !isValidCnpj(value)) {
      if (normalizeCnpj(value).length >= 14) setLookupState({ busy: false, message: 'Confira o CNPJ: os dígitos verificadores não são válidos.', error: true })
      return
    }
    if (kind === 'zip_code' && value.replace(/\D/g, '').length !== 8) return
    const requestId = ++requestIds.current[kind]
    setLookupState({ busy: true, message: kind === 'cnpj' ? 'Consultando os dados públicos da empresa…' : 'Consultando o CEP…', error: false })
    try {
      const data = kind === 'cnpj' ? await lookupCompany(value) : await lookupAddress(value)
      if (requestId !== requestIds.current[kind]) return
      applyLookupToForm(formRef.current, data, previousValues.current)
      if (kind === 'cnpj' && data.zip_code?.length === 8) {
        try {
          const address = await lookupAddress(data.zip_code)
          if (requestId === requestIds.current[kind]) applyLookupToForm(formRef.current, address, previousValues.current)
        } catch {
          // O cadastro do CNPJ já contém os campos de endereço disponíveis.
        }
      }
      setLookupState({ busy: false, message: kind === 'cnpj' ? 'Dados encontrados. Confira e complete o que estiver faltando.' : 'Endereço preenchido. Confira os dados antes de salvar.', error: false })
    } catch (error) {
      if (requestId !== requestIds.current[kind]) return
      setLookupState({ busy: false, message: error.message || 'Não foi possível consultar agora. Você pode preencher os dados manualmente.', error: true })
    }
  }

  function onBlurCapture(event) {
    const field = event.target?.name
    if (field === 'cnpj') void lookup('cnpj', event.target.value)
    if (field === 'zip_code') void lookup('zip_code', event.target.value)
  }

  function lookupCurrentCnpj() {
    void lookup('cnpj', formRef.current?.elements.namedItem('cnpj')?.value)
  }

  return { formRef, lookupState, onBlurCapture, lookupCurrentCnpj }
}
