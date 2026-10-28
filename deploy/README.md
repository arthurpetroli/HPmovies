# Implantação em uma VM Linux

Estes templates apoiam uma implantação autorizada; não executam alterações
automaticamente. A estrutura usa Node.js 22.12+, systemd e Caddy 2.8+ sobre HTTPS.
O serviço executa com usuário próprio, enquanto site/API, fontes e tradutor
permanecem em loopback. Somente o proxy recebe conexões públicas.

## Diretórios

| Caminho | Conteúdo |
| --- | --- |
| `/opt/hpmovies/releases/<versao>` | Artefatos compilados, scripts, runtime CJS/licenças e dependências Node. |
| `/opt/hpmovies/current` | Link para a release ativa. |
| `/opt/hpmovies/shared` | Registro e arquivos privados de fontes, fora da raiz pública. |
| `/etc/hpmovies/runtime.env` | Configuração privada lida por systemd e pelo launcher. |
| `/var/lib/hpmovies/subtitle-translator` | Venv e modelo do tradutor, instalados no destino. |

Compile e verifique o projeto antes de enviar a release. Inclua `dist/web`,
`dist/backend`, `package.json`, `package-lock.json`, os scripts usados pelo
launcher e `src/aniwatch-apis/src/providers/tatakai-runtime`, preservando suas
licenças. Instale as dependências com `npm ci --omit=dev` na VM; não copie
`node_modules` ou o venv de outra máquina. `dist` sozinho não é um pacote completo.

Mantenha o código da release somente para leitura pelo usuário `hpmovies`.
Arquivos privados não pertencem a `dist/web`, Git, logs ou imagens públicas.
O registro de fontes deve usar caminhos válidos no servidor e preservar os
hashes e os bytes dos bundles originais. Configure diretórios privados com acesso
restrito, por exemplo `0750`, e arquivos com `0640`, para o grupo do serviço.

## Ambiente privado

Crie `/etc/hpmovies/runtime.env` com proprietário `root`, grupo `hpmovies` e
permissão `0640`. A sintaxe precisa funcionar tanto em `EnvironmentFile` do
systemd quanto no dotenv do launcher: uma variável por linha, sem `export`,
expansões de shell ou comandos. Use aspas simples para preservar JSON que não
contenha apóstrofos; valores com aspas, barras ou múltiplas linhas exigem
validação específica nos dois leitores. Não copie cegamente quoting de um
arquivo de shell.

Configuração mínima ilustrativa, sem credenciais:

```dotenv
BACKEND_HOST=127.0.0.1
BACKEND_PORT=4000
CORS_ALLOWED_ORIGINS=https://example.com
HPMOVIES_SOURCE_HOST_PORT=8099
HPMOVIES_EXTENSIONS_FILE=/opt/hpmovies/shared/sources.json
HPMOVIES_TRANSLATOR_HOME=/var/lib/hpmovies/subtitle-translator
AUTOMATIC_SUBTITLES_URL=http://127.0.0.1:5000
```

Acrescente a configuração autorizada de provedores, domínios e tradução. A
origem CORS deve corresponder à URL pública HTTPS: atrás do proxy, a origem
interna HTTP não coincide automaticamente com a origem enviada pelo navegador.
Deixe `VITE_API_BASE_URL` vazio durante o build para usar `/api` na mesma origem.

O tradutor é opcional. Para mantê-lo, instale Python/venv e execute o setup
existente com `HPMOVIES_TRANSLATOR_HOME` definido e como usuário do serviço.
Recrie o venv no Linux de destino; preserve a licença e a atribuição do modelo.
Sua ausência ou falha não deve ser apresentada como tradução validada.

## Serviço e HTTPS

Crie o usuário de sistema `hpmovies` antes de instalar
[`hpmovies.service`](hpmovies.service) em `/etc/systemd/system/`. O
`StateDirectory` fornece `/var/lib/hpmovies` para o estado gravável; o restante
do sistema fica somente para leitura pelo serviço. O template não usa
`MemoryDenyWriteExecute`, pois o JIT do Node precisa executar código gerado.

Adapte [`Caddyfile.example`](Caddyfile.example) ao endereço escolhido. Um domínio
gratuito associado ao IP público também precisa resolver para a VM. Substitua o
placeholder por um hash gerado com `caddy hash-password`; mantenha a senha em um
arquivo privado entregue ao operador. O exemplo falha se o hash não for válido.
O acesso familiar é protegido por HTTP Basic sobre HTTPS, inclusive nas rotas
da API. Depois de autenticar, o proxy remove `Authorization` antes de enviar a
requisição à API: a credencial familiar permanece no Caddy e não precisa chegar
ao aplicativo ou aos provedores. Essa regra não remove `Range`, `Origin` ou os
headers de resposta da mídia. Não configure uma exceção pública para mídia ou
para `/health`.

Valide antes de iniciar:

```bash
sudo systemd-analyze verify /etc/systemd/system/hpmovies.service
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now hpmovies
sudo systemctl enable --now caddy
```

Libere TCP 80/443 nas regras do sistema e da Oracle, preservando SSH. Não exponha
4000, 8099 ou 5000 à internet. O template não habilita access logs do Caddy,
evitando registrar URLs de mídia e tickets. Não habilite logs detalhados que
persistam parâmetros privados, credenciais ou conteúdo de legendas.

Um listener local em 80/443 não comprova entrada pública: a Security List ou NSG
da Oracle também precisa permitir o tráfego. Enquanto isso estiver bloqueado,
a emissão ACME e o acesso HTTPS podem continuar pendentes. Não apresente um
túnel SSH funcional como validação do endereço público.

## Verificar e retomar

Confira que serviços reiniciam, escutam nos endereços esperados e mantêm arquivos
privados inacessíveis. Sem autenticação, a URL pública deve exigir acesso; com
autenticação, valide navegação, API, vídeo, áudio, seek e legendas a partir do IP
da Oracle. Índice de episódios e HTTP 200 não comprovam conteúdo correto.
Confirme também o certificado pelo endereço público e que requisições sem
autenticação recebem 401. Para a tradução, um POST autenticado com a origem
HTTPS pública deve passar pela validação de origem antes de processar o ticket.

Nesta configuração de proxy, o limitador atual usa o endereço do socket:
clientes compartilham as quotas da conexão do Caddy. Não aceite genericamente
`X-Forwarded-For` para contornar essa limitação. Tickets e jobs ficam em memória;
reiniciar invalida tickets, e múltiplas instâncias exigem tratamento específico.

Uma VM de aproximadamente 1 GB com swap é apenas um ponto inicial para uso
individual. Meça RSS, swap, latência e tradução antes de ampliar o uso; isso não
comprova capacidade para dez usuários simultâneos. Preserve a release anterior
e sua configuração para rollback, sem reverter arquivos privados sem análise.
Registre o resultado real, limites e estado de retomada em
`docs/DEVELOPMENT-STATE.md`, sem incluir credenciais.
