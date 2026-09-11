export function emailVerificationIsAvailable(env) {
  return Boolean(env.RESEND_API_KEY && env.AUTH_EMAIL_FROM)
}

export async function sendConfirmationCode(env, { email, otp, type }) {
  if (!emailVerificationIsAvailable(env) || type !== 'email-verification') {
    throw new Error('Email confirmation is not available.')
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM,
      to: [email],
      subject: 'Your Crash Beats confirmation code',
      text: `Your Crash Beats confirmation code is ${otp}.\n\nIt expires in 10 minutes and can only be used once. Enter it in the account window where you requested it. Never share this code.\n\nIf you did not request this code, ignore this email.`,
    }),
  })
  if (!response.ok) throw new Error('The confirmation email could not be sent. Please try again later.')
}
