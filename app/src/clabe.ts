// CLABE de 18 dígitos: banco (3) + plaza (3) + cuenta (11) + verificador (1).
// Solo guardamos los últimos 4 dígitos de cada cuenta, así que la que mostramos
// es de demostración: válida en formato, estable por cuenta, sin recibir dinero.

const WEIGHTS = [3, 7, 1];
const DEMO_BANK = '052';
const DEMO_PLAZA = '580';

export function clabeCheckDigit(first17: string): number {
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += (Number(first17[i]) * WEIGHTS[i % 3]) % 10;
  return (10 - (sum % 10)) % 10;
}

export function isValidClabe(clabe: string): boolean {
  return /^\d{18}$/.test(clabe) && clabeCheckDigit(clabe.slice(0, 17)) === Number(clabe[17]);
}

/** Termina en los mismos 4 dígitos que la app ya enseña como "·· 4821". */
export function demoClabe(accountId: string, lastFour: string): string {
  let hash = 7;
  for (let i = 0; i < accountId.length; i += 1) hash = (hash * 31 + accountId.charCodeAt(i)) % 10_000_000;
  const first17 = `${DEMO_BANK}${DEMO_PLAZA}${String(hash).padStart(7, '0')}${lastFour}`;
  return `${first17}${clabeCheckDigit(first17)}`;
}

/** `052580123456748219` -> `052 580 1234567482 19`, en bloques fáciles de dictar. */
export function formatClabe(clabe: string): string {
  return `${clabe.slice(0, 3)} ${clabe.slice(3, 6)} ${clabe.slice(6, 10)} ${clabe.slice(10, 14)} ${clabe.slice(14)}`;
}
