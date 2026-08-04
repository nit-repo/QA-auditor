// api/index.js — Vercel Serverless Function entry point.
// Bridges Vercel serverless requests to server.js request handler.

var server = require('../server.js');

module.exports = function (req, res) {
  return server.handleRequest(req, res);
};
