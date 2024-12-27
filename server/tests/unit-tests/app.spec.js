const { Server } = require('socket.io');
const SetupWebRTC = require('../../src/web-rtc/setup-web-rtc');
const App = require('../../src/app');

// Mock dependencies
jest.mock('socket.io');
jest.mock('../../src/web-rtc/setup-web-rtc');

describe('App.start()', () => {
  let app;
  let mockExpress;
  let mockServer;
  let mockLogger;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock server
    mockServer = {
      close: jest.fn()
    };

    // Setup mock express
    mockExpress = {
      listen: jest.fn((port, host, cb) => {
        if (cb) cb();
        return mockServer;
      })
    };

    // Setup mock logger
    mockLogger = {
      info: jest.fn()
    };

    // Initialize app with mocks
    app = new App({
      port: 3001,
      host: 'localhost',
      environment: 'test'
    });
    app.express = mockExpress;
    app.logger = mockLogger;
  });

  it('should start the server successfully', async () => {
    await app.start();

    // Verify express.listen was called with correct parameters
    expect(mockExpress.listen).toHaveBeenCalledWith(
      3001,
      'localhost',
      expect.any(Function)
    );

    // Verify logger.info was called with correct parameters
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Server is running',
      {
        host: 'localhost',
        port: 3001,
        environment: 'test'
      }
    );
  });

  it('should initialize Socket.IO with correct configuration', async () => {
    await app.start();

    // Verify Socket.IO initialization
    expect(Server).toHaveBeenCalledWith(
      mockServer,
      {
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
      }
    );
  });

  it('should initialize WebRTC with Socket.IO instance', async () => {
    const mockIo = {};
    Server.mockReturnValue(mockIo);

    await app.start();

    // Verify WebRTC setup
    expect(SetupWebRTC).toHaveBeenCalledWith(mockIo);
    expect(app.webRTC).toBeDefined();
  });

  it('should setup graceful shutdown', async () => {
    const setupGracefulShutdownSpy = jest.spyOn(app, 'setupGracefulShutdown');

    await app.start();

    expect(setupGracefulShutdownSpy).toHaveBeenCalled();
    setupGracefulShutdownSpy.mockRestore();
  });

  it('should store server instance', async () => {
    await app.start();

    expect(app.server).toBe(mockServer);
  });

  it('should handle server startup errors', async () => {
    const startupError = new Error('Failed to start server');
    mockExpress.listen.mockImplementation(() => {
      throw startupError;
    });

    await expect(app.start()).rejects.toThrow(startupError);
  });
});