// services/service.openai.js
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const db = require('./service.db');
const { initAndSeed } = require('../db/database');

const openai = new OpenAI({
  apiKey: process.env.IA_API_KEY || process.env.OPENAI_API_KEY
});

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const CHAT_MODEL = process.env.IA_MODEL || 'gpt-4o-mini';

// 1. Gera vetores de 1536 dimensões na OpenAI
async function gerarEmbeddings(textos) {
  const entradas = Array.isArray(textos) ? textos : [textos];
  const limpas = entradas.map(t => String(t).replace(/\n+/g, ' ').trim());

  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: limpas
  });
  return res.data.map(d => d.embedding);
}

// 2. Garante que os itens iniciais do banco tenham vetor
async function sincronizarVetoresBanco() {
  await initAndSeed();
  const { rows } = await db.query(`SELECT * FROM recursos_apoio WHERE embedding IS NULL`);
  if (rows.length === 0) return;

  const textos = rows.map(r => `${r.titulo || ''} | ${r.categoria || ''} | ${r.gatilho || ''} | ${r.conteudo}`);
  const vetores = await gerarEmbeddings(textos);

  for (let i = 0; i < rows.length; i++) {
    const vetorStr = `[${vetores[i].join(',')}]`;
    await db.query(
      `UPDATE recursos_apoio SET embedding = $1::vector WHERE id = $2`,
      [vetorStr, rows[i].id]
    );
  }
}

// 3. Faz upload do arquivo (.md) na OpenAI, extrai o file_id e salva os chunks no PostgreSQL
async function uploadArquivoEExtrairChunks(caminhoRelativo = 'static/data.md', categoria = 'Protocolo File Search') {
  await initAndSeed();
  const caminhoAbsoluto = path.resolve(process.cwd(), caminhoRelativo);

  const fileUpload = await openai.files.create({
    file: fs.createReadStream(caminhoAbsoluto),
    purpose: 'assistants'
  });

  const texto = fs.readFileSync(caminhoAbsoluto, 'utf-8');
  const chunks = texto
    .split(/(?=^##\s)/m)
    .map(c => c.trim())
    .filter(c => c.length > 20);

  const vetores = await gerarEmbeddings(chunks);

  // Remove chunks antigos da mesma categoria para evitar duplicatas no banco
  await db.query(`DELETE FROM recursos_apoio WHERE categoria = $1 AND openai_file_id IS NOT NULL`, [categoria]);

  for (let i = 0; i < chunks.length; i++) {
    const vetorStr = `[${vetores[i].join(',')}]`;
    const primeiraLinha = chunks[i].split('\n')[0].replace(/^##\s*/, '').trim();

    await db.query(
      `INSERT INTO recursos_apoio (titulo, categoria, gatilho, conteudo, openai_file_id, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      [
        primeiraLinha.slice(0, 140),
        categoria,
        chunks[i].slice(0, 100),
        chunks[i],
        fileUpload.id,
        vetorStr
      ]
    );
  }

  return {
    sucesso: true,
    openai_file_id: fileUpload.id,
    arquivo: caminhoRelativo,
    chunks_salvos: chunks.length
  };
}

// 4. Busca no PostgreSQL os chunks mais próximos semanticamente da mensagem do usuário
async function buscarContextoSimilar(mensagemUsuario, limite = 3) {
  await sincronizarVetoresBanco();

  const [vetorMsg] = await gerarEmbeddings([mensagemUsuario]);
  const vetorStr = `[${vetorMsg.join(',')}]`;

  const { rows: similares } = await db.query(
    `SELECT id, titulo, categoria, conteudo, musica_url, video_url, openai_file_id,
            1 - (embedding <=> $1::vector) AS similaridade
     FROM recursos_apoio
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vetorStr, limite]
  );

  return similares;
}

// 5. Responde via OpenAI Responses API usando os chunks recuperados (para GET /generate)
async function responderComRAG(mensagemUsuario) {
  const similares = await buscarContextoSimilar(mensagemUsuario, 3);

  const contexto = similares
    .map(
      s =>
        `[Fonte: ${s.openai_file_id || 'DB-Seed'} | Similaridade: ${Number(s.similaridade).toFixed(2)}]\n${s.conteudo}` +
        (s.musica_url ? `\nMúsica: ${s.musica_url}` : '') +
        (s.video_url ? `\nVídeo: ${s.video_url}` : '')
    )
    .join('\n\n');

  const response = await openai.responses.create({
    model: CHAT_MODEL,
    instructions: `Você é o assistente de acolhimento emocional do projeto Saúde em Linhas.
Responda de forma empática, acolhedora e fundamentada nos recursos recuperados por similaridade abaixo:

${contexto}`,
    input: mensagemUsuario
  });

  return {
    input_usuario: mensagemUsuario,
    cartaApoio: response.output_text,
    similares_encontrados: similares
  };
}

module.exports = {
  gerarEmbeddings,
  sincronizarVetoresBanco,
  uploadArquivoEExtrairChunks,
  buscarContextoSimilar,
  responderComRAG
};