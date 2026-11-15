// Importa o histórico do WhatsApp do corretor (conversas, mensagens e etiquetas) a partir da Evolution API.

import { query, queryOne } from "./db.js";
import * as evolution from "./evolution.js";
import { salvarEtiquetas } from "./etiquetas.js";
import { jidDoContato, jidValido, normalizarMensagem, salvarMensagens, type MensagemNormalizada } from "./ingestao.js";

interface Corretor {
  id: number;
  instancia: string;
}

let emAndamento = new Set<number>();

export async function sincronizarCorretor(corretor: Corretor): Promise<{ conversas: number; mensagensNovas: number }> {
  if (emAndamento.has(corretor.id)) return { conversas: 0, mensagensNovas: 0 };
  emAndamento.add(corretor.id);
  try {
    try {
      await salvarEtiquetas(corretor.id, await evolution.listarEtiquetas(corretor.instancia));
    } catch (e) {
      console.warn(`[sync] etiquetas do corretor ${corretor.id}:`, (e as Error).message);
    }

    const chats = await evolution.listarConversas(corretor.instancia);
    let conversas = 0;
    let mensagensNovas = 0;
    for (const chat of chats) {
      const jid: string | undefined = jidDoContato({ remoteJid: chat.remoteJid ?? chat.id, remoteJidAlt: chat.remoteJidAlt });
      if (!jidValido(jid)) continue;

      const existente = await queryOne<{ tipo: string }>("SELECT tipo FROM conversas WHERE corretor_id = $1 AND remote_jid = $2", [corretor.id, jid]);
      // Não baixa de novo o conteúdo de conversas já classificadas como pessoais.
      if (existente && (existente.tipo === "pessoal" || existente.tipo === "outro")) continue;

      const brutas = await evolution.listarMensagens(corretor.instancia, chat.remoteJid ?? jid);
      const msgs = brutas.map(normalizarMensagem).filter((m): m is MensagemNormalizada => Boolean(m));
      // Garante que todas as mensagens fiquem na mesma conversa, mesmo se vierem com @lid e número misturados.
      for (const m of msgs) m.remoteJid = jid;
      if (msgs.length === 0) continue;
      mensagensNovas += await salvarMensagens(corretor.id, msgs);
      conversas++;

      // Etiquetas aplicadas na conversa (quando a Evolution devolve essa informação junto da conversa).
      const labels: unknown = chat.labels ?? chat.labelIds;
      if (Array.isArray(labels)) {
        const ids = labels.map((l: any) => String(l?.id ?? l?.labelId ?? l));
        await query("UPDATE conversas SET etiquetas = $3 WHERE corretor_id = $1 AND remote_jid = $2", [corretor.id, jid, ids]);
      }
    }
    await query("UPDATE corretores SET ultima_sincronizacao = now() WHERE id = $1", [corretor.id]);
    console.log(`[sync] corretor ${corretor.id}: ${conversas} conversas, ${mensagensNovas} mensagens novas`);
    return { conversas, mensagensNovas };
  } finally {
    emAndamento.delete(corretor.id);
  }
}

/**
 * Quando o WhatsApp conecta, o histórico chega aos poucos. Sincroniza logo, depois de alguns minutos
 * e de novo mais tarde para pegar tudo.
 */
export function agendarSincronizacaoInicial(corretor: Corretor): void {
  for (const minutos of [1, 10, 60]) {
    setTimeout(() => {
      sincronizarCorretor(corretor).catch((e) => console.error(`[sync] corretor ${corretor.id}:`, (e as Error).message));
    }, minutos * 60_000).unref();
  }
}
