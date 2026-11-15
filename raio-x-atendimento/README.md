# Raio-X do Atendimento

Ferramenta para analisar os atendimentos de WhatsApp dos corretores e mostrar **onde cada um perde clientes** e **o que fazer para converter mais**.

## Como funciona

1. **O corretor migra para o WhatsApp Business** no mesmo número. As conversas vão junto.
2. **Ele abre o link pessoal** (`/c/<token>`), aceita os termos e **escaneia um QR Code**, como no WhatsApp Web. Isso usa a [Evolution API](https://doc.evolution-api.com).
3. **O sistema importa o histórico** e passa a receber as mensagens novas em tempo real.
4. **Triagem:** a IA separa conversas de **clientes** das **pessoais**. O conteúdo das pessoais é **apagado** e nunca aparece em painel.
5. **Análise de cada atendimento com IA**, depois que a conversa "esfria" (30 min sem mensagens). Ela avalia:
   - nota de 0 a 10 em 10 critérios (velocidade, qualificação, descoberta da necessidade, condução para visita, objeções, follow-up…);
   - **o momento exato em que a conversa travou** (com o número da mensagem);
   - etapa do funil e perfil do cliente;
   - 3 dicas com **mensagem pronta** de exemplo e próximo passo sugerido.
6. **Etiquetas automáticas:** o sistema aplica no WhatsApp do corretor a etiqueta da etapa (Lead novo, Qualificado, Visita agendada, Proposta, Fechou, Perdido). Se o corretor trocar a etiqueta à mão, a escolha dele prevalece.
7. **O corretor recebe todo dia** no próprio WhatsApp: clientes esperando resposta, quem retomar e uma dica. Pelo link, ele vê as mensagens sugeridas com botão para abrir o WhatsApp.
8. **O gestor vê o painel do time** (`/gestor`): onde o time perde clientes, funil, notas por critério e detalhe de cada corretor e conversa.

O que a IA usa como referência de "bom atendimento" está em **`config/processo-comercial.md`**. Edite esse arquivo com o processo da sua imobiliária.

## Testar agora (sem WhatsApp e sem chave de IA)

Requisitos: Node 22+ e Postgres.

```bash
npm install
export DATABASE_URL=postgres://postgres:senha@localhost:5432/raiox
npm run demo        # cria 3 corretores e conversas fictícias e roda a análise
GESTOR_SENHA=teste npm start
```

- Painel do gestor: http://localhost:3000/gestor (usuário `gestor`, senha `teste`).
- Os links dos corretores de demonstração aparecem na saída do `npm run demo`.

Sem `ANTHROPIC_API_KEY`, a análise é **simulada** (regras simples, só para ver as telas). Com a chave, `npm run demo` faz a análise real.

## Colocar em produção

Você precisa de um servidor Linux com Docker (uma VPS de 4 GB de RAM atende o começo; veja a seção Escala) e um domínio com HTTPS.

```bash
cp .env.example .env     # preencha as senhas, a URL pública e a ANTHROPIC_API_KEY
docker compose up -d
```

Isso sobe a aplicação, a Evolution API, o Postgres e o Redis. Coloque um proxy com HTTPS (Caddy é o mais simples) apontando para a porta 3000. A Evolution **não** fica exposta na internet.

Depois:

1. Acesse `/gestor/corretores` e cadastre os corretores. Cada um recebe um link pessoal.
2. Peça a cada corretor para **criar as etiquetas** no WhatsApp Business: `Lead novo`, `Qualificado`, `Visita agendada`, `Proposta`, `Fechou`, `Perdido` e `Pessoal`. A página dele mostra quais faltam.
3. Mande o link. Ele conecta em 5 minutos, seguindo as instruções da própria página.

**Comece com 5 a 10 corretores** para validar a qualidade das análises e o custo antes de abrir para os 150.

## Custos (estimativa: meça com o piloto)

A análise usa por padrão o Claude Opus 5.5. Os preços são por milhão de tokens (US$ 4 de entrada, US$ 20 de saída). O roteiro de avaliação fica em cache para baratear.

| Item | Estimativa |
|---|---|
| Uma análise de conversa típica (~50 mensagens) | ~US$ 0,05 a 0,15 |
| Importação inicial, por corretor (~150 conversas de clientes) | ~US$ 10 a 20 |
| Operação diária, 150 corretores, ~10 conversas ativas cada | ~US$ 75 a 225 por dia |

Como reduzir:

- `MODELO_TRIAGEM=claude-haiku-5-5`: a triagem (cliente ou pessoal) é simples e fica muito mais barata.
- `MODELO_ANALISE=claude-sonnet-5-5`: cerca de metade do custo do Opus. Compare a qualidade das dicas no piloto antes de decidir.
- Aumente `ANALISE_MINIMO_NOVAS` (reanalisa menos vezes) e `ANALISE_ESPERA_MINUTOS`.

Infraestrutura: uma VPS de ~R$ 100 a 300 por mês, conforme a escala.

## Limitações e riscos (leia antes de usar)

- **Conexão não oficial.** A Evolution conecta como "aparelho conectado", o que não é permitido pelos termos do WhatsApp. O sistema só **lê** (não dispara mensagens para clientes, não marca como lido). Isso reduz o risco, mas existe chance de bloqueio do número. Avise os corretores.
- **Histórico:** o WhatsApp libera para aparelhos conectados uma parte do histórico, em geral meses e não anos. Isso varia de conta para conta.
- **Áudios não são transcritos** nesta versão. A IA vê apenas "[áudio]". Se o time usa muito áudio, a próxima etapa é adicionar transcrição.
- **Etiquetas:** a Evolution aplica e remove etiquetas, mas não cria. Por isso o corretor cria as 7 etiquetas uma vez.
- **Etiquetas no histórico:** dependendo da versão da Evolution, as etiquetas que já estavam nas conversas antes da conexão podem não vir na importação. As mudanças feitas depois chegam normalmente.
- **Contatos com identificador "@lid"** (contas novas do WhatsApp): quando o número não vem junto, o botão "Abrir no WhatsApp" não aparece para esse cliente.

## LGPD

- Base: legítimo interesse da imobiliária na gestão e qualidade do atendimento. Formalize com **termo de adesão** do corretor (a página registra o aceite) e informe os clientes na **política de privacidade**.
- **Minimização:** conversas pessoais são descartadas. Nomes, telefones, e-mails, CPF e links são mascarados antes de ir para a IA.
- Defina por quanto tempo guardar as conversas e as análises. Hoje elas ficam até serem apagadas.
- O corretor pode desconectar a qualquer momento e marcar conversas como "Não é cliente", o que apaga o conteúdo.

## Estrutura do código

| Caminho | O que faz |
|---|---|
| `src/server.ts` | Rotas web, webhook e início da aplicação |
| `src/evolution.ts` | Cliente da Evolution API (QR Code, mensagens, etiquetas) |
| `src/webhook.ts`, `src/sincronizacao.ts`, `src/ingestao.ts` | Recebimento e importação das mensagens |
| `src/analise/` | Triagem e análise com IA, análise simulada, fila |
| `src/metricas.ts` | Tempos de resposta e outras métricas calculadas sem IA |
| `src/anonimizar.ts` | Mascaramento de dados pessoais |
| `src/etiquetas.ts`, `src/funil.ts` | Etapas do funil e etiquetas do WhatsApp Business |
| `src/resumo.ts` | Lista "Retome hoje" e resumo diário no WhatsApp |
| `src/web/` | Telas do gestor e do corretor |
| `config/processo-comercial.md` | Roteiro de avaliação (edite!) |

Comandos: `npm test` (testes), `npm run typecheck`, `npm run migrate` (cria as tabelas).

## Escala (150 corretores)

- **Evolution:** cada corretor é uma instância. 150 instâncias numa única Evolution funcionam com ~4 a 8 GB de RAM. Monitore memória e reinicializações.
- **Análise:** a fila processa `ANALISE_CONCORRENCIA` conversas em paralelo. Ajuste conforme o limite da sua conta na Anthropic.
- **Banco:** o Postgres atende tranquilamente. Faça backup diário.
