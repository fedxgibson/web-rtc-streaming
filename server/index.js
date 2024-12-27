const App = require('./src/app');

const app = new App({
  port: process.env.PORT,
  host: process.env.HOST,
  logLevel: process.env.LOG_LEVEL,
  environment: process.env.NODE_ENV
});

app.initialize();