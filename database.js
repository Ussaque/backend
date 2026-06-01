const mysql = require('mysql2/promise');
require('dotenv').config();

// External MySQL server (startech) — has all app data
// Railway injects its own DB_HOST/MYSQL_URL vars that point to an empty internal DB,
// so we connect directly to the external host here.
const pool = mysql.createPool({
  host:     '157.173.113.193',
  port:     3306,
  user:     'startech_start',
  password: '!10Start100',
  database: 'startech_fixlink',
  waitForConnections: true,
  connectionLimit: 10,
});

// Thin wrapper that keeps the same db.query(sql, params) → [rows, result] interface.
// MySQL2 already uses ? placeholders, so no conversion is needed.
const db = {
  async query(sql, params = []) {
    return pool.query(sql, params);
  },
};

module.exports = db;