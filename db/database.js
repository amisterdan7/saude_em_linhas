// db/database.js
const db = require('../services/service.db');

const catalogoInicial = [
  {
    titulo: 'Pausa e Desaceleração',
    categoria: 'burnout',
    gatilho: 'estou cansado, exausto, sem energia, esgotado, sem foco',
    conteudo: 'O cansaço profundo pede desaceleração imediata. Faça uma pausa de 10 minutos longe das telas, hidrate-se e pratique a respiração 4-7-8.',
    musica_url: 'https://open.spotify.com/track/6kkwzB6hXLIONkEk9JciA6',
    video_url: 'https://www.youtube.com/watch?v=inpok4MKVLM'
  },
  {
    titulo: 'Aterramento 5-4-3-2-1',
    categoria: 'ansiedade',
    gatilho: 'estou ansioso, mente acelerada, preocupado, nervoso, insônia',
    conteudo: 'Use a técnica de aterramento 5-4-3-2-1: observe 5 objetos ao seu redor, 4 coisas que pode tocar, 3 sons, 2 aromas e 1 gosto.',
    musica_url: 'https://open.spotify.com/track/3be9ACTxtcL6Zm4vJRUiPG',
    video_url: 'https://www.youtube.com/watch?v=O-6f5wQXSu8'
  }
];

async function initAndSeed() {
  await db.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS recursos_apoio (
      id SERIAL PRIMARY KEY,
      titulo VARCHAR(150),
      categoria VARCHAR(100),
      gatilho TEXT,
      conteudo TEXT,
      musica_url TEXT,
      video_url TEXT,
      openai_file_id VARCHAR(120),
      embedding VECTOR(1536)
    );
  `);

  const { rows } = await db.query(`SELECT COUNT(*) FROM recursos_apoio`);
  if (Number(rows[0].count) === 0) {
    for (const item of catalogoInicial) {
      await db.query(
        `INSERT INTO recursos_apoio (titulo, categoria, gatilho, conteudo, musica_url, video_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [item.titulo, item.categoria, item.gatilho, item.conteudo, item.musica_url, item.video_url]
      );
    }
  }
}

module.exports = {
  initAndSeed,
  initVectorDatabase: initAndSeed
};