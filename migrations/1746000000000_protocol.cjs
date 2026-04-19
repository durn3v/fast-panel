/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumns("users", {
    protocol: {
      type: "varchar(32)",
      notNull: true,
      default: "vless",
    },
    flow: {
      type: "varchar(64)",
      notNull: false,
    },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumns("users", ["protocol", "flow"]);
};
