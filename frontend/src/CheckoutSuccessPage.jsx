import './CheckoutSuccessPage.css'

export function CheckoutSuccessPage() {
  function returnToNexora() {
    window.history.replaceState(null, '', window.location.pathname)
    window.location.reload()
  }

  return (
    <main className="checkout-success-page">
      <section className="checkout-success-card" aria-labelledby="checkout-success-title">
        <span className="checkout-success-check" aria-hidden="true">✓</span>
        <p className="checkout-success-kicker">NEXORA PRO</p>
        <h1 id="checkout-success-title">Obrigado pela sua assinatura!</h1>
        <p>
          Agradecemos por escolher a Nexora. Estamos confirmando seu pagamento e sua assinatura
          será ativada em instantes. Se tiver dúvidas, fale com nossa equipe pelo e-mail{' '}
          <a href="mailto:orders@example.com">orders@example.com</a>.
        </p>
        <button type="button" className="checkout-success-button" onClick={returnToNexora}>
          Voltar ao Nexora
        </button>
      </section>
    </main>
  )
}
