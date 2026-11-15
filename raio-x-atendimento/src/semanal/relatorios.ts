// Relatórios semanais: um para cada corretor e um para o time.

import {
  CRITERIOS,
  NOME_CATEGORIA_PERDA,
  NOME_CRITERIO,
  RelatorioCorretorSchema,
  RelatorioTimeSchema,
  type Analise,
  type CategoriaPerda,
  type RelatorioCorretor,
  type RelatorioTime,
} from "../analise/esquema.js";
import { processoComercial, type Pedido } from "../analise/ia.js";
import { anonimizar } from "../anonimizar.js";
import { config } from "../config.js";
import { query, queryOne } from "../db.js";
import { NOME_DA_ETAPA, type Etapa } from "../funil.js";
import { formatarMinutos } from "../metricas.js";
import { evolucaoPorCorretor, indicadores, serieSemanal, tendencia, type Indicadores } from "./estatisticas.js";
import { rotuloSemana, somarDias } from "./semanas.js";

const CONTEXTO_COMUM = `O time de corretores começou a usar IA (Claude) para apoiar o atendimento a partir de ${config.marcoIa.split("-").reverse().join("/")} (o "marco").
A imobiliária quer saber se o atendimento está evoluindo com o uso da IA e, quando não estiver, orientar: tanto sobre como usar melhor a IA quanto sobre como atender melhor pessoalmente (inclusive por telefone).
Os indícios de uso de IA vêm da leitura das mensagens (texto estruturado, padronizado); não é uma medição exata de quem usa a ferramenta.
Notas vão de 0 a 10. Diferenças menores que 0,5 ponto ou com poucas conversas não são conclusivas: diga isso quando for o caso.

<processo_comercial>
${processoComercial}
</processo_comercial>`;

const SISTEMA_CORRETOR = `Você é um gestor comercial de imobiliária que faz o acompanhamento semanal de cada corretor, com base na análise das conversas de WhatsApp dele.
Escreva para o próprio corretor: em português do Brasil, direto, respeitoso e motivador. Reconheça o que melhorou antes de cobrar.
Use apenas os dados fornecidos. Cite as conversas pelos códigos (C123) nos campos de detalhe, mas nunca na mensagem de WhatsApp.
As dicas de IA devem ser práticas: pedidos prontos para o corretor colar no Claude (ex.: pedir para adaptar a resposta ao que o cliente disse, preparar perguntas de qualificação, simular objeções).
As dicas de ligação devem dizer quando ligar e como conduzir a conversa.

${CONTEXTO_COMUM}`;

const SISTEMA_TIME = `Você é um consultor de vendas imobiliárias e escreve o relatório semanal do time de corretores para a gestão.
Use apenas os dados fornecidos, cite números e seja honesto sobre limitações (amostra pequena, poucas semanas depois do marco, sazonalidade).
Os exemplos de boas práticas devem usar as mensagens reais fornecidas, sem alterar.

${CONTEXTO_COMUM}`;

function textoIndicadores(titulo: string, i: Indicadores): string {
  const criterios = CRITERIOS.filter((c) => i.criterios[c] !== undefined)
    .map((c) => `${NOME_CRITERIO[c]} ${i.criterios[c]}`)
    .join("; ");
  const perdas = Object.entries(i.perdas)
    .map(([k, n]) => `${NOME_CATEGORIA_PERDA[k as CategoriaPerda]}: ${n}`)
    .join("; ");
  return [
    `${titulo}: ${i.conversas} conversa(s)-semana analisadas. Nota média ${i.nota ?? "—"}. Tempo de resposta mediano ${formatarMinutos(i.respostaMedianaMin)}.`,
    criterios ? `  Notas por critério: ${criterios}` : "",
    perdas ? `  Onde travou: ${perdas}` : "",
    `  Indícios de IA: personalizada ${i.usoIa.uso_personalizado}, genérica ${i.usoIa.uso_generico}, sem indício ${i.usoIa.nenhum}. Ligações recomendadas: ${i.ligacoesRecomendadas}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- Relatório do corretor ----------

export interface DadosRelatorioCorretor {
  corretorId: number;
  nome: string;
  semana: string;
  antes: Indicadores;
  depois: Indicadores;
  daSemana: Indicadores;
  serie: Awaited<ReturnType<typeof serieSemanal>>;
  conversas: { codigo: string; etapa: string | null; nota: number; resultado: Analise }[];
}

export async function dadosRelatorioCorretor(corretorId: number, semana: string): Promise<DadosRelatorioCorretor | undefined> {
  const corretor = await queryOne<{ nome: string }>("SELECT nome FROM corretores WHERE id = $1", [corretorId]);
  if (!corretor) return undefined;
  const conversas = await query<{ conversa_id: number; etapa: string | null; nota_geral: string; resultado: Analise }>(
    `SELECT a.conversa_id, a.etapa, a.nota_geral, a.resultado FROM analises a JOIN conversas c ON c.id = a.conversa_id
     WHERE c.corretor_id = $1 AND a.semana = $2::date AND c.tipo = 'cliente' ORDER BY a.nota_geral`,
    [corretorId, semana],
  );
  return {
    corretorId,
    nome: corretor.nome,
    semana,
    antes: await indicadores({ corretorId, periodo: "antes" }),
    depois: await indicadores({ corretorId, periodo: "depois" }),
    daSemana: await indicadores({ corretorId, semana }),
    serie: await serieSemanal(corretorId, somarDias(semana, -7 * 11)),
    conversas: conversas.map((c) => ({ codigo: `C${c.conversa_id}`, etapa: c.etapa, nota: Number(c.nota_geral), resultado: c.resultado })),
  };
}

export function pedidoRelatorioCorretor(d: DadosRelatorioCorretor): Pedido<RelatorioCorretor> {
  const serie = d.serie.map((p) => `${rotuloSemana(p.semana)} (${p.periodo}): ${p.conversas} conversas, nota ${p.nota ?? "—"}, ${p.usoIa}% com indício de IA`).join("\n");
  const conversas = d.conversas
    .map((c) => {
      const r = c.resultado;
      return [
        `${c.codigo} | etapa ${NOME_DA_ETAPA[c.etapa as Etapa] ?? c.etapa ?? "—"} | nota ${c.nota}`,
        `  Resumo: ${r.resumo}`,
        `  Onde travou: ${NOME_CATEGORIA_PERDA[r.ponto_de_perda.categoria]}: ${r.ponto_de_perda.descricao}`,
        `  IA: ${r.uso_ia.indicio}: ${r.uso_ia.comentario}`,
        r.ligacao.recomendada ? `  Ligação recomendada: ${r.ligacao.motivo}` : "",
        r.objecoes.length ? `  Objeções: ${r.objecoes.join("; ")}` : "",
        `  Dicas: ${r.dicas.map((x) => x.titulo).join("; ")}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  const conteudo = `Corretor: ${d.nome.split(" ")[0]}
Semana do relatório: ${rotuloSemana(d.semana)}

<indicadores>
${textoIndicadores("Antes do marco", d.antes)}
${textoIndicadores("Depois do marco", d.depois)}
${textoIndicadores("Esta semana", d.daSemana)}
</indicadores>

<evolucao_semanal>
${serie || "Sem semanas anteriores analisadas."}
</evolucao_semanal>

<conversas_da_semana>
${conversas || "Nenhuma conversa com cliente analisada nesta semana."}
</conversas_da_semana>

Escreva o relatório semanal deste corretor.`;
  return { modelo: config.ia.modeloRelatorio, esforco: "high", maxTokens: 16000, sistema: SISTEMA_CORRETOR, conteudo, esquema: RelatorioCorretorSchema };
}

const br = (n: number | null) => (n === null ? "—" : n.toFixed(1).replace(".", ","));
const NOME_TENDENCIA = { melhorando: "melhorando", estavel: "estável", piorando: "piorando", sem_dados: "sem dados suficientes" } as const;

export function relatorioCorretorSimulado(d: DadosRelatorioCorretor): RelatorioCorretor {
  const t = tendencia(d.antes.nota, d.depois.nota);
  const piores = CRITERIOS.filter((c) => d.depois.criterios[c] !== undefined).sort((a, b) => d.depois.criterios[a]! - d.depois.criterios[b]!).slice(0, 3);
  const primeiroNome = d.nome.split(" ")[0];
  const frase =
    t === "melhorando"
      ? `sua nota subiu de ${br(d.antes.nota)} para ${br(d.depois.nota)} depois que o time começou a usar IA`
      : t === "piorando"
        ? `sua nota caiu de ${br(d.antes.nota)} para ${br(d.depois.nota)} depois do marco`
        : t === "estavel"
          ? `sua nota ficou estável (${br(d.antes.nota)} antes, ${br(d.depois.nota)} depois do marco)`
          : "ainda não há dados suficientes para comparar antes e depois";
  const generico = d.depois.usoIa.uso_generico > 0;
  return {
    resumo_semana: `Relatório simulado (sem IA). ${d.daSemana.conversas} conversa(s) com clientes analisadas nesta semana, nota média ${br(d.daSemana.nota)}.`,
    tendencia: t,
    evolucao: `Em resumo, ${frase}.`,
    pontos_fortes: [],
    focos: piores.map((c) => ({
      titulo: NOME_CRITERIO[c],
      por_que: `Nota média ${br(d.depois.criterios[c]!)} depois do marco.`,
      como_fazer: "Veja as dicas nas conversas da semana.",
      exemplo_mensagem: "",
    })),
    dicas_ia: generico
      ? [
          {
            titulo: "Personalize o que a IA escreve",
            como_fazer: "Cole a conversa inteira e peça uma resposta que retome o que o cliente disse, curta e com uma pergunta no final.",
            exemplo_prompt: "Esta é minha conversa com um cliente: [cole aqui]. Escreva minha próxima mensagem em até 3 linhas, retomando o que ele pediu e terminando com uma pergunta para agendar visita.",
          },
        ]
      : [
          {
            titulo: "Use a IA para preparar a qualificação",
            como_fazer: "Antes de responder um lead novo, peça perguntas de qualificação naturais para o perfil dele.",
            exemplo_prompt: "Um cliente chegou pelo anúncio [cole o anúncio] e disse: [cole a mensagem]. Sugira 3 perguntas curtas e naturais para entender orçamento, região e prazo.",
          },
        ],
    dicas_ligacao:
      d.daSemana.ligacoesRecomendadas > 0
        ? [{ situacao: `${d.daSemana.ligacoesRecomendadas} conversa(s) com objeção nesta semana`, recomendacao: "Ligue, entenda o que pesa na decisão e proponha uma visita." }]
        : [],
    mensagem_whatsapp: `📊 *Seu resumo da semana, ${primeiroNome}*\n\nRelatório simulado (sem IA): ${frase}.${piores.length ? `\n\n🎯 *Foco da semana:* ${NOME_CRITERIO[piores[0]]}` : ""}\n\nVeja os detalhes: ${config.urlPublica}`,
  };
}

// ---------- Relatório do time ----------

export interface DadosRelatorioTime {
  semana: string;
  antes: Indicadores;
  depois: Indicadores;
  daSemana: Indicadores;
  serie: Awaited<ReturnType<typeof serieSemanal>>;
  evolucao: Awaited<ReturnType<typeof evolucaoPorCorretor>>;
  objecoes: { texto: string; n: number }[];
  perguntas: string[];
  melhoresMensagens: { corretor: string; texto: string; porQue: string }[];
  aguardandoResposta: number;
}

/** Busca o texto real da mensagem número N de uma conversa (anonimizado). */
async function textoDaMensagem(conversaId: number, numero: number): Promise<string | null> {
  const linha = await queryOne<{ texto: string | null; nome_contato: string | null; corretor: string }>(
    `SELECT m.texto, c.nome_contato, k.nome AS corretor FROM mensagens m JOIN conversas c ON c.id = m.conversa_id JOIN corretores k ON k.id = c.corretor_id
     WHERE m.conversa_id = $1 ORDER BY m.enviada_em OFFSET $2 LIMIT 1`,
    [conversaId, numero - 1],
  );
  return linha?.texto ? anonimizar(linha.texto, { cliente: linha.nome_contato, corretor: linha.corretor }) : null;
}

export async function dadosRelatorioTime(semana: string): Promise<DadosRelatorioTime> {
  const daSemana = await query<{ conversa_id: number; corretor: string; resultado: Analise }>(
    `SELECT a.conversa_id, k.nome AS corretor, a.resultado FROM analises a JOIN conversas c ON c.id = a.conversa_id JOIN corretores k ON k.id = c.corretor_id
     WHERE a.semana = $1::date AND c.tipo = 'cliente'`,
    [semana],
  );
  const contagem = new Map<string, number>();
  for (const a of daSemana) for (const o of a.resultado.objecoes) contagem.set(o.toLowerCase(), (contagem.get(o.toLowerCase()) ?? 0) + 1);
  const melhores: DadosRelatorioTime["melhoresMensagens"] = [];
  for (const a of daSemana) {
    if (!a.resultado.melhor_mensagem || melhores.length >= 40) continue;
    const texto = await textoDaMensagem(a.conversa_id, a.resultado.melhor_mensagem.mensagem);
    if (texto) melhores.push({ corretor: a.corretor, texto, porQue: a.resultado.melhor_mensagem.por_que_funcionou });
  }
  const aguardando = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM conversas WHERE tipo = 'cliente' AND aguardando_resposta AND COALESCE(etapa, '') NOT IN ('fechou', 'perdido')",
  );
  return {
    semana,
    antes: await indicadores({ periodo: "antes" }),
    depois: await indicadores({ periodo: "depois" }),
    daSemana: await indicadores({ semana }),
    serie: await serieSemanal(undefined, somarDias(semana, -7 * 15)),
    evolucao: await evolucaoPorCorretor(),
    objecoes: [...contagem].map(([texto, n]) => ({ texto, n })).sort((a, b) => b.n - a.n).slice(0, 40),
    perguntas: daSemana.flatMap((a) => a.resultado.perguntas_cliente).slice(0, 80),
    melhoresMensagens: melhores,
    aguardandoResposta: aguardando?.n ?? 0,
  };
}

export function pedidoRelatorioTime(d: DadosRelatorioTime): Pedido<RelatorioTime> {
  const corretores = d.evolucao
    .map((e) => `${e.nome}: antes ${e.antes ?? "—"} (${e.conversasAntes}), depois ${e.depois ?? "—"} (${e.conversasDepois}), tendência ${e.tendencia}, indício de IA em ${e.usoIaDepois}% (genérica ${e.usoGenericoDepois}%)`)
    .join("\n");
  const conteudo = `Semana do relatório: ${rotuloSemana(d.semana)}

<indicadores_do_time>
${textoIndicadores("Antes do marco", d.antes)}
${textoIndicadores("Depois do marco", d.depois)}
${textoIndicadores("Esta semana", d.daSemana)}
Clientes aguardando resposta agora: ${d.aguardandoResposta}
</indicadores_do_time>

<evolucao_semanal_do_time>
${d.serie.map((p) => `${rotuloSemana(p.semana)} (${p.periodo}): ${p.conversas} conversas, nota ${p.nota ?? "—"}, ${p.usoIa}% com indício de IA`).join("\n")}
</evolucao_semanal_do_time>

<corretores>
Nota média antes e depois do marco (número de conversas-semana entre parênteses):
${corretores}
</corretores>

<objecoes_da_semana>
${d.objecoes.map((o) => `${o.texto} (${o.n})`).join("\n") || "Nenhuma registrada."}
</objecoes_da_semana>

<perguntas_dos_clientes>
${d.perguntas.join("\n") || "Nenhuma registrada."}
</perguntas_dos_clientes>

<melhores_mensagens_da_semana>
${d.melhoresMensagens.map((m) => `[${m.corretor}] "${m.texto}" (por que funcionou: ${m.porQue})`).join("\n") || "Nenhuma destacada."}
</melhores_mensagens_da_semana>

Escreva o relatório semanal do time.`;
  return { modelo: config.ia.modeloRelatorio, esforco: "high", maxTokens: 32000, sistema: SISTEMA_TIME, conteudo, esquema: RelatorioTimeSchema };
}

export function relatorioTimeSimulado(d: DadosRelatorioTime): RelatorioTime {
  const evoluindo = d.evolucao.filter((e) => e.tendencia === "melhorando").map((e) => e.nome);
  const estagnados = d.evolucao.filter((e) => e.tendencia === "estavel" || e.tendencia === "piorando").map((e) => e.nome);
  const perdas = Object.entries(d.depois.perdas).sort((a, b) => b[1] - a[1]);
  return {
    resumo_executivo: `Relatório simulado (sem IA). Nota média do time: ${br(d.antes.nota)} antes do marco e ${br(d.depois.nota)} depois. Configure a chave da Anthropic para o relatório completo.`,
    efeito_ia: {
      conclusao: `Tendência do time: ${NOME_TENDENCIA[tendencia(d.antes.nota, d.depois.nota)]}. Com poucas semanas depois do marco, a comparação ainda é preliminar.`,
      evidencias: [`${d.depois.usoIa.uso_personalizado + d.depois.usoIa.uso_generico} conversa(s)-semana com indício de IA depois do marco.`],
      corretores_evoluindo: evoluindo,
      corretores_estagnados: estagnados,
    },
    onde_perdemos: perdas.slice(0, 3).map(([k, n]) => ({ tema: NOME_CATEGORIA_PERDA[k as CategoriaPerda], dimensao: `${n} conversa(s) depois do marco`, recomendacao: "Ver dicas nas conversas." })),
    objecoes_frequentes: d.objecoes.slice(0, 3).map((o) => ({ objecao: o.texto, como_responder: "—" })),
    perguntas_frequentes: [],
    boas_praticas: d.melhoresMensagens.slice(0, 3).map((m) => ({ titulo: "Mensagem que fez a conversa avançar", corretor: m.corretor, exemplo: m.texto, por_que_funciona: m.porQue })),
    uso_ia: { diagnostico: `Indícios de uso genérico em ${d.depois.usoIa.uso_generico} conversa(s)-semana e personalizado em ${d.depois.usoIa.uso_personalizado}.`, recomendacoes: [] },
    treinamentos_sugeridos: [],
    alertas: d.aguardandoResposta ? [`${d.aguardandoResposta} cliente(s) aguardando resposta.`] : [],
  };
}

// ---------- Gravação ----------

export async function salvarRelatorio(semana: string, corretorId: number | null, modelo: string, conteudo: unknown, entrada: unknown): Promise<void> {
  await query(
    `INSERT INTO relatorios (semana, corretor_id, modelo, conteudo, entrada) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (semana, COALESCE(corretor_id, 0)) DO UPDATE SET modelo = EXCLUDED.modelo, conteudo = EXCLUDED.conteudo, entrada = EXCLUDED.entrada, criado_em = now()`,
    [semana, corretorId, modelo, JSON.stringify(conteudo), JSON.stringify(entrada)],
  );
}

/** Corretores com conversas analisadas na semana e sem relatório ainda. */
export async function corretoresSemRelatorio(semana: string): Promise<number[]> {
  const linhas = await query<{ id: number }>(
    `SELECT DISTINCT c.corretor_id AS id FROM analises a JOIN conversas c ON c.id = a.conversa_id
     WHERE a.semana = $1::date AND c.tipo = 'cliente'
       AND NOT EXISTS (SELECT 1 FROM relatorios r WHERE r.semana = $1::date AND r.corretor_id = c.corretor_id)`,
    [semana],
  );
  return linhas.map((l) => l.id);
}
