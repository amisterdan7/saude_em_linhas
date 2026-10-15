const { Pool } = require('pg');

// Neon: DATABASE_URL é a URL com pooler; o SSL vem da própria URL (sslmode=require)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.connect()
  .then(client => {
    console.log('✓ PostgreSQL conectado');
    client.release();
  })
  .catch(err => {
    console.error('✗ Falha ao conectar no PostgreSQL:', err.message);
    process.exit(1);
  });

module.exports = pool;