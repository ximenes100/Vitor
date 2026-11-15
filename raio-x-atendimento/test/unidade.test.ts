import assert from "node:assert/strict";
import { test } from "node:test";
import { anonimizar } from "../src/anonimizar.js";
import { etapaPorNomeDeEtiqueta } from "../src/funil.js";
import { jidDoContato, normalizarMensagem } from "../src/ingestao.js";
import { calcularMetricas } from "../src/metricas.js";

const t0 = new Date("2026-11-10T12:00:00Z").getTime();
const msg = (min: number, doCorretor: boolean, texto = "x", tipo = "texto") => ({
  do_corretor: doCorretor,
  tipo,
  texto,
  enviada_em: new Date(t0 + min * 60_000),
});

test("métricas: tempos de resposta por bloco de mensagens do cliente", () => {
  const m = calcularMetricas(
    [msg(0, false), msg(2, false), msg(10, true), msg(100, false), msg(160, true), msg(161, true)],
    new Date(t0 + 200 * 60_000),
  );
  assert.equal(m.quemIniciou, "cliente");
  assert.equal(m.primeiraRespostaMin, 10);
  assert.equal(m.respostaMedianaMin, 10);
  assert.equal(m.respostaP90Min, 60);
  assert.equal(m.clienteSemResposta, false);
  assert.equal(m.tentativasSemRetorno, 1);
});

test("métricas: cliente aguardando e follow-ups sem retorno", () => {
  const semResposta = calcularMetricas([msg(0, true), msg(5, false)], new Date(t0 + 30 * 3600_000));
  assert.equal(semResposta.clienteSemResposta, true);
  assert.equal(semResposta.horasDesdeUltimaMensagem, 30);

  const followups = calcularMetricas([msg(0, false), msg(5, true), msg(5 + 3 * 1440, true), msg(5 + 7 * 1440, true)]);
  assert.equal(followups.tentativasSemRetorno, 3);
});

test("métricas: percentual de áudios do corretor", () => {
  const m = calcularMetricas([msg(0, false), msg(1, true, "", "audio"), msg(2, true, "", "audio"), msg(3, true, "ok")]);
  assert.equal(m.percentualAudiosCorretor, 67);
});

test("anonimização mascara contatos, documentos e nomes", () => {
  const saida = anonimizar("Oi Maria Souza! Meu cel é (11) 98765-4321, email maria@ex.com, CPF 123.456.789-09. Abs, João", {
    cliente: "Maria Souza",
    corretor: "João Pedro",
  });
  assert.equal(saida, "Oi [cliente]! Meu cel é [telefone], email [email], CPF [cpf]. Abs, [corretor]");
});

test("anonimização não estraga valores de imóveis", () => {
  assert.equal(anonimizar("Fica R$ 850.000 ou 850 mil, condomínio 980"), "Fica R$ 850.000 ou 850 mil, condomínio 980");
});

test("normaliza mensagem de texto do webhook", () => {
  const m = normalizarMensagem({
    key: { remoteJid: "5511999990000@s.whatsapp.net", fromMe: false, id: "X1" },
    pushName: "Cliente",
    message: { extendedTextMessage: { text: "Olá" } },
    messageTimestamp: 1794700000,
  });
  assert.deepEqual(m, {
    id: "X1",
    remoteJid: "5511999990000@s.whatsapp.net",
    doCorretor: false,
    tipo: "texto",
    texto: "Olá",
    enviadaEm: new Date(1794700000 * 1000),
    nomeContato: "Cliente",
  });
});

test("ignora grupos, reações e prefere o número quando o contato vem como @lid", () => {
  assert.equal(normalizarMensagem({ key: { remoteJid: "123@g.us", id: "1" }, message: { conversation: "oi" }, messageTimestamp: 1 }), undefined);
  assert.equal(
    normalizarMensagem({ key: { remoteJid: "55119@s.whatsapp.net", id: "2" }, message: { reactionMessage: {} }, messageType: "reactionMessage", messageTimestamp: 1 }),
    undefined,
  );
  assert.equal(jidDoContato({ remoteJid: "9988@lid", remoteJidAlt: "5511@s.whatsapp.net" }), "5511@s.whatsapp.net");
  const audio = normalizarMensagem({ key: { remoteJid: "55119@s.whatsapp.net", id: "3", fromMe: true }, message: { audioMessage: {} }, messageTimestamp: 5 });
  assert.equal(audio?.tipo, "audio");
  assert.equal(audio?.doCorretor, true);
});

test("reconhece etiquetas do funil ignorando acentos, maiúsculas e emojis", () => {
  assert.equal(etapaPorNomeDeEtiqueta("🟣 VISITA AGENDADA"), "visita_agendada");
  assert.equal(etapaPorNomeDeEtiqueta("Lead Novo"), "lead_novo");
  assert.equal(etapaPorNomeDeEtiqueta("Novo pedido"), undefined);
});

test("semanas: segunda-feira, semana anterior completa e período em relação ao marco", async () => {
  const { inicioDaSemana, ultimaSemanaCompleta, periodoDaSemana, semanaDe, limitesDaSemana } = await import("../src/semanal/semanas.js");
  assert.equal(inicioDaSemana("2026-11-15"), "2026-11-09"); // domingo -> segunda anterior
  assert.equal(inicioDaSemana("2026-11-09"), "2026-11-09");
  assert.equal(ultimaSemanaCompleta(new Date("2026-11-15T15:00:00Z")), "2026-11-02");
  // Domingo 23h30 em Brasília ainda é a mesma semana (02h30 UTC de segunda).
  assert.equal(semanaDe(new Date("2026-11-16T02:30:00Z")), "2026-11-09");
  assert.equal(periodoDaSemana("2026-10-26", "2026-11-01"), "antes");
  assert.equal(periodoDaSemana("2026-11-02", "2026-11-01"), "depois");
  assert.equal(limitesDaSemana("2026-11-09").inicio.toISOString(), "2026-11-09T03:00:00.000Z");
});

test("tendência só muda com diferença de pelo menos meio ponto", async () => {
  const { tendencia } = await import("../src/semanal/estatisticas.js");
  assert.equal(tendencia(5, 5.4), "estavel");
  assert.equal(tendencia(5, 5.5), "melhorando");
  assert.equal(tendencia(6, 5.4), "piorando");
  assert.equal(tendencia(null, 6), "sem_dados");
});
