# Documentação Técnica — Saúde em Linhas

## 1. Visão Geral e Stack Tecnológica

### Objetivo

O **Saúde em Linhas** é uma aplicação web de acolhimento emocional voltada a situações relacionadas ao trabalho e à saúde mental. A interface apresenta uma área para o usuário escrever uma carta/anônimo, envia o texto ao servidor e exibe uma resposta empática, classificação de urgência, emoção predominante e recomendações de músicas, livros e links.

### Tecnologias principais

| Tecnologia | Versão declarada no `package.json` | Uso no projeto |
|---|---:|---|
| Node.js | Aplicação JavaScript executada por Node | Runtime do servidor |
| Express | `~4.16.1` | Servidor HTTP, middlewares e rotas |
| EJS | `~2.6.1` | Renderização das páginas |
| PostgreSQL | Integrado pelo `pg` | Persistência dos relatos, emoções e recursos |
| `pg` | `^8.22.0` | Pool e consultas SQL |
| Neon PostgreSQL | Variável `DATABASE_URL` | Hospedagem PostgreSQL externa |
| `pgvector` | Extensão `vector` criada por SQL | Armazenamento e busca vetorial com vetores de 1536 dimensões |
| OpenAI SDK | `^7.59.0` | Upload de arquivos, embeddings e Responses API |
| API compatível com OpenAI | Configurável por `IA_API_URL` | Chat completions usado pela análise de relatos |
| `dotenv` | `^17.4.2` | Carregamento de `.env.local` e `.env` |
| `nodemon` | `^3.1.14` | Reinício automático em desenvolvimento |
| `cookie-parser` | `~1.4.4` | Dependência disponível no projeto |
| `debug` | `~2.6.9` | Mensagens de depuração do servidor |
| `morgan` | `~1.9.1` | Dependência disponível no projeto |
| `http-errors` | `~1.6.3` | Dependência disponível no projeto |
| `serve-favicon` | `~1.0.1` | Dependência disponível no projeto |
| `@neon/config` | `^1.9.1` | Dependência declarada |
| `@neon/env` | `^1.6.2` | Dependência declarada |

### Integrações externas

- **PostgreSQL/Neon:** pool configurado pela `DATABASE_URL`.
- **`pgvector`:** extensão `vector` usada pela tabela `recursos_apoio`.
- **API de IA compatível com OpenAI:**
  - por padrão, o controller usa `https://api.openai.com/v1/chat/completions`;
  - o serviço OpenAI usa o SDK para embeddings, upload de arquivo e Responses API;
  - os modelos podem ser configurados pelas variáveis de ambiente correspondentes.

## 2. Estrutura de Pastas e Arquitetura

```text
saude_em_linhas/
├── app.js                 # Configuração do Express, middlewares e registro das rotas
├── bin/
│   └── www.js             # Criação e inicialização do servidor HTTP
├── routes/
│   └── index.js           # Rotas GET /, /api, /generate e /upload-arquivo
├── controllers/
│   ├── controller.ai.js   # Fluxo de análise de relatos e handlers HTTP de IA/RAG
│   └── controller.report.js # Validação do relato e persistência relacionada
├── services/
│   ├── service.db.js      # Pool PostgreSQL principal
│   └── service.openai.js  # Embeddings, upload/chunks e busca vetorial/RAG
├── db/
│   ├── database.js        # Criação da extensão/tabela de recursos e seed inicial
│   └── migrate.js         # Migração das tabelas REGISTROS e EMOCAO
├── views/
│   ├── index.ejs          # Página principal com formulário e área de resposta
│   └── error.ejs          # Template de erro do Express
├── static/
│   └── data.md            # Base de conhecimento usada no pipeline RAG
├── public/
│   ├── javascripts/main.js # Interação da página e fallback local
│   ├── stylesheets/        # Estilos da interface
│   ├── images/icons/       # Ícones estáticos
│   └── favicon.svg         # Favicon servido pelo Express
├── .github/
│   └── workflows/
│       └── dependency-review.yml
├── .env.example           # Modelo das variáveis necessárias
└── package.json
```

A aplicação segue uma separação em camadas:

1. **Rotas** recebem as requisições HTTP.
2. **Controllers** validam entradas e coordenam serviços.
3. **Services** acessam PostgreSQL e provedores de IA.
4. **Banco** contém relatos, emoções e recursos vetorizados.
5. **Views e `public`** compõem a interface apresentada ao navegador.

## 3. Como o Sistema Funciona

### Fluxo ponta a ponta

#### Página inicial

1. `bin/www.js` carrega `app.js`, obtém a porta de `PORT` ou usa `3000` e inicia o servidor em `0.0.0.0`.
2. `app.js` carrega as variáveis com `dotenv`, configurando a procura por `.env.local` e depois `.env`.
3. `app.js` cria o pool PostgreSQL por meio de `require('./services/service.db')`.
4. O Express configura EJS, JSON, formulários URL-encoded e arquivos estáticos de `public`.
5. `GET /` renderiza `views/index.ejs` com os valores iniciais `erro: null` e `resultado: null`.
6. `views/index.ejs` apresenta o formulário de carta e carrega `public/javascripts/main.js`.

#### Envio de um relato

1. O JavaScript limita o texto no navegador a 1000 caracteres e habilita o botão apenas quando existe conteúdo.
2. `handleSend()` realiza `POST /relato` com JSON `{ "conteudo": "..." }`.
3. `app.js` encaminha a requisição ao controller `enviarRelato`.
4. `controller.report.js` exige pelo menos 10 caracteres após remover espaços das extremidades.
5. O texto é recortado para no máximo 2000 caracteres.
6. Banco e IA são acionados em paralelo com `Promise.allSettled`:
   - uma inserção em `REGISTROS`;
   - `analisarRelato(textoLimpo)`.
7. Se a IA falhar, a API responde HTTP `502` com `{ "erro": "Erro ao consultar a IA." }`.
8. Se a IA retornar, o controller atualiza o registro com análise e urgência e faz o upsert de uma emoção por nome.
9. Em caso de falha apenas no banco de relato, a resposta da IA ainda é enviada ao cliente.
10. O front-end usa os dados retornados para exibir cartão de emoção, carta, músicas, livros e links.
11. Se a resposta HTTP não for aceita ou houver falha de rede, o JavaScript executa uma análise local baseada em palavras-chave e recomendações estáticas.

### Pipeline RAG

#### Inicialização dos recursos

`sincronizarVetoresBanco()` chama `initAndSeed()`:

- cria a extensão PostgreSQL `vector`, se necessário;
- cria `recursos_apoio`;
- insere no banco um catálogo inicial somente quando a tabela está vazia;
- busca registros de `recursos_apoio` com `embedding IS NULL`;
- gera embeddings para `titulo`, `categoria`, `gatilho` e `conteudo`;
- atualiza cada recurso com o vetor na coluna `embedding`.

Os vetores gerados têm 1536 dimensões, correspondente ao modelo padrão `text-embedding-3-small`.

#### Indexação de `static/data.md`

`POST /upload-arquivo` chama `uploadArquivoEExtrairChunks()`:

1. `initAndSeed()` garante a extensão, a tabela e o seed.
2. O caminho recebido é resolvido a partir do diretório atual do processo; o padrão é `static/data.md`.
3. O arquivo Markdown é enviado ao serviço OpenAI com finalidade `assistants`.
4. O ID retornado pelo upload é usado como `openai_file_id`.
5. O conteúdo é dividido em chunks pelo início de títulos Markdown do tipo `##`.
6. Chunks com 20 caracteres ou menos são descartados.
7. Os chunks restantes são enviados ao serviço de embeddings.
8. Chunks antigos da mesma categoria são removidos para evitar duplicatas.
9. Cada chunk é salvo em `recursos_apoio` com título, categoria, gatilho, conteúdo, `openai_file_id` e vetor.

O arquivo atual possui casos separados por títulos `##`, incluindo exaustão/burnout, ansiedade, estresse, tristeza e crise.

#### Busca por similaridade

Quando um relato é analisado:

1. `buscarContextoSimilar()` chama a sincronização dos vetores.
2. O texto do relato é convertido em um vetor pelo mesmo serviço de embeddings.
3. A consulta calcula a similaridade por distância cosseno com o operador `embedding <=> $1::vector`.
4. A similaridade apresentada é calculada como `1 - (embedding <=> vetor)`.
5. São recuperados até três recursos com `embedding IS NOT NULL`, ordenados pela menor distância.

#### Montagem do prompt e respostas

Há dois caminhos de geração existentes:

- **Análise de `POST /relato`:** o contexto RAG é incluído no prompt enviado ao endpoint de chat completions junto ao relato. A API deve retornar somente JSON válido. Se não houver contexto porque a busca falhou, o controller mantém a análise padrão com apenas o relato.
- **`GET /generate`:** o contexto RAG é usado nas `instructions` da Responses API do SDK OpenAI, e o texto recebido em `msg` é enviado como `input`.

O fallback em caso de erro no RAG é a continuação da análise sem contexto vetorial. Caso a consulta ao banco falhe durante `buscarContextoSimilar()`, o erro é registrado em `analisarRelato()` e o fluxo segue para a IA. Já no front-end, qualquer falha HTTP ou de rede em `/relato` ativa uma análise local que não depende da API.

## 4. Banco de Dados e Variáveis de Ambiente

### Tabelas e extensão

#### Extensão

| Nome | Comando |
|---|---|
| `vector` | `CREATE EXTENSION IF NOT EXISTS vector` |

A extensão é criada por `initAndSeed()` em `db/database.js`.

#### `REGISTROS`

Criada por `db/migrate.js`.

| Coluna | Tipo | Observação |
|---|---|---|
| `ID_RELATO` | `SERIAL PRIMARY KEY` | Identificador |
| `CONTEUDO` | `TEXT NOT NULL` | Texto limpo do relato |
| `ANALISE` | `VARCHAR(100)` | Conselho da IA limitado a 100 caracteres na atualização |
| `NIVEL_URGENCIA` | `INT` | Valor normalizado para `1`, `2` ou `3` |

#### `EMOCAO`

Criada por `db/migrate.js`.

| Coluna | Tipo | Observação |
|---|---|---|
| `ID_EMOCAO` | `SERIAL PRIMARY KEY` | Identificador |
| `NOME_EMOCAO` | `VARCHAR(100) NOT NULL` | Nome da emoção |
| `CATEGORIA` | `VARCHAR(20)` | Categoria apresentada pela IA |
| `NIVEL_RISCO` | `VARCHAR(10)` | Nível apresentado pela IA |

O controller consulta uma emoção existente por nome sem distinguir maiúsculas de minúsculas. Uma emoção nova é inserida apenas quando não encontra uma correspondência.

#### `recursos_apoio`

Criada por `db/database.js`.

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | Identificador |
| `titulo` | `VARCHAR(150)` | Título do recurso/chunk |
| `categoria` | `VARCHAR(100)` | Categoria do recurso |
| `gatilho` | `TEXT` | Gatilho ou trecho inicial usado na sincronização |
| `conteudo` | `TEXT` | Conteúdo completo do recurso/chunk |
| `musica_url` | `TEXT` | URL de música do seed |
| `video_url` | `TEXT` | URL de vídeo do seed |
| `openai_file_id` | `VARCHAR(120)` | ID do arquivo enviado ao OpenAI |
| `embedding` | `VECTOR(1536)` | Vetor para busca de similaridade |

O seed inicial contém dois recursos:

- “Pausa e Desaceleração”, categoria `burnout`;
- “Aterramento 5-4-3-2-1”, categoria `ansiedade`.

Os recursos são semeados somente quando a tabela não contém registros.

### Scripts de banco

- `npm run db:migrate`: executa `db/migrate.js` e cria `REGISTROS` e `EMOCAO`.
- `initAndSeed()` é chamado pelo serviço RAG para criar a extensão `vector`, criar `recursos_apoio` e inserir o catálogo inicial.

### Variáveis de ambiente

| Variável | Obrigatoriedade | Finalidade |
|---|---|---|
| `DATABASE_URL` | Obrigatória para a aplicação se conectar ao PostgreSQL | URL do pool Neon/PostgreSQL usada por `services/service.db.js` |
| `DATABASE_URL_UNPOOLED` | Opcional no código; preferida por `db/migrate.js` | URL direta sem pool usada pela migração |
| `IA_API_URL` | Opcional | Endpoint compatível com Chat Completions usado pela análise de relato |
| `IA_API_KEY` | Necessária para autenticar o serviço de IA, quando não usada `OPENAI_API_KEY` | Chave usada pelo SDK OpenAI e pelo header do Chat Completions |
| `OPENAI_API_KEY` | Alternativa à `IA_API_KEY` | Chave legada/compatível usada pelo SDK e pelo controller |
| `IA_MODEL` | Opcional | Modelo usado pela API de chat e pela Responses API |
| `IA_MAX_TOKENS` | Opcional | Limite máximo de tokens usado no Chat Completions |
| `OPENAI_EMBEDDING_MODEL` | Opcional | Modelo usado para gerar embeddings |
| `PORT` | Opcional | Porta HTTP; padrão `3000` |
| `NODE_ENV` | Opcional | Valor apresentado por `GET /api`; padrão `development` |

O arquivo `.env.example` possui os nomes `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `IA_API_URL`, `IA_API_KEY`, `IA_MODEL`, `IA_MAX_TOKENS`, `PORT` e `NODE_ENV`. `OPENAI_API_KEY` e `OPENAI_EMBEDDING_MODEL` são variáveis reconhecidas diretamente pelo código, mas não estão listadas nesse exemplo.

O projeto procura `.env.local` e `.env`, nessa ordem de caminho no `dotenv`.

## 5. Catálogo Completo de Endpoints

### `GET /`

- **Finalidade:** renderizar a página principal.
- **Parâmetros:** nenhum.
- **Controller:** handler local em `routes/index.js`.
- **Respostas:**
  - `200`: renderização de `views/index.ejs`;
  - não há captura explícita de erro HTTP nesse handler.

### `GET /api`

- **Finalidade:** informar o estado básico da API.
- **Parâmetros:** nenhum.
- **Controller:** handler local em `routes/index.js`.
- **Resposta JSON de sucesso (`200`):**

```json
{
  "endpoint": "/api",
  "banco": "PostgreSQL",
  "description": "API para o projeto Saúde em Linhas",
  "environment": "development"
}
```

O campo `environment` usa `NODE_ENV` ou `development`.

### `GET /generate`

- **Finalidade:** gerar uma resposta RAG para uma mensagem usando a Responses API.
- **Parâmetros:** `query.msg`, opcional. Exemplo:

```text
GET /generate?msg=Estou muito cansado
```

Quando `msg` não é informado, o texto padrão é `Estou muito cansado`.

- **Controller:** `aiController.gerarPorUrl`.
- **Service:** `openaiService.responderComRAG` e, por consequência, `buscarContextoSimilar`.
- **Resposta de sucesso (`200`)**:

```json
{
  "input_usuario": "mensagem",
  "cartaApoio": "texto gerado pela IA",
  "similares_encontrados": []
}
```

`similares_encontrados` contém os campos das linhas recuperadas, incluindo `id`, `titulo`, `categoria`, `conteudo`, `musica_url`, `video_url`, `openai_file_id` e `similaridade`.

- **Erro (`500`)**:

```json
{
  "erro": "mensagem do erro"
}
```

### `POST /upload-arquivo`

- **Finalidade:** carregar um Markdown por caminho relativo, dividir em chunks e salvar vetores no PostgreSQL.
- **Parâmetros:** JSON ou formulário URL-encoded:
  - `body.caminho`: opcional; padrão `static/data.md`;
  - `body.categoria`: opcional; padrão `Relatos e Protocolos Base`.
- Exemplo:

```json
{
  "caminho": "static/data.md",
  "categoria": "Relatos e Protocolos Base"
}
```

Não existe middleware de upload binário/multipart; o controller espera o caminho de um arquivo já disponível no servidor.

- **Controller:** `aiController.uploadArquivo`.
- **Service:** `openaiService.uploadArquivoEExtrairChunks`.
- **Resposta de sucesso (`200`)**:

```json
{
  "sucesso": true,
  "openai_file_id": "id-retornado-pelo-openai",
  "arquivo": "static/data.md",
  "chunks_salvos": 6
}
```

- **Erro (`500`)**:

```json
{
  "erro": "mensagem do erro"
}
```

### `POST /relato`

- **Finalidade:** salvar e analisar um relato emocional.
- **Parâmetros:** `body.conteudo`, obrigatório.
- Exemplo:

```json
{
  "conteudo": "Estou muito cansado e preocupado com o trabalho."
}
```

- **Controller:** `enviarRelato`.
- **Services:** `pool.query` em `service.db.js` e `analisarRelato` em `controller.ai.js`, que pode consultar `service.openai.js`.
- **Respostas:**
  - `400` quando o texto não existe ou possui menos de 10 caracteres após `trim`:

```json
{
  "erro": "Texto muito curto."
}
```

  - `502` quando a IA é rejeitada:

```json
{
  "erro": "Erro ao consultar a IA."
}
```

  - `200` quando a IA responde:

```json
{
  "conselho": "texto",
  "nivel_urgencia": 1,
  "emocao": {
    "nome_emocao": "nome",
    "categoria": "geral",
    "nivel_risco": "baixo"
  },
  "musicas": [],
  "livros": [],
  "links": []
}
```

Falhas da inserção ou atualização no banco não transformam automaticamente essa rota em erro HTTP: a resposta da IA ainda pode ser enviada. Atualizações e inserções de emoção têm tratamento separado por logs no servidor.

## 6. Regras de Negócio, Segurança e CI/CD

### Regras de negócio

- O relato deve possuir pelo menos 10 caracteres após remoção de espaços nas extremidades.
- O front-end limita a entrada a 1000 caracteres; o servidor recorta o texto para 2000 caracteres.
- O nível de urgência é limitado pelo controller a `1`, `2` ou `3`. Valores fora dessa lista são convertidos para `1`.
- A urgência `3` faz o front-end inserir o recurso de CVV como primeiro item.
- A resposta da IA no fluxo de chat deve ser JSON válido, sem Markdown ou texto externo.
- Campos ausentes da resposta da IA recebem valores padrão:
  - `conselho`: texto vazio;
  - `nome_emocao`: `Indefinida`;
  - `categoria`: `geral`;
  - `nivel_risco`: `baixo`;
  - listas: arrays vazios.
- Categorias esperadas da emoção: `crise`, `burnout`, `ansiedade`, `estresse`, `tristeza` e `geral`.
- Níveis de urgência usados pelo prompt:
  - `1`: cotidiano;
  - `2`: sofrimento moderado;
  - `3`: automutilação, ideação suicida ou crise aguda.

### Privacidade e anonimato

- O projeto define `POST /relato` como “único endpoint de escrita — anônimo por design”.
- O front-end afirma que a carta é anônima e confidencial e não envia outros campos pessoais no corpo da requisição.
- O prompt manda que a IA nunca use nomes pessoais e nunca faça diagnósticos clínicos.
- Os arquivos não implementam autenticação, cookies de usuário ou vínculo do relato a uma identidade.

### Tratamento de erros e fallbacks

- Se a conexão inicial PostgreSQL falhar, `service.db.js` registra a mensagem e encerra o processo.
- A busca RAG pode falhar isoladamente: `analisarRelato()` registra um aviso e continua sem contexto RAG.
- Se a IA falhar no `POST /relato`, o servidor retorna `502`.
- Se o JSON da IA não puder ser interpretado ou estiver incompleto, `analisarRelato()` lança uma exceção.
- O navegador executa um fallback local por palavras-chave quando `/relato` não responde corretamente. Esse fallback usa cartas e categorias locais já presentes no JavaScript.
- A conexão SSL do pool usa `rejectUnauthorized: false`.

### CI/CD

Existe um workflow em `.github/workflows/dependency-review.yml`.

| Configuração | Comportamento |
|---|---|
| Nome | `Dependency review` |
| Disparador | `pull_request` direcionado às branches `main` ou `develop` |
| Permissões | leitura do conteúdo e escrita de comentários em Pull Request |
| Execução | Ubuntu latest |
| Passo 1 | `actions/checkout@v4` |
| Passo 2 | `actions/dependency-review-action@v4` |
| Configuração | `comment-summary-in-pr: always` |

O workflow não realiza build, testes ou deploy. Sua função configurada é revisar alterações de dependências e publicar um resumo no Pull Request.

## 7. Como Executar Localmente

### Pré-requisitos

- Node.js e npm;
- acesso a um banco PostgreSQL compatível com `pgvector`;
- uma chave da API de IA ou de uma API compatível;
- dependências listadas em `package.json`.

### Instalação

Na raiz do projeto:

```bash
npm install
```

### Configuração de ambiente

Copie o modelo:

```bash
cp .env.example .env
```

Preencha as variáveis sem compartilhar valores reais em arquivos versionados. Como mínimo técnico para os recursos usados:

- `DATABASE_URL` para o pool PostgreSQL;
- `DATABASE_URL_UNPOOLED` para o script de migração, quando disponível;
- `IA_API_KEY` ou `OPENAI_API_KEY` para a IA;
- opcionalmente `IA_API_URL`, `IA_MODEL`, `IA_MAX_TOKENS`, `OPENAI_EMBEDDING_MODEL`, `PORT` e `NODE_ENV`.

O carregamento procura `.env.local` e `.env`.

### Banco de dados

Aplicar as tabelas de relatos e emoções:

```bash
npm run db:migrate
```

A inicialização vetorial acontece quando o serviço RAG chama `initAndSeed()`:

- cria a extensão `vector`;
- cria `recursos_apoio`;
- cria os dois recursos iniciais caso a tabela esteja vazia.

Para popular `recursos_apoio` com os chunks de `static/data.md`, use:

```text
POST /upload-arquivo
Content-Type: application/json

{
  "caminho": "static/data.md",
  "categoria": "Relatos e Protocolos Base"
}
```

### Executar o servidor

Produção/local simples:

```bash
npm start
```

Com reinício automático:

```bash
npm run dev
```

Por padrão, o servidor atende em `http://localhost:3000`.
