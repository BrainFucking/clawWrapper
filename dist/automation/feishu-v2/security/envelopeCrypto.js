"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEnvelopeCipher = createEnvelopeCipher;
class PassthroughEnvelopeCipher {
    async encrypt(plaintext) {
        return plaintext;
    }
    async decrypt(ciphertext) {
        return ciphertext;
    }
}
function createEnvelopeCipher() {
    // Scaffold only. Replace with actual envelope encryption before production use.
    return new PassthroughEnvelopeCipher();
}
