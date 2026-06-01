const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
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