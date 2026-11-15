import { z } from "zod";
import { ETAPAS } from "../funil.js";

export const CRITERIOS = [
  "velocidade",
  "rapport",
  "qualificacao",
  "descoberta_necessidade",
  "apresentacao_imoveis",
  "conducao_visita",
  "objecoes",
  "proximo_passo",
  "followup",
  "comunicacao",
] as const;
export type Criterio = (typeof CRITERIOS)[number];

export const NOME_CRITERIO: Record<Criterio, string> = {
  velocidade: "Velocidade de resposta",
  rapport: "Relacionamento",
  qualificacao: "Qualificação",
  descoberta_necessidade: "Descoberta da necessidade",
  apresentacao_imoveis: "Apresentação de imóveis",
  conducao_visita: "Condução para visita",
  objecoes: "Tratamento de objeções",
  proximo_passo: "Próximo passo",
  followup: "Follow-up",
  comunicacao: "Comunicação",
};

export const CATEGORIAS_PERDA = [
  "nenhuma",
  "demora_resposta",
  "sem_qualificacao",
  "imoveis_sem_entender_necessidade",
  "sem_convite_visita",
  "objecao_mal_tratada",
  "sem_proximo_passo",
  "sem_followup",
  "followup_sem_valor",
  "comunicacao_confusa",
  "cliente_sem_perfil",
  "comprou_com_concorrente",
  "outro",
] as const;
export type CategoriaPerda = (typeof CATEGORIAS_PERDA)[number];

export const NOME_CATEGORIA_PERDA: Record<CategoriaPerda, string> = {
  nenhuma: "Sem travamento",
  demora_resposta: "Demora para responder",
  sem_qualificacao: "Não qualificou o cliente",
  imoveis_sem_entender_necessidade: "Mandou imóveis sem entender a necessidade",
  sem_convite_visita: "Não convidou para visita",
  objecao_mal_tratada: "Objeção mal tratada",
  sem_proximo_passo: "Conversa terminou sem próximo passo",
  sem_followup: "Não fez follow-up",
  followup_sem_valor: "Follow-up sem valor (\"alguma novidade?\")",
  comunicacao_confusa: "Comunicação confusa",
  cliente_sem_perfil: "Cliente sem perfil",
  comprou_com_concorrente: "Comprou com concorrente",
  outro: "Outro motivo",
};

export const TriagemSchema = z.object({
  tipo: z
    .enum(["cliente", "pessoal", "outro"])
    .describe("cliente = atendimento imobiliário a um cliente ou lead; pessoal = família, amigos, assuntos pessoais; outro = colegas, parceiros, fornecedores, proprietários captando"),
  motivo: z.string().describe("Uma frase curta justificando"),
});
export type Triagem = z.infer<typeof TriagemSchema>;

const texto = (d: string) => z.string().nullable().describe(d);

export const AnaliseSchema = z.object({
  etapa: z.enum(ETAPAS).describe("Etapa atual do funil em que o cliente está"),
  confianca_etapa: z.enum(["alta", "media", "baixa"]),
  resumo: z.string().describe("2 a 3 frases: quem é o cliente, o que busca e como está a negociação"),
  perfil_cliente: z.object({
    objetivo: texto("morar, investir, alugar... ou null se não descoberto"),
    tipo_imovel: texto("tipo de imóvel buscado"),
    regiao: texto("bairros/regiões de interesse"),
    orcamento: texto("faixa de valor"),
    pagamento: texto("à vista, financiamento, FGTS, permuta..."),
    prazo: texto("quando pretende comprar/mudar"),
    decisores: texto("quem decide junto"),
  }),
  notas: z
    .array(
      z.object({
        criterio: z.enum(CRITERIOS),
        nota: z.number().nullable().describe("0 a 10; null quando o critério não se aplica a esta conversa"),
        evidencia: z.string().describe("Referência às mensagens (#número) e citação curta que justificam a nota"),
        comentario: z.string().describe("O que foi bem ou mal, em uma frase"),
      }),
    )
    .describe("Uma entrada para cada um dos 10 critérios"),
  nota_geral: z.number().describe("0 a 10, visão geral do atendimento"),
  ponto_de_perda: z.object({
    categoria: z.enum(CATEGORIAS_PERDA).describe("Principal motivo de a conversa ter travado/esfriado; 'nenhuma' se está avançando bem"),
    mensagem: z.number().nullable().describe("Número (#) da mensagem onde a conversa começou a travar"),
    descricao: z.string().describe("O que aconteceu nesse momento, em 1-2 frases"),
  }),
  pontos_fortes: z.array(z.string()).describe("Até 3 coisas que o corretor fez bem"),
  dicas: z
    .array(
      z.object({
        titulo: z.string(),
        o_que_aconteceu: z.string().describe("Cite a mensagem (#número)"),
        como_fazer: z.string(),
        exemplo_mensagem: z.string().describe("Mensagem pronta, no tom de WhatsApp, que o corretor poderia ter enviado"),
      }),
    )
    .describe("As 3 dicas mais importantes, da mais impactante para a menos"),
  cliente_aguarda_resposta: z
    .boolean()
    .describe("true se a última mensagem é do cliente e pede ou espera retorno (pergunta, pedido, dúvida). false se o corretor falou por último ou se o cliente só encerrou (\"ok\", \"combinado\", \"obrigado\")"),
  proximo_passo: z
    .object({
      acao: z.string(),
      mensagem_sugerida: z.string().describe("Mensagem pronta para o corretor enviar agora"),
      urgencia: z.enum(["alta", "media", "baixa"]),
    })
    .nullable()
    .describe("null se o negócio já fechou ou foi perdido em definitivo"),
});
export type Analise = z.infer<typeof AnaliseSchema>;
