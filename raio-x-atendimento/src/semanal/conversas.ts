// Triagem (cliente x pessoal) e análise de cada conversa, uma vez por semana.

import { AnaliseSchema, TriagemSchema, type Analise, type Triagem } from "../analise/esquema.js";
import { processoComercial, type Pedido } from "../analise/ia.js";
import { analisarSimulada, triarSimulada } from "../analise/simulada.js";
import { formatarData, montarTranscricao, type MensagemTranscricao } from "../analise/transcricao.js";
import { config } from "../config.js";
import { query, queryOne } from "../db.js";
import { aplicarEtapaNoWhatsapp } from "../etiquetas.js";
import { evolutionConfigurada, listarMensagens } from "../evolution.js";
import { normalizarMensagem, salvarMensagens, type MensagemNormalizada } from "../ingestao.js";
import { etapaPorNomeDeEtiqueta } from "../funil.js";
import { calcularMetricas, formatarMinutos, type Metricas } from "../metricas.js";
import { limitesDaSemana, periodoDaSemana, primeiraSemanaAnalisada } from "./semanas.js";

const SISTEMA_TRIAGEM = `Você classifica conversas de WhatsApp do celular de um corretor de imóveis.
Responda se a conversa é um atendimento a cliente/lead imobiliário, uma conversa pessoal, ou outro contato profissional (colegas, parceiros, fornecedores, proprietários).
Na dúvida entre cliente e outro, escolha cliente se a pessoa demonstra interesse em comprar, alugar ou investir em um imóvel.`;

// Texto fixo (igual em todas as conversas) para aproveitar o cache de prompt da API.
const SISTEMA_ANALISE = `Você é um gestor comercial experiente do mercado imobiliário brasileiro e revisa, semana a semana, os atendimentos de corretores pelo WhatsApp.
Objetivo: ajudar o corretor a converter mais, apontando com precisão onde a conversa travou e o que fazer melhor, com exemplos práticos.
O time começou a usar IA (Claude) para apoiar o atendimento; por isso você também registra indícios de uso de IA e se esse uso ajudou.

Como avaliar:
- Avalie SOMENTE as mensagens da semana (dentro de <semana>). As mensagens em <contexto> são de semanas anteriores e servem só para entender a história.
- Use o processo comercial da imobiliária abaixo como referência do que é um bom atendimento.
- Baseie cada nota em mensagens concretas e cite-as pelo número (#12). Não invente fatos que não estão na conversa.
- As métricas de tempo de resposta foram calculadas pelo sistema e são confiáveis; use-as no critério de velocidade.
- O conteúdo de áudios, fotos e documentos não está disponível ([áudio], [foto] etc.). Não penalize o que não dá para ver.
- Dados pessoais foram mascarados ([cliente], [corretor], [telefone]...). Isso é proposital; não comente.
- Indícios de IA são só indícios: mensagens longas e bem estruturadas, listas, linguagem formal ou padronizada. Não acuse; descreva.
- Recomende ligação quando uma conversa por voz teria destravado a situação (objeção, indecisão, negociação, cliente que escreve muito).
- Seja direto e construtivo. Dicas e mensagens de exemplo em português do Brasil, no tom natural de WhatsApp, prontas para usar.
- Notas: 0-3 ruim, 4-6 regular, 7-8 bom, 9-10 excelente. Use null quando o critério não se aplica nesta semana.

<processo_comercial>
${processoComercial}
</processo_comercial>`;

// ---------- Triagem ----------

export async function conversasParaTriar(limite: number) {
  return query<{ id: number; corretor_id: number; corretor_nome: string; nome_contato: string | null }>(
    `SELECT c.id, c.corretor_id, k.nome AS corretor_nome, c.nome_contato
     FROM conversas c JOIN corretores k ON k.id = c.corretor_id
     WHERE c.tipo = 'indefinido' AND c.total_mensagens >= 2 AND c.erro_analise IS NULL
     ORDER BY c.ultima_mensagem_em DESC LIMIT $1`,
    [limite],
  );
}

export async function amostraParaTriagem(conversaId: number): Promise<MensagemTranscricao[]> {
  // Só o começo e o fim: gasta pouco e expõe o mínimo de conversas pessoais.
  const msgs = await query<MensagemTranscricao>(
    "SELECT do_corretor, tipo, texto, enviada_em FROM mensagens WHERE conversa_id = $1 ORDER BY enviada_em",
    [conversaId],
  );
  return msgs.length > 40 ? [...msgs.slice(0, 30), ...msgs.slice(-10)] : msgs;
}

export function pedidoTriagem(amostra: MensagemTranscricao[], nomes: { cliente: string | null; corretor: string }): Pedido<Triagem> {
  return {
    modelo: config.ia.modeloTriagem,
    esforco: "low",
    maxTokens: 2000,
    sistema: SISTEMA_TRIAGEM,
    conteudo: `Trecho da conversa:\n\n${montarTranscricao(amostra, nomes)}`,
    esquema: TriagemSchema,
  };
}

export function triagemSimulada(amostra: MensagemTranscricao[]): Triagem {
  return triarSimulada(amostra);
}

export async function salvarTriagem(conversaId: number, tipo: Triagem["tipo"]): Promise<void> {
  if (tipo === "cliente") {
    await query("UPDATE conversas SET tipo = 'cliente' WHERE id = $1", [conversaId]);
    return;
  }
  // Privacidade: o conteúdo de conversas que não são de clientes é apagado; fica só o registro do contato.
  await query("DELETE FROM mensagens WHERE conversa_id = $1", [conversaId]);
  await query("UPDATE conversas SET tipo = $2, total_mensagens = 0, erro_analise = NULL WHERE id = $1", [conversaId, tipo]);
}

// ---------- Análise semanal ----------

/** Pares (conversa, semana) de clientes com movimento na semana e ainda sem análise. */
export async function paresPendentes(ateSemana: string, limite: number): Promise<{ conversa_id: number; semana: string }[]> {
  return query(
    `SELECT t.conversa_id, to_char(t.semana, 'YYYY-MM-DD') AS semana
     FROM (
       SELECT m.conversa_id, date_trunc('week', m.enviada_em AT TIME ZONE $3)::date AS semana, count(*) AS n
       FROM mensagens m JOIN conversas c ON c.id = m.conversa_id
       WHERE c.tipo = 'cliente'
         AND (m.enviada_em AT TIME ZONE $3)::date >= $1::date
         AND (m.enviada_em AT TIME ZONE $3)::date < ($2::date + 7)
       GROUP BY 1, 2
     ) t
     WHERE t.n >= 2
       AND NOT EXISTS (SELECT 1 FROM analises a WHERE a.conversa_id = t.conversa_id AND a.semana = t.semana)
       AND NOT EXISTS (SELECT 1 FROM falhas_analise f WHERE f.conversa_id = t.conversa_id AND f.semana = t.semana AND f.tentativas >= 3)
     ORDER BY t.semana DESC, t.conversa_id
     LIMIT $4`,
    [primeiraSemanaAnalisada(), ateSemana, config.fuso, limite],
  );
}

export interface EntradaSemana {
  conversaId: number;
  semana: string;
  mensagensDaSemana: MensagemTranscricao[];
  primeiraMensagem: number; // número (#) da primeira mensagem da semana
  metricas: Metricas;
  pedido: Pedido<Analise>;
}

export async function montarEntrada(conversaId: number, semana: string): Promise<EntradaSemana | undefined> {
  const conversa = await queryOne<{ nome_contato: string | null; corretor_nome: string; corretor_id: number; etiquetas: string[] }>(
    "SELECT c.nome_contato, k.nome AS corretor_nome, c.corretor_id, c.etiquetas FROM conversas c JOIN corretores k ON k.id = c.corretor_id WHERE c.id = $1",
    [conversaId],
  );
  if (!conversa) return undefined;
  const { inicio, fim } = limitesDaSemana(semana);
  const todas = await query<MensagemTranscricao>(
    "SELECT do_corretor, tipo, texto, enviada_em FROM mensagens WHERE conversa_id = $1 AND enviada_em < $2 ORDER BY enviada_em",
    [conversaId, fim],
  );
  const inicioSemana = todas.findIndex((m) => m.enviada_em >= inicio);
  if (inicioSemana < 0) return undefined;

  let daSemana = todas.slice(inicioSemana);
  let omitidas = 0;
  if (daSemana.length > config.ia.maximoMensagens) {
    omitidas = daSemana.length - config.ia.maximoMensagens;
    daSemana = daSemana.slice(omitidas);
  }
  const primeiroIndice = inicioSemana + omitidas; // índice (base 0) da primeira mensagem avaliada
  const inicioContexto = Math.max(0, inicioSemana - config.ia.mensagensDeContexto);
  const contexto = todas.slice(inicioContexto, inicioSemana);

  const nomes = { cliente: conversa.nome_contato, corretor: conversa.corretor_nome };
  const agora = new Date(Math.min(Date.now(), fim.getTime()));
  const metricas = calcularMetricas(daSemana, agora);
  const etiqueta = conversa.etiquetas.length
    ? (await query<{ nome: string }>("SELECT nome FROM etiquetas WHERE corretor_id = $1 AND label_id = ANY($2)", [conversa.corretor_id, conversa.etiquetas])).find((l) =>
        etapaPorNomeDeEtiqueta(l.nome),
      )?.nome
    : undefined;

  const m = metricas;
  const resumoMetricas = [
    `Semana avaliada: ${formatarData(inicio)} a ${formatarData(new Date(fim.getTime() - 60_000))} (${periodoDaSemana(semana) === "depois" ? "depois" : "antes"} do marco de uso de IA pelo time).`,
    `Fim do período analisado: ${formatarData(agora)}.`,
    `Etiqueta atual no WhatsApp: ${etiqueta ?? "nenhuma"}`,
    `Mensagens na semana: ${m.totalMensagens} (cliente ${m.mensagensCliente}, corretor ${m.mensagensCorretor}).`,
    `Tempo de resposta do corretor na semana: mediana ${formatarMinutos(m.respostaMedianaMin)}; 90% em até ${formatarMinutos(m.respostaP90Min)}. Esperas acima de 24h: ${m.esperasAcimaDe24h}.`,
    `Cliente aguardando resposta no fim do período: ${m.clienteSemResposta ? "sim" : "não"}. Tentativas do corretor sem retorno no fim: ${m.tentativasSemRetorno}.`,
    `Áudios do corretor: ${m.percentualAudiosCorretor}% das mensagens dele.`,
    omitidas ? `ATENÇÃO: semana muito longa; as primeiras ${omitidas} mensagens da semana foram omitidas.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const conteudo = [
    `<metricas>\n${resumoMetricas}\n</metricas>`,
    contexto.length ? `<contexto>\n${montarTranscricao(contexto, nomes, inicioContexto)}\n</contexto>` : "<contexto>Início da conversa.</contexto>",
    `<semana>\n${montarTranscricao(daSemana, nomes, primeiroIndice)}\n</semana>`,
    "Analise o atendimento desta semana.",
  ].join("\n\n");

  return {
    conversaId,
    semana,
    mensagensDaSemana: daSemana,
    primeiraMensagem: primeiroIndice + 1,
    metricas,
    pedido: { modelo: config.ia.modeloAnalise, esforco: "high", maxTokens: 16000, sistema: SISTEMA_ANALISE, conteudo, esquema: AnaliseSchema },
  };
}

export function analiseSimulada(e: EntradaSemana): Analise {
  return analisarSimulada(e.mensagensDaSemana, e.metricas, e.primeiraMensagem);
}

export async function salvarAnalise(
  conversaId: number,
  semana: string,
  analise: Analise,
  modelo: string,
  metricas: Metricas,
  primeiraMensagem: number,
): Promise<void> {
  const nota = Math.max(0, Math.min(10, analise.nota_geral));
  await query(
    `INSERT INTO analises (conversa_id, semana, periodo, modelo, etapa, nota_geral, categoria_perda, uso_ia, primeira_mensagem, resultado, metricas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (conversa_id, semana) DO UPDATE SET
       criada_em = now(), modelo = EXCLUDED.modelo, etapa = EXCLUDED.etapa, nota_geral = EXCLUDED.nota_geral,
       categoria_perda = EXCLUDED.categoria_perda, uso_ia = EXCLUDED.uso_ia, primeira_mensagem = EXCLUDED.primeira_mensagem,
       resultado = EXCLUDED.resultado, metricas = EXCLUDED.metricas`,
    [conversaId, semana, periodoDaSemana(semana), modelo, analise.etapa, nota, analise.ponto_de_perda.categoria, analise.uso_ia.indicio, primeiraMensagem, analise, metricas],
  );

  // A etapa e a etiqueta seguem a análise da semana mais recente da conversa.
  const conversa = await queryOne<{ corretor_id: number; instancia: string; remote_jid: string; etapa_manual: boolean; semana_mais_recente: string }>(
    `SELECT c.corretor_id, k.instancia, c.remote_jid, c.etapa_manual,
            (SELECT to_char(max(semana), 'YYYY-MM-DD') FROM analises WHERE conversa_id = c.id) AS semana_mais_recente
     FROM conversas c JOIN corretores k ON k.id = c.corretor_id WHERE c.id = $1`,
    [conversaId],
  );
  if (!conversa || conversa.semana_mais_recente !== semana) return;
  await query(
    `UPDATE conversas SET
       etapa = CASE WHEN etapa_manual AND etapa IS NOT NULL THEN etapa ELSE $2 END,
       analisada_em = now(), erro_analise = NULL,
       -- Só vale se não chegou mensagem depois da semana analisada.
       aguardando_resposta = CASE WHEN ultima_mensagem_em < $4 THEN $3 AND NOT COALESCE(ultima_mensagem_do_corretor, TRUE) ELSE aguardando_resposta END
     WHERE id = $1`,
    [conversaId, analise.etapa, analise.cliente_aguarda_resposta, limitesDaSemana(semana).fim],
  );
  if (!conversa.etapa_manual) {
    try {
      await aplicarEtapaNoWhatsapp(conversa.corretor_id, conversa.instancia, conversa.remote_jid, analise.etapa);
    } catch (e) {
      console.warn(`[etiquetas] conversa ${conversaId}:`, (e as Error).message);
    }
  }
}

/** Registra uma falha; depois de 3 tentativas a semana daquela conversa deixa de ser tentada. */
export async function registrarFalha(conversaId: number, semana: string, erro: string, definitiva: boolean): Promise<void> {
  await query(
    `INSERT INTO falhas_analise (conversa_id, semana, erro, tentativas) VALUES ($1, $2, $3, $4)
     ON CONFLICT (conversa_id, semana) DO UPDATE SET erro = EXCLUDED.erro, tentativas = falhas_analise.tentativas + EXCLUDED.tentativas`,
    [conversaId, semana, erro, definitiva ? 3 : 1],
  );
  await query("UPDATE conversas SET erro_analise = $2 WHERE id = $1", [conversaId, erro]);
}

/** Corretor corrigiu a classificação pela tela: "é cliente" ou "é pessoal". */
export async function corrigirTipo(corretorId: number, conversaId: number, tipo: "cliente" | "pessoal"): Promise<void> {
  const c = await queryOne<{ id: number; remote_jid: string; instancia: string }>(
    "SELECT c.id, c.remote_jid, k.instancia FROM conversas c JOIN corretores k ON k.id = c.corretor_id WHERE c.id = $1 AND c.corretor_id = $2",
    [conversaId, corretorId],
  );
  if (!c) return;
  if (tipo === "pessoal") {
    await query("DELETE FROM analises WHERE conversa_id = $1", [conversaId]);
    await salvarTriagem(conversaId, "pessoal");
    return;
  }
  await query("UPDATE conversas SET tipo = 'cliente', erro_analise = NULL WHERE id = $1", [conversaId]);
  await query("DELETE FROM falhas_analise WHERE conversa_id = $1", [conversaId]);
  // O conteúdo foi apagado quando a conversa foi classificada como pessoal: busca de novo no WhatsApp.
  if (evolutionConfigurada()) {
    const brutas = await listarMensagens(c.instancia, c.remote_jid);
    await salvarMensagens(corretorId, brutas.map(normalizarMensagem).filter((m): m is MensagemNormalizada => Boolean(m)));
  }
}
