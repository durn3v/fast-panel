/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumns("users", {
    last_seen_at: { type: "timestamptz", notNull: false },
  });
  pgm.createIndex("users", ["inbound_tag", "last_seen_at"], {
    name: "users_inbound_last_seen_idx",
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex("users", ["inbound_tag", "last_seen_at"], {
    name: "users_inbound_last_seen_idx",
    ifExists: true,
  });
  pgm.dropColumns("users", ["last_seen_at"], { ifExists: true });
};
