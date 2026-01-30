// Test endpoint to check Apple Wallet environment variables
export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const envVars = {
      // Basic config
      APPLE_PASS_TYPE_ID: process.env.APPLE_PASS_TYPE_ID ? '✅ Found' : '❌ Missing',
      APPLE_PASS_TEAM_ID: process.env.APPLE_PASS_TEAM_ID ? '✅ Found' : '❌ Missing',
      
      // Certificates (PEM format)
      APPLE_PASS_CERTIFICATE_PEM_BASE64: process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64 
        ? `✅ Found (${process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64.length} chars)` 
        : '❌ Missing',
      APPLE_PASS_KEY_PEM_BASE64: process.env.APPLE_PASS_KEY_PEM_BASE64 
        ? `✅ Found (${process.env.APPLE_PASS_KEY_PEM_BASE64.length} chars)` 
        : '❌ Missing',
      APPLE_WWDR_CERTIFICATE_BASE64: process.env.APPLE_WWDR_CERTIFICATE_BASE64 
        ? `✅ Found (${process.env.APPLE_WWDR_CERTIFICATE_BASE64.length} chars)` 
        : '❌ Missing',
      APPLE_PASS_CERTIFICATE_PASSWORD: process.env.APPLE_PASS_CERTIFICATE_PASSWORD 
        ? '✅ Found (hidden)' 
        : '❌ Missing',
      
      // Legacy .p12 format
      APPLE_PASS_CERTIFICATE_BASE64: process.env.APPLE_PASS_CERTIFICATE_BASE64 
        ? `✅ Found (legacy, ${process.env.APPLE_PASS_CERTIFICATE_BASE64.length} chars)` 
        : '❌ Missing',
      
      // File paths (for local dev)
      APPLE_PASS_CERTIFICATE_PATH: process.env.APPLE_PASS_CERTIFICATE_PATH || 'Not set',
      APPLE_WWDR_CERTIFICATE_PATH: process.env.APPLE_WWDR_CERTIFICATE_PATH || 'Not set',
    }
    
    // Count how many are found
    const found = Object.values(envVars).filter(v => v.includes('✅')).length
    const total = Object.keys(envVars).length
    
    return Response.json({
      status: found === total ? '✅ All variables found' : `⚠️ ${found}/${total} variables found`,
      environment: process.env.NODE_ENV,
      variables: envVars,
      recommendations: found < total ? [
        '1. Check Vercel Dashboard → Settings → Environment Variables',
        '2. Ensure variables are added to Production environment (not just Preview/Development)',
        '3. After adding variables, redeploy the project',
        '4. Variables must be named exactly as shown above (case-sensitive)'
      ] : []
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    return Response.json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    })
  }
}

