/**
 * Seed the first admin user.
 * Usage: node src/db/seed.js
 * CHANGE THE PASSWORD before running in production!
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

const ADMIN = {
  email:    'social@uppercrustwealth.com',
  password: 'ChangeMe@123',           // <-- CHANGE THIS
  name:     'Dhruv',
  role:     'admin'
};

async function seed() {
  const hash = await bcrypt.hash(ADMIN.password, 12);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, name = EXCLUDED.name, role = EXCLUDED.role`,
      [ADMIN.email, hash, ADMIN.name, ADMIN.role]
    );
    console.log(`Admin user created: ${ADMIN.email}`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => { console.error(err); process.exit(1); });
