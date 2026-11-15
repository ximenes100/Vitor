// Transforma mensagens cruas do WhatsApp (formato Baileys/Evolution) em registros do banco.

import { query, queryOne } from "./db.js";

export interface MensagemNormalizada {
  id: string;
  remoteJid: string;
  doCorretor: boolean;
  tipo: string;
  texto: string | null;
  enviadaEm: Date;
  nomeContato?: string;
}

const TIPOS: Record<string, string> = {
  conversation: "texto",
  extendedTextMessage: "texto",
  audioMessage: "audio",
  pttMessage: "audio",
  imageMessage: "imagem",
  videoMessage: "video",
  documentMessage: "documento",
  documentWithCaptionMessage: "documento",
  stickerMessage: "figurinha",
  locationMessage: "localizacao",
  liveLocationMessage: "localizacao",
  contactMessage: "contato",
  contactsArrayMessage: "contato",
};

// Tipos que não são conversa (confirmações de leitura, reações, mensagens apagadas etc.).
const IGNORAR = new Set([
  "protocolMessage",
  "reactionMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo",
  "pollUpdateMessage",
  "editedMessage",
  "keepInChatMessage",
]);

/** Só conversas individuais: ignora grupos, status, canais e listas de transmissão. */
export function jidValido(jid: string | undefined): jid is string {
  return Boolean(jid) && (jid!.endsWith("@s.whatsapp.net") || jid!.endsWith("@lid"));
}

/** Escolhe o identificador do contato. Contas novas do WhatsApp usam "@lid"; quando houver, preferimos o número. */
export function jidDoContato(key: any): string | undefined {
  const principal: string | undefined = key?.remoteJid;
  if (principal?.endsWith("@lid")) {
    const alternativo: string | undefined = key?.remoteJidAlt ?? key?.senderPn;
    if (alternativo?.endsWith("@s.whatsapp.net")) return alternativo;
  }
  return principal;
}

function textoDe(msg: any, tipoBruto: string): string | null {
  if (!msg) return null;
  const m = msg.ephemeralMessage?.message ?? msg.viewOnceMessage?.message ?? msg.viewOnceMessageV2?.message ?? msg;
  const texto =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    m.documentMessage?.fileName;
  if (texto) return texto;
  if (tipoBruto === "locationMessage") return m.locationMessage?.name ?? m.locationMessage?.address ?? null;
  if (tipoBruto === "contactMessage") return m.contactMessage?.displayName ?? null;
  return null;
}

function tipoBrutoDe(registro: any): string | undefined {
  if (registro.messageType) return registro.messageType;
  const msg = registro.message ?? {};
  return Object.keys(msg).find((k) => k !== "messageContextInfo");
}

export function normalizarMensagem(registro: any): MensagemNormalizada | undefined {
  const key = registro?.key;
  const remoteJid = jidDoContato(key);
  if (!key?.id || !jidValido(remoteJid)) return undefined;

  const tipoBruto = tipoBrutoDe(registro);
  if (!tipoBruto || IGNORAR.has(tipoBruto)) return undefined;
  const tipo = TIPOS[tipoBruto] ?? "outro";
  const texto = textoDe(registro.message, tipoBruto);

  const ts = Number(registro.messageTimestamp?.low ?? registro.messageTimestamp);
  if (!Number.isFinite(ts) || ts <= 0) return undefined;

  return {
    id: String(key.id),
    remoteJid,
    doCorretor: Boolean(key.fromMe),
    tipo,
    texto: texto ? String(texto).slice(0, 4000) : null,
    enviadaEm: new Date(ts * 1000),
    nomeContato: !key.fromMe && registro.pushName ? String(registro.pushName) : undefined,
  };
}

/** Cria a conversa se não existir e devolve o id e o tipo. */
export async function garantirConversa(corretorId: number, remoteJid: string, nomeContato?: string): Promise<{ id: number; tipo: string }> {
  const linha = await queryOne<{ id: number; tipo: string }>(
    `INSERT INTO conversas (corretor_id, remote_jid, nome_contato) VALUES ($1, $2, $3)
     ON CONFLICT (corretor_id, remote_jid)
     DO UPDATE SET nome_contato = COALESCE(conversas.nome_contato, EXCLUDED.nome_contato)
     RETURNING id, tipo`,
    [corretorId, remoteJid, nomeContato ?? null],
  );
  return linha!;
}

/** Recalcula os totais da conversa a partir das mensagens salvas. */
export async function atualizarResumoConversa(conversaId: number): Promise<void> {
  await query(
    `UPDATE conversas c SET
       total_mensagens = s.total,
       primeira_mensagem_em = s.primeira,
       ultima_mensagem_em = s.ultima,
       ultima_mensagem_do_corretor = s.ultima_do_corretor,
       -- Com mensagem nova, o cliente aguarda se foi ele quem falou por último. Sem mensagem nova, mantém o que a análise decidiu.
       aguardando_resposta = CASE WHEN s.ultima IS DISTINCT FROM c.ultima_mensagem_em THEN NOT s.ultima_do_corretor ELSE c.aguardando_resposta END
     FROM (
       SELECT count(*)::int AS total, min(enviada_em) AS primeira, max(enviada_em) AS ultima,
              (array_agg(do_corretor ORDER BY enviada_em DESC))[1] AS ultima_do_corretor
       FROM mensagens WHERE conversa_id = $1
     ) s
     WHERE c.id = $1`,
    [conversaId],
  );
}

/** Salva mensagens (ignora as repetidas). Devolve quantas eram novas. */
export async function salvarMensagens(corretorId: number, mensagens: MensagemNormalizada[]): Promise<number> {
  const porConversa = new Map<string, MensagemNormalizada[]>();
  for (const m of mensagens) {
    const lista = porConversa.get(m.remoteJid) ?? [];
    lista.push(m);
    porConversa.set(m.remoteJid, lista);
  }

  let novas = 0;
  for (const [remoteJid, lista] of porConversa) {
    const nome = lista.find((m) => m.nomeContato)?.nomeContato;
    const { id: conversaId, tipo } = await garantirConversa(corretorId, remoteJid, nome);
    // Conversas pessoais (ou de outros contatos que não são clientes) não têm o conteúdo guardado.
    if (tipo === "pessoal" || tipo === "outro") {
      await query("UPDATE conversas SET ultima_mensagem_em = GREATEST(ultima_mensagem_em, $2) WHERE id = $1", [
        conversaId,
        new Date(Math.max(...lista.map((m) => m.enviadaEm.getTime()))),
      ]);
      continue;
    }
    // Insere em blocos para não montar uma consulta gigante com históricos longos.
    for (let i = 0; i < lista.length; i += 500) {
      const bloco = lista.slice(i, i + 500);
      const valores: unknown[] = [];
      const linhas = bloco.map((m, j) => {
        const b = j * 7;
        valores.push(corretorId, m.id, conversaId, m.doCorretor, m.tipo, m.texto, m.enviadaEm);
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
      });
      const inseridas = await query(
        `INSERT INTO mensagens (corretor_id, id, conversa_id, do_corretor, tipo, texto, enviada_em)
         VALUES ${linhas.join(", ")} ON CONFLICT DO NOTHING RETURNING id`,
        valores,
      );
      novas += inseridas.length;
    }
    await atualizarResumoConversa(conversaId);
  }
  return novas;
}
