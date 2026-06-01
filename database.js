const mysql = require('mysql2/promise');
require('dotenv').config();

// Always use host-based config (ignores MYSQL_URL to avoid Railway internal empty DB)
// Railway vars: DB_HOST / DB_USER / DB_PASSWORD / DB_NAME / DB_PORT
// Local .env:   MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || process.env.MYSQL_HOST     || '157.173.113.193',
  port: parseInt(process.env.DB_PORT || process.env.MYSQL_PORT    || '3306', 10),
  user:     process.env.DB_USER     || process.env.MYSQL_USER     || 'startech_start',
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '!10Start100',
  database: process.env.DB_NAME     || process.env.MYSQL_DATABASE || 'startech_fixlink',
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