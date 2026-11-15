// Cliente da Evolution API v2 (https://doc.evolution-api.com).
// A Evolution conecta no WhatsApp do corretor como um "aparelho conectado" (igual ao WhatsApp Web).
// As respostas variam um pouco entre versões, por isso a leitura dos campos é defensiva.

import { config } from "./config.js";

export const EVENTOS_WEBHOOK = [
  "QRCODE_UPDATED",
  "CONNECTION_UPDATE",
  "MESSAGES_SET",
  "MESSAGES_UPSERT",
  "CHATS_UPSERT",
  "LABELS_EDIT",
  "LABELS_ASSOCIATION",
];

export class EvolutionErro extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function evolutionConfigurada(): boolean {
  return Boolean(config.evolution.url && config.evolution.apiKey);
}

async function chamar<T = any>(metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown): Promise<T> {
  if (!evolutionConfigurada()) {
    throw new EvolutionErro(0, "Evolution API não configurada (defina EVOLUTION_URL e EVOLUTION_API_KEY).");
  }
  const res = await fetch(`${config.evolution.url}${caminho}`, {
    method: metodo,
    headers: { apikey: config.evolution.apiKey, "content-type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await res.text();
  if (!res.ok) throw new EvolutionErro(res.status, `Evolution ${metodo} ${caminho} -> ${res.status}: ${texto.slice(0, 500)}`);
  return (texto ? JSON.parse(texto) : undefined) as T;
}

export function urlWebhook(): string {
  return `${config.urlPublica}/webhook/evolution/${config.evolution.webhookSegredo}`;
}

export async function criarInstancia(instancia: string): Promise<void> {
  await chamar("POST", "/instance/create", {
    instanceName: instancia,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    groupsIgnore: true, // grupos não entram na análise
    alwaysOnline: false, // não marca o corretor como "online" o tempo todo
    readMessages: false, // nunca marca mensagens como lidas
    syncFullHistory: true, // pede o máximo de histórico que o WhatsApp libera para aparelhos conectados
    webhook: { url: urlWebhook(), byEvents: false, base64: false, events: EVENTOS_WEBHOOK },
  });
}

export async function instanciaExiste(instancia: string): Promise<boolean> {
  try {
    const lista = await chamar<any[]>("GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`);
    return Array.isArray(lista) && lista.length > 0;
  } catch (e) {
    if (e instanceof EvolutionErro && e.status === 404) return false;
    throw e;
  }
}

/** Devolve o QR Code (imagem em data URI) para o corretor escanear, ou undefined se já está conectado. */
export async function obterQrCode(instancia: string): Promise<string | undefined> {
  const r = await chamar<any>("GET", `/instance/connect/${encodeURIComponent(instancia)}`);
  return r?.base64 ?? r?.qrcode?.base64 ?? undefined;
}

export async function estadoConexao(instancia: string): Promise<string> {
  const r = await chamar<any>("GET", `/instance/connectionState/${encodeURIComponent(instancia)}`);
  return r?.instance?.state ?? r?.state ?? "close";
}

/** Número do WhatsApp conectado na instância (apenas dígitos). */
export async function numeroConectado(instancia: string): Promise<string | undefined> {
  const lista = await chamar<any[]>("GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`);
  const inst = Array.isArray(lista) ? lista[0] : undefined;
  const jid: string | undefined = inst?.ownerJid ?? inst?.instance?.owner ?? inst?.owner;
  return jid ? jid.split("@")[0].split(":")[0] : undefined;
}

export async function desconectar(instancia: string): Promise<void> {
  await chamar("DELETE", `/instance/logout/${encodeURIComponent(instancia)}`);
}

export async function listarConversas(instancia: string): Promise<any[]> {
  const r = await chamar<any>("POST", `/chat/findChats/${encodeURIComponent(instancia)}`, {});
  return Array.isArray(r) ? r : (r?.chats ?? []);
}

/** Busca todas as mensagens de uma conversa, página por página. */
export async function listarMensagens(instancia: string, remoteJid: string): Promise<any[]> {
  const todas: any[] = [];
  for (let pagina = 1; pagina <= 100; pagina++) {
    const r = await chamar<any>("POST", `/chat/findMessages/${encodeURIComponent(instancia)}`, {
      where: { key: { remoteJid } },
      page: pagina,
      offset: 200,
    });
    const bloco = r?.messages ?? r;
    const registros: any[] = Array.isArray(bloco) ? bloco : (bloco?.records ?? []);
    todas.push(...registros);
    const totalPaginas: number = bloco?.pages ?? 1;
    if (registros.length === 0 || pagina >= totalPaginas) break;
  }
  return todas;
}

export async function listarEtiquetas(instancia: string): Promise<{ id: string; nome: string; cor?: string }[]> {
  const r = await chamar<any[]>("GET", `/label/findLabels/${encodeURIComponent(instancia)}`);
  return (Array.isArray(r) ? r : []).map((l) => ({
    id: String(l.labelId ?? l.id),
    nome: String(l.name ?? ""),
    cor: l.color !== undefined ? String(l.color) : undefined,
  }));
}

/** Adiciona ou remove uma etiqueta de uma conversa no WhatsApp Business do corretor. */
export async function alterarEtiqueta(instancia: string, remoteJid: string, labelId: string, acao: "add" | "remove"): Promise<void> {
  await chamar("POST", `/label/handleLabel/${encodeURIComponent(instancia)}`, {
    number: remoteJid.split("@")[0],
    labelId,
    action: acao,
  });
}

export async function enviarTexto(instancia: string, numero: string, texto: string): Promise<void> {
  await chamar("POST", `/message/sendText/${encodeURIComponent(instancia)}`, { number: numero, text: texto });
}
