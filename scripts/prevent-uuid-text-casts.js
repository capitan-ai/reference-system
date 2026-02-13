#!/usr/bin/env node
/**
 * Prevention Script: Detect incorrect ::text casts on UUID columns
 * 
 * This script scans the codebase for patterns that might indicate
 * incorrect type casting of UUID columns (especially organization_id)
 * to text in raw SQL queries.
 * 
 * Usage: node scripts/prevent-uuid-text-casts.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const UUID_COLUMNS = [
  'organization_id',
  'id', // Primary keys are UUIDs
  'location_id',
  'booking_id',
  'order_id',
  'payment_id',
  'customer_id', // Sometimes UUID
  'service_variation_id',
  'technician_id',
  'administrator_id',
];

const PATTERNS = [
  // Pattern: ${variable}::text where variable is a UUID column
  {
    regex: /\$\{([^}]+(?:organizationId|organization_id|locationId|location_id|bookingId|booking_id|orderId|order_id|paymentId|payment_id))[^}]*\}\s*::\s*text/gi,
    message: 'UUID column cast to ::text - should be ::uuid',
    severity: 'error',
  },
  // Pattern: VALUES clause with organization_id::text
  {
    regex: /VALUES\s*\([^)]*\$\{([^}]+organizationId[^}]*)\}[^)]*::\s*text/gi,
    message: 'organization_id in VALUES clause cast to ::text - should be ::uuid',
    severity: 'error',
  },
  // Pattern: INSERT with organization_id::text
  {
    regex: /INSERT\s+INTO\s+\w+\s*\([^)]*organization_id[^)]*\)\s*VALUES\s*\([^)]*\$\{([^}]+)\}[^)]*::\s*text/gi,
    message: 'INSERT with organization_id cast to ::text - should be ::uuid',
    severity: 'error',
  },
];

function findFiles(dir, extensions = ['.js', '.ts', '.jsx', '.tsx']) {
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    
    // Skip node_modules, .git, etc.
    if (item.isDirectory()) {
      if (!['node_modules', '.git', '.next', 'dist', 'build'].includes(item.name)) {
        files.push(...findFiles(fullPath, extensions));
      }
    } else if (extensions.some(ext => item.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  
  // Skip test files and scripts (they might have intentional patterns)
  if (filePath.includes('/test/') || 
      filePath.includes('/tests/') || 
      filePath.includes('/scripts/') ||
      filePath.includes('.test.') ||
      filePath.includes('.spec.')) {
    return issues;
  }
  
  PATTERNS.forEach((pattern, index) => {
    const matches = [...content.matchAll(pattern.regex)];
    matches.forEach(match => {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      const line = content.split('\n')[lineNumber - 1];
      
      issues.push({
        file: filePath,
        line: lineNumber,
        column: match.index - content.lastIndexOf('\n', match.index),
        match: match[0],
        message: pattern.message,
        severity: pattern.severity,
        context: line.trim(),
      });
    });
  });
  
  return issues;
}

function main() {
  console.log('🔍 Scanning for incorrect UUID::text casts...\n');
  
  const rootDir = path.join(__dirname, '..');
  const files = findFiles(rootDir);
  
  const allIssues = [];
  files.forEach(file => {
    const issues = checkFile(file);
    allIssues.push(...issues);
  });
  
  if (allIssues.length === 0) {
    console.log('✅ No issues found! All UUID casts look correct.\n');
    process.exit(0);
  }
  
  console.log(`❌ Found ${allIssues.length} potential issue(s):\n`);
  
  // Group by file
  const byFile = {};
  allIssues.forEach(issue => {
    if (!byFile[issue.file]) {
      byFile[issue.file] = [];
    }
    byFile[issue.file].push(issue);
  });
  
  Object.entries(byFile).forEach(([file, issues]) => {
    console.log(`📄 ${file}`);
    issues.forEach(issue => {
      console.log(`   Line ${issue.line}: ${issue.message}`);
      console.log(`   ${issue.context}`);
      console.log('');
    });
  });
  
  console.log('\n💡 Tip: Use ::uuid instead of ::text for UUID columns');
  console.log('   Check migration scripts to verify actual database column types\n');
  
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { checkFile, findFiles };

