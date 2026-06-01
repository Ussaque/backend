const mysql = require('mysql2/promise');
require('dotenv').config();

// MYSQL_URL set in Railway dashboard → use it (internal network)
// Locally → fall back to external IP from .env
const poolConfig = process.env.MYSQL_URL
  ? {
      uri: process.env.MYSQL_URL,
      waitForConnections: true,
      connectionLimit: 10,
    }
  : {
      host: process.env.MYSQL_HOST || '157.173.113.193',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER || 'startech_start',
      password: process.env.MYSQL_PASSWORD || '!10Start100',
      database: process.env.MYSQL_DATABASE || 'startech_fixlink',
      waitForConnections: true,
      connectionLimit: 10,
    };

const pool = mysql.createPool(poolConfig);

// Thin wrapper that keeps the same db.query(sql, params) → [rows, result] interface.
// MySQL2 already uses ? placeholders, so no conversion is needed.
const db = {
  async query(sql, params = []) {
    return pool.query(sql, params);
  },
};

module.exports = db;