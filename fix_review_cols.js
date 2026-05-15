const db = require('./database');
async function run() {
  try { await db.query("ALTER TABLE reviews ADD COLUMN before_photo_url VARCHAR(500) DEFAULT NULL"); console.log('before_photo_url ok'); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE reviews ADD COLUMN after_photo_url VARCHAR(500) DEFAULT NULL"); console.log('after_photo_url ok'); } catch(e) { console.log(e.message); }
  process.exit(0);
}
run();
