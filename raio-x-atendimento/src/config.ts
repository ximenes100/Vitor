// Configuração lida das variáveis de ambiente (veja .env.example).

function env(nome: string, padrao?: string): string {
  const valor = process.env[nome] ?? padrao;
  if (valor === undefined || valor === "") {
    throw new Error(`Variável de ambiente obrigatória não definida: ${nome}`);
  }
  return valor;
}

function envNumero(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (!bruto) return padrao;
  const n = Number(bruto);
  if (!Number.isFinite(n)) throw new Error(`${nome} precisa ser um número (recebido: ${bruto})`);
  return n;
}

export const config = {
  porta: envNumero("PORTA", 3000),
  // URL pública desta aplicação: usada para montar o webhook que a Evolution API chama.
  urlPublica: env("URL_PUBLICA", "http://localhost:3000").replace(/\/$/, ""),
  databaseUrl: env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/raiox"),

  evolution: {
    url: (process.env.EVOLUTION_URL ?? "").replace(/\/$/, ""),
    apiKey: process.env.EVOLUTION_API_KEY ?? "",
    // Segredo que vai no caminho do webhook, para ninguém de fora injetar mensagens.
    webhookSegredo: env("WEBHOOK_SEGREDO", "troque-este-segredo"),
  },

  gestor: {
    usuario: env("GESTOR_USUARIO", "gestor"),
    senha: env("GESTOR_SENHA", "troque-esta-senha"),
  },

  ia: {
    // Sem chave da Anthropic o sistema roda a "análise simulada" (regras simples), só para demonstração.
    ativa: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    modeloAnalise: env("MODELO_ANALISE", "claude-opus-5-5"),
    modeloTriagem: env("MODELO_TRIAGEM", "claude-opus-5-5"),
    // Quantas análises rodam em paralelo (limite de taxa da API).
    concorrencia: envNumero("ANALISE_CONCORRENCIA", 4),
    // Espera a conversa "esfriar" antes de analisar, para não analisar no meio de uma troca de mensagens.
    esperaMinutos: envNumero("ANALISE_ESPERA_MINUTOS", 30),
    // Reanalisa uma conversa quando chegam pelo menos N mensagens novas.
    minimoMensagensNovas: envNumero("ANALISE_MINIMO_NOVAS", 3),
    // Conversas muito longas: só as últimas N mensagens vão para a IA (o prompt avisa o modelo disso).
    maximoMensagens: envNumero("ANALISE_MAXIMO_MENSAGENS", 600),
  },

  // Horas sem resposta do corretor para o cliente entrar na lista de follow-up.
  followupHoras: envNumero("FOLLOWUP_HORAS", 24),
  // Hora (0-23, fuso de São Paulo) do resumo diário enviado no WhatsApp do corretor.
  resumoDiarioHora: envNumero("RESUMO_DIARIO_HORA", 8),
  fuso: "America/Sao_Paulo",
};

export type Config = typeof config;
