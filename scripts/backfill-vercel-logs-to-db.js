#!/usr/bin/env node
/**
 * Backfill last 12 hours of Vercel logs to application_logs table
 * 
 * IMPORTANT LIMITATIONS:
 * - Vercel's REST API does not provide access to runtime application logs
 * - The API endpoints available are for build/deployment events, not runtime logs
 * - Runtime logs are only available through:
 *   1. Vercel Dashboard (web interface)
 *   2. Real-time streaming via `vercel logs` CLI (last 5 minutes only)
 * 
 * GOING FORWARD:
 * - All new logs are automatically saved to application_logs table
 * - Webhooks, cron jobs, and structured logs are captured in real-time
 * 
 * For historical logs, you may need to:
 * - Manually export from Vercel Dashboard
 * - Or accept that only logs going forward will be captured
 * 
 * Requirements:
 * - VERCEL_TOKEN environment variable (get from: https://vercel.com/account/tokens)
 * - VERCEL_TEAM_ID (optional, defaults to umis-projects-e802f152)
 * - VERCEL_PROJECT_NAME (optional, defaults to referral-system-salon)
 * 
 * Usage: node scripts/backfill-vercel-logs-to-db.js
 */

require('dotenv').config()
const { execSync } = require('child_process')
const https = require('https')
const { PrismaClient } = require('@prisma/client')
const { saveApplicationLog } = require('../lib/workflows/application-log-queue')
const { randomUUID } = require('crypto')
const fs = require('fs')
const path = require('path')

const prisma = new PrismaClient()

// Calculate 12 hours ago
const twelveHoursAgo = new Date()
twelveHoursAgo.setHours(twelveHoursAgo.getHours() - 12)

function getVercelToken() {
  // Try environment variable first
  if (process.env.VERCEL_TOKEN) {
    return process.env.VERCEL_TOKEN
  }
  
  // Try reading from Vercel CLI auth file
  try {
    const authPath = path.join(process.env.HOME || process.env.USERPROFILE, '.vercel', 'auth.json')
    if (fs.existsSync(authPath)) {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'))
      // Vercel CLI stores tokens in different formats, try to find it
      if (auth.token) {
        return auth.token
      }
      // Sometimes it's in teams
      if (auth.teams && auth.teams.length > 0 && auth.teams[0].token) {
        return auth.teams[0].token
      }
    }
  } catch (e) {
    // Ignore errors
  }
  
  return null
}

async function fetchVercelLogsViaAPI() {
  console.log('🔍 Fetching Vercel logs from last 12 hours using API...\n')
  console.log(`📅 Time range: ${twelveHoursAgo.toISOString()} to ${new Date().toISOString()}\n`)
  
  const token = getVercelToken()
  if (!token) {
    throw new Error('VERCEL_TOKEN not found. Set it in .env or get from https://vercel.com/account/tokens')
  }
  
  // Get project info from URL or env
  // URL format: https://vercel.com/{teamId}/{projectName}/logs
  const projectName = process.env.VERCEL_PROJECT_NAME || 'referral-system-salon'
  const teamId = process.env.VERCEL_TEAM_ID || 'umis-projects-e802f152'
  
  console.log(`📡 Project: ${projectName}`)
  console.log(`📡 Team: ${teamId}\n`)
  
  // Try project-level logs first (more efficient)
  console.log('📋 Trying project-level logs endpoint...')
  let allLogs = []
  
  try {
    const projectLogs = await fetchVercelProjectLogs(token, projectName, teamId, twelveHoursAgo)
    if (projectLogs.length > 0) {
      console.log(`✅ Found ${projectLogs.length} logs from project endpoint\n`)
      return projectLogs
    }
  } catch (error) {
    console.log(`   ⚠️  Project logs endpoint not available: ${error.message}`)
    console.log('   Falling back to deployment-level logs...\n')
  }
  
  // Fallback: Get logs from individual deployments
  const deployments = await fetchVercelDeployments(token, projectName, teamId)
  if (deployments.length === 0) {
    console.log('❌ No deployments found')
    return []
  }
  
  console.log(`✅ Found ${deployments.length} deployments\n`)
  
  // Fetch logs from each deployment that's within 12 hours
  for (const deployment of deployments.slice(0, 20)) { // Limit to 20 most recent
    const deploymentTime = new Date(deployment.createdAt)
    if (deploymentTime >= twelveHoursAgo) {
      console.log(`📋 Fetching logs from deployment ${deployment.uid.substring(0, 8)}... (${deployment.url})`)
      try {
        const logs = await fetchVercelDeploymentLogs(token, deployment.uid, teamId, twelveHoursAgo)
        allLogs.push(...logs)
        if (logs.length > 0) {
          console.log(`   ✅ Found ${logs.length} logs`)
        }
      } catch (error) {
        console.log(`   ⚠️  Error: ${error.message}`)
      }
    }
  }
  
  console.log(`\n✅ Total logs collected: ${allLogs.length}\n`)
  return allLogs
}

function fetchVercelProjectLogs(token, projectName, teamId, since) {
  return new Promise((resolve, reject) => {
    // Try project logs endpoint (if available in API)
    const teamParam = teamId ? `?teamId=${teamId}` : '?'
    const sinceParam = `&since=${since.getTime()}`
    const options = {
      hostname: 'api.vercel.com',
      path: `/v1/projects/${projectName}/logs${teamParam}${sinceParam}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
    
    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 404 || res.statusCode === 403) {
          reject(new Error(`Project logs endpoint not available (${res.statusCode})`))
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`API error: ${res.statusCode}`))
          return
        }
        try {
          const result = JSON.parse(data)
          const logs = []
          
          // Handle different response formats
          if (Array.isArray(result)) {
            result.forEach(log => {
              const timestamp = log.timestamp || log.date || log.createdAt
              if (timestamp) {
                const logTime = new Date(timestamp)
                if (logTime >= since) {
                  logs.push({
                    ...log,
                    parsedTimestamp: logTime
                  })
                }
              }
            })
          } else if (result.logs && Array.isArray(result.logs)) {
            result.logs.forEach(log => {
              const timestamp = log.timestamp || log.date || log.createdAt
              if (timestamp) {
                const logTime = new Date(timestamp)
                if (logTime >= since) {
                  logs.push({
                    ...log,
                    parsedTimestamp: logTime
                  })
                }
              }
            })
          }
          
          resolve(logs)
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

function fetchVercelDeployments(token, projectName, teamId) {
  return new Promise((resolve, reject) => {
    // Use project-specific deployments endpoint
    const teamParam = teamId ? `?teamId=${teamId}` : ''
    const options = {
      hostname: 'api.vercel.com',
      path: `/v6/projects/${projectName}/deployments${teamParam}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
    
    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 404) {
          // Try fallback to general deployments endpoint
          fetchVercelDeploymentsFallback(token, projectName, teamId)
            .then(resolve)
            .catch(reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`API error: ${res.statusCode} - ${data.substring(0, 200)}`))
          return
        }
        try {
          const result = JSON.parse(data)
          // Response might be array or object with deployments array
          const deployments = Array.isArray(result) ? result : (result.deployments || [])
          // Sort by createdAt descending (most recent first)
          deployments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          resolve(deployments)
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

function fetchVercelDeploymentsFallback(token, projectName, teamId) {
  return new Promise((resolve, reject) => {
    const teamParam = teamId ? `?teamId=${teamId}` : ''
    const options = {
      hostname: 'api.vercel.com',
      path: `/v6/deployments${teamParam}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
    
    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API error: ${res.statusCode} - ${data.substring(0, 200)}`))
          return
        }
        try {
          const result = JSON.parse(data)
          // Filter by project name
          const deployments = result.deployments?.filter(d => 
            d.name === projectName || d.url?.includes(projectName)
          ) || []
          deployments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          resolve(deployments)
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

function fetchVercelDeploymentLogs(token, deploymentId, teamId, since) {
  return new Promise((resolve, reject) => {
    // Try the logs endpoint - this might be a streaming endpoint or require different format
    // Vercel API v13+ uses different endpoints
    const teamParam = teamId ? `?teamId=${teamId}` : '?'
    const options = {
      hostname: 'api.vercel.com',
      path: `/v13/deployments/${deploymentId}/logs${teamParam}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
    
    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 404 || res.statusCode === 403) {
          // Logs might not be available via API for this deployment
          resolve([])
          return
        }
        if (res.statusCode !== 200) {
          // Try alternative endpoint
          console.log(`   ⚠️  Status ${res.statusCode}, trying alternative endpoint...`)
          fetchVercelDeploymentLogsAlternative(token, deploymentId, teamId, since)
            .then(resolve)
            .catch(() => resolve([]))
          return
        }
        try {
          // Vercel logs API might return different formats
          // Could be: array of log objects, or object with logs array, or streaming format
          const result = JSON.parse(data)
          const logs = []
          
          // Handle different response formats
          if (Array.isArray(result)) {
            // Direct array of logs
            result.forEach(log => {
              const timestamp = log.timestamp || log.date || log.createdAt
              if (timestamp) {
                const logTime = new Date(timestamp)
                if (logTime >= since) {
                  logs.push({
                    ...log,
                    parsedTimestamp: logTime
                  })
                }
              }
            })
          } else if (result.logs && Array.isArray(result.logs)) {
            // Object with logs array
            result.logs.forEach(log => {
              const timestamp = log.timestamp || log.date || log.createdAt
              if (timestamp) {
                const logTime = new Date(timestamp)
                if (logTime >= since) {
                  logs.push({
                    ...log,
                    parsedTimestamp: logTime
                  })
                }
              }
            })
          } else if (result.type === 'log' || result.message) {
            // Single log object
            const timestamp = result.timestamp || result.date || result.createdAt
            if (timestamp) {
              const logTime = new Date(timestamp)
              if (logTime >= since) {
                logs.push({
                  ...result,
                  parsedTimestamp: logTime
                })
              }
            }
          }
          
          resolve(logs)
        } catch (e) {
          // If it's not JSON, might be plain text logs
          if (data.trim()) {
            // Try to parse as plain text logs
            const lines = data.split('\n').filter(l => l.trim())
            const parsedLogs = []
            for (const line of lines) {
              // Try to extract timestamp and message
              const match = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)$/)
              if (match) {
                const [, timestampStr, level, message] = match
                try {
                  const logTime = new Date(timestampStr)
                  if (logTime >= since) {
                    parsedLogs.push({
                      timestamp: timestampStr,
                      level: level.toLowerCase(),
                      message: message,
                      raw: line,
                      parsedTimestamp: logTime
                    })
                  }
                } catch (dateError) {
                  // Skip if can't parse
                }
              }
            }
            resolve(parsedLogs)
          } else {
            resolve([])
          }
        }
      })
    }).on('error', (err) => {
      // Try alternative endpoint on error
      fetchVercelDeploymentLogsAlternative(token, deploymentId, teamId, since)
        .then(resolve)
        .catch(() => resolve([]))
    })
  })
}

function fetchVercelDeploymentLogsAlternative(token, deploymentId, teamId, since) {
  return new Promise((resolve, reject) => {
    // Try the events endpoint (older API) - this is for build events, not runtime logs
    const teamParam = teamId ? `?teamId=${teamId}` : '?'
    const sinceParam = `&since=${since.getTime()}`
    const options = {
      hostname: 'api.vercel.com',
      path: `/v2/deployments/${deploymentId}/events${teamParam}${sinceParam}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
    
    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          // Events endpoint might not have runtime logs
          resolve([])
          return
        }
        try {
          const result = JSON.parse(data)
          const logs = []
          
          // Events endpoint returns build/deployment events, not runtime logs
          // But we can extract any log-type events
          if (Array.isArray(result)) {
            result.forEach(event => {
              // Look for log events or any event with message/text
              if (event.type === 'log' || event.type === 'stdout' || event.type === 'stderr') {
                const payload = event.payload || event
                const timestamp = payload.timestamp || event.createdAt || event.date
                if (timestamp) {
                  const logTime = new Date(timestamp)
                  if (logTime >= since) {
                    logs.push({
                      type: event.type,
                      message: payload.message || payload.text || payload.data || JSON.stringify(payload),
                      level: payload.level || (event.type === 'stderr' ? 'error' : 'info'),
                      ...payload,
                      parsedTimestamp: logTime
                    })
                  }
                }
              } else if (event.message || event.text) {
                // Some events have messages directly
                const timestamp = event.timestamp || event.createdAt || event.date
                if (timestamp) {
                  const logTime = new Date(timestamp)
                  if (logTime >= since) {
                    logs.push({
                      type: event.type || 'event',
                      message: event.message || event.text,
                      level: 'info',
                      ...event,
                      parsedTimestamp: logTime
                    })
                  }
                }
              }
            })
          }
          resolve(logs)
        } catch (e) {
          resolve([])
        }
      })
    }).on('error', () => resolve([]))
  })
}

async function fetchVercelLogs() {
  console.log('🔍 Fetching Vercel logs from last 12 hours...\n')
  console.log(`📅 Time range: ${twelveHoursAgo.toISOString()} to ${new Date().toISOString()}\n`)
  
  try {
    // Get latest deployment (parse text output since --json is not supported)
    console.log('📡 Getting latest deployment...')
    const deploymentsOutput = execSync('vercel ls', { encoding: 'utf-8', stdio: 'pipe' })
    
    // Parse the deployment list output
    // Format: Age     Deployment                                                                    Status         Environment     Duration     Username
    const lines = deploymentsOutput.split('\n').filter(l => l.trim() && !l.includes('Age') && !l.includes('Deployments for'))
    
    if (lines.length === 0) {
      console.log('❌ No deployments found')
      return []
    }
    
    // Get the first deployment (prefer Ready, but accept Building too)
    let deploymentUrl = null
    for (const line of lines) {
      // Extract URL from the line (URLs are in the format https://...)
      const urlMatch = line.match(/https:\/\/[^\s]+/)
      if (urlMatch) {
        deploymentUrl = urlMatch[0]
        // Prefer Ready deployments, but use Building if that's all we have
        if (line.includes('● Ready')) {
          break
        }
      }
    }
    
    if (!deploymentUrl) {
      console.log('❌ No deployment URL found in output')
      console.log('   Deployment list output:')
      lines.slice(0, 5).forEach(l => console.log(`   ${l}`))
      return []
    }
    
    console.log(`✅ Using deployment: ${deploymentUrl}`)
    console.log(`   Note: Vercel CLI logs only show logs from "now" for up to 5 minutes`)
    console.log(`   For 12 hours of logs, you may need to use Vercel API\n`)
    
    // Fetch logs with JSON format for easier parsing
    // Note: vercel logs only shows logs from "now" for 5 minutes max
    console.log('📋 Fetching logs (Vercel CLI only shows logs from "now" for 5 minutes)...\n')
    try {
      const logsOutput = execSync(`vercel logs "${deploymentUrl}" -j`, { 
        encoding: 'utf-8', 
        stdio: 'pipe',
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
        timeout: 300000 // 5 minutes timeout (max time vercel logs streams)
      })
      
      const logLines = logsOutput.split('\n').filter(l => l.trim())
      const parsedLogs = []
      
      console.log(`📊 Parsing ${logLines.length} log lines...`)
      
      for (const line of logLines) {
        try {
          const logEntry = JSON.parse(line)
          
          // Parse timestamp - Vercel logs have different timestamp formats
          let logTimestamp = null
          if (logEntry.timestamp) {
            logTimestamp = new Date(logEntry.timestamp)
          } else if (logEntry.date) {
            logTimestamp = new Date(logEntry.date)
          } else if (logEntry.created) {
            logTimestamp = new Date(logEntry.created)
          }
          
          // Only include logs from last 12 hours
          if (logTimestamp && logTimestamp >= twelveHoursAgo) {
            parsedLogs.push({
              ...logEntry,
              parsedTimestamp: logTimestamp
            })
          }
        } catch (e) {
          // Not JSON, try to parse as plain text log
          // Vercel logs format: [timestamp] [level] message
          const textMatch = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)$/)
          if (textMatch) {
            const [, timestampStr, level, message] = textMatch
            try {
              const logTimestamp = new Date(timestampStr)
              if (logTimestamp >= twelveHoursAgo) {
                parsedLogs.push({
                  timestamp: timestampStr,
                  level: level.toLowerCase(),
                  message: message,
                  raw: line,
                  parsedTimestamp: logTimestamp
                })
              }
            } catch (dateError) {
              // Skip if can't parse date
            }
          }
        }
      }
      
      console.log(`✅ Found ${parsedLogs.length} logs (filtered to last 12 hours)\n`)
      
      if (parsedLogs.length === 0) {
        console.log('⚠️  Note: Vercel CLI logs command only shows logs from "now" for up to 5 minutes.')
        console.log('   To get 12 hours of historical logs, you need to use the Vercel API.')
        console.log('   See: https://vercel.com/docs/rest-api/endpoints/logs\n')
      }
      
      return parsedLogs
      
    } catch (logError) {
      console.error('❌ Error fetching logs:', logError.message)
      throw logError
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('\n💡 Make sure you are:')
    console.error('   1. Logged into Vercel CLI: vercel login')
    console.error('   2. In the correct project directory')
    console.error('   3. Have access to the project')
    throw error
  }
}

async function saveLogsToDatabase(logs) {
  console.log(`💾 Saving ${logs.length} logs to application_logs table...\n`)
  
  let saved = 0
  let skipped = 0
  let errors = 0
  
  for (const log of logs) {
    try {
      // Determine log type from log content
      let logType = 'vercel'
      const message = (log.message || log.text || JSON.stringify(log)).toLowerCase()
      
      if (message.includes('webhook') || message.includes('🔔')) {
        logType = 'webhook'
      } else if (message.includes('cron') || message.includes('[cron]')) {
        logType = 'cron'
      } else if (message.includes('api') || message.includes('/api/')) {
        logType = 'api'
      }
      
      // Extract organization_id if present in log
      let organizationId = null
      const orgIdMatch = message.match(/organization[_-]?id[:\s]+([a-f0-9-]{36})/i)
      if (orgIdMatch) {
        organizationId = orgIdMatch[1]
      }
      
      // Determine status from log level
      let status = 'completed'
      const level = (log.level || 'info').toLowerCase()
      if (level === 'error' || level === 'fatal') {
        status = 'error'
      } else if (level === 'warn' || level === 'warning') {
        status = 'completed'
      }
      
      // Generate unique log ID
      const logId = log.id || log.event_id || `vercel-${log.parsedTimestamp?.getTime() || Date.now()}-${randomUUID().substring(0, 8)}`
      
      // Save to database
      const result = await saveApplicationLog(prisma, {
        logType: logType,
        logId: logId,
        logCreatedAt: log.parsedTimestamp || new Date(),
        payload: log, // Complete log entry
        organizationId: organizationId,
        status: status,
        error: level === 'error' ? (log.message || log.text) : null,
        maxAttempts: 0
      })
      
      if (result) {
        saved++
        if (saved % 100 === 0) {
          process.stdout.write(`\r   Progress: ${saved}/${logs.length} saved...`)
        }
      } else {
        skipped++
      }
    } catch (error) {
      errors++
      if (errors <= 10) {
        console.error(`\n⚠️  Error saving log: ${error.message}`)
      }
    }
  }
  
  console.log(`\n\n✅ Backfill complete:`)
  console.log(`   Saved: ${saved}`)
  console.log(`   Skipped: ${skipped}`)
  console.log(`   Errors: ${errors}`)
}

async function main() {
  try {
    // Try API first (for historical logs), fallback to CLI (for real-time)
    let logs = []
    
    try {
      logs = await fetchVercelLogsViaAPI()
    } catch (apiError) {
      console.log(`⚠️  API method failed: ${apiError.message}`)
      console.log('   Falling back to CLI method (limited to last 5 minutes)...\n')
      logs = await fetchVercelLogs()
    }
    
    if (logs.length === 0) {
      console.log('ℹ️  No logs found in the last 12 hours via API')
      console.log('\n⚠️  IMPORTANT: Vercel REST API does not provide runtime application logs')
      console.log('   The API endpoints only return build/deployment events, not runtime logs.')
      console.log('\n✅ GOOD NEWS: Going forward, all logs are automatically saved!')
      console.log('   - All webhook events → application_logs table')
      console.log('   - All cron executions → application_logs table')
      console.log('   - All structured logs → application_logs table')
      console.log('\n💡 For historical logs:')
      console.log('   - Export manually from Vercel Dashboard')
      console.log('   - Or accept that only future logs will be captured')
      return
    }
    
    await saveLogsToDatabase(logs)
    
  } catch (error) {
    console.error('❌ Backfill failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then(() => {
    console.log('\n✅ Script complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Script failed:', error)
    process.exit(1)
  })

3цй