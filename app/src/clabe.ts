// CLABE de 18 dígitos: banco (3) + plaza (3) + cuenta (11) + verificador (1).
// La de cada cuenta la genera el engine con el número de cuenta de Nessie
// (engine/app/clabe.py, mismo algoritmo). Aquí solo se valida, se formatea y se
// lee el banco.

const WEIGHTS = [3, 7, 1];
export const OWN_BANK_CODE = '052';
const OWN_PLAZA = '580';

const BANKS: Record<string, string> = {
  [OWN_BANK_CODE]: 'Capital One',
  '002': 'Banamex',
  '012': 'BBVA',
  '014': 'Santander',
  '021': 'HSBC',
  '030': 'BanBajío',
  '036': 'Inbursa',
  '044': 'Scotiabank',
  '058': 'Banregio',
  '072': 'Banorte',
  '127': 'Banco Azteca',
  '137': 'BanCoppel',
  '638': 'Nu México',
  '646': 'STP',
};

export function clabeCheckDigit(first17: string): number {
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += (Number(first17[i]) * WEIGHTS[i % 3]) % 10;
  return (10 - (sum % 10)) % 10;
}

export function isValidClabe(clabe: string): boolean {
  return /^\d{18}$/.test(clabe) && clabeCheckDigit(clabe.slice(0, 17)) === Number(clabe[17]);
}

export function bankForClabe(clabe: string): string {
  return BANKS[clabe.slice(0, 3)] ?? 'Otro banco';
}

/** Los mismos 4 dígitos que la app enseña como "·· 4821". */
export function clabeLastFour(clabe: string): string {
  return clabe.slice(13, 17);
}

/** 11 dígitos de cuenta -> CLABE de nuestro banco. Los fixtures la usan para abrir cuentas. */
export function clabeFromAccountDigits(digits: string): string {
  const first17 = `${OWN_BANK_CODE}${OWN_PLAZA}${digits}`;
  return `${first17}${clabeCheckDigit(first17)}`;
}

/** `052580123456748219` -> `052 580 1234 5674 8219`, en bloques fáciles de dictar. */
export function formatClabe(clabe: string): string {
  return `${clabe.slice(0, 3)} ${clabe.slice(3, 6)} ${clabe.slice(6, 10)} ${clabe.slice(10, 14)} ${clabe.slice(14)}`;
}
