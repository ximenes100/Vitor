// Análise SIMULADA, usada só quando não há chave da Anthropic configurada.
// Serve para ver o sistema funcionando (painéis, etiquetas, resumo diário) sem gastar com IA.
// As regras são simples (palavras-chave + métricas) e NÃO substituem a análise real.

import { normalizarNome, type Etapa } from "../funil.js";
import type { Metricas } from "../metricas.js";
import type { MensagemTranscricao } from "./transcricao.js";
import { CRITERIOS, type Analise, type CategoriaPerda, type Triagem } from "./esquema.js";

const tem = (texto: string, termos: string[]) => termos.some((t) => texto.includes(t));

const TERMOS_IMOVEL = ["imovel", "apartamento", "apto", "casa", "quarto", "visita", "aluguel", "financiamento", "condominio", "metragem", "m2", "terreno", "lancamento", "vaga"];

function juntar(mensagens: MensagemTranscricao[], doCorretor?: boolean): string {
  return normalizarNome(
    mensagens
      .filter((m) => doCorretor === undefined || m.do_corretor === doCorretor)
      .map((m) => m.texto ?? "")
      .join(" "),
  );
}

export function triarSimulada(mensagens: MensagemTranscricao[]): Triagem {
  const texto = juntar(mensagens);
  return tem(texto, TERMOS_IMOVEL)
    ? { tipo: "cliente", motivo: "Menciona termos de imóvel (análise simulada)" }
    : { tipo: "pessoal", motivo: "Não menciona imóveis (análise simulada)" };
}

export function analisarSimulada(mensagens: MensagemTranscricao[], m: Metricas, primeiraMensagem = 1): Analise {
  const corretor = juntar(mensagens, true);
  const cliente = juntar(mensagens, false);
  const todos = `${corretor} ${cliente}`;

  const perguntouOrcamento = tem(corretor, ["orcamento", "faixa de valor", "quanto pretende", "valor maximo", "ate quanto"]);
  const perguntouRegiao = tem(corretor, ["regiao", "bairro", "onde voce"]);
  const perguntouPagamento = tem(corretor, ["financiamento", "fgts", "a vista", "entrada"]);
  const perguntouMotivo = tem(corretor, ["por que", "porque", "motivo", "o que nao pode faltar", "o que e importante"]);
  const convidouVisita = tem(corretor, ["visita", "conhecer pessoalmente", "agendar", "posso te mostrar"]);
  const objecao = tem(cliente, ["caro", "vou pensar", "falar com meu", "falar com minha", "acima do"]);
  const qualificacao = [perguntouOrcamento, perguntouRegiao, perguntouPagamento].filter(Boolean).length;

  let etapa: Etapa = "lead_novo";
  if (qualificacao >= 2) etapa = "qualificado";
  if (tem(todos, ["visita confirmada", "combinado", "te espero", "nos vemos"]) && convidouVisita) etapa = "visita_agendada";
  if (tem(todos, ["proposta"])) etapa = "proposta";
  if (tem(todos, ["contrato assinado", "fechado", "parabens pela"])) etapa = "fechou";
  if (tem(cliente, ["ja comprei", "ja achei outro", "fechei com outro", "desisti", "nao tenho mais interesse"])) etapa = "perdido";

  const velocidade = m.respostaMedianaMin === null ? null : m.respostaMedianaMin <= 10 ? 9 : m.respostaMedianaMin <= 60 ? 7 : m.respostaMedianaMin <= 240 ? 5 : 2;
  const notasPorCriterio: Record<string, number | null> = {
    velocidade,
    rapport: tem(corretor, ["bom dia", "boa tarde", "boa noite", "tudo bem"]) ? 7 : 4,
    qualificacao: [2, 5, 7, 9][qualificacao],
    descoberta_necessidade: perguntouMotivo ? 7 : 3,
    apresentacao_imoveis: tem(corretor, ["opcao", "opcoes", "segue"]) ? (perguntouMotivo ? 7 : 4) : null,
    conducao_visita: convidouVisita ? 8 : 3,
    objecoes: objecao ? (tem(corretor, ["entendo", "faz sentido", "posso", "condicao"]) ? 6 : 3) : null,
    proximo_passo: m.ultimaMensagemDoCorretor && (mensagens.at(-1)?.texto ?? "").includes("?") ? 6 : 4,
    followup: m.tentativasSemRetorno > 0 || m.clienteSemResposta ? (m.clienteSemResposta ? 2 : 5) : null,
    comunicacao: m.percentualAudiosCorretor > 50 ? 5 : 7,
  };
  const validas = Object.values(notasPorCriterio).filter((n): n is number => n !== null);
  const notaGeral = Math.round((validas.reduce((a, b) => a + b, 0) / validas.length) * 10) / 10;

  let categoria: CategoriaPerda = "nenhuma";
  if (etapa === "fechou") categoria = "nenhuma";
  else if (m.clienteSemResposta && (m.horasDesdeUltimaMensagem ?? 0) > 24) categoria = "demora_resposta";
  else if (qualificacao < 2) categoria = "sem_qualificacao";
  else if (!convidouVisita) categoria = "sem_convite_visita";
  else if (objecao) categoria = "objecao_mal_tratada";
  else if ((m.horasDesdeUltimaMensagem ?? 0) > 72) categoria = "sem_followup";

  const dicas: Analise["dicas"] = [];
  if (qualificacao < 2)
    dicas.push({
      titulo: "Qualifique antes de mandar opções",
      o_que_aconteceu: "O corretor não perguntou faixa de valor, região e forma de pagamento.",
      como_fazer: "Faça 2 ou 3 perguntas logo no início, de forma leve.",
      exemplo_mensagem: "Pra eu te mandar só o que faz sentido: qual região você prefere e até quanto pretende investir? Vai usar financiamento?",
    });
  if (!convidouVisita)
    dicas.push({
      titulo: "Convide para visita com data e hora",
      o_que_aconteceu: "A conversa não teve convite para visita.",
      como_fazer: "Proponha duas opções concretas de horário.",
      exemplo_mensagem: "Que tal conhecer pessoalmente? Consigo terça às 18h ou sábado às 10h. Qual fica melhor pra você?",
    });
  if (m.clienteSemResposta || (m.respostaMedianaMin ?? 0) > 60)
    dicas.push({
      titulo: "Responda mais rápido",
      o_que_aconteceu: `Tempo de resposta mediano de ${m.respostaMedianaMin ?? "?"} minutos.`,
      como_fazer: "Use respostas rápidas do WhatsApp Business para o primeiro contato e retome em seguida.",
      exemplo_mensagem: "Oi! Recebi sua mensagem e já vou te ajudar. Me conta: você procura pra morar ou investir?",
    });

  const fechadoOuPerdido = etapa === "fechou" || etapa === "perdido";

  // Indícios de IA: mensagens longas e estruturadas (listas, quebras de linha). Personalizada se retoma o que o cliente disse.
  const numero = (i: number) => primeiraMensagem + i;
  const comCaraDeIa = mensagens
    .map((msg, i) => ({ msg, i }))
    .filter(({ msg }) => msg.do_corretor && (msg.texto?.length ?? 0) > 220 && /\n|•|✅|1\)|- /.test(msg.texto ?? ""));
  const personalizada = comCaraDeIa.some(({ msg }) => /voce (comentou|falou|disse|mencionou)|como voce|pelo que voce/.test(normalizarNome(msg.texto ?? "")));
  const usoIa: Analise["uso_ia"] = comCaraDeIa.length
    ? {
        indicio: personalizada ? "uso_personalizado" : "uso_generico",
        mensagens: comCaraDeIa.map(({ i }) => numero(i)),
        comentario: personalizada ? "Mensagens estruturadas e ligadas ao que o cliente pediu." : "Mensagens longas e padronizadas, sem ligação com o que o cliente disse.",
      }
    : { indicio: "nenhum", mensagens: [], comentario: "Sem indícios de uso de IA." };

  const objecoes: string[] = [];
  if (tem(cliente, ["caro", "acima do"])) objecoes.push("preço acima do orçamento");
  if (tem(cliente, ["vou pensar"])) objecoes.push("vai pensar");
  if (tem(cliente, ["falar com meu", "falar com minha"])) objecoes.push("decidir com o cônjuge");
  const perguntas = mensagens.filter((x) => !x.do_corretor && (x.texto ?? "").includes("?")).map((x) => x.texto!.slice(0, 80));
  const indiceObjecao = mensagens.findIndex((x) => !x.do_corretor && tem(normalizarNome(x.texto ?? ""), ["caro", "vou pensar", "acima do"]));
  const indiceMelhor = mensagens.findIndex((x) => x.do_corretor && (x.texto ?? "").includes("?") && tem(normalizarNome(x.texto ?? ""), ["visita", "conhecer", "orcamento", "regiao", "morar ou investir"]));
  const ultima = mensagens.at(-1);
  const ultimaTexto = normalizarNome(ultima?.texto ?? "");
  const encerramento = /^(ok|okay|blz|beleza|combinado|confirmado|obrigad[oa]|valeu|fechado|perfeito)\b/.test(ultimaTexto) || ultimaTexto.includes("nos vemos");
  const clienteAguarda = Boolean(ultima && !ultima.do_corretor && !encerramento);
  return {
    etapa,
    confianca_etapa: "baixa",
    resumo: "Análise simulada (sem IA): configure a chave da Anthropic para ter a análise detalhada desta conversa.",
    perfil_cliente: { objetivo: null, tipo_imovel: null, regiao: null, orcamento: null, pagamento: null, prazo: null, decisores: null },
    notas: CRITERIOS.map((c) => ({
      criterio: c,
      nota: notasPorCriterio[c],
      evidencia: "Regra automática da análise simulada",
      comentario: notasPorCriterio[c] === null ? "Não se aplica" : "Estimativa por palavras-chave",
    })),
    nota_geral: notaGeral,
    ponto_de_perda: { categoria, mensagem: null, descricao: "Estimado pelas regras da análise simulada." },
    pontos_fortes: [],
    uso_ia: usoIa,
    ligacao:
      indiceObjecao >= 0
        ? { recomendada: true, mensagem: numero(indiceObjecao), motivo: "Objeção do cliente: uma ligação ajudaria a entender o que pesa na decisão." }
        : { recomendada: false, mensagem: null, motivo: "Não foi necessária." },
    objecoes,
    perguntas_cliente: perguntas,
    melhor_mensagem: indiceMelhor >= 0 ? { mensagem: numero(indiceMelhor), por_que_funcionou: "Faz uma pergunta que faz a conversa avançar." } : null,
    dicas: dicas.slice(0, 3),
    cliente_aguarda_resposta: clienteAguarda,
    proximo_passo: fechadoOuPerdido
      ? null
      : {
          acao: m.clienteSemResposta ? "Responder o cliente" : "Retomar contato",
          mensagem_sugerida: "Oi! Separei uma opção nova que combina com o que você me falou. Posso te mandar?",
          urgencia: m.clienteSemResposta ? "alta" : "media",
        },
  };
}
