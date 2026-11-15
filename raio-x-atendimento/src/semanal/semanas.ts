// Datas das semanas (segunda a domingo, horário de Brasília).
// As semanas são identificadas pela segunda-feira, no formato AAAA-MM-DD.

import { config } from "../config.js";

const DIA = 24 * 3600_000;

/** Data local (AAAA-MM-DD) no fuso de Brasília. */
export function dataLocal(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(data: string, dias: number): string {
  return new Date(Date.parse(`${data}T12:00:00Z`) + dias * DIA).toISOString().slice(0, 10);
}

/** Segunda-feira da semana que contém a data (AAAA-MM-DD). */
export function inicioDaSemana(data: string): string {
  const diaDaSemana = new Date(`${data}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return somarDias(data, -((diaDaSemana + 6) % 7));
}

export function semanaDe(d: Date): string {
  return inicioDaSemana(dataLocal(d));
}

/** Última semana já encerrada (a anterior à semana atual). */
export function ultimaSemanaCompleta(agora = new Date()): string {
  return somarDias(semanaDe(agora), -7);
}

/** Uma semana conta como "depois" do marco se começa no dia do marco ou depois. */
export function periodoDaSemana(semana: string, marco = config.marcoIa): "antes" | "depois" {
  return semana >= marco ? "depois" : "antes";
}

/** Primeira semana analisada: N semanas antes do marco. */
export function primeiraSemanaAnalisada(): string {
  return somarDias(inicioDaSemana(config.marcoIa), -7 * config.semanasLinhaDeBase);
}

/** Intervalo [início, fim) da semana em horário de Brasília, como instantes (para consultas no banco). */
export function limitesDaSemana(semana: string): { inicio: Date; fim: Date } {
  // Brasília não tem horário de verão desde 2019: UTC-3 o ano todo.
  return { inicio: new Date(`${semana}T03:00:00Z`), fim: new Date(`${somarDias(semana, 7)}T03:00:00Z`) };
}

export function rotuloSemana(semana: string): string {
  const [, m, d] = semana.split("-");
  const fim = somarDias(semana, 6).split("-");
  return `${d}/${m} a ${fim[2]}/${fim[1]}`;
}
