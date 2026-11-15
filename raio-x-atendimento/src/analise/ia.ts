// Chamadas ao Claude: triagem, análise semanal de conversas e relatórios.
// Cada tarefa vira um "pedido" que pode ser executado na hora (chamada direta)
// ou em lote (Batch API: metade do preço, resultado em até algumas horas).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync } from "node:fs";
import type { z } from "zod";

let cliente: Anthropic | undefined;
export function anthropic(): Anthropic {
  cliente ??= new Anthropic();
  return cliente;
}

export const processoComercial = readFileSync(new URL("../../config/processo-comercial.md", import.meta.url), "utf8");

export interface Pedido<T> {
  modelo: string;
  esforco: "low" | "medium" | "high";
  maxTokens: number;
  /** Instruções fixas (iguais em todos os pedidos do mesmo tipo): ficam em cache para baratear. */
  sistema: string;
  conteudo: string;
  esquema: z.ZodType<T>;
}

// Fallback do lado do servidor: se o modelo recusar a requisição, a API tenta outro modelo automaticamente,
// na mesma chamada. Não existe para os modelos Haiku nem no processamento em lote.
function fallback(modelo: string): { betas?: Anthropic.Beta.AnthropicBeta[]; fallbacks?: "default" } {
  if (modelo.includes("haiku")) return {};
  return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
}

function verificar(stopReason: string | null): void {
  if (stopReason === "refusal") throw new Error("O modelo recusou esta análise.");
  if (stopReason === "max_tokens") throw new Error("A resposta do modelo foi cortada (max_tokens).");
}

/** Executa o pedido na hora. */
export async function executar<T>(p: Pedido<T>): Promise<T> {
  // Streaming evita timeout em entradas longas; finalMessage() devolve a resposta completa.
  const stream = anthropic().beta.messages.stream({
    model: p.modelo,
    max_tokens: p.maxTokens,
    ...fallback(p.modelo),
    output_config: { effort: p.esforco, format: betaZodOutputFormat(p.esquema) },
    system: [{ type: "text", text: p.sistema, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: p.conteudo }],
  });
  const resposta = await stream.finalMessage();
  verificar(resposta.stop_reason);
  if (!resposta.parsed_output) throw new Error("O modelo não devolveu uma resposta no formato esperado.");
  return resposta.parsed_output as T;
}

/** Converte o pedido no formato de um item de lote. */
function itemDeLote<T>(customId: string, p: Pedido<T>): Anthropic.Messages.Batches.BatchCreateParams.Request {
  const formato = zodOutputFormat(p.esquema);
  return {
    custom_id: customId,
    params: {
      model: p.modelo,
      max_tokens: p.maxTokens,
      output_config: { effort: p.esforco, format: { type: formato.type, schema: formato.schema } },
      system: [{ type: "text", text: p.sistema, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: p.conteudo }],
    },
  };
}

/** Envia vários pedidos em um lote e devolve o id do lote. */
export async function enviarLote(pedidos: { id: string; pedido: Pedido<unknown> }[]): Promise<string> {
  const lote = await anthropic().messages.batches.create({ requests: pedidos.map((p) => itemDeLote(p.id, p.pedido)) });
  return lote.id;
}

export type ResultadoLote = { id: string; ok: true; texto: string } | { id: string; ok: false; erro: string; tentarDeNovo: boolean };

/** Devolve undefined enquanto o lote ainda está processando. */
export async function resultadosDoLote(loteId: string): Promise<ResultadoLote[] | undefined> {
  const lote = await anthropic().messages.batches.retrieve(loteId);
  if (lote.processing_status !== "ended") return undefined;
  const resultados: ResultadoLote[] = [];
  for await (const r of await anthropic().messages.batches.results(loteId)) {
    const id = r.custom_id;
    if (r.result.type === "succeeded") {
      const msg = r.result.message;
      if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") {
        resultados.push({ id, ok: false, erro: `Resposta interrompida (${msg.stop_reason})`, tentarDeNovo: false });
        continue;
      }
      const texto = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      resultados.push({ id, ok: true, texto });
    } else if (r.result.type === "errored") {
      const invalido = r.result.error.error.type === "invalid_request_error";
      resultados.push({ id, ok: false, erro: `Erro no lote: ${r.result.error.error.message}`, tentarDeNovo: !invalido });
    } else {
      resultados.push({ id, ok: false, erro: `Pedido ${r.result.type}`, tentarDeNovo: true });
    }
  }
  return resultados;
}

/** Valida o texto devolvido pelo lote contra o esquema esperado. */
export function interpretar<T>(texto: string, esquema: z.ZodType<T>): T {
  return esquema.parse(JSON.parse(texto));
}

export function descricaoErroIa(e: unknown): { mensagem: string; tentarDeNovo: boolean } {
  if (e instanceof Anthropic.RateLimitError) return { mensagem: "Limite de uso da API atingido", tentarDeNovo: true };
  if (e instanceof Anthropic.AuthenticationError) return { mensagem: "Chave da Anthropic inválida", tentarDeNovo: false };
  if (e instanceof Anthropic.BadRequestError) return { mensagem: `Requisição inválida: ${e.message}`, tentarDeNovo: false };
  if (e instanceof Anthropic.APIError) return { mensagem: `Erro da API (${e.status}): ${e.message}`, tentarDeNovo: true };
  return { mensagem: e instanceof Error ? e.message : String(e), tentarDeNovo: true };
}
