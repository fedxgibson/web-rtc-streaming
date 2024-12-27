// setupWebRTC.test.js
const SetupWebRTC = require('../../../src/web-rtc/setup-web-rtc');

describe('SetupWebRTC', () => {
  let webRTC;
  let mockSocket;
  let mockIo;
  let socketEventHandlers;
  let socketEmitSpy;
  let ioEmitSpy;

  beforeEach(() => {
    // Reset event handlers for each test
    socketEventHandlers = {};
    
    // Create mock socket
    socketEmitSpy = jest.fn();
    mockSocket = {
      id: 'test-socket-id',
      join: jest.fn(),
      to: jest.fn().mockReturnValue({
        emit: socketEmitSpy
      }),
      emit: socketEmitSpy,
      on: jest.fn((event, handler) => {
        socketEventHandlers[event] = handler;
      })
    };

    // Create mock io
    ioEmitSpy = jest.fn();
    mockIo = {
      on: jest.fn((event, handler) => {
        // Immediately call the connection handler with our mock socket
        if (event === 'connection') {
          handler(mockSocket);
        }
      }),
      to: jest.fn().mockReturnValue({
        emit: ioEmitSpy
      })
    };

    // Initialize WebRTC instance
    webRTC = new SetupWebRTC(mockIo);
  });

  afterEach(() => {
    jest.clearAllMocks();
    webRTC.cleanup();
  });

  describe('Initialization', () => {
    test('should initialize with empty rooms and connections', () => {
      expect(webRTC.rooms.size).toBe(0);
      expect(webRTC.peerConnections.size).toBe(0);
    });

    test('should set up socket connection listener', () => {
      expect(mockIo.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    test('should set up all required socket event listeners', () => {
      expect(mockSocket.on).toHaveBeenCalledWith('start-broadcasting', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('join-as-viewer', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('offer', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('answer', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('ice-candidate', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });
  });

  describe('Room Management', () => {
    test('should create new room when broadcaster joins', () => {
      const roomId = 'test-room';
      socketEventHandlers['start-broadcasting'](roomId);

      expect(webRTC.isRoomActive(roomId)).toBe(true);
      expect(webRTC.getRoomParticipants(roomId).has(mockSocket.id)).toBe(true);
      expect(mockSocket.join).toHaveBeenCalledWith(roomId);
    });

    test('should notify room when broadcaster joins', () => {
      const roomId = 'test-room';
      socketEventHandlers['start-broadcasting'](roomId);

      expect(mockSocket.to).toHaveBeenCalledWith(roomId);
      expect(socketEmitSpy).toHaveBeenCalledWith('broadcaster-joined', mockSocket.id);
    });

    test('should send current broadcasters list to new broadcaster', () => {
      const roomId = 'test-room';
      socketEventHandlers['start-broadcasting'](roomId);

      expect(socketEmitSpy).toHaveBeenCalledWith('current-broadcasters', expect.any(Array));
    });
  });

  describe('Viewer Management', () => {
    test('should handle viewer joining existing room', () => {
      const roomId = 'test-room';
      webRTC.rooms.set(roomId, new Set(['existing-broadcaster']));

      socketEventHandlers['join-as-viewer'](roomId);

      expect(mockSocket.join).toHaveBeenCalledWith(roomId);
      expect(mockSocket.to).toHaveBeenCalledWith(roomId);
      expect(socketEmitSpy).toHaveBeenCalledWith('viewer-joined', mockSocket.id);
    });

    test('should not allow viewer to join non-existent room', () => {
      socketEventHandlers['join-as-viewer']('non-existent-room');

      expect(mockSocket.join).not.toHaveBeenCalled();
      expect(socketEmitSpy).not.toHaveBeenCalledWith('viewer-joined', expect.any(String));
    });
  });

  describe('WebRTC Signaling', () => {
    const mockOffer = { type: 'offer', sdp: 'test-sdp' };
    const mockAnswer = { type: 'answer', sdp: 'test-sdp' };
    const mockCandidate = { candidate: 'test-candidate' };
    const roomId = 'test-room';
    const targetId = 'target-socket-id';

    test('should handle offer signaling', () => {
      socketEventHandlers['offer'](mockOffer, roomId, targetId);

      expect(mockSocket.to).toHaveBeenCalledWith(targetId);
      expect(socketEmitSpy).toHaveBeenCalledWith('offer', mockOffer, mockSocket.id);
    });

    test('should handle answer signaling', () => {
      socketEventHandlers['answer'](mockAnswer, roomId, targetId);

      expect(mockSocket.to).toHaveBeenCalledWith(targetId);
      expect(socketEmitSpy).toHaveBeenCalledWith('answer', mockAnswer, mockSocket.id);
    });

    test('should handle ICE candidate signaling', () => {
      socketEventHandlers['ice-candidate'](mockCandidate, targetId);

      expect(mockSocket.to).toHaveBeenCalledWith(targetId);
      expect(socketEmitSpy).toHaveBeenCalledWith('ice-candidate', mockCandidate, mockSocket.id);
    });
  });

  describe('Disconnection Handling', () => {
    test('should cleanup room when last broadcaster disconnects', () => {
      const roomId = 'test-room';
      webRTC.rooms.set(roomId, new Set([mockSocket.id]));

      socketEventHandlers['disconnect']();

      expect(webRTC.isRoomActive(roomId)).toBe(false);
      expect(mockIo.to).toHaveBeenCalledWith(roomId);
      expect(ioEmitSpy).toHaveBeenCalledWith('broadcaster-left', mockSocket.id);
    });

    test('should keep room active when other broadcasters remain', () => {
      const roomId = 'test-room';
      webRTC.rooms.set(roomId, new Set([mockSocket.id, 'other-broadcaster-id']));

      socketEventHandlers['disconnect']();

      expect(webRTC.isRoomActive(roomId)).toBe(true);
      expect(webRTC.getRoomParticipants(roomId).size).toBe(1);
    });

    test('should cleanup peer connections on disconnect', () => {
      const peerId = 'peer-id';
      webRTC.peerConnections.set(mockSocket.id, new Set([peerId]));

      socketEventHandlers['disconnect']();

      expect(webRTC.peerConnections.has(mockSocket.id)).toBe(false);
      expect(mockIo.to).toHaveBeenCalledWith(peerId);
      expect(ioEmitSpy).toHaveBeenCalledWith('peer-disconnected', mockSocket.id);
    });
  });

  describe('Utility Methods', () => {
    test('getRoomParticipants should return empty set for non-existent room', () => {
      const participants = webRTC.getRoomParticipants('non-existent');
      expect(participants).toBeInstanceOf(Set);
      expect(participants.size).toBe(0);
    });

    test('getRoomParticipants should return correct participants', () => {
      const roomId = 'test-room';
      const participants = new Set(['user1', 'user2']);
      webRTC.rooms.set(roomId, participants);

      expect(webRTC.getRoomParticipants(roomId)).toBe(participants);
    });

    test('isRoomActive should correctly identify active rooms', () => {
      const roomId = 'test-room';
      webRTC.rooms.set(roomId, new Set(['user1']));

      expect(webRTC.isRoomActive(roomId)).toBe(true);
      expect(webRTC.isRoomActive('non-existent')).toBe(false);
    });

    test('getActiveRooms should return all room IDs', () => {
      webRTC.rooms.set('room1', new Set(['user1']));
      webRTC.rooms.set('room2', new Set(['user2']));

      const rooms = webRTC.getActiveRooms();
      expect(rooms).toEqual(['room1', 'room2']);
    });

    test('cleanup should clear all rooms and connections', () => {
      webRTC.rooms.set('room1', new Set(['user1']));
      webRTC.peerConnections.set('conn1', new Set(['peer1']));

      webRTC.cleanup();

      expect(webRTC.rooms.size).toBe(0);
      expect(webRTC.peerConnections.size).toBe(0);
    });
  });
});