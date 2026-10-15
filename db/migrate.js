require('dotenv').config({ path: ['.env.local', '.env'], quiet: true });

const { Pool } = require('pg');

// Usa a conexão direta (sem pooler) para alterações de schema
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
});

const schema = `
CREATE TABLE IF NOT EXISTS REGISTROS (
  ID_RELATO      SERIAL PRIMARY KEY,
  CONTEUDO       TEXT NOT NULL,
  ANALISE        VARCHAR(100),
  NIVEL_URGENCIA INT
);

CREATE TABLE IF NOT EXISTS EMOCAO (
  ID_EMOCAO   SERIAL PRIMARY KEY,
  NOME_EMOCAO VARCHAR(100) NOT NULL,
  CATEGORIA   VARCHAR(20),
  NIVEL_RISCO VARCHAR(10)
);
`;

pool.query(schema)
  .then(() => console.log('✓ Schema aplicado'))
  .catch(err => {
    console.error('✗ Falha ao aplicar schema:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
