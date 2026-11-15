// Cria dados de demonstração (corretores e conversas fictícias) e roda a análise.
// Uso: npm run demo   (apaga e recria apenas os corretores de demonstração)
// Sem ANTHROPIC_API_KEY a análise é simulada; com a chave, é a análise real com IA.

import { randomBytes } from "node:crypto";
import { processarFila } from "../analise/fila.js";
import { config } from "../config.js";
import { migrar, pool, query } from "../db.js";
import { ETAPAS, ETIQUETA_DA_ETAPA, ETIQUETA_PESSOAL } from "../funil.js";
import { salvarMensagens, type MensagemNormalizada } from "../ingestao.js";

type Fala = [minutosDepois: number, quem: "c" | "k", texto: string, tipo?: string];

const HORA = 60;
const DIA = 24 * HORA;

// Roteiros fictícios. "k" = corretor, "c" = cliente. O tempo é contado em minutos a partir do início da conversa.
const ROTEIROS: Record<string, { cliente: string; diasAtras: number; falas: Fala[] }> = {
  bom_atendimento: {
    cliente: "Fernanda Lima",
    diasAtras: 6,
    falas: [
      [0, "c", "Oi, vi o anúncio do apartamento de 3 quartos no Jardim Botânico no portal. Ainda está disponível?"],
      [3, "k", "Oi Fernanda, boa tarde! Aqui é o Rafael, da Imobiliária. Está disponível sim 😊 Pra eu te ajudar melhor: você procura pra morar ou investir?"],
      [10, "c", "Pra morar. Somos eu, meu marido e duas crianças"],
      [12, "k", "Que legal! E o que não pode faltar no novo apê? Hoje vocês moram onde e o que está incomodando?"],
      [25, "c", "Moramos de aluguel em um 2 quartos, ficou pequeno. Precisa de 2 vagas e ser perto de escola"],
      [27, "k", "Entendi. E qual faixa de valor vocês estão pensando? Vão usar financiamento ou FGTS?"],
      [40, "c", "Até uns 850 mil. Vamos financiar e usar o FGTS na entrada"],
      [42, "k", "Perfeito. Esse do anúncio tem 2 vagas e fica a 400m de uma escola. Separei mais duas opções na mesma faixa que combinam com o que você falou. Que tal conhecer pessoalmente? Consigo quinta às 18h ou sábado às 10h"],
      [60, "c", "Sábado às 10h é ótimo!"],
      [62, "k", "Combinado! Visita confirmada sábado às 10h. Te mando a localização na sexta pra confirmar 👍"],
      [3 * DIA, "k", "Oi Fernanda! Passando pra confirmar nossa visita amanhã às 10h. Te espero na portaria"],
      [3 * DIA + 30, "c", "Confirmado, nos vemos lá!"],
    ],
  },
  sem_qualificacao: {
    cliente: "Marcos Paulo",
    diasAtras: 12,
    falas: [
      [0, "c", "Boa noite, quero saber de apartamentos na zona sul"],
      [9 * HORA, "k", "Bom dia"],
      [9 * HORA + 1, "k", "Segue algumas opções"],
      [9 * HORA + 2, "k", "https://portal.exemplo/imovel/111", "texto"],
      [9 * HORA + 2, "k", "https://portal.exemplo/imovel/222", "texto"],
      [9 * HORA + 3, "k", "https://portal.exemplo/imovel/333", "texto"],
      [9 * HORA + 3, "k", "https://portal.exemplo/imovel/444", "texto"],
      [11 * HORA, "c", "Esses são muito caros pra mim"],
      [20 * HORA, "k", "Tenho outros, vou ver e te mando"],
      [4 * DIA, "k", "E aí, alguma novidade?"],
      [9 * DIA, "k", "Oi Marcos, ainda procurando?"],
    ],
  },
  objecao_preco: {
    cliente: "Juliana Costa",
    diasAtras: 9,
    falas: [
      [0, "c", "Olá! Quero mais informações da casa no condomínio Reserva Verde"],
      [15, "k", "Oi Juliana! Claro. A casa tem 4 quartos, 280m2, piscina e está por R$ 1.450.000. Você procura pra morar?"],
      [40, "c", "Sim, pra morar. Qual o valor do condomínio?"],
      [45, "k", "R$ 980 por mês. Quer agendar uma visita?"],
      [2 * HORA, "c", "Achei caro, está acima do que eu pensava. Vou pensar e falar com meu marido"],
      [2 * HORA + 5, "k", "Ok, qualquer coisa me chama!"],
    ],
  },
  cliente_esperando: {
    cliente: "Roberto Alves",
    diasAtras: 3,
    falas: [
      [0, "k", "Oi Roberto, tudo bem? Aqui é da imobiliária, você pediu informações sobre locação de sala comercial"],
      [30, "c", "Oi, isso. Preciso de uma sala de uns 40m2 no centro, até 3 mil de aluguel"],
      [35, "k", "Tenho duas opções ótimas, vou te mandar"],
      [40, "k", "", "imagem"],
      [41, "k", "", "imagem"],
      [42, "k", "Essa fica na Av. Principal, 42m2, R$ 2.800. A outra 38m2, R$ 2.500"],
      [2 * HORA, "c", "Gostei da primeira. Dá pra visitar amanhã? E aceita fiador ou só seguro fiança?"],
    ],
  },
  fechou: {
    cliente: "Patrícia Gomes",
    diasAtras: 20,
    falas: [
      [0, "c", "Boa tarde, ainda tem o apartamento de 2 quartos no Centro para venda?"],
      [5, "k", "Boa tarde Patrícia! Tem sim. Me conta: é para morar ou investir? E qual região você prefere?"],
      [20, "c", "Investir, quero alugar depois. Centro mesmo, até 400 mil à vista"],
      [25, "k", "Ótimo perfil. Esse rende em média R$ 2.200 de aluguel. Posso te mostrar amanhã às 17h?"],
      [40, "c", "Pode ser"],
      [2 * DIA, "c", "Gostei muito do apartamento. Quero fazer uma proposta de 370 mil"],
      [2 * DIA + 20, "k", "Excelente! Vou levar sua proposta ao proprietário agora e te retorno até amanhã"],
      [3 * DIA, "k", "Patrícia, o proprietário aceitou 380 mil à vista. Fechamos?"],
      [3 * DIA + 60, "c", "Fechado!"],
      [6 * DIA, "k", "Contrato assinado! Parabéns pela compra, Patrícia 🎉"],
    ],
  },
  audio_demais: {
    cliente: "Lucas Martins",
    diasAtras: 5,
    falas: [
      [0, "c", "Oi, tem apartamento para alugar perto da faculdade?"],
      [50, "k", "", "audio"],
      [52, "k", "", "audio"],
      [55, "k", "", "audio"],
      [3 * HORA, "c", "Não consigo ouvir áudio agora, pode escrever?"],
      [26 * HORA, "k", "", "audio"],
    ],
  },
  pessoal: {
    cliente: "Mãe",
    diasAtras: 1,
    falas: [
      [0, "c", "Filho, vem almoçar domingo?"],
      [10, "k", "Vou sim mãe! Levo a sobremesa"],
      [12, "c", "Combinado, beijos"],
    ],
  },
};

const CORRETORES: { nome: string; equipe: string; roteiros: string[] }[] = [
  { nome: "Rafael Souza", equipe: "Equipe Zona Sul", roteiros: ["bom_atendimento", "fechou", "cliente_esperando", "pessoal"] },
  { nome: "Camila Ribeiro", equipe: "Equipe Zona Sul", roteiros: ["sem_qualificacao", "objecao_preco", "audio_demais", "pessoal"] },
  { nome: "Diego Fernandes", equipe: "Equipe Centro", roteiros: ["objecao_preco", "sem_qualificacao", "cliente_esperando", "bom_atendimento"] },
];

await migrar();
await query("DELETE FROM corretores WHERE instancia LIKE 'demo-%'");

let telefone = 11_90000_0000;
for (const [i, c] of CORRETORES.entries()) {
  const token = `demo-${i + 1}-${randomBytes(6).toString("base64url")}`;
  const [{ id }] = await query<{ id: number }>(
    `INSERT INTO corretores (nome, equipe, token, instancia, status_conexao, conectado_em, telefone, consentimento_em)
     VALUES ($1, $2, $3, $4, 'conectado', now(), $5, now()) RETURNING id`,
    [c.nome, c.equipe, token, `demo-${i + 1}`, `55${11_99000_0000 + i}`],
  );
  // Etiquetas como se o corretor tivesse criado no WhatsApp Business (a última fica faltando, para mostrar o aviso).
  const nomes = [...ETAPAS.map((e) => ETIQUETA_DA_ETAPA[e]), ETIQUETA_PESSOAL];
  for (const [j, nome] of nomes.entries()) {
    if (i === 1 && j === nomes.length - 1) continue;
    await query("INSERT INTO etiquetas (corretor_id, label_id, nome) VALUES ($1, $2, $3)", [id, String(j + 1), nome]);
  }

  for (const chave of c.roteiros) {
    const r = ROTEIROS[chave];
    const jid = `55${telefone++}@s.whatsapp.net`;
    const inicio = Date.now() - r.diasAtras * DIA * 60_000;
    const msgs: MensagemNormalizada[] = r.falas.map(([min, quem, texto, tipo], n) => ({
      id: `${chave}-${i}-${n}`,
      remoteJid: jid,
      doCorretor: quem === "k",
      tipo: tipo ?? "texto",
      texto: texto || null,
      enviadaEm: new Date(inicio + min * 60_000),
      nomeContato: quem === "c" ? r.cliente : undefined,
    }));
    await salvarMensagens(id, msgs);
  }
  console.log(`Corretor de demonstração: ${c.nome} -> ${config.urlPublica}/c/${token}`);
}

console.log(config.ia.ativa ? "Analisando com IA (pode levar alguns minutos)…" : "Sem ANTHROPIC_API_KEY: rodando a análise SIMULADA.");
let total = 0;
for (let rodada = 0; rodada < 5; rodada++) {
  const n = await processarFila(100);
  total += n;
  if (n === 0) break;
}
console.log(`${total} conversa(s) analisada(s). Painel do gestor: ${config.urlPublica}/gestor`);
await pool.end();
