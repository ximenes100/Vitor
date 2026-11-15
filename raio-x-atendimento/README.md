# Raio-X do Atendimento

Ferramenta para acompanhar, semana a semana, **como os corretores atendem os clientes no WhatsApp** e se o atendimento **está evoluindo com o uso de IA** (o time passou a usar o Claude a partir de novembro de 2026). Quando não está, ela gera sugestões: de como usar melhor a IA e de como atender melhor pessoalmente, inclusive por telefone.

## Como funciona

**Coleta (contínua, sem IA)**
1. O corretor migra para o **WhatsApp Business** no mesmo número. As conversas vão junto.
2. Ele abre o link pessoal (`/c/<token>`), aceita os termos e **escaneia um QR Code**, como no WhatsApp Web. Isso usa a [Evolution API](https://doc.evolution-api.com).
3. O sistema importa o histórico (em geral alguns meses) e recebe as mensagens novas em tempo real.

**Análise (uma vez por semana, segunda de madrugada)**

4. **Triagem:** a IA separa conversas de **clientes** das **pessoais**. O conteúdo das pessoais é **apagado**.
5. **Cada conversa com movimento na semana é analisada uma vez**, avaliando só as mensagens daquela semana (as anteriores servem de contexto). A análise registra:
   - notas de 0 a 10 em 10 critérios, o momento em que a conversa travou e a etapa do funil;
   - **indícios de uso de IA** (texto estruturado, padronizado) e se o uso foi **personalizado** ou **genérico**;
   - se **valia ter ligado**, as objeções e perguntas do cliente e a melhor mensagem do corretor.
6. **Linha de base:** na primeira execução, as semanas **antes do marco** (padrão: 12 semanas) também são analisadas. Assim dá para comparar o "antes" e o "depois" de cada corretor.

**Relatórios (segunda de manhã)**

7. **Relatório do corretor**, no WhatsApp dele e na página pessoal:
   - evolução desde o marco;
   - 3 focos para a semana com mensagens de exemplo;
   - **pedidos prontos para colar no Claude**;
   - quando ligar e como conduzir a ligação.
8. **Relatório do time**, para você (`/gestor/relatorio`):
   - a IA está melhorando o atendimento?
   - quem evolui e quem precisa de apoio;
   - onde o time perde clientes;
   - objeções e perguntas frequentes;
   - **mensagens reais que funcionaram** (para treinamento);
   - treinamentos sugeridos e alertas.
9. **Painel do gestor** (`/gestor`):
   - **antes x depois** do marco, critério por critério;
   - nota do time semana a semana;
   - tabela de evolução por corretor.

**Etiquetas e lembrete diário (sem IA)**
- O sistema aplica no WhatsApp do corretor a etiqueta da etapa (Lead novo, Qualificado, Visita agendada, Proposta, Fechou, Perdido). Se ele trocar a etiqueta à mão, a escolha dele prevalece.
- Todo dia, o corretor recebe a lista de clientes esperando resposta.

O que a IA considera "bom atendimento" está em **`config/processo-comercial.md`**. Edite com o processo da sua imobiliária.

### Como o efeito da IA é medido
Não dá para saber exatamente quem usa a IA. Por isso a comparação é feita de dois jeitos:
- **Antes x depois do marco** (`MARCO_IA`, padrão 01/11/2026), para cada corretor e para o time.
- **Indícios nas mensagens:** quem melhorou *e* mostra indícios de IA personalizada sugere efeito da IA; quem tem indícios de IA genérica recebe dicas de uso.

Com poucas semanas depois do marco, as diferenças ainda são preliminares. O painel mostra quantas conversas sustentam cada número.

## Testar agora (sem WhatsApp e sem chave de IA)

Requisitos: Node 22+ e Postgres.

```bash
npm install
export DATABASE_URL=postgres://postgres:senha@localhost:5432/raiox
npm run demo        # cria 3 corretores com conversas antes e depois do marco e roda o ciclo semanal
GESTOR_SENHA=teste npm start
```

- Painel do gestor: http://localhost:3000/gestor (usuário `gestor`, senha `teste`).
- Os links dos corretores de demonstração aparecem na saída do `npm run demo`.

Sem `ANTHROPIC_API_KEY`, a análise é **simulada** (regras simples, só para ver as telas). Com a chave, `USAR_LOTE=nao npm run demo` faz a análise real na hora, sem esperar o lote.

Na demonstração, Rafael passa a usar IA de forma personalizada e melhora; Camila usa IA de forma genérica e piora; Diego não muda.

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

Configuração padrão:
- **Haiku 5.5** para a triagem e a análise de cada conversa (tarefas de volume);
- **Opus 5.5** só para os relatórios semanais;
- tudo em **lote** (Batch API, metade do preço).

| Item (150 corretores, ~30 conversas com movimento por corretor por semana) | Estimativa |
|---|---|
| Análise das ~4.500 conversas da semana (Haiku, em lote) | ~US$ 5–10 por semana |
| 150 relatórios de corretor (Opus, em lote) | ~US$ 10–25 por semana |
| Relatório do time (Opus) | ~US$ 1–2 por semana |
| **Total semanal** | **~US$ 20–40 (US$ 80–160 por mês)** |
| Linha de base, uma vez (12 semanas antes do marco) | ~US$ 40–100 |

Para gastar ainda menos, troque `MODELO_RELATORIO` por `claude-sonnet-5-5` (cerca de metade do custo do Opus). Compare a qualidade dos relatórios no piloto antes.

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
| `src/semanal/` | Ciclo semanal: triagem, análise por semana, estatísticas antes x depois, relatórios |
| `src/analise/` | Chamadas à IA (direta e em lote), esquemas das respostas, análise simulada |
| `src/metricas.ts` | Tempos de resposta e outras métricas calculadas sem IA |
| `src/anonimizar.ts` | Mascaramento de dados pessoais |
| `src/etiquetas.ts`, `src/funil.ts` | Etapas do funil e etiquetas do WhatsApp Business |
| `src/resumo.ts` | Lista "Retome hoje" e resumo diário no WhatsApp |
| `src/web/` | Telas do gestor e do corretor |
| `config/processo-comercial.md` | Roteiro de avaliação (edite!) |

Comandos: `npm test` (testes), `npm run typecheck`, `npm run migrate` (cria as tabelas).

## Escala (150 corretores)

- **Evolution:** cada corretor é uma instância. 150 instâncias numa única Evolution funcionam com ~4 a 8 GB de RAM. Monitore memória e reinicializações.
- **Análise:** o processamento em lote aceita até 10 mil conversas por envio e costuma terminar em menos de 1 hora (no máximo 24 h). Por isso os relatórios ficam prontos na segunda de manhã.
- **Banco:** o Postgres atende tranquilamente. Faça backup diário.
