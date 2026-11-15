import { migrar, pool } from "../db.js";

await migrar();
console.log("Banco de dados atualizado.");
await pool.end();
