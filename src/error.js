'use strict';

class PookieDBError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PookieDBError';
    this.code = code;
  }
}

module.exports = PookieDBError;
