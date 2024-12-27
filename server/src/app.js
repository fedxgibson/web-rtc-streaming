const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const winston = require('winston');
const { Server } = require('socket.io');
const SetupWebRTC = require('../src/web-rtc/setup-web-rtc');

class Logger {
  constructor(logLevel) {
    this.logger = winston.createLogger({
      level: logLevel || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
      ]
    });
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  error(message, error = null, meta = {}) {
    this.logger.error(message, { error, ...meta });
  }
}

class App {
  constructor(opts = {}) {
    this.port = opts.port || 3001;
    this.host = opts.host || '0.0.0.0';
    this.environment = opts.environment || 'production';
    this.logger = new Logger(opts.logLevel || 'info');
    this.express = express();
  }

  async initialize() {
    try {      
      await this.start();
    } catch (error) {            
      this.logger.error('Failed to initialize application', error);
      process.exit(1);
    }
  }

  setupMiddleware() {
    this.express.use(helmet());
    this.express.use(bodyParser.json());
    this.express.use(morgan('combined', { 
      stream: { 
        write: message => this.logger.info(message.trim()) 
      }
    }));

    this.setupHealthCheck();
  }

  setupHealthCheck() {
    this.express.get('/health', async (req, res) => {
      try {
        await this.database.ping();
        res.status(200).json({ 
          status: 'ok',
          timestamp: new Date().toISOString(),
          services: {
            database: 'up'
          }
        });
      } catch (error) {
        this.logger.error('Server is unhealthy');
        this.logger.error(error.stack)

        res.status(503).json({ 
          status: 'error',
          timestamp: new Date().toISOString(),
          services: {
            database: 'down'
          }
        });
      }
    });
  }

  async start() {
    const { port, host } = this;
    
    this.server = this.express.listen(port, host, () => {
      this.logger.info(`Server is running`, {
        host,
        port,
        environment: this.environment
      });
    });

    this.io = new Server(this.server, {
      path: '/socket.io/',
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      allowUpgrades: true,
      pingTimeout: 60000,
      pingInterval: 25000,
      cookie: false
    });

    this.webRTC = new SetupWebRTC(this.io);

    this.setupGracefulShutdown();
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      this.logger.info(`Received ${signal}, starting graceful shutdown`);
      await this.shutdown();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  async shutdown() {
    try {            
      // Close the HTTP server if it exists
      if (this.server) {
        await new Promise((resolve, reject) => {
          this.server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        this.logger.info('HTTP server closed');
      }

      process.exit(0);
    } catch (error) {
      this.logger.error('Error during shutdown', error);
      process.exit(1);
    }
  }
}

module.exports = App;