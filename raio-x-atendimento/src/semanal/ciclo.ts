// Ciclo semanal. Roda de tempos em tempos e avança um passo por vez:
//   1. recebe resultados de lotes enviados
//   2. triagem das conversas novas (cliente x pessoal)
//   3. análise de cada conversa por semana (inclui a linha de base, antes do marco)
//   4. relatório de cada corretor
//   5. relatório do time
//   6. envio do relatório no WhatsApp do corretor (segunda-feira de manhã)

import { AnaliseSchema, RelatorioCorretorSchema, type Analise } from "../analise/esquema.js";
import { descricaoErroIa, enviarLote, executar, interpretar, resultadosDoLote, type Pedido } from "../analise/ia.js";
import { config } from "../config.js";
import { query, queryOne } from "../db.js";
import * as evolution from "../evolution.js";
import {
  amostraParaTriagem,
  analiseSimulada,
  conversasParaTriar,
  montarEntrada,
  paresPendentes,
  pedidoTriagem,
  registrarFalha,
  salvarAnalise,
  salvarTriagem,
  triagemSimulada,
} from "./conversas.js";
import {
  corretoresSemRelatorio,
  dadosRelatorioCorretor,
  dadosRelatorioTime,
  pedidoRelatorioCorretor,
  pedidoRelatorioTime,
  relatorioCorretorSimulado,
  relatorioTimeSimulado,
  salvarRelatorio,
} from "./relatorios.js";
import { dataLocal, semanaDe, ultimaSemanaCompleta } from "./semanas.js";

const LIMITE_LOTE = 10_000;

interface Opcoes {
  /** Semana dos relatórios (padrão: última semana completa). */
  semana?: string;
}

const modoSimulado = () => !config.ia.ativa;
const usarLote = () => config.ia.ativa && config.ia.usarLote;

async function comLimite<T>(itens: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, async () => {
      while (proximo < itens.length) await fn(itens[proximo++]);
    }),
  );
}

const idConversa = (conversaId: number, semana: string) => `c${conversaId}-${semana.replace(/-/g, "")}`;
const idRelatorio = (corretorId: number, semana: string) => `r${corretorId}-${semana.replace(/-/g, "")}`;
const lerSemana = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

// ---------- 1. Lotes ----------

async function processarLotesAbertos(): Promise<boolean> {
  const abertos = await query<{ id: string; tipo: string }>("SELECT id, tipo FROM lotes WHERE finalizado_em IS NULL ORDER BY criado_em");
  if (abertos.length === 0) return false;
  for (const lote of abertos) {
    const resultados = await resultadosDoLote(lote.id);
    if (!resultados) return true; // ainda processando: espera a próxima rodada
    let erros = 0;
    for (const r of resultados) {
      const [prefixo, data] = r.id.slice(1).split("-");
      const semana = lerSemana(data);
      try {
        if (!r.ok) throw Object.assign(new Error(r.erro), { tentarDeNovo: r.tentarDeNovo });
        if (r.id.startsWith("c")) {
          const conversaId = Number(prefixo);
          const analise = interpretar(r.texto, AnaliseSchema);
          const entrada = await montarEntrada(conversaId, semana);
          if (entrada) await salvarAnalise(conversaId, semana, analise, config.ia.modeloAnalise, entrada.metricas, entrada.primeiraMensagem);
        } else {
          const relatorio = interpretar(r.texto, RelatorioCorretorSchema);
          await salvarRelatorio(semana, Number(prefixo), config.ia.modeloRelatorio, relatorio, null);
        }
      } catch (e) {
        erros++;
        const definitiva = (e as any)?.tentarDeNovo === false || e instanceof SyntaxError;
        console.error(`[lote ${lote.id}] ${r.id}: ${(e as Error).message}`);
        if (r.id.startsWith("c")) await registrarFalha(Number(prefixo), semana, (e as Error).message, definitiva);
      }
    }
    await query("UPDATE lotes SET finalizado_em = now(), erros = $2 WHERE id = $1", [lote.id, erros]);
    console.log(`[lote ${lote.id}] concluído: ${resultados.length - erros} ok, ${erros} com erro`);
  }
  return true;
}

// ---------- 2. Triagem ----------

async function triar(): Promise<number> {
  const conversas = await conversasParaTriar(300);
  await comLimite(conversas, config.ia.concorrencia, async (c) => {
    const amostra = await amostraParaTriagem(c.id);
    try {
      const triagem = modoSimulado() ? triagemSimulada(amostra) : await executar(pedidoTriagem(amostra, { cliente: c.nome_contato, corretor: c.corretor_nome }));
      await salvarTriagem(c.id, triagem.tipo);
    } catch (e) {
      const { mensagem } = descricaoErroIa(e);
      console.error(`[triagem] conversa ${c.id}: ${mensagem}`);
      await query("UPDATE conversas SET erro_analise = $2 WHERE id = $1", [c.id, mensagem]);
    }
  });
  return conversas.length;
}

// ---------- 3. Análise das conversas ----------

async function analisarConversas(semana: string): Promise<number> {
  const pares = await paresPendentes(semana, usarLote() ? LIMITE_LOTE : 200);
  if (pares.length === 0) return 0;

  if (usarLote()) {
    const pedidos: { id: string; pedido: Pedido<unknown> }[] = [];
    for (const p of pares) {
      const entrada = await montarEntrada(p.conversa_id, p.semana);
      if (entrada) pedidos.push({ id: idConversa(p.conversa_id, p.semana), pedido: entrada.pedido as Pedido<unknown> });
    }
    if (pedidos.length === 0) return 0;
    const id = await enviarLote(pedidos);
    await query("INSERT INTO lotes (id, tipo, semana, pedidos) VALUES ($1, 'conversas', $2, $3)", [id, semana, pedidos.length]);
    console.log(`[análise] lote ${id} enviado com ${pedidos.length} conversa(s)-semana`);
    return pedidos.length;
  }

  await comLimite(pares, config.ia.concorrencia, async (p) => {
    const entrada = await montarEntrada(p.conversa_id, p.semana);
    if (!entrada) {
      await registrarFalha(p.conversa_id, p.semana, "Sem mensagens na semana", true);
      return;
    }
    try {
      const analise: Analise = modoSimulado() ? analiseSimulada(entrada) : await executar(entrada.pedido);
      await salvarAnalise(p.conversa_id, p.semana, analise, modoSimulado() ? "simulada" : config.ia.modeloAnalise, entrada.metricas, entrada.primeiraMensagem);
    } catch (e) {
      const { mensagem, tentarDeNovo } = descricaoErroIa(e);
      console.error(`[análise] conversa ${p.conversa_id}, semana ${p.semana}: ${mensagem}`);
      await registrarFalha(p.conversa_id, p.semana, mensagem, !tentarDeNovo);
    }
  });
  return pares.length;
}

// ---------- 4 e 5. Relatórios ----------

async function relatoriosDosCorretores(semana: string): Promise<number> {
  const ids = await corretoresSemRelatorio(semana);
  if (ids.length === 0) return 0;

  if (usarLote()) {
    const pedidos: { id: string; pedido: Pedido<unknown> }[] = [];
    for (const id of ids) {
      const dados = await dadosRelatorioCorretor(id, semana);
      if (dados) pedidos.push({ id: idRelatorio(id, semana), pedido: pedidoRelatorioCorretor(dados) as Pedido<unknown> });
    }
    const loteId = await enviarLote(pedidos);
    await query("INSERT INTO lotes (id, tipo, semana, pedidos) VALUES ($1, 'relatorios_corretor', $2, $3)", [loteId, semana, pedidos.length]);
    console.log(`[relatórios] lote ${loteId} enviado com ${pedidos.length} relatório(s)`);
    return pedidos.length;
  }

  await comLimite(ids, config.ia.concorrencia, async (id) => {
    const dados = await dadosRelatorioCorretor(id, semana);
    if (!dados) return;
    try {
      const relatorio = modoSimulado() ? relatorioCorretorSimulado(dados) : await executar(pedidoRelatorioCorretor(dados));
      await salvarRelatorio(semana, id, modoSimulado() ? "simulada" : config.ia.modeloRelatorio, relatorio, null);
    } catch (e) {
      console.error(`[relatórios] corretor ${id}: ${descricaoErroIa(e).mensagem}`);
    }
  });
  return ids.length;
}

async function relatorioDoTime(semana: string): Promise<boolean> {
  const existe = await queryOne("SELECT 1 FROM relatorios WHERE semana = $1::date AND corretor_id IS NULL", [semana]);
  const temAnalises = await queryOne("SELECT 1 FROM analises WHERE semana = $1::date LIMIT 1", [semana]);
  if (existe || !temAnalises) return false;
  const dados = await dadosRelatorioTime(semana);
  const relatorio = modoSimulado() ? relatorioTimeSimulado(dados) : await executar(pedidoRelatorioTime(dados));
  await salvarRelatorio(semana, null, modoSimulado() ? "simulada" : config.ia.modeloRelatorio, relatorio, {
    antes: dados.antes,
    depois: dados.depois,
    semana: dados.daSemana,
    evolucao: dados.evolucao,
  });
  console.log(`[relatórios] relatório do time da semana ${semana} pronto`);
  return true;
}

// ---------- 6. Envio ----------

function horaLocal(): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: config.fuso, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
}

/** Envia o relatório semanal no WhatsApp do corretor (na conversa "Você", com ele mesmo). */
export async function enviarRelatoriosSemanais(): Promise<number> {
  if (!evolution.evolutionConfigurada()) return 0;
  // Só a partir da hora configurada da segunda-feira (ou depois, se os relatórios atrasarem).
  if (semanaDe(new Date()) === dataLocal(new Date()) && horaLocal() < config.relatorioSemanalHora) return 0;
  const pendentes = await query<{ id: number; instancia: string; telefone: string; token: string; mensagem: string }>(
    `SELECT r.id, k.instancia, k.telefone, k.token, r.conteudo->>'mensagem_whatsapp' AS mensagem
     FROM relatorios r JOIN corretores k ON k.id = r.corretor_id
     WHERE r.enviado_em IS NULL AND r.semana >= $1::date AND k.status_conexao = 'conectado' AND k.receber_resumo AND k.telefone IS NOT NULL`,
    [ultimaSemanaCompleta()],
  );
  let enviados = 0;
  for (const p of pendentes) {
    try {
      await evolution.enviarTexto(p.instancia, p.telefone, `${p.mensagem}\n\nRelatório completo: ${config.urlPublica}/c/${p.token}`);
      enviados++;
    } catch (e) {
      console.error(`[envio] relatório ${p.id}:`, (e as Error).message);
    }
    await query("UPDATE relatorios SET enviado_em = now() WHERE id = $1", [p.id]);
  }
  return enviados;
}

// ---------- Orquestração ----------

/** Avança um passo do ciclo e descreve o que fez. */
export async function avancarCiclo(opcoes: Opcoes = {}): Promise<string> {
  const semana = opcoes.semana ?? ultimaSemanaCompleta();
  if (await processarLotesAbertos()) return "lotes";
  const triadas = await triar();
  if (triadas) return `triagem de ${triadas} conversa(s)`;
  const analisadas = await analisarConversas(semana);
  if (analisadas) return `análise de ${analisadas} conversa(s)-semana`;
  const relatorios = await relatoriosDosCorretores(semana);
  if (relatorios) return `${relatorios} relatório(s) de corretor`;
  if (await relatorioDoTime(semana)) return "relatório do time";
  const enviados = await enviarRelatoriosSemanais();
  return enviados ? `${enviados} relatório(s) enviado(s)` : "nada a fazer";
}

let rodando = false;
export function iniciarCiclo(intervaloMs = 5 * 60_000): NodeJS.Timeout {
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      // Vários passos por rodada, até não haver mais nada ou ficar esperando um lote.
      for (let i = 0; i < 20; i++) {
        const feito = await avancarCiclo();
        if (feito === "nada a fazer" || feito === "lotes") break;
        console.log(`[ciclo] ${feito}`);
      }
    } catch (e) {
      console.error("[ciclo] erro:", e);
    } finally {
      rodando = false;
    }
  };
  setTimeout(rodar, 10_000).unref();
  return setInterval(rodar, intervaloMs);
}
