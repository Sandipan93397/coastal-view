/**
 * Script to patch user management & room deletion with requireReauth and Argon2id
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let serverJs = fs.readFileSync(serverPath, 'utf8');

// 1. Add requireReauth to DELETE /api/rooms/:id
serverJs = serverJs.replace(
  "app.delete('/api/rooms/:id', requireManager,",
  "app.delete('/api/rooms/:id', requireManager, requireReauth,"
);

// 2. Patch POST /api/admin/users and DELETE /api/admin/users/:username
const oldUserBlock = `app.post('/api/admin/users', requireSuperAdmin, (req, res) => {
  const { username, name, password, role } = req.body;
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Valid username and 6+ character password required' });
  }

  const db = readDB();
  if (!db) return res.status(500).json({ success: false });
  db.users = db.users || [];
  const existingIdx = db.users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
  const hash = bcrypt.hashSync(password, 10);
  const userObj = {
    username,
    name: name || username,
    passwordHash: hash,
    role: role || 'Manager',
    email: req.body.email || \`\${username}@coastalviewmandarmani.com\`
  };

  if (existingIdx > -1) {
    db.users[existingIdx] = { ...db.users[existingIdx], ...userObj };
  } else {
    db.users.push(userObj);
  }

  logAudit(db, req.user, existingIdx > -1 ? 'User Updated' : 'User Created', \`\${req.user?.name || 'Super Admin'} configured staff account for \${username} (\${role || 'Manager'}).\`, req);
  writeDB(db);

  const safeUsers = db.users.map(u => ({ username: u.username, role: u.role || 'Manager', name: u.name || u.username }));
  res.json({ success: true, message: \`Manager \${username} saved successfully\`, users: safeUsers });
});

app.delete('/api/admin/users/:username', requireSuperAdmin, (req, res) => {
  const targetUser = req.params.username;
  if (targetUser.toLowerCase() === 'admin') {
    return res.status(400).json({ success: false, message: 'Cannot delete primary Super Admin' });
  }

  const db = readDB();
  if (!db) return res.status(500).json({ success: false });
  db.users = (db.users || []).filter(u => u.username.toLowerCase() !== targetUser.toLowerCase());
  logAudit(db, req.user, 'User Deleted', \`\${req.user?.name || 'Super Admin'} removed staff account \${targetUser}.\`, req);
  writeDB(db);

  const safeUsers = db.users.map(u => ({ username: u.username, role: u.role || 'Manager', name: u.name || u.username }));
  res.json({ success: true, message: \`Account \${targetUser} removed\`, users: safeUsers });
});`;

const newUserBlock = `app.post('/api/admin/users', requireSuperAdmin, requireReauth, async (req, res) => {
  const { username, name, password, role, email } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  const policy = validatePasswordPolicy(password);
  if (!policy.isValid) {
    return res.status(400).json({ success: false, message: policy.issues.join('; ') });
  }

  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });
  db.users = db.users || [];
  const existingIdx = db.users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());

  const hash = await hashPassword(password);
  const userObj = {
    username: username.trim(),
    name: name || username,
    passwordHash: hash,
    role: role || 'Manager',
    email: email || \`\${username}@coastalviewmandarmani.com\`
  };

  if (existingIdx > -1) {
    db.users[existingIdx] = { ...db.users[existingIdx], ...userObj };
  } else {
    db.users.push(userObj);
  }

  logAudit(db, req.user, existingIdx > -1 ? 'Staff Account Updated' : 'Staff Account Created', \`Super Admin configured staff account for \${username} (\${role || 'Manager'}). Argon2id hashing applied.\`, req);

  // Send Alert on role changes or creation
  sendSuperAdminAlert(
    \`Staff Account Configured: \${username} (\${role})\`,
    \`Super Admin \${req.user.name} configured staff credentials and role <strong>\${role}</strong> for account <strong>\${username}</strong>.\`,
    db
  );

  writeDB(db);

  const safeUsers = db.users.map(u => ({ username: u.username, role: u.role || 'Manager', name: u.name || u.username, email: u.email }));
  res.json({ success: true, message: \`Staff account \${username} saved successfully with Argon2id.\`, users: safeUsers });
});

app.delete('/api/admin/users/:username', requireSuperAdmin, requireReauth, (req, res) => {
  const targetUser = req.params.username;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });

  const targetAccount = (db.users || []).find(u => u.username.toLowerCase() === targetUser.toLowerCase());
  if (targetAccount && targetAccount.role === 'Super Admin') {
    return res.status(400).json({ success: false, message: 'Cannot delete Super Admin account' });
  }

  db.users = (db.users || []).filter(u => u.username.toLowerCase() !== targetUser.toLowerCase());
  logAudit(db, req.user, 'Staff Account Deleted', \`Super Admin removed staff account \${targetUser}.\`, req);

  sendSuperAdminAlert(
    \`Staff Account Deleted: \${targetUser}\`,
    \`Super Admin \${req.user.name} deleted staff account <strong>\${targetUser}</strong>.\`,
    db
  );

  writeDB(db);

  const safeUsers = db.users.map(u => ({ username: u.username, role: u.role || 'Manager', name: u.name || u.username, email: u.email }));
  res.json({ success: true, message: \`Account \${targetUser} removed\`, users: safeUsers });
});`;

serverJs = serverJs.replace(oldUserBlock, newUserBlock);

fs.writeFileSync(serverPath, serverJs, 'utf8');
console.log('User management & room delete patched with requireReauth and Argon2id.');
