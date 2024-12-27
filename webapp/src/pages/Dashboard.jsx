import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const Dashboard = () => {
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState({ broadcasters: [], viewers: [] });
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const socketRef = useRef(null);

  const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  useEffect(() => {
    socketRef.current = io({
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      secure: true,
      rejectUnauthorized: false
    });
    
    socketRef.current.on('connect', () => {
      console.log('Connected to server with ID:', socketRef.current.id);
      setIsConnected(true);
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setError('Connection error: ' + error.message);
    });

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      peerConnectionsRef.current.forEach(pc => pc.close());
      socketRef.current.disconnect();
    };
  }, []);

  const getLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: {
          width: { ideal: 1080 },
          height: { ideal: 1920 },
          aspectRatio: 0.5625 // 9:16 ratio
        },
        audio: true 
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (err) {
      setError('Error accessing camera: ' + err.message);
      throw err;
    }
  }, []);

  const createPeerConnection = useCallback((peerId) => {
    const pc = new RTCPeerConnection(configuration);
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', event.candidate, peerId);
      }
    };

    pc.ontrack = (event) => {
      setRemoteStreams(prev => new Map(prev).set(peerId, event.streams[0]));
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state for peer ${peerId}:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setRemoteStreams(prev => {
          const newStreams = new Map(prev);
          newStreams.delete(peerId);
          return newStreams;
        });
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    peerConnectionsRef.current.set(peerId, pc);
    return pc;
  }, []);

  const checkMediaPermissions = async () => {
    try {
      const permissions = await navigator.permissions.query({ name: 'camera' });
      if (permissions.state === 'denied') {
        setError('Camera access is blocked. Please update your browser settings.');
        return false;
      }
      return true;
    } catch (err) {
      console.warn('Permissions API not supported');
      return true;
    }
  };

  const handleStartBroadcast = async () => {
    if (!roomId) {
      setError('Please enter a room ID');
      return;
    }

    try {
      setError('');
      const hasPermissions = await checkMediaPermissions();
      if (!hasPermissions) return;
      
      setIsBroadcasting(true);
      await getLocalStream();
      socketRef.current.emit('start-broadcasting', roomId);
    } catch (err) {
      setError('Failed to start broadcasting: ' + err.message);
    }
  };

  const handleJoinRoom = () => {
    if (!roomId) {
      setError('Please enter a room ID');
      return;
    }

    try {
      setError('');
      socketRef.current.emit('join-as-viewer', roomId);
      setIsBroadcasting(false);
    } catch (err) {
      setError('Failed to join room: ' + err.message);
    }
  };

  const handlePictureInPicture = async (videoElement) => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        // Set preferred width/height for PiP window
        await videoElement.requestPictureInPicture({
          width: 360,  // This is proportional to 9:16
          height: 640
        });
      }
    } catch (err) {
      console.error('PiP error:', err);
    }
  };

  const stopTransmitting = () => {
    try {
      // Stop all tracks in the local stream
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }

      // Clear the local video
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }

      // Close and cleanup all peer connections
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();

      // Clear remote streams
      setRemoteStreams(new Map());

      // Leave the room
      socketRef.current.emit('leave-room', roomId);

      // Reset states
      setIsBroadcasting(false);
      setParticipants({ broadcasters: [], viewers: [] });
      
      console.log('Stopped transmitting and cleaned up resources');
    } catch (err) {
      setError('Error stopping transmission: ' + err.message);
    }
  };

  useEffect(() => {
    if (!socketRef.current) return;

    const socket = socketRef.current;

    socket.on('room-state', ({ broadcasters, viewers }) => {
      setParticipants({ broadcasters, viewers });
      if (!isBroadcasting) {
        broadcasters.forEach(broadcasterId => {
          socket.emit('request-stream', broadcasterId);
        });
      }
    });

    socket.on('viewer-joined', async (viewerId) => {
      if (isBroadcasting) {
        try {
          const pc = createPeerConnection(viewerId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', offer, roomId, viewerId);
        } catch (err) {
          setError('Error creating offer: ' + err.message);
        }
      }
    });

    socket.on('stream-requested', async (viewerId) => {
      if (isBroadcasting) {
        try {
          const pc = createPeerConnection(viewerId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', offer, roomId, viewerId);
        } catch (err) {
          setError('Error creating offer: ' + err.message);
        }
      }
    });

    socket.on('offer', async (offer, broadcasterId) => {
      try {
        let pc = peerConnectionsRef.current.get(broadcasterId);
        
        // If we already have a connection, check its state
        if (pc) {
          if (pc.signalingState !== 'stable') {
            // If it's not stable, close and create a new one
            pc.close();
            pc = null;
          }
        }
        
        // Create new peer connection if needed
        if (!pc) {
          pc = createPeerConnection(broadcasterId);
        }
        
        // Handle the offer
        if (pc.signalingState === 'stable' || pc.signalingState === 'have-remote-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('answer', answer, roomId, broadcasterId);
        } else {
          console.warn(`Received offer in unexpected state: ${pc.signalingState}`);
          setError(`Cannot process offer in state: ${pc.signalingState}`);
        }
      } catch (err) {
        console.error('Error handling offer:', err);
        setError('Error handling offer: ' + err.message);
      }
    });

    socket.on('answer', async (answer, peerId) => {
      try {
        const pc = peerConnectionsRef.current.get(peerId);
        if (pc) {
          // Check if we're in the right state to receive an answer
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
          } else {
            console.warn(`Received answer in ${pc.signalingState} state for peer ${peerId}`);
            // If we're stable, we might have already processed this answer
            if (pc.signalingState !== 'stable') {
              // For other states, we might want to queue the answer or handle differently
              setError(`Unexpected signaling state: ${pc.signalingState}`);
            }
          }
        }
      } catch (err) {
        console.error('Error handling answer:', err);
        setError('Error handling answer: ' + err.message);
      }
    });

    socket.on('ice-candidate', async (candidate, peerId) => {
      try {
        const pc = peerConnectionsRef.current.get(peerId);
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        setError('Error adding ICE candidate: ' + err.message);
      }
    });

    socket.on('peer-disconnected', (peerId) => {
      const pc = peerConnectionsRef.current.get(peerId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(peerId);
      }
      setRemoteStreams(prev => {
        const newStreams = new Map(prev);
        newStreams.delete(peerId);
        return newStreams;
      });
    });

    socket.on('room-left', () => {
      // Clear remote streams when we leave the room
      setRemoteStreams(new Map());
      setParticipants({ broadcasters: [], viewers: [] });
    });

    return () => {
      socket.off('room-state');
      socket.off('viewer-joined');
      socket.off('stream-requested');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('peer-disconnected');
    };
  }, [roomId, isBroadcasting, createPeerConnection]);

  return (
    <div className="container mx-auto p-4">
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-6">
          <h2 className="text-2xl font-bold mb-4">WebRTC Video Room</h2>
          
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
              <p className="text-red-700">{error}</p>
            </div>
          )}
          
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 items-center">
              <input
                type="text"
                placeholder="Enter Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <button
                onClick={handleStartBroadcast}
                disabled={!isConnected || isBroadcasting}
                className={`px-4 py-2 rounded-md ${
                  !isConnected || isBroadcasting
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                Start Broadcasting
              </button>
              
              <button
                onClick={handleJoinRoom}
                disabled={!isConnected || isBroadcasting}
                className={`px-4 py-2 rounded-md ${
                  !isConnected || isBroadcasting
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-green-500 hover:bg-green-600 text-white'
                }`}
              >
                Join Room
              </button>

              {(isBroadcasting || remoteStreams.size > 0) && (
                <button
                  onClick={stopTransmitting}
                  className="px-4 py-2 rounded-md bg-red-500 hover:bg-red-600 text-white"
                >
                  Stop {isBroadcasting ? 'Broadcasting' : 'Viewing'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Local Video */}
              { isBroadcasting && (
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">Local Video</h3>
                  <div className="relative bg-gray-900 rounded-lg overflow-hidden" style={{ aspectRatio: '9/16' }}>
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                      style={{
                        objectFit: 'cover',
                        aspectRatio: '9/16',
                      }}
                      pip="true"
                      pictureinpictureoptions={{ aspectRatio: '9/16' }}
                    />
                    <button
                      onClick={() => handlePictureInPicture(localVideoRef.current)}
                      className="absolute bottom-2 right-2 bg-black/50 text-white p-2 rounded"
                    >
                      PiP
                    </button>
                  </div>
                </div>)
              }

              {/* Remote Videos */}
              {Array.from(remoteStreams).map(([peerId, stream]) => (
                <div key={peerId} className="space-y-2">
                  <h3 className="text-lg font-medium">
                    {participants.broadcasters.includes(peerId) ? 'Broadcaster' : 'Viewer'} 
                    {peerId.slice(-4)}
                  </h3>
                  <div className="relative bg-gray-900 rounded-lg overflow-hidden" style={{ aspectRatio: '9/16' }}>
                    <video
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                      ref={el => {
                        if (el) el.srcObject = stream;
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Room Participants */}
            <div className="mt-4">
              <h3 className="text-lg font-medium mb-2">Room Participants</h3>
              <div className="flex gap-4">
                <div>
                  <h4 className="font-medium">Broadcasters ({participants.broadcasters.length})</h4>
                  <ul className="text-sm text-gray-600">
                    {participants.broadcasters.map(id => (
                      <li key={id}>ID: {id.slice(-4)}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium">Viewers ({participants.viewers.length})</h4>
                  <ul className="text-sm text-gray-600">
                    {participants.viewers.map(id => (
                      <li key={id}>ID: {id.slice(-4)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;