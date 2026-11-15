// Etapas do funil e as etiquetas correspondentes no WhatsApp Business.
// O nome da etiqueta é o que o corretor vê no app; a comparação ignora acentos, maiúsculas e emojis.

export const ETAPAS = ["lead_novo", "qualificado", "visita_agendada", "proposta", "fechou", "perdido"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const ETIQUETA_DA_ETAPA: Record<Etapa, string> = {
  lead_novo: "Lead novo",
  qualificado: "Qualificado",
  visita_agendada: "Visita agendada",
  proposta: "Proposta",
  fechou: "Fechou",
  perdido: "Perdido",
};

export const NOME_DA_ETAPA: Record<Etapa, string> = {
  lead_novo: "Lead novo",
  qualificado: "Qualificado",
  visita_agendada: "Visita agendada",
  proposta: "Proposta",
  fechou: "Fechou",
  perdido: "Perdido",
};

// Etiqueta usada para marcar conversas pessoais (o corretor pode aplicar à mão para tirar da análise).
export const ETIQUETA_PESSOAL = "Pessoal";

export function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function etapaPorNomeDeEtiqueta(nome: string): Etapa | undefined {
  const n = normalizarNome(nome);
  return ETAPAS.find((e) => normalizarNome(ETIQUETA_DA_ETAPA[e]) === n);
}

export function ehEtiquetaPessoal(nome: string): boolean {
  return normalizarNome(nome) === normalizarNome(ETIQUETA_PESSOAL);
}
