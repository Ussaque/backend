const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// Compatibility wrapper — converts ? placeholders to $1, $2, ... for PostgreSQL
// and mirrors mysql2's [rows, result] return format.
const db = {
  async query(sql, params = []) {
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`);
    const result = await pool.query(pgSql, params);
    const rows = result.rows;
    rows.affectedRows = result.rowCount;
    return [rows, result];
  },
};

module.exports = db;

module.exports = db;