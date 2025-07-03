const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./users.db');

db.serialize(function() {
  // Users table
  db.run(
    'CREATE TABLE IF NOT EXISTS users (' +
    '  id TEXT PRIMARY KEY,' +
    '  balance INTEGER DEFAULT 0' +
    ')'
  );
  // Requests log table
  db.run(
    'CREATE TABLE IF NOT EXISTS requests (' +
    '  req_id   INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  user_id  TEXT,' +
    '  type     TEXT,' +       // addfund, withdraw, data, airtime
    '  amount   INTEGER,' +
    '  details  TEXT,' +       // e.g. phone#
    '  status   TEXT,' +       // pending, approved, rejected
    '  created  DATETIME DEFAULT CURRENT_TIMESTAMP' +
    ')'
  );
});

module.exports = {
  // Fetch a user's balance
  getBalance: function(id, callback) {
    db.get(
      'SELECT balance FROM users WHERE id = ?',
      [id],
      function(err, row) {
        if (err || !row) return callback(0);
        callback(row.balance);
      }
    );
  },

  // Add or deduct from balance
  updateBalance: function(id, amount, callback) {
    db.run(
      'INSERT OR IGNORE INTO users (id) VALUES (?)',
      [id],
      function() {
        db.run(
          'UPDATE users SET balance = balance + ? WHERE id = ?',
          [amount, id],
          callback
        );
      }
    );
  },

  // Log any user request
  logRequest: function(userId, type, amount, details, callback) {
    db.run(
      'INSERT INTO requests (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)',
      [userId, type, amount, details || '', 'pending'],
      callback
    );
  },

  // Get all pending requests
  getPendingRequests: function(callback) {
    db.all(
      'SELECT * FROM requests WHERE status = "pending" ORDER BY created DESC',
      [],
      callback
    );
  },

  // Update a request's status
  setRequestStatus: function(reqId, status, callback) {
    db.run(
      'UPDATE requests SET status = ? WHERE req_id = ?',
      [status, reqId],
      callback
    );
  },

  // Fetch a single request by ID
  getRequest: function(reqId, callback) {
    db.get(
      'SELECT * FROM requests WHERE req_id = ?',
      [reqId],
      callback
    );
  },

  // List all users & balances
  getAllUsers: function(callback) {
    db.all(
      'SELECT * FROM users ORDER BY id',
      [],
      callback
    );
  }
};
