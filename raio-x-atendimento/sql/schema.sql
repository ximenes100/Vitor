-- Esquema do Raio-X do Atendimento. Idempotente: pode rodar várias vezes.

CREATE TABLE IF NOT EXISTS corretores (
  id              SERIAL PRIMARY KEY,
  nome            TEXT NOT NULL,
  equipe          TEXT,
  token           TEXT NOT NULL UNIQUE,          -- link pessoal do corretor: /c/<token>
  instancia       TEXT NOT NULL UNIQUE,          -- nome da instância na Evolution API
  telefone        TEXT,                          -- preenchido quando o WhatsApp conecta
  status_conexao  TEXT NOT NULL DEFAULT 'desconectado', -- desconectado | aguardando_qr | conectado
  conectado_em    TIMESTAMPTZ,
  ultima_sincronizacao TIMESTAMPTZ,
  receber_resumo  BOOLEAN NOT NULL DEFAULT TRUE, -- resumo diário no próprio WhatsApp
  ultimo_resumo_em DATE,
  consentimento_em TIMESTAMPTZ,                  -- quando o corretor aceitou os termos e conectou
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Etiquetas que existem no WhatsApp Business de cada corretor.
CREATE TABLE IF NOT EXISTS etiquetas (
  corretor_id INT NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
  label_id    TEXT NOT NULL,
  nome        TEXT NOT NULL,
  cor         TEXT,
  PRIMARY KEY (corretor_id, label_id)
);

CREATE TABLE IF NOT EXISTS conversas (
  id              SERIAL PRIMARY KEY,
  corretor_id     INT NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
  remote_jid      TEXT NOT NULL,
  nome_contato    TEXT,
  etiquetas       TEXT[] NOT NULL DEFAULT '{}',  -- label_ids aplicados no WhatsApp
  -- Classificação feita pela IA (ou corrigida pelo corretor)
  tipo            TEXT NOT NULL DEFAULT 'indefinido', -- cliente | pessoal | outro | indefinido
  etapa           TEXT,                          -- lead_novo | qualificado | visita_agendada | proposta | fechou | perdido
  etapa_manual    BOOLEAN NOT NULL DEFAULT FALSE, -- corretor definiu a etapa pela etiqueta: a IA não sobrescreve
  primeira_mensagem_em TIMESTAMPTZ,
  ultima_mensagem_em   TIMESTAMPTZ,
  ultima_mensagem_do_corretor BOOLEAN,
  aguardando_resposta BOOLEAN NOT NULL DEFAULT FALSE, -- cliente espera retorno do corretor
  total_mensagens INT NOT NULL DEFAULT 0,
  analisada_em    TIMESTAMPTZ,
  mensagens_na_analise INT NOT NULL DEFAULT 0,
  erro_analise    TEXT,
  UNIQUE (corretor_id, remote_jid)
);
CREATE INDEX IF NOT EXISTS conversas_pendentes ON conversas (ultima_mensagem_em) WHERE tipo <> 'pessoal';

CREATE TABLE IF NOT EXISTS mensagens (
  corretor_id   INT NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
  id            TEXT NOT NULL,                   -- id da mensagem no WhatsApp
  conversa_id   INT NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  do_corretor   BOOLEAN NOT NULL,
  tipo          TEXT NOT NULL,                   -- texto | audio | imagem | video | documento | figurinha | localizacao | contato | outro
  texto         TEXT,
  enviada_em    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (corretor_id, id)
);
CREATE INDEX IF NOT EXISTS mensagens_conversa ON mensagens (conversa_id, enviada_em);

CREATE TABLE IF NOT EXISTS analises (
  id            SERIAL PRIMARY KEY,
  conversa_id   INT NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  criada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  modelo        TEXT NOT NULL,                   -- modelo usado, ou 'simulada' no modo demonstração
  tipo          TEXT NOT NULL,
  etapa         TEXT,
  nota_geral    NUMERIC(4,1),
  categoria_perda TEXT,                          -- onde a conversa travou (para agrupar no painel)
  resultado     JSONB NOT NULL,                  -- análise completa
  metricas      JSONB NOT NULL                   -- métricas calculadas sem IA
);
CREATE INDEX IF NOT EXISTS analises_conversa ON analises (conversa_id, criada_em DESC);
