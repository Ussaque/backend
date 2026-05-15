const mysql = require('mysql2');
require('dotenv').config();

const pool = process.env.MYSQL_URL
  ? mysql.createPool(process.env.MYSQL_URL + '?waitForConnections=true&connectionLimit=10&queueLimit=0')
  : mysql.createPool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

const promisePool = pool.promise();

module.exports = promisePool;