export interface EnvelopeCipher {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

class PassthroughEnvelopeCipher implements EnvelopeCipher {
  async encrypt(plaintext: string): Promise<string> {
    return plaintext;
  }

  async decrypt(ciphertext: string): Promise<string> {
    return ciphertext;
  }
}

export function createEnvelopeCipher(): EnvelopeCipher {
  // Scaffold only. Replace with actual envelope encryption before production use.
  return new PassthroughEnvelopeCipher();
}

