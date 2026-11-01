#!/usr/bin/env node
/**
 * Build Clean Production Deployment Package (`dist/coastal-view-production.zip`)
 *
 * Strictly includes only production runtime files and administrative CLI scripts,
 * and verifies that the resulting archive contains ZERO excluded patterns:
 *   - data/
 *   - *.sqlite*
 *   - db-backup-*.json
 *   - .env (any secret environment file; only .env.example is permitted)
 *   - uploads/
 *   - test_*
 *   - verify_*
 *   - scratch/
 *   - .git/ (Git history)
 *   - api/ (legacy PHP files)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const OUTPUT_ZIP = path.join(DIST_DIR, 'coastal-view-production.zip');
const MANIFEST_JSON = path.join(DIST_DIR, 'production-manifest.json');

// Explicit allowlist of production files and folders
const PRODUCTION_PATHS = [
  'package.json',
  'package-lock.json',
  'server.js',
  'auth_security.js',
  'db_store.js',
  'email_service.js',
  'invoice_generator.js',
  'media_security.js',
  'roles_permissions.js',
  'settings_crypto.js',
  'chatbot_service.js',
  'chatbot',
  'admin',
  'assets',
  'index.html',
  'gallery.html',
  'menu.html',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  '.htaccess',
  '.env.example',
  'HOSTINGER_DEPLOYMENT.md',
  'HOSTINGER_DEPLOYMENT_GUIDE.md',
  'scripts/build_production_package.js',
  'scripts/create_super_admin.js',
  'scripts/reset_admin_password.js',
  'scripts/unlock_admin.js',
  'scripts/reset_admin_mfa.js',
  'scripts/recover_account.js',
  'scripts/rotate_encryption_key.js'
];

// Forbidden pattern checks (belt-and-suspenders guard)
const FORBIDDEN_CHECKS = [
  { label: 'data/', test: (rel) => rel === 'data' || rel.startsWith('data/') },
  { label: '*.sqlite*', test: (rel) => /\.sqlite/i.test(rel) },
  { label: 'db-backup-*.json', test: (rel) => /db-backup-.*\.json/i.test(rel) || /\.bak|\.backup/i.test(rel) },
  { label: '.env', test: (rel) => /(^|\/)\.env(\..+)?$/i.test(rel) && rel !== '.env.example' },
  { label: 'uploads/', test: (rel) => rel === 'uploads' || rel.startsWith('uploads/') },
  { label: 'test_*', test: (rel) => /(^|\/)test_/i.test(rel) },
  { label: 'verify_*', test: (rel) => /(^|\/)verify_/i.test(rel) },
  { label: 'scratch/', test: (rel) => rel === 'scratch' || rel.startsWith('scratch/') },
  { label: '.git/', test: (rel) => rel === '.git' || rel.startsWith('.git/') },
  { label: 'api/ (legacy PHP)', test: (rel) => rel === 'api' || rel.startsWith('api/') || /\.php$/i.test(rel) }
];

function isForbidden(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  for (const rule of FORBIDDEN_CHECKS) {
    if (rule.test(normalized)) {
      return rule.label;
    }
  }
  return null;
}

function collectFiles(entryRelPath, collected = []) {
  const normalizedRel = entryRelPath.replace(/\\/g, '/');
  const forbiddenReason = isForbidden(normalizedRel);
  if (forbiddenReason) {
    throw new Error(`Security Guard blocked forbidden path "${normalizedRel}" (matched rule: ${forbiddenReason})`);
  }

  const fullPath = path.join(ROOT_DIR, entryRelPath);
  if (!fs.existsSync(fullPath)) {
    return collected;
  }

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(fullPath).sort();
    for (const child of entries) {
      collectFiles(path.posix.join(normalizedRel, child), collected);
    }
  } else if (stat.isFile()) {
    collected.push({
      relPath: normalizedRel,
      fullPath,
      sizeBytes: stat.size
    });
  }
  return collected;
}

async function buildProductionPackage() {
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }
  if (fs.existsSync(OUTPUT_ZIP)) {
    fs.unlinkSync(OUTPUT_ZIP);
  }

  const filesToPackage = [];
  for (const item of PRODUCTION_PATHS) {
    collectFiles(item, filesToPackage);
  }

  // Sort deterministically
  filesToPackage.sort((a, b) => a.relPath.localeCompare(b.relPath));

  // Double-check every collected file against forbidden rules
  for (const file of filesToPackage) {
    const reason = isForbidden(file.relPath);
    if (reason) {
      throw new Error(`Forbidden file "${file.relPath}" matched exclusion rule "${reason}"`);
    }
  }

  const { ZipArchive } = await import('archiver');

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(OUTPUT_ZIP);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);

    for (const file of filesToPackage) {
      archive.file(file.fullPath, { name: file.relPath });
    }

    archive.finalize();
  });

  const zipStat = fs.statSync(OUTPUT_ZIP);
  const manifest = {
    builtAt: new Date().toISOString(),
    archivePath: 'dist/coastal-view-production.zip',
    archiveSizeBytes: zipStat.size,
    totalFiles: filesToPackage.length,
    excludedPatternsVerified: FORBIDDEN_CHECKS.map((c) => c.label),
    files: filesToPackage.map((f) => ({
      path: f.relPath,
      sizeBytes: f.sizeBytes
    }))
  };

  fs.writeFileSync(MANIFEST_JSON, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('================================================================');
  console.log(' CLEAN PRODUCTION PACKAGE BUILT SUCCESSFULLY');
  console.log('================================================================');
  console.log(` Archive       : dist/coastal-view-production.zip (${(zipStat.size / 1024).toFixed(1)} KB)`);
  console.log(` Manifest      : dist/production-manifest.json`);
  console.log(` Total Files   : ${filesToPackage.length}`);
  console.log(` Excluded      : ${FORBIDDEN_CHECKS.map((c) => c.label).join(', ')}`);
  console.log('----------------------------------------------------------------');
  for (const f of filesToPackage) {
    console.log(` [INCLUDED] ${f.relPath} (${f.sizeBytes} bytes)`);
  }
  console.log('================================================================');
}

buildProductionPackage().catch((err) => {
  console.error('[BUILD FAILED]:', err.message);
  process.exit(1);
});
