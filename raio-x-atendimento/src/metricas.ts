// Métricas objetivas do atendimento, calculadas sem IA (rápidas, baratas e auditáveis).

export interface MensagemParaMetrica {
  do_corretor: boolean;
  tipo: string;
  texto: string | null;
  enviada_em: Date;
}

export interface Metricas {
  totalMensagens: number;
  mensagensCliente: number;
  mensagensCorretor: number;
  quemIniciou: "cliente" | "corretor" | null;
  /** Minutos entre a primeira mensagem do cliente e a primeira resposta do corretor (se o cliente iniciou). */
  primeiraRespostaMin: number | null;
  /** Mediana, em minutos, do tempo que o corretor leva para responder cada bloco de mensagens do cliente. */
  respostaMedianaMin: number | null;
  respostaP90Min: number | null;
  /** Quantas vezes o cliente esperou mais de 24h por uma resposta. */
  esperasAcimaDe24h: number;
  /** Mensagens do cliente que ficaram sem nenhuma resposta até agora. */
  clienteSemResposta: boolean;
  horasDesdeUltimaMensagem: number | null;
  ultimaMensagemDoCorretor: boolean | null;
  percentualAudiosCorretor: number;
  mensagensLongasCorretor: number;
  /** Mensagens seguidas do corretor sem retorno do cliente no fim da conversa (follow-ups sem resposta). */
  tentativasSemRetorno: number;
}

const MINUTO = 60_000;

function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return Math.round(ordenados[Math.max(0, idx)]);
}

export function calcularMetricas(mensagens: MensagemParaMetrica[], agora: Date = new Date()): Metricas {
  const msgs = [...mensagens].sort((a, b) => a.enviada_em.getTime() - b.enviada_em.getTime());
  const doCorretor = msgs.filter((m) => m.do_corretor);
  const doCliente = msgs.filter((m) => !m.do_corretor);

  // Para cada bloco de mensagens do cliente, mede quanto tempo o corretor levou para responder.
  const tempos: number[] = [];
  let inicioEspera: Date | null = null;
  for (const m of msgs) {
    if (!m.do_corretor) {
      if (!inicioEspera) inicioEspera = m.enviada_em;
    } else if (inicioEspera) {
      tempos.push((m.enviada_em.getTime() - inicioEspera.getTime()) / MINUTO);
      inicioEspera = null;
    }
  }

  const quemIniciou = msgs.length ? (msgs[0].do_corretor ? "corretor" : "cliente") : null;
  const primeiraRespostaMin = quemIniciou === "cliente" && tempos.length ? Math.round(tempos[0]) : null;

  let tentativasSemRetorno = 0;
  for (let i = msgs.length - 1; i >= 0 && msgs[i].do_corretor; i--) {
    // Conta "rodadas" de follow-up: mensagens com mais de 6h de distância entre si contam como tentativas separadas.
    if (i === msgs.length - 1 || msgs[i + 1].enviada_em.getTime() - msgs[i].enviada_em.getTime() > 6 * 60 * MINUTO) {
      tentativasSemRetorno++;
    }
  }

  const ultima = msgs.at(-1);
  const audios = doCorretor.filter((m) => m.tipo === "audio").length;

  return {
    totalMensagens: msgs.length,
    mensagensCliente: doCliente.length,
    mensagensCorretor: doCorretor.length,
    quemIniciou,
    primeiraRespostaMin,
    respostaMedianaMin: percentil(tempos, 50),
    respostaP90Min: percentil(tempos, 90),
    esperasAcimaDe24h: tempos.filter((t) => t > 24 * 60).length,
    clienteSemResposta: inicioEspera !== null,
    horasDesdeUltimaMensagem: ultima ? Math.round((agora.getTime() - ultima.enviada_em.getTime()) / (60 * MINUTO)) : null,
    ultimaMensagemDoCorretor: ultima ? ultima.do_corretor : null,
    percentualAudiosCorretor: doCorretor.length ? Math.round((audios / doCorretor.length) * 100) : 0,
    mensagensLongasCorretor: doCorretor.filter((m) => (m.texto?.length ?? 0) > 600).length,
    tentativasSemRetorno,
  };
}

export function formatarMinutos(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} dias`;
}
