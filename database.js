const mysql = require('mysql2/promise');
require('dotenv').config();

// Support Railway's MYSQL_URL / MYSQL_PRIVATE_URL, or individual vars
const poolConfig = process.env.MYSQL_URL || process.env.MYSQL_PRIVATE_URL
  ? {
      uri: process.env.MYSQL_URL || process.env.MYSQL_PRIVATE_URL,
      waitForConnections: true,
      connectionLimit: 10,
    }
  : {
      host: process.env.MYSQL_HOST || process.env.MYSQLHOST || '157.173.113.193',
      port: parseInt(process.env.MYSQL_PORT || process.env.MYSQLPORT || '3306', 10),
      user: process.env.MYSQL_USER || process.env.MYSQLUSER || 'startech_start',
      password: process.env.MYSQL_PASSWORD || process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE || 'startech_fixlink',
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