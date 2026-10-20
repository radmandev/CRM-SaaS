import { hash, verify } from "@node-rs/argon2";

// AUTH-02: Argon2id, OWASP baseline parameters (algorithm 2 = Argon2id).
const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);
export const verifyPassword = ({ hash: h, password }: { hash: string; password: string }) => verify(h, password);
