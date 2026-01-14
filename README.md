# HPmovies - Anime Streaming Platform

Plataforma de streaming de anime construída com React, TypeScript, Vite e integração com APIs do HiAnime.

## 🚀 Tecnologias

### Frontend

- **React 18+** com TypeScript
- **Vite** para build e desenvolvimento
- **TailwindCSS** para estilização
- **HLS.js** para reprodução de vídeo HLS
- **React Router** para navegação
- **Lucide React** para ícones

### Backend

- **Node.js** com TypeScript
- **Hono** framework web
- **Cheerio** para scraping
- **Axios** para requisições HTTP

## 📋 Pré-requisitos

- Node.js (versão 16 ou superior)
- npm ou yarn
- Git

## ⚙️ Configuração

### 1. Clone o repositório

```bash
git clone https://github.com/arthurpetroli/HPmovies.git
cd HPmovies
```

### 2. Configure as variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto baseado no `.env.example`:

```bash
cp .env.example .env
```

Edite o arquivo `.env` e configure:

```env
VITE_API_BASE_URL=http://localhost:4000
```

### 3. Instale as dependências

#### Frontend (raiz do projeto)

```bash
npm install
```

#### Backend (aniwatch-apis)

```bash
cd src/aniwatch-apis
npm install
cd ../..
```

## 🎬 Como Executar

### Desenvolvimento

Você precisa executar tanto o backend quanto o frontend simultaneamente.

#### 1. Execute o Backend (Terminal 1)

```bash
cd src/aniwatch-apis
npm run dev
```

O backend estará rodando em `http://localhost:4000`

#### 2. Execute o Frontend (Terminal 2)

```bash
npm run dev:frontend
```

O frontend estará rodando em `http://localhost:5173`

### Acesse a aplicação

Abra seu navegador e acesse: `http://localhost:5173`

## 🏗️ Estrutura do Projeto

```
HPmovies/
├── src/
│   ├── frontend/          # Código React do frontend
│   │   ├── components/    # Componentes React
│   │   ├── pages/         # Páginas da aplicação
│   │   ├── services/      # Serviços de API
│   │   ├── hooks/         # React hooks customizados
│   │   ├── types/         # Tipos TypeScript
│   │   └── utils/         # Utilitários
│   ├── aniwatch-apis/     # Backend API
│   │   └── src/
│   │       ├── routes/    # Rotas da API
│   │       ├── config/    # Configurações
│   │       └── middleware/ # Middlewares
│   ├── App.tsx            # Componente principal
│   └── main.tsx           # Entry point
├── public/                # Arquivos estáticos
└── README.md

```

## 🔧 Funcionalidades Principais

### Sistema de Proxy para Streaming

O projeto inclui um sistema de proxy para contornar restrições CORS e requisitos de headers específicos dos CDNs de vídeo:

- **Endpoint**: `/api/v2/hianime/proxy-stream?url={encoded_url}`
- **Funcionalidade**:
  - Adiciona headers necessários (Referer, etc)
  - Reescreve URLs em playlists m3u8 para usar o proxy
  - Proxy transparente para segmentos de vídeo (.ts)

### Páginas Disponíveis

- **Home**: Lista de animes em destaque
- **Busca**: Pesquisa de animes com sugestões
- **Detalhes**: Informações completas sobre o anime
- **Player**: Reprodução de episódios com HLS.js
- **Categorias**: Navegação por categorias
- **Gêneros**: Navegação por gêneros

## 🐛 Solução de Problemas

### Vídeos não carregam

1. Verifique se o backend está rodando
2. Verifique as variáveis de ambiente
3. Confira o console do navegador para erros
4. Veja os logs do backend

### Erro de CORS

Certifique-se de que:

- O backend está rodando na porta 4000
- A variável `VITE_API_BASE_URL` está configurada corretamente
- O proxy está sendo usado nas requisições de vídeo

### Erro 500 no proxy

Reinicie o backend após qualquer modificação no código:

```bash
cd src/aniwatch-apis
npm run dev
```

## 📚 Scripts Disponíveis

### Frontend (raiz)

- `npm run dev` - Inicia o servidor de desenvolvimento
- `npm run build` - Cria o build de produção
- `npm run preview` - Preview do build de produção
- `npm run lint` - Executa o linter

### Backend (src/aniwatch-apis)

- `npm run dev` - Inicia o servidor de desenvolvimento
- `npm run build` - Compila o TypeScript
- `npm run start` - Inicia o servidor compilado

## 📖 Documentação Adicional

Para informações mais detalhadas sobre o sistema de proxy, consulte o arquivo [PROXY_FIX_README.md](PROXY_FIX_README.md).

## 📝 Licença

Este projeto é licenciado sob a licença MIT.

## 🤝 Contribuindo

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues e pull requests.
