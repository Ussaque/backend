require('dotenv').config({ path: __dirname + '/.env' });
const db = require('./database');

async function run() {
  try {
    const [[userRows]] = await db.query('SELECT COUNT(*) as count FROM users');
    console.log('users:', userRows);

    const [[jobRows]] = await db.query('SELECT COUNT(*) as count FROM jobs');
    console.log('jobs:', jobRows);

    const [[pendingJobs]] = await db.query("SELECT COUNT(*) as count FROM jobs WHERE status = 'PENDING'");
    console.log('pending:', pendingJobs);

    const [[revenueRows]] = await db.query("SELECT SUM(price) as total FROM jobs WHERE status = 'COMPLETED'");
    console.log('revenue:', revenueRows);

    console.log('TUDO OK');
  } catch(e) {
    console.error('ERRO:', e.message);
  }
  process.exit(0);
}
run();
