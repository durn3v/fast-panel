/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable("inbounds", {
    tag: { type: "text", primaryKey: true },
    port: { type: "integer", notNull: true },
    config: { type: "jsonb", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("users", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "text", notNull: true },
    uuid: { type: "uuid", notNull: true, unique: true },
    inbound_tag: {
      type: "text",
      notNull: true,
      references: "inbounds(tag)",
      onDelete: "CASCADE",
    },
    enabled: { type: "boolean", notNull: true, default: true },
    expire_at: { type: "timestamptz" },
    data_limit: { type: "bigint" },
    traffic_up: { type: "bigint", notNull: true, default: 0 },
    traffic_down: { type: "bigint", notNull: true, default: 0 },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable("users", { ifExists: true, cascade: true });
  pgm.dropTable("inbounds", { ifExists: true, cascade: true });
};
