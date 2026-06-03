const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  const target = 'http://localhost:3005';
  const opts = { target, changeOrigin: true };

  // Proxy API calls and custom static pages to the Express server
  app.use('/api', createProxyMiddleware(opts));
  app.use('/p', createProxyMiddleware(opts));
};
