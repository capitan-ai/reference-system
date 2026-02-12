const { PrismaClient } = require('@prisma/client')

let PrismaNeon
let NeonPool
let neonConfig
let neonPoolInstance
let neonAdapterFailed = false

const DATABASE_URL = process.env.DATABASE_URL
const isNeonConnection = typeof DATABASE_URL === 'string' && DATABASE_URL.includes('neon.tech')
const isSupabaseConnection = typeof DATABASE_URL === 'string' && DATABASE_URL.includes('supabase.co')

function ensureConnectionOptions(urlString, includePoolHints = false, includeSupabaseHints = false) {
  if (!urlString) return urlString

  try {
    const parsed = new URL(urlString)
    const ensureParam = (name, value) => {
      if (!parsed.searchParams.has(name)) {
        parsed.searchParams.set(name, value)
      }
    }

    if (includePoolHints) {
      ensureParam('sslmode', 'require')
      ensureParam('connect_timeout', '30')
      ensureParam('pool_timeout', '30')
      ensureParam('pgbouncer', 'true')
      ensureParam('connection_limit', '1')
    }

    if (includeSupabaseHints) {
      // Supabase requires SSL connections and connection pooling
      ensureParam('sslmode', 'require')
      ensureParam('connect_timeout', '10')
      ensureParam('statement_timeout', '30000') // 30 seconds
      // Add connection pool settings for better reliability
      ensureParam('pool_timeout', '10')
    }

    return parsed.toString()
  } catch (error) {
    console.warn('⚠️ Unable to normalize DATABASE_URL:', error.message)
    return urlString
  }
}

const normalizedDatabaseUrl = ensureConnectionOptions(
  DATABASE_URL, 
  isNeonConnection, 
  isSupabaseConnection
)
const effectiveDatabaseUrl = normalizedDatabaseUrl || DATABASE_URL

function createNeonAdapter(connectionString) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to initialize Prisma client')
  }

  if (!PrismaNeon) {
    ;({ PrismaNeon } = require('@prisma/adapter-neon'))
  }

  if (!NeonPool || !neonConfig) {
    const neonServerless = require('@neondatabase/serverless')
    ;({ Pool: NeonPool, neonConfig } = neonServerless)
    if (!NeonPool) {
      throw new Error('Failed to load Neon Pool from @neondatabase/serverless')
    }
    if (neonConfig) {
      if (!process.env.WS_NO_BUFFER_UTIL) {
        process.env.WS_NO_BUFFER_UTIL = '1'
      }
      if (!process.env.WS_NO_UTF_8_VALIDATE) {
        process.env.WS_NO_UTF_8_VALIDATE = '1'
      }
      neonConfig.webSocketConstructor = require('ws')
    }
  }

  if (!neonPoolInstance) {
    neonPoolInstance = new NeonPool({ connectionString })
  }

  return new PrismaNeon(neonPoolInstance)
}

function createPrismaClient() {
  if (isNeonConnection && !neonAdapterFailed) {
    try {
      return new PrismaClient({
        adapter: createNeonAdapter(effectiveDatabaseUrl)
      })
    } catch (error) {
      neonAdapterFailed = true
      console.warn('⚠️ Failed to initialize Prisma Neon adapter, falling back to standard driver:', error.message)
    }
  }

  // For Supabase and standard PostgreSQL connections, configure Prisma with connection limits
  const prismaOptions = {}
  
  if (isSupabaseConnection) {
    // Configure connection pool for Supabase
    prismaOptions.log = process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']
    // Add connection pool configuration via DATABASE_URL params (already handled above)
  }

  return new PrismaClient(prismaOptions)
}

const globalForPrisma = globalThis
const prisma = globalForPrisma.__prisma || createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma
}

module.exports = prisma
module.exports.default = prisma


