// Sincroniza as etiquetas do WhatsApp Business com o funil.
// - A IA define a etapa e o sistema aplica a etiqueta no WhatsApp do corretor.
// - Se o corretor trocar a etiqueta à mão, a escolha dele vale e a IA deixa de mexer naquela conversa.

import { query, queryOne } from "./db.js";
import * as evolution from "./evolution.js";
import { ETAPAS, ETIQUETA_DA_ETAPA, ETIQUETA_PESSOAL, ehEtiquetaPessoal, etapaPorNomeDeEtiqueta, normalizarNome, type Etapa } from "./funil.js";

// Mudanças feitas pelo próprio sistema voltam pelo webhook; guardamos para não confundir com mudança manual.
const mudancasAutomaticas = new Map<string, number>();
const chaveMudanca = (corretorId: number, jid: string, labelId: string, acao: string) => `${corretorId}|${jid}|${labelId}|${acao}`;

function registrarMudancaAutomatica(chave: string) {
  mudancasAutomaticas.set(chave, Date.now() + 5 * 60_000);
  for (const [k, expira] of mudancasAutomaticas) if (expira < Date.now()) mudancasAutomaticas.delete(k);
}

export async function salvarEtiquetas(corretorId: number, etiquetas: { id: string; nome: string; cor?: string }[]): Promise<void> {
  await query("DELETE FROM etiquetas WHERE corretor_id = $1", [corretorId]);
  for (const e of etiquetas) {
    await query("INSERT INTO etiquetas (corretor_id, label_id, nome, cor) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [corretorId, e.id, e.nome, e.cor ?? null]);
  }
}

export async function etiquetasDoCorretor(corretorId: number): Promise<{ label_id: string; nome: string }[]> {
  return query("SELECT label_id, nome FROM etiquetas WHERE corretor_id = $1", [corretorId]);
}

/** Quais etiquetas do funil ainda não existem no WhatsApp do corretor. */
export async function etiquetasFaltando(corretorId: number): Promise<string[]> {
  const existentes = new Set((await etiquetasDoCorretor(corretorId)).map((e) => normalizarNome(e.nome)));
  return [...ETAPAS.map((e) => ETIQUETA_DA_ETAPA[e]), ETIQUETA_PESSOAL].filter((nome) => !existentes.has(normalizarNome(nome)));
}

/** Aplica no WhatsApp a etiqueta da etapa e remove as outras etiquetas de funil. */
export async function aplicarEtapaNoWhatsapp(corretorId: number, instancia: string, remoteJid: string, etapa: Etapa): Promise<boolean> {
  if (!evolution.evolutionConfigurada()) return false;
  const etiquetas = await etiquetasDoCorretor(corretorId);
  const alvo = etiquetas.find((e) => etapaPorNomeDeEtiqueta(e.nome) === etapa);
  if (!alvo) return false; // etiqueta não criada no app: aparece no checklist do corretor

  const conversa = await queryOne<{ etiquetas: string[] }>("SELECT etiquetas FROM conversas WHERE corretor_id = $1 AND remote_jid = $2", [corretorId, remoteJid]);
  const atuais = new Set(conversa?.etiquetas ?? []);
  const doFunil = etiquetas.filter((e) => etapaPorNomeDeEtiqueta(e.nome));

  for (const e of doFunil) {
    if (e.label_id !== alvo.label_id && atuais.has(e.label_id)) {
      registrarMudancaAutomatica(chaveMudanca(corretorId, remoteJid, e.label_id, "remove"));
      await evolution.alterarEtiqueta(instancia, remoteJid, e.label_id, "remove");
      atuais.delete(e.label_id);
    }
  }
  if (!atuais.has(alvo.label_id)) {
    registrarMudancaAutomatica(chaveMudanca(corretorId, remoteJid, alvo.label_id, "add"));
    await evolution.alterarEtiqueta(instancia, remoteJid, alvo.label_id, "add");
    atuais.add(alvo.label_id);
  }
  await query("UPDATE conversas SET etiquetas = $3 WHERE corretor_id = $1 AND remote_jid = $2", [corretorId, remoteJid, [...atuais]]);
  return true;
}

/** Trata a mudança de etiqueta que chegou pelo webhook (feita no celular ou pelo próprio sistema). */
export async function registrarAssociacao(corretorId: number, remoteJid: string, labelId: string, acao: "add" | "remove"): Promise<void> {
  const conversa = await queryOne<{ id: number; etiquetas: string[] }>("SELECT id, etiquetas FROM conversas WHERE corretor_id = $1 AND remote_jid = $2", [corretorId, remoteJid]);
  if (!conversa) return;
  const atuais = new Set(conversa.etiquetas);
  if (acao === "add") atuais.add(labelId);
  else atuais.delete(labelId);
  await query("UPDATE conversas SET etiquetas = $2 WHERE id = $1", [conversa.id, [...atuais]]);

  const chave = chaveMudanca(corretorId, remoteJid, labelId, acao);
  if (mudancasAutomaticas.has(chave)) {
    mudancasAutomaticas.delete(chave);
    return;
  }
  if (acao !== "add") return;

  // Mudança manual do corretor: a escolha dele prevalece.
  const etiqueta = await queryOne<{ nome: string }>("SELECT nome FROM etiquetas WHERE corretor_id = $1 AND label_id = $2", [corretorId, labelId]);
  if (!etiqueta) return;
  if (ehEtiquetaPessoal(etiqueta.nome)) {
    await query("UPDATE conversas SET tipo = 'pessoal' WHERE id = $1", [conversa.id]);
    return;
  }
  const etapa = etapaPorNomeDeEtiqueta(etiqueta.nome);
  if (etapa) await query("UPDATE conversas SET etapa = $2, etapa_manual = TRUE, tipo = 'cliente' WHERE id = $1", [conversa.id, etapa]);
}
