
const { Pool } = require('pg');
require('dotenv').config();

// console.log('DATABASE_URL:', process.env.DATABASE_URL);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = pool;
