// Fila de análise: de tempos em tempos procura conversas novas ou com mensagens novas e analisa.

import { config } from "../config.js";
import { query, queryOne } from "../db.js";
import { aplicarEtapaNoWhatsapp } from "../etiquetas.js";
import { etapaPorNomeDeEtiqueta } from "../funil.js";
import { evolutionConfigurada, listarMensagens } from "../evolution.js";
import { normalizarMensagem, salvarMensagens, type MensagemNormalizada } from "../ingestao.js";
import { calcularMetricas } from "../metricas.js";
import type { Analise, Triagem } from "./esquema.js";
import { analisarComIa, descricaoErroIa, triarComIa } from "./ia.js";
import { analisarSimulada, triarSimulada } from "./simulada.js";
import { formatarData, montarTranscricao, type MensagemTranscricao } from "./transcricao.js";

interface ConversaPendente {
  id: number;
  corretor_id: number;
  corretor_nome: string;
  instancia: string;
  remote_jid: string;
  nome_contato: string | null;
  tipo: string;
  etapa: string | null;
  etapa_manual: boolean;
  etiquetas: string[];
  total_mensagens: number;
}

// Conversas que falharam por erro temporário esperam um pouco antes de tentar de novo.
const aguardarAte = new Map<number, number>();

export async function conversasPendentes(limite: number): Promise<ConversaPendente[]> {
  return query<ConversaPendente>(
    `SELECT c.id, c.corretor_id, k.nome AS corretor_nome, k.instancia, c.remote_jid, c.nome_contato, c.tipo,
            c.etapa, c.etapa_manual, c.etiquetas, c.total_mensagens
     FROM conversas c JOIN corretores k ON k.id = c.corretor_id
     WHERE c.tipo IN ('cliente', 'indefinido')
       AND c.total_mensagens >= 2
       AND c.ultima_mensagem_em < now() - make_interval(mins => $1)
       AND (c.analisada_em IS NULL OR c.total_mensagens - c.mensagens_na_analise >= $2)
     ORDER BY c.ultima_mensagem_em DESC
     LIMIT $3`,
    [config.ia.esperaMinutos, config.ia.minimoMensagensNovas, limite],
  );
}

async function nomeDaEtiquetaAtual(corretorId: number, etiquetas: string[]): Promise<string | null> {
  if (etiquetas.length === 0) return null;
  const linhas = await query<{ nome: string }>("SELECT nome FROM etiquetas WHERE corretor_id = $1 AND label_id = ANY($2)", [corretorId, etiquetas]);
  return linhas.find((l) => etapaPorNomeDeEtiqueta(l.nome))?.nome ?? linhas[0]?.nome ?? null;
}

export async function analisarConversa(conversa: ConversaPendente): Promise<void> {
  const mensagens = await query<MensagemTranscricao>(
    "SELECT do_corretor, tipo, texto, enviada_em FROM mensagens WHERE conversa_id = $1 ORDER BY enviada_em",
    [conversa.id],
  );
  const nomes = { cliente: conversa.nome_contato, corretor: conversa.corretor_nome };
  const total = mensagens.length;

  // 1) Triagem: só uma amostra (início + fim), para gastar pouco e expor o mínimo de conversas pessoais.
  let tipo = conversa.tipo;
  if (tipo === "indefinido") {
    const amostra = total > 40 ? [...mensagens.slice(0, 30), ...mensagens.slice(-10)] : mensagens;
    const triagem: Triagem = config.ia.ativa ? await triarComIa(montarTranscricao(amostra, nomes)) : triarSimulada(amostra);
    tipo = triagem.tipo;
    await query("UPDATE conversas SET tipo = $2 WHERE id = $1", [conversa.id, tipo]);
  }
  if (tipo !== "cliente") {
    // Privacidade: o conteúdo de conversas que não são de clientes é apagado; fica só o registro do contato.
    await query("DELETE FROM mensagens WHERE conversa_id = $1", [conversa.id]);
    await query("UPDATE conversas SET analisada_em = now(), mensagens_na_analise = 0, total_mensagens = 0, erro_analise = NULL WHERE id = $1", [conversa.id]);
    return;
  }

  // 2) Análise completa.
  const metricas = calcularMetricas(mensagens);
  const inicio = Math.max(0, total - config.ia.maximoMensagens);
  const trecho = mensagens.slice(inicio);
  let analise: Analise;
  let modelo: string;
  if (config.ia.ativa) {
    analise = await analisarComIa({
      transcricao: montarTranscricao(trecho, nomes, inicio),
      metricas,
      totalMensagens: total,
      mensagensOmitidas: inicio,
      etiquetaAtual: await nomeDaEtiquetaAtual(conversa.corretor_id, conversa.etiquetas),
      agora: formatarData(new Date()),
    });
    modelo = config.ia.modeloAnalise;
  } else {
    analise = analisarSimulada(trecho, metricas);
    modelo = "simulada";
  }

  const notaGeral = Math.max(0, Math.min(10, analise.nota_geral));
  await query(
    `INSERT INTO analises (conversa_id, modelo, tipo, etapa, nota_geral, categoria_perda, resultado, metricas)
     VALUES ($1, $2, 'cliente', $3, $4, $5, $6, $7)`,
    [conversa.id, modelo, analise.etapa, notaGeral, analise.ponto_de_perda.categoria, analise, metricas],
  );

  // A etapa escolhida pelo corretor (etiqueta manual) vale mais que a da IA.
  const etapaFinal = conversa.etapa_manual && conversa.etapa ? conversa.etapa : analise.etapa;
  await query(
    `UPDATE conversas SET etapa = $2, analisada_em = now(), mensagens_na_analise = $3, erro_analise = NULL,
       -- Se chegaram mensagens durante a análise, mantém o cálculo automático até a próxima análise.
       aguardando_resposta = CASE WHEN total_mensagens = $3 THEN $4 AND NOT COALESCE(ultima_mensagem_do_corretor, TRUE) ELSE aguardando_resposta END
     WHERE id = $1`,
    [conversa.id, etapaFinal, total, analise.cliente_aguarda_resposta],
  );
  if (!conversa.etapa_manual) {
    try {
      await aplicarEtapaNoWhatsapp(conversa.corretor_id, conversa.instancia, conversa.remote_jid, analise.etapa);
    } catch (e) {
      console.warn(`[etiquetas] não foi possível aplicar etiqueta na conversa ${conversa.id}:`, (e as Error).message);
    }
  }
}

async function comLimite<T>(itens: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) await fn(itens[proximo++]);
  });
  await Promise.all(trabalhadores);
}

/** Processa uma rodada da fila. Devolve quantas conversas foram analisadas. */
export async function processarFila(limite = 40): Promise<number> {
  const agora = Date.now();
  const pendentes = (await conversasPendentes(limite)).filter((c) => (aguardarAte.get(c.id) ?? 0) < agora);
  let feitas = 0;
  await comLimite(pendentes, config.ia.concorrencia, async (c) => {
    try {
      await analisarConversa(c);
      aguardarAte.delete(c.id);
      feitas++;
    } catch (e) {
      const { mensagem, tentarDeNovo } = descricaoErroIa(e);
      console.error(`[análise] conversa ${c.id}: ${mensagem}`);
      await query("UPDATE conversas SET erro_analise = $2 WHERE id = $1", [c.id, mensagem]);
      if (tentarDeNovo) aguardarAte.set(c.id, Date.now() + 15 * 60_000);
      else await query("UPDATE conversas SET mensagens_na_analise = total_mensagens, analisada_em = COALESCE(analisada_em, now()) WHERE id = $1", [c.id]);
    }
  });
  return feitas;
}

let rodando = false;
export function iniciarFila(intervaloMs = 60_000): NodeJS.Timeout {
  return setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      const n = await processarFila();
      if (n) console.log(`[análise] ${n} conversa(s) analisada(s)`);
    } catch (e) {
      console.error("[análise] erro na fila:", e);
    } finally {
      rodando = false;
    }
  }, intervaloMs);
}

/** Corretor corrigiu a classificação pela tela: "é cliente" ou "é pessoal". */
export async function corrigirTipo(corretorId: number, conversaId: number, tipo: "cliente" | "pessoal"): Promise<void> {
  const c = await queryOne<{ id: number; remote_jid: string; instancia: string }>(
    "SELECT c.id, c.remote_jid, k.instancia FROM conversas c JOIN corretores k ON k.id = c.corretor_id WHERE c.id = $1 AND c.corretor_id = $2",
    [conversaId, corretorId],
  );
  if (!c) return;
  if (tipo === "pessoal") {
    await query("DELETE FROM mensagens WHERE conversa_id = $1", [conversaId]);
    await query("UPDATE conversas SET tipo = 'pessoal', total_mensagens = 0, mensagens_na_analise = 0 WHERE id = $1", [conversaId]);
    await query("DELETE FROM analises WHERE conversa_id = $1", [conversaId]);
    return;
  }
  await query("UPDATE conversas SET tipo = 'cliente', analisada_em = NULL, mensagens_na_analise = 0 WHERE id = $1", [conversaId]);
  // O conteúdo foi apagado quando a conversa foi classificada como pessoal: busca de novo no WhatsApp.
  if (evolutionConfigurada()) {
    const brutas = await listarMensagens(c.instancia, c.remote_jid);
    await salvarMensagens(corretorId, brutas.map(normalizarMensagem).filter((m): m is MensagemNormalizada => Boolean(m)));
  }
}
