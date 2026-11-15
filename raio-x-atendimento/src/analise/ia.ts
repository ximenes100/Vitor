// Análise das conversas com Claude.
// Duas etapas para economizar: (1) triagem barata decide se a conversa é de cliente;
// (2) só conversas de cliente recebem a análise completa.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { readFileSync } from "node:fs";
import { config } from "../config.js";
import type { Metricas } from "../metricas.js";
import { formatarMinutos } from "../metricas.js";
import { AnaliseSchema, TriagemSchema, type Analise, type Triagem } from "./esquema.js";

let cliente: Anthropic | undefined;
function anthropic(): Anthropic {
  cliente ??= new Anthropic();
  return cliente;
}

// Fallback do lado do servidor: se um modelo recusar a requisição, a API tenta o modelo indicado
// automaticamente, na mesma chamada. Remova estas duas linhas se não quiser esse comportamento.
const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

const processoComercial = readFileSync(new URL("../../config/processo-comercial.md", import.meta.url), "utf8");

// Texto fixo (não muda entre conversas) para aproveitar o cache de prompt da API.
const SISTEMA_ANALISE = `Você é um gestor comercial experiente do mercado imobiliário brasileiro e faz a revisão de atendimentos de corretores pelo WhatsApp.
Seu objetivo é ajudar o corretor a converter mais: apontar com precisão onde a conversa travou e o que ele pode fazer melhor, com exemplos práticos.

Como avaliar:
- Use o processo comercial da imobiliária abaixo como referência do que é um bom atendimento.
- Baseie cada nota em mensagens concretas da conversa e cite-as pelo número (#12). Não invente fatos que não estão na conversa.
- As métricas de tempo de resposta foram calculadas pelo sistema e são confiáveis; use-as no critério de velocidade.
- O conteúdo de áudios, fotos e documentos não está disponível (aparece como [áudio], [foto] etc.). Não penalize o que não dá para ver; considere apenas o efeito visível na conversa.
- Dados pessoais foram mascarados ([cliente], [corretor], [telefone]...). Isso é proposital; não comente.
- Seja direto e construtivo, como um bom gestor. As dicas e mensagens de exemplo devem estar em português do Brasil, no tom natural de WhatsApp, prontas para usar.
- Notas: 0-3 ruim, 4-6 regular, 7-8 bom, 9-10 excelente. Use null quando o critério não se aplica (ex.: objeções em uma conversa sem objeções).

<processo_comercial>
${processoComercial}
</processo_comercial>`;

const SISTEMA_TRIAGEM = `Você classifica conversas de WhatsApp do celular de um corretor de imóveis.
Responda se a conversa é um atendimento a cliente/lead imobiliário, uma conversa pessoal, ou outro contato profissional (colegas, parceiros, fornecedores, proprietários).
Na dúvida entre cliente e outro, escolha cliente se a pessoa demonstra interesse em comprar, alugar ou investir em um imóvel.`;

function verificarResposta<T>(resposta: { stop_reason: string | null; parsed_output?: T | null }): NonNullable<T> {
  if (resposta.stop_reason === "refusal") throw new Error("O modelo recusou analisar esta conversa.");
  if (resposta.stop_reason === "max_tokens") throw new Error("A resposta do modelo foi cortada (max_tokens).");
  if (!resposta.parsed_output) throw new Error("O modelo não devolveu uma resposta no formato esperado.");
  return resposta.parsed_output;
}

export async function triarComIa(amostra: string): Promise<Triagem> {
  const resposta = await anthropic().beta.messages.parse({
    model: config.ia.modeloTriagem,
    max_tokens: 2000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(TriagemSchema) },
    system: SISTEMA_TRIAGEM,
    messages: [{ role: "user", content: `Trecho da conversa:\n\n${amostra}` }],
  });
  return verificarResposta(resposta);
}

export interface EntradaAnalise {
  transcricao: string;
  metricas: Metricas;
  totalMensagens: number;
  mensagensOmitidas: number;
  etiquetaAtual: string | null;
  agora: string;
}

export async function analisarComIa(entrada: EntradaAnalise): Promise<Analise> {
  const m = entrada.metricas;
  const contexto = [
    `Data e hora atual: ${entrada.agora}`,
    `Etiqueta atual no WhatsApp: ${entrada.etiquetaAtual ?? "nenhuma"}`,
    `Mensagens: ${m.totalMensagens} (cliente ${m.mensagensCliente}, corretor ${m.mensagensCorretor}). Quem iniciou: ${m.quemIniciou ?? "—"}.`,
    `Primeira resposta do corretor: ${formatarMinutos(m.primeiraRespostaMin)}. Tempo de resposta mediano: ${formatarMinutos(m.respostaMedianaMin)}; 90% das respostas em até ${formatarMinutos(m.respostaP90Min)}. Esperas acima de 24h: ${m.esperasAcimaDe24h}.`,
    `Cliente aguardando resposta agora: ${m.clienteSemResposta ? "sim" : "não"}. Horas desde a última mensagem: ${m.horasDesdeUltimaMensagem ?? "—"}. Tentativas do corretor sem retorno no fim da conversa: ${m.tentativasSemRetorno}.`,
    `Áudios do corretor: ${m.percentualAudiosCorretor}% das mensagens dele.`,
    entrada.mensagensOmitidas > 0
      ? `ATENÇÃO: a conversa é longa; as primeiras ${entrada.mensagensOmitidas} de ${entrada.totalMensagens} mensagens foram omitidas. Avalie o trecho abaixo e não tire conclusões sobre o início.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Streaming evita timeout em conversas longas; finalMessage() devolve a resposta completa.
  const stream = anthropic().beta.messages.stream({
    model: config.ia.modeloAnalise,
    max_tokens: 32000,
    ...FALLBACK,
    output_config: { effort: "high", format: betaZodOutputFormat(AnaliseSchema) },
    system: [{ type: "text", text: SISTEMA_ANALISE, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `<metricas>\n${contexto}\n</metricas>\n\n<conversa>\n${entrada.transcricao}\n</conversa>\n\nAnalise este atendimento.`,
      },
    ],
  });
  const resposta = await stream.finalMessage();
  return verificarResposta(resposta);
}

export function descricaoErroIa(e: unknown): { mensagem: string; tentarDeNovo: boolean } {
  if (e instanceof Anthropic.RateLimitError) return { mensagem: "Limite de uso da API atingido", tentarDeNovo: true };
  if (e instanceof Anthropic.AuthenticationError) return { mensagem: "Chave da Anthropic inválida", tentarDeNovo: false };
  if (e instanceof Anthropic.BadRequestError) return { mensagem: `Requisição inválida: ${e.message}`, tentarDeNovo: false };
  if (e instanceof Anthropic.APIError) return { mensagem: `Erro da API (${e.status}): ${e.message}`, tentarDeNovo: true };
  return { mensagem: e instanceof Error ? e.message : String(e), tentarDeNovo: true };
}
