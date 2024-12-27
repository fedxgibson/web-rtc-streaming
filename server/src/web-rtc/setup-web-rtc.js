// setupWebRTC.js
module.exports = class SetupWebRTC {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // Map<roomId, Room>
    this.peerConnections = new Map(); // Map<socketId, Set<peerId>>
    
    // Room structure: { broadcasters: Set<socketId>, viewers: Set<socketId> }
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('User connected:', socket.id);
      
      this.handleBroadcasting(socket);
      this.handleViewer(socket);
      this.handleSignaling(socket);
      this.handleDisconnection(socket);
    });
  }

  initializeRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        broadcasters: new Set(),
        viewers: new Set()
      });
    }
    return this.rooms.get(roomId);
  }

  handleBroadcasting(socket) {
    socket.on('start-broadcasting', (roomId) => {
      const room = this.initializeRoom(roomId);
      room.broadcasters.add(socket.id);
      socket.join(roomId);
      
      // Notify existing participants about the new broadcaster
      socket.to(roomId).emit('broadcaster-joined', socket.id);
      
      // Send current room state to the new broadcaster
      socket.emit('room-state', {
        broadcasters: Array.from(room.broadcasters),
        viewers: Array.from(room.viewers)
      });
      
      console.log(`New broadcaster ${socket.id} in room ${roomId}`);
    });
  }

  handleViewer(socket) {
    socket.on('join-as-viewer', (roomId) => {
      const room = this.initializeRoom(roomId);
      room.viewers.add(socket.id);
      socket.join(roomId);

      // Notify room participants about the new viewer
      socket.to(roomId).emit('viewer-joined', socket.id);
      
      // Send current room state to the new viewer
      socket.emit('room-state', {
        broadcasters: Array.from(room.broadcasters),
        viewers: Array.from(room.viewers)
      });

      console.log(`Viewer ${socket.id} joined room ${roomId}`);
    });

    socket.on('leave-room', (roomId) => {
      const room = this.rooms.get(roomId);
      if (room) {
        // Remove from broadcasters or viewers
        room.broadcasters.delete(socket.id);
        room.viewers.delete(socket.id);

        // Notify others in the room
        socket.to(roomId).emit('peer-disconnected', socket.id);
        
        // Leave the socket.io room
        socket.leave(roomId);
        
        // Notify the leaving user
        socket.emit('room-left');

        // Clean up empty rooms
        if (room.broadcasters.size === 0 && room.viewers.size === 0) {
          this.rooms.delete(roomId);
        }

        console.log(`User ${socket.id} left room ${roomId}`);
      }
    });

    socket.on('request-stream', (broadcasterId) => {
      // Notify specific broadcaster that a viewer wants to connect
      socket.to(broadcasterId).emit('stream-requested', socket.id);
    });
  }

  handleSignaling(socket) {
    socket.on('offer', (offer, roomId, targetId) => {
      this.trackPeerConnection(socket.id, targetId);
      socket.to(targetId).emit('offer', offer, socket.id);
    });

    socket.on('answer', (answer, roomId, targetId) => {
      this.trackPeerConnection(socket.id, targetId);
      socket.to(targetId).emit('answer', answer, socket.id);
    });

    socket.on('ice-candidate', (candidate, targetId) => {
      socket.to(targetId).emit('ice-candidate', candidate, socket.id);
    });
  }

  trackPeerConnection(socketId, peerId) {
    if (!this.peerConnections.has(socketId)) {
      this.peerConnections.set(socketId, new Set());
    }
    this.peerConnections.get(socketId).add(peerId);
  }

  handleDisconnection(socket) {
    socket.on('disconnect', () => {
      this.cleanupRooms(socket);
      this.cleanupPeerConnections(socket);
      console.log('User disconnected:', socket.id);
    });
  }

  cleanupRooms(socket) {
    this.rooms.forEach((room, roomId) => {
      // Remove from broadcasters if present
      if (room.broadcasters.has(socket.id)) {
        room.broadcasters.delete(socket.id);
        this.io.to(roomId).emit('broadcaster-left', socket.id);
      }
      
      // Remove from viewers if present
      if (room.viewers.has(socket.id)) {
        room.viewers.delete(socket.id);
        this.io.to(roomId).emit('viewer-left', socket.id);
      }

      // Clean up empty rooms
      if (room.broadcasters.size === 0 && room.viewers.size === 0) {
        this.rooms.delete(roomId);
      }
    });
  }

  cleanupPeerConnections(socket) {
    if (this.peerConnections.has(socket.id)) {
      // Notify all peers about the disconnection
      this.peerConnections.get(socket.id).forEach(peerId => {
        this.io.to(peerId).emit('peer-disconnected', socket.id);
      });
      this.peerConnections.delete(socket.id);
    }

    // Clean up references to the disconnected peer
    this.peerConnections.forEach((peers, socketId) => {
      if (peers.has(socket.id)) {
        peers.delete(socket.id);
      }
    });
  }

  getRoomParticipants(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { broadcasters: new Set(), viewers: new Set() };
    return {
      broadcasters: room.broadcasters,
      viewers: room.viewers
    };
  }

  isRoomActive(roomId) {
    const room = this.rooms.get(roomId);
    return room && (room.broadcasters.size > 0 || room.viewers.size > 0);
  }

  getActiveRooms() {
    return Array.from(this.rooms.keys());
  }

  getRoomStats(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return {
      broadcasters: room.broadcasters.size,
      viewers: room.viewers.size,
      totalParticipants: room.broadcasters.size + room.viewers.size
    };
  }

  cleanup() {
    this.rooms.clear();
    this.peerConnections.clear();
  }
}