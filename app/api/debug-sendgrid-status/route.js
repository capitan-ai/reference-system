const sendgridClient = require('@sendgrid/client')

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const apiKey = process.env.SENDGRID_API_KEY
    const fromEmail = process.env.FROM_EMAIL || 'info@studiozorina.com'
    
    if (!apiKey) {
      return Response.json({
        success: false,
        error: 'SENDGRID_API_KEY not configured',
        check: {
          hasApiKey: false,
          hasFromEmail: !!process.env.FROM_EMAIL,
          fromEmail
        }
      }, { status: 500 })
    }
    
    // Test API key
    sendgridClient.setApiKey(apiKey)
    
    const results = {
      apiKeyValid: false,
      apiKeyTest: null,
      recentActivity: null,
      suppressionLists: null,
      error: null
    }
    
    // 1. Test API key by getting user profile
    try {
      const [response, body] = await sendgridClient.request({
        url: '/v3/user/profile',
        method: 'GET'
      })
      
      if (response.statusCode === 200) {
        results.apiKeyValid = true
        results.apiKeyTest = {
          success: true,
          username: body.username,
          email: body.email
        }
      } else {
        results.apiKeyTest = {
          success: false,
          statusCode: response.statusCode,
          body
        }
      }
    } catch (error) {
      results.apiKeyTest = {
        success: false,
        error: error.message,
        statusCode: error.response?.statusCode,
        body: error.response?.body
      }
    }
    
    // 2. Get recent email activity (last 10 messages)
    try {
      const [activityResponse, activityBody] = await sendgridClient.request({
        url: '/v3/messages?limit=10',
        method: 'GET'
      })
      
      if (activityResponse.statusCode === 200) {
        results.recentActivity = {
          success: true,
          messages: activityBody.messages?.map(msg => ({
            msg_id: msg.msg_id,
            from: msg.from_email,
            to: msg.to_email,
            subject: msg.subject,
            status: msg.status,
            last_event_time: msg.last_event_time,
            events: msg.events?.map(e => ({
              event: e.event,
              timestamp: e.timestamp,
              reason: e.reason,
              status: e.status
            })) || []
          })) || []
        }
      } else {
        results.recentActivity = {
          success: false,
          statusCode: activityResponse.statusCode,
          body: activityBody
        }
      }
    } catch (error) {
      results.recentActivity = {
        success: false,
        error: error.message,
        statusCode: error.response?.statusCode
      }
    }
    
    // 3. Check suppression lists (bounces, blocks, spam reports)
    try {
      const [bouncesResponse, bouncesBody] = await sendgridClient.request({
        url: '/v3/suppression/bounces?limit=10',
        method: 'GET'
      })
      
      const [blocksResponse, blocksBody] = await sendgridClient.request({
        url: '/v3/suppression/blocks?limit=10',
        method: 'GET'
      })
      
      const [spamResponse, spamBody] = await sendgridClient.request({
        url: '/v3/suppression/spam_reports?limit=10',
        method: 'GET'
      })
      
      results.suppressionLists = {
        bounces: {
          count: bouncesBody.length || 0,
          recent: bouncesBody.slice(0, 5).map(b => ({
            email: b.email,
            created: b.created,
            reason: b.reason
          }))
        },
        blocks: {
          count: blocksBody.length || 0,
          recent: blocksBody.slice(0, 5).map(b => ({
            email: b.email,
            created: b.created,
            reason: b.reason
          }))
        },
        spam: {
          count: spamBody.length || 0,
          recent: spamBody.slice(0, 5).map(s => ({
            email: s.email,
            created: s.created
          }))
        }
      }
    } catch (error) {
      results.suppressionLists = {
        error: error.message,
        statusCode: error.response?.statusCode
      }
    }
    
    return Response.json({
      success: true,
      environment: {
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey?.length || 0,
        fromEmail,
        hasFromEmail: !!process.env.FROM_EMAIL
      },
      results
    })
    
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 })
  }
}

