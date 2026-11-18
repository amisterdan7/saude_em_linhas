// controllers/controller.ai.js
const openaiService = require('../services/service.openai');

const IA_API_URL = process.env.IA_API_URL || 'https://api.openai.com/v1/chat/completions'; // endpoint oficial da OpenAI para chat completions
const IA_API_KEY = process.env.IA_API_KEY || process.env.OPENAI_API_KEY;
const IA_MODEL = process.env.IA_MODEL || 'gpt-4o-mini';
const IA_MAX_TOKENS = Number(process.env.IA_MAX_TOKENS) || 6000;

const SYSTEM_PROMPT = `Você é um assistente de apoio emocional empático e acolhedor.
Analise o relato e responda SOMENTE com JSON válido, sem markdown, sem texto fora do JSON.
Priorize recomendar as músicas, livros, links e condutas presentes no CONTEXTO RAG recuperado do banco de dados, caso seja fornecido.
Use exatamente esta estrutura:

{
  "conselho": "Carta de apoio personalizada com 4-6 parágrafos curtos, empática, no estilo de uma carta. Comece com 'Olá,' e termine com 'Atenciosamente,\\nSistema de Apoio Emocional'. Use \\n para quebras de linha.",
  "nivel_urgencia": 1,
  "emocao": {
    "nome_emocao": "nome da emoção predominante em português",
    "categoria": "uma dessas: crise | burnout | ansiedade | estresse | tristeza | geral",
    "nivel_risco": "baixo"
  },
  "musicas": [
    { "titulo": "Nome da música", "artista": "Nome do artista", "url": "https://open.spotify.com/..." },
    { "titulo": "Nome da música", "artista": "Nome do artista", "url": "https://www.youtube.com/..." },
    { "titulo": "Nome da música", "artista": "Nome do artista", "url": "https://open.spotify.com/..." }
  ],
  "livros": [
    { "titulo": "Nome do livro", "autor": "Nome do autor", "descricao": "Uma frase sobre o livro" },
    { "titulo": "Nome do livro", "autor": "Nome do autor", "descricao": "Uma frase sobre o livro" }
  ],
  "links": [
    { "titulo": "Nome do recurso", "descricao": "O que é", "url": "https://..." },
    { "titulo": "Nome do recurso", "descricao": "O que é", "url": "https://..." }
  ]
}

Regras para nivel_urgencia:
- 1 (normal): relato cotidiano, sem sinais de crise
- 2 (medio): sofrimento moderado, estresse elevado, choro frequente, isolamento
- 3 (urgente): menciona automutilação, pensamentos suicidas, crise aguda

Regras para nivel_risco:
- "baixo" → emoções leves ou passageiras
- "medio" → emoções intensas mas sem risco imediato
- "alto"  → emoções associadas a sofrimento grave

Nunca use nomes pessoais. Nunca faça diagnósticos clínicos.`;

async function analisarRelato(conteudo) {
  // Busca os chunks do data.md mais similares no PostgreSQL via service.openai.js
  let contextoRAG = '';
  try {
    const similares = await openaiService.buscarContextoSimilar(conteudo, 3);
    if (similares.length > 0) {
      contextoRAG = similares
        .map(s => `[Fonte: ${s.openai_file_id || 'DB'} | Sim: ${Number(s.similaridade).toFixed(2)}]\n${s.conteudo}`)
        .join('\n\n');
    }
  } catch (err) {
    console.warn('Aviso: Busca RAG indisponível no momento, seguindo com análise padrão:', err.message);
  }

  const promptUsuario = contextoRAG
    ? `CONTEXTO RAG RECUPERADO DO BANCO:\n${contextoRAG}\n\nRELATO DO USUÁRIO:\n${conteudo}`
    : `Relato:\n${conteudo}`;

  const resposta = await fetch(IA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${IA_API_KEY}`,
    },
    body: JSON.stringify({
      model: IA_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: promptUsuario },
      ],
      max_tokens: IA_MAX_TOKENS,
    }),
  });

  if (!resposta.ok) {
    const erro = await resposta.text();
    throw new Error(`IA retornou ${resposta.status}: ${erro}`);
  }

  const json = await resposta.json();
  const escolha = json.choices?.[0];
  const raw = escolha?.message?.content;

  if (!raw) {
    const motivo = escolha?.finish_reason === 'length'
      ? `limite de ${IA_MAX_TOKENS} tokens atingido antes da resposta (aumente IA_MAX_TOKENS)`
      : `resposta vazia (${escolha?.finish_reason || json.error?.message || 'sem detalhes'})`;
    throw new Error(`IA sem conteúdo: ${motivo}`);
  }

  const clean = raw.replace(/```json|```/g, '').trim();
  const dados = JSON.parse(clean);
  const urgencia = [1, 2, 3].includes(dados.nivel_urgencia) ? dados.nivel_urgencia : 1;

  return {
    conselho:       dados.conselho || '',
    nivel_urgencia: urgencia,
    emocao: {
      nome_emocao: dados.emocao?.nome_emocao || 'Indefinida',
      categoria:   dados.emocao?.categoria   || 'geral',
      nivel_risco: dados.emocao?.nivel_risco || 'baixo',
    },
    musicas: Array.isArray(dados.musicas) ? dados.musicas : [],
    livros:  Array.isArray(dados.livros)  ? dados.livros  : [],
    links:   Array.isArray(dados.links)   ? dados.links   : [],
  };
}

// 2. Handlers HTTP para as rotas /generate e /upload-arquivo
async function gerarPorUrl(req, res) {
  try {
    const msg = req.query.msg || 'Estou muito cansado';
    const resultado = await openaiService.responderComRAG(msg);
    res.json(resultado);
  } catch (err) {
    console.error('Erro em GET /generate:', err);
    res.status(500).json({ erro: err.message });
  }
}

async function uploadArquivo(req, res) {
  try {
    const caminho = req.body?.caminho || 'static/data.md';
    const categoria = req.body?.categoria || 'Relatos e Protocolos Base';
    const resultado = await openaiService.uploadArquivoEExtrairChunks(caminho, categoria);
    res.json(resultado);
  } catch (err) {
    console.error('Erro em POST /upload-arquivo:', err);
    res.status(500).json({ erro: err.message });
  }
}

module.exports = {
  analisarRelato,
  gerarPorUrl,
  uploadArquivo,
};