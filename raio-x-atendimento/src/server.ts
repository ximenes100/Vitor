import formbody from "@fastify/formbody";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { corrigirTipo, iniciarFila } from "./analise/fila.js";
import { config } from "./config.js";
import { migrar, query, queryOne } from "./db.js";
import * as evolution from "./evolution.js";
import { enviarResumosDiarios } from "./resumo.js";
import { sincronizarCorretor } from "./sincronizacao.js";
import { tratarEvento } from "./webhook.js";
import { telaConversa } from "./web/conversa.js";
import { telaConectar, telaPainelCorretor, type CorretorDaPagina } from "./web/corretor.js";
import { navGestor, telaCorretor, telaCorretores, telaTime } from "./web/gestor.js";
import { html, pagina } from "./web/html.js";

const app = Fastify({ logger: { level: "info" }, bodyLimit: 50 * 1024 * 1024 });
await app.register(formbody);

function enviarHtml(reply: FastifyReply, conteudo: string, status = 200) {
  return reply.code(status).type("text/html; charset=utf-8").header("cache-control", "no-store").send(conteudo);
}

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ---------- Gestor (protegido por usuário e senha) ----------

async function exigirGestor(req: FastifyRequest, reply: FastifyReply) {
  const cabecalho = req.headers.authorization ?? "";
  const [usuario, senha] = Buffer.from(cabecalho.replace(/^Basic /, ""), "base64").toString().split(":");
  if (!iguais(usuario ?? "", config.gestor.usuario) || !iguais(senha ?? "", config.gestor.senha)) {
    return reply.code(401).header("www-authenticate", 'Basic realm="Raio-X do Atendimento"').send("Acesso restrito ao gestor.");
  }
}

app.get("/", async (_req, reply) => reply.redirect("/gestor"));
app.get("/saude", async () => ({ ok: true }));

app.register(async (gestor) => {
  gestor.addHook("onRequest", exigirGestor);

  gestor.get("/gestor", async (_req, reply) => enviarHtml(reply, pagina("Visão do time", await telaTime(), { nav: navGestor })));

  gestor.get("/gestor/corretores", async (_req, reply) => enviarHtml(reply, pagina("Corretores", await telaCorretores(), { nav: navGestor })));

  gestor.post<{ Body: { nome?: string; equipe?: string } }>("/gestor/corretores", async (req, reply) => {
    const nome = (req.body.nome ?? "").trim();
    if (!nome) return reply.redirect("/gestor/corretores");
    const token = randomBytes(18).toString("base64url");
    const instancia = `corretor-${randomBytes(6).toString("hex")}`;
    await query("INSERT INTO corretores (nome, equipe, token, instancia) VALUES ($1, $2, $3, $4)", [nome, req.body.equipe?.trim() || null, token, instancia]);
    return enviarHtml(reply, pagina("Corretores", await telaCorretores({ nome, token }), { nav: navGestor }));
  });

  gestor.get<{ Params: { id: string } }>("/gestor/corretor/:id", async (req, reply) => {
    const tela = await telaCorretor(Number(req.params.id));
    if (!tela) return enviarHtml(reply, pagina("Não encontrado", html`<h1>Corretor não encontrado</h1>`, { nav: navGestor }), 404);
    return enviarHtml(reply, pagina("Corretor", tela, { nav: navGestor }));
  });

  gestor.get<{ Params: { id: string } }>("/gestor/conversa/:id", async (req, reply) => {
    const tela = await telaConversa(Number(req.params.id));
    if (!tela) return enviarHtml(reply, pagina("Não encontrada", html`<h1>Conversa não encontrada</h1>`, { nav: navGestor }), 404);
    return enviarHtml(reply, pagina(tela.titulo, tela.corpo, { nav: navGestor }));
  });

  gestor.post<{ Params: { id: string } }>("/gestor/corretor/:id/sincronizar", async (req, reply) => {
    const c = await queryOne("SELECT id, instancia FROM corretores WHERE id = $1", [Number(req.params.id)]);
    if (c) sincronizarCorretor(c).catch((e) => req.log.error(e));
    return reply.redirect(`/gestor/corretor/${req.params.id}`);
  });
});

// ---------- Corretor (acesso pelo link pessoal) ----------

async function corretorPorToken(token: string): Promise<(CorretorDaPagina & { instancia: string }) | undefined> {
  return queryOne("SELECT id, nome, token, instancia, status_conexao, telefone FROM corretores WHERE token = $1", [token]);
}

const naoEncontrado = (reply: FastifyReply) => enviarHtml(reply, pagina("Link inválido", html`<h1>Link inválido</h1><p>Peça um novo link ao seu gestor.</p>`), 404);

app.get<{ Params: { token: string }; Querystring: { reconectar?: string; aviso?: string } }>("/c/:token", async (req, reply) => {
  const c = await corretorPorToken(req.params.token);
  if (!c) return naoEncontrado(reply);
  if (c.status_conexao === "conectado" || (c.status_conexao === "desconectado" && !req.query.reconectar && (await temConversas(c.id)))) {
    return enviarHtml(reply, pagina("Meu raio-x", await telaPainelCorretor(c, req.query.aviso)));
  }
  return enviarHtml(reply, pagina("Conectar WhatsApp", telaConectar(c)));
});

async function temConversas(corretorId: number): Promise<boolean> {
  return Boolean(await queryOne("SELECT 1 FROM conversas WHERE corretor_id = $1 LIMIT 1", [corretorId]));
}

app.post<{ Params: { token: string }; Body: { aceite?: string } }>("/c/:token/conectar", async (req, reply) => {
  const c = await corretorPorToken(req.params.token);
  if (!c) return naoEncontrado(reply);
  if (req.body.aceite !== "sim") return enviarHtml(reply, pagina("Conectar WhatsApp", telaConectar(c, "Para conectar, marque que concorda com os termos.")));
  try {
    if (!(await evolution.instanciaExiste(c.instancia))) await evolution.criarInstancia(c.instancia);
    await query("UPDATE corretores SET status_conexao = 'aguardando_qr', consentimento_em = now() WHERE id = $1", [c.id]);
  } catch (e) {
    req.log.error(e);
    return enviarHtml(reply, pagina("Conectar WhatsApp", telaConectar(c, "Não foi possível iniciar a conexão agora. Tente de novo em alguns minutos ou avise o gestor.")));
  }
  return reply.redirect(`/c/${c.token}?reconectar=1`);
});

app.get<{ Params: { token: string } }>("/c/:token/qr", async (req, reply) => {
  const c = await corretorPorToken(req.params.token);
  if (!c) return reply.code(404).send({ erro: "Link inválido" });
  try {
    const estado = await evolution.estadoConexao(c.instancia);
    if (estado === "open") {
      // O webhook também avisa, mas aqui confirmamos na hora para a página atualizar.
      if (c.status_conexao !== "conectado") await tratarEvento({ event: "connection.update", instance: c.instancia, data: { state: "open" } });
      return { status: "conectado" };
    }
    return { status: "aguardando_qr", qr: await evolution.obterQrCode(c.instancia) };
  } catch (e) {
    req.log.error(e);
    return { status: "erro", erro: "Não foi possível gerar o QR Code. Tentando de novo…" };
  }
});

app.get<{ Params: { token: string; id: string } }>("/c/:token/conversa/:id", async (req, reply) => {
  const c = await corretorPorToken(req.params.token);
  if (!c) return naoEncontrado(reply);
  const tela = await telaConversa(Number(req.params.id), c.id);
  if (!tela) return enviarHtml(reply, pagina("Não encontrada", html`<h1>Conversa não encontrada</h1>`), 404);
  return enviarHtml(reply, pagina(tela.titulo, html`<p><a href="/c/${c.token}">← Voltar</a></p>${tela.corpo}`));
});

app.post<{ Params: { token: string; id: string }; Body: { tipo?: string } }>("/c/:token/conversa/:id/tipo", async (req, reply) => {
  const c = await corretorPorToken(req.params.token);
  if (!c) return naoEncontrado(reply);
  const tipo = req.body.tipo === "cliente" ? "cliente" : "pessoal";
  await corrigirTipo(c.id, Number(req.params.id), tipo);
  const aviso = tipo === "pessoal" ? "Conversa removida da análise e conteúdo apagado." : "Conversa incluída. A análise aparece em alguns minutos.";
  return reply.redirect(`/c/${c.token}?aviso=${encodeURIComponent(aviso)}`);
});

app.post<{ Params: { token: string } }>("/c/:token/desconectar", async (req, reply) => {
  const c = await corretorPorToken(req.params.token);
  if (!c) return naoEncontrado(reply);
  try {
    await evolution.desconectar(c.instancia);
  } catch (e) {
    req.log.warn(e);
  }
  await query("UPDATE corretores SET status_conexao = 'desconectado' WHERE id = $1", [c.id]);
  return reply.redirect(`/c/${c.token}?aviso=${encodeURIComponent("WhatsApp desconectado.")}`);
});

// ---------- Webhook da Evolution API ----------

app.post<{ Params: { segredo: string } }>("/webhook/evolution/:segredo", async (req, reply) => {
  if (!iguais(req.params.segredo, config.evolution.webhookSegredo)) return reply.code(404).send();
  // Responde logo e processa em seguida, para a Evolution não reenviar por timeout.
  tratarEvento(req.body).catch((e) => req.log.error({ err: e, evento: (req.body as any)?.event }, "erro ao tratar evento"));
  return { ok: true };
});

// ---------- Início ----------

await migrar();
if (config.gestor.senha === "troque-esta-senha") app.log.warn("GESTOR_SENHA está com o valor padrão: troque antes de usar com dados reais.");
if (!config.ia.ativa) app.log.warn("ANTHROPIC_API_KEY não definida: as análises serão SIMULADAS (modo demonstração).");
if (!evolution.evolutionConfigurada()) app.log.warn("EVOLUTION_URL/EVOLUTION_API_KEY não definidas: conexão com WhatsApp desativada.");

iniciarFila();
setInterval(() => enviarResumosDiarios().catch((e) => app.log.error(e)), 5 * 60_000);

await app.listen({ port: config.porta, host: "0.0.0.0" });
