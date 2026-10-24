const { execSync } = require('child_process');

console.log('--- Checking if .env was ever committed ---');
try {
  const envLog = execSync('git log --all --full-history --name-only -- ".env"', { encoding: 'utf8' }).trim();
  console.log('.env in git history:', envLog ? 'YES (found in history)' : 'NO (clean)');
  if (envLog) console.log(envLog);
} catch (e) {
  console.log('Error checking .env:', e.message);
}

console.log('\n--- Checking for sensitive patterns in commit history ---');
const sensitiveStrings = [
  '0x4AAAAAAFdzwaPwK2How4KseNGzTcwxESo',
  'b8d7a12401f9c894e6378e9b04752d586a117b4459871f3914a873d6f10bc479',
  'FHTAXX62R7FEZOI4QXM6XUHCB2NVLP5O',
  'SMTP_PASS=',
  'sandipanmajumder9339@gmail.com'
];

for (const s of sensitiveStrings) {
  try {
    const hits = execSync(`git log --no-textconv -S "${s}" --oneline`, { encoding: 'utf8' }).trim();
    if (hits) {
      console.log(`Found string "${s.slice(0, 15)}..." in commits:`, hits.split('\n'));
    } else {
      console.log(`String "${s.slice(0, 15)}...": CLEAN (not found)`);
    }
  } catch (e) {
    console.log(`String "${s.slice(0, 15)}...": Error ${e.message}`);
  }
}

console.log('\n--- Checking current working tree (git grep) ---');
for (const s of sensitiveStrings) {
  try {
    const hits = execSync(`git grep "${s}"`, { encoding: 'utf8' }).trim();
    if (hits) {
      console.log(`Working tree MATCH for "${s.slice(0, 15)}...":\n`, hits);
    } else {
      console.log(`Working tree CLEAN for "${s.slice(0, 15)}..."`);
    }
  } catch (e) {
    console.log(`Working tree CLEAN for "${s.slice(0, 15)}..."`);
  }
}
