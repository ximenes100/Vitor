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
    // Triagem (cliente x pessoal) e análise de cada conversa: tarefas de volume, modelo econômico.
    modeloTriagem: env("MODELO_TRIAGEM", "claude-haiku-5-5"),
    modeloAnalise: env("MODELO_ANALISE", "claude-haiku-5-5"),
    // Relatórios semanais (por corretor e do time): poucos e importantes, modelo mais capaz.
    modeloRelatorio: env("MODELO_RELATORIO", "claude-opus-5-5"),
    // Processamento em lote (Batch API): metade do preço, resultado em até algumas horas.
    usarLote: env("USAR_LOTE", "sim") !== "nao",
    // Chamadas diretas em paralelo (triagem, ou tudo quando USAR_LOTE=nao).
    concorrencia: envNumero("ANALISE_CONCORRENCIA", 4),
    // Conversas muito longas: só as últimas N mensagens da semana vão para a IA (o prompt avisa o modelo disso).
    maximoMensagens: envNumero("ANALISE_MAXIMO_MENSAGENS", 400),
    // Mensagens de semanas anteriores enviadas como contexto (não são avaliadas).
    mensagensDeContexto: envNumero("ANALISE_MENSAGENS_CONTEXTO", 30),
  },

  // Marco do uso de IA pelo time: semanas que começam nesta data ou depois contam como "depois".
  marcoIa: env("MARCO_IA", "2026-11-01"),
  // Quantas semanas antes do marco analisar para formar a linha de base ("antes").
  semanasLinhaDeBase: envNumero("SEMANAS_LINHA_DE_BASE", 12),
  // Hora (0-23, horário de Brasília) de segunda-feira em que o relatório semanal é enviado ao corretor.
  relatorioSemanalHora: envNumero("RELATORIO_SEMANAL_HORA", 8),

  // Horas sem resposta do corretor para o cliente entrar na lista de follow-up.
  followupHoras: envNumero("FOLLOWUP_HORAS", 24),
  // Hora (0-23, horário de Brasília) do lembrete diário "clientes esperando resposta" (não usa IA).
  resumoDiarioHora: envNumero("RESUMO_DIARIO_HORA", 8),
  fuso: "America/Sao_Paulo",
};

export type Config = typeof config;
