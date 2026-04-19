/**
 * Inbounds только в config/xray/config.json. Таблица inbounds и FK с users сняты.
 */
/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.dropConstraint("users", "users_inbound_tag_fkey", { ifExists: true });
  pgm.dropTable("inbounds", { ifExists: true });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = () => {};
