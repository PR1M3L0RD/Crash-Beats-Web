import { betterAuth } from 'better-auth'

const MINIMUM_AUTH_SECRET_LENGTH = 32

function hasCredentials(env, clientIdKey, clientSecretKey) {
  return Boolean(env?.[clientIdKey] && env?.[clientSecretKey])
}

export function getAuthProviderAvailability(env = {}) {
  return {
    google: hasCredentials(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
  }
}

function getTrustedOrigins(env) {
  const origins = String(env.BETTER_AUTH_TRUSTED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  if (env.BETTER_AUTH_URL) {
    origins.unshift(new URL(env.BETTER_AUTH_URL).origin)
  }

  return [...new Set(origins)]
}

export function createAuth(env) {
  if (!env?.DB) throw new Error('The Better Auth D1 binding is not configured.')

  const secret = String(env.BETTER_AUTH_SECRET || '')
  if (secret.length < MINIMUM_AUTH_SECRET_LENGTH) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.')
  }

  const availability = getAuthProviderAvailability(env)
  const socialProviders = {}

  if (availability.google) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }
  }

  const options = {
    appName: 'Crash Beats',
    database: env.DB,
    secret,
    emailAndPassword: {
      enabled: true,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
      },
    },
    account: {
      encryptOAuthTokens: true,
    },
    socialProviders,
  }

  if (env.BETTER_AUTH_URL) options.baseURL = env.BETTER_AUTH_URL

  const trustedOrigins = getTrustedOrigins(env)
  if (trustedOrigins.length) options.trustedOrigins = trustedOrigins

  return betterAuth(options)
}
