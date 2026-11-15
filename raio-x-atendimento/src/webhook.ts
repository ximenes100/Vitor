// Recebe os eventos da Evolution API (mensagens novas, conexão, etiquetas).

import { query, queryOne } from "./db.js";
import * as evolution from "./evolution.js";
import { registrarAssociacao } from "./etiquetas.js";
import { jidDoContato, jidValido, normalizarMensagem, salvarMensagens, type MensagemNormalizada } from "./ingestao.js";
import { agendarSincronizacaoInicial } from "./sincronizacao.js";

interface Corretor {
  id: number;
  instancia: string;
  status_conexao: string;
}

function lista(dado: any): any[] {
  if (Array.isArray(dado)) return dado;
  if (Array.isArray(dado?.messages)) return dado.messages;
  return dado ? [dado] : [];
}

export async function tratarEvento(corpo: any): Promise<void> {
  const evento = String(corpo?.event ?? "").toLowerCase().replace(/_/g, ".");
  const instancia = String(corpo?.instance ?? "");
  const corretor = await queryOne<Corretor>("SELECT id, instancia, status_conexao FROM corretores WHERE instancia = $1", [instancia]);
  if (!corretor) return;
  const dado = corpo.data;

  switch (evento) {
    case "qrcode.updated":
      await query("UPDATE corretores SET status_conexao = 'aguardando_qr' WHERE id = $1 AND status_conexao <> 'conectado'", [corretor.id]);
      break;

    case "connection.update": {
      const estado = dado?.state;
      if (estado === "open") {
        const primeiraVez = corretor.status_conexao !== "conectado";
        let numero: string | undefined = dado?.wuid ? String(dado.wuid).split("@")[0].split(":")[0] : undefined;
        if (!numero) numero = await evolution.numeroConectado(corretor.instancia).catch(() => undefined);
        await query(
          "UPDATE corretores SET status_conexao = 'conectado', conectado_em = COALESCE(conectado_em, now()), telefone = COALESCE($2, telefone) WHERE id = $1",
          [corretor.id, numero ?? null],
        );
        if (primeiraVez) agendarSincronizacaoInicial(corretor);
      } else if (estado === "close") {
        await query("UPDATE corretores SET status_conexao = 'desconectado' WHERE id = $1", [corretor.id]);
      }
      break;
    }

    case "messages.upsert":
    case "messages.set": {
      const msgs = lista(dado)
        .map(normalizarMensagem)
        .filter((m): m is MensagemNormalizada => Boolean(m));
      if (msgs.length) await salvarMensagens(corretor.id, msgs);
      break;
    }

    case "labels.edit": {
      const id = String(dado?.id ?? dado?.labelId ?? "");
      if (!id) break;
      if (dado?.deleted) await query("DELETE FROM etiquetas WHERE corretor_id = $1 AND label_id = $2", [corretor.id, id]);
      else
        await query(
          `INSERT INTO etiquetas (corretor_id, label_id, nome, cor) VALUES ($1, $2, $3, $4)
           ON CONFLICT (corretor_id, label_id) DO UPDATE SET nome = EXCLUDED.nome, cor = EXCLUDED.cor`,
          [corretor.id, id, String(dado?.name ?? ""), dado?.color !== undefined ? String(dado.color) : null],
        );
      break;
    }

    case "labels.association": {
      const assoc = dado?.association ?? dado;
      const jid = jidDoContato({ remoteJid: assoc?.chatId ?? assoc?.jid });
      const labelId = assoc?.labelId !== undefined ? String(assoc.labelId) : undefined;
      const acao = dado?.type === "remove" ? "remove" : "add";
      if (jidValido(jid) && labelId) await registrarAssociacao(corretor.id, jid, labelId, acao);
      break;
    }
  }
}
