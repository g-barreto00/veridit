import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CriptografiaCampo } from '../src/cripto-campo';

const cripto = new CriptografiaCampo(randomBytes(32).toString('base64'), randomBytes(32).toString('base64'));

describe('CriptografiaCampo', () => {
  it('cifra e decifra; cifras diferentes para o mesmo texto', () => {
    const a = cripto.cifrar('52998224725');
    const b = cripto.cifrar('52998224725');
    expect(a).not.toBe(b);
    expect(a).not.toContain('52998224725');
    expect(cripto.decifrar(a)).toBe('52998224725');
  });

  it('detecta adulteração do valor cifrado', () => {
    const partes = cripto.cifrar('52998224725').split('.');
    partes[3] = Buffer.from('xxxxxxxxxxx').toString('base64url');
    expect(() => cripto.decifrar(partes.join('.'))).toThrow();
  });

  it('índice de busca é determinístico', () => {
    expect(cripto.indiceBusca('52998224725')).toBe(cripto.indiceBusca('52998224725'));
  });
});
