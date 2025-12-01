/**
 * GestureRecognizer - Hand tracking and gesture recognition using MediaPipe
 * Part of the Myelin project experiments
 */

export class GestureRecognizer {
  constructor() {
    this.hands = null;
    this.faceMesh = null;
    this.camera = null;
    this.videoElement = null;
    this.callback = null;
    this.animationFrameId = null;
    this.isRunning = false;
    
    // Previous frame data for movement tracking
    this.previousLandmarks = null;
    this.previousTime = Date.now();
    this.latestFaceResults = null;
  }

  /**
   * Initialize MediaPipe Hands and Face Mesh
   */
  async init() {
    try {
      // Check if MediaPipe Hands is available
      if (typeof Hands === 'undefined') {
        // Load MediaPipe Hands from CDN
        await this.loadMediaPipeScript();
      }

      this.hands = new Hands({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });

      this.hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
      });

      this.hands.onResults((results) => this.onHandsResults(results));

      // Initialize Face Mesh
      this.faceMesh = new FaceMesh({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
        }
      });

      this.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.faceMesh.onResults((results) => this.onFaceResults(results));
    } catch (error) {
      console.error("Failed to initialize MediaPipe:", error);
      throw error;
    }
  }

  /**
   * Load MediaPipe script dynamically
   */
  async loadMediaPipeScript() {
    return new Promise((resolve, reject) => {
      // Load Hands script
      const handsScript = document.createElement('script');
      handsScript.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
      handsScript.crossOrigin = 'anonymous';
      
      handsScript.onload = () => {
        // Load Face Mesh
        const faceScript = document.createElement('script');
        faceScript.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
        faceScript.crossOrigin = 'anonymous';
        
        faceScript.onload = () => {
          // Load Camera Utils
          const cameraScript = document.createElement('script');
          cameraScript.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
          cameraScript.crossOrigin = 'anonymous';
          
          cameraScript.onload = () => resolve();
          cameraScript.onerror = () => reject(new Error('Failed to load MediaPipe Camera Utils'));
          
          document.head.appendChild(cameraScript);
        };
        
        faceScript.onerror = () => reject(new Error('Failed to load MediaPipe Face Mesh'));
        document.head.appendChild(faceScript);
      };
      
      handsScript.onerror = () => reject(new Error('Failed to load MediaPipe Hands'));
      document.head.appendChild(handsScript);
    });
  }

  /**
   * Start camera and begin hand tracking
   * @param {HTMLVideoElement} videoElement - Video element to use for camera feed
   * @param {Function} callback - Callback function to receive results
   */
  async startCamera(videoElement, callback) {
    this.videoElement = videoElement;
    this.callback = callback;

    try {
      // Initialize MediaPipe if not already done
      if (!this.hands) {
        await this.init();
      }

    // Start camera
    this.camera = new Camera(videoElement, {
      onFrame: async () => {
        if (this.hands && this.isRunning) {
          await this.hands.send({ image: videoElement });
        }
        if (this.faceMesh && this.isRunning) {
          await this.faceMesh.send({ image: videoElement });
        }
      },
      width: 640,
      height: 480
    });      this.isRunning = true;
      await this.camera.start();
    } catch (error) {
      console.error("Failed to start camera:", error);
      throw error;
    }
  }

  /**
   * Stop camera and hand tracking
   */
  stop() {
    this.isRunning = false;
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.camera) {
      this.camera.stop();
      this.camera = null;
    }

    if (this.videoElement && this.videoElement.srcObject) {
      const tracks = this.videoElement.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      this.videoElement.srcObject = null;
    }
  }

  /**
   * Process MediaPipe Hands results
   */
  onHandsResults(results) {
    const handDetected = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
    
    if (!handDetected) {
      this.sendCallback({
        handDetected: false,
        landmarks: null,
        cursorPosition: null,
        gesture: 'IDLE'
      });
      this.previousLandmarks = null;
      return;
    }

    const landmarks = results.multiHandLandmarks[0];
    const gesture = this.recognizeGesture(landmarks);
    const cursorPosition = this.getCursorPosition(landmarks);
    const velocity = this.getMovementVelocity(landmarks);

    this.sendCallback({
      handDetected: true,
      landmarks: landmarks,
      cursorPosition: cursorPosition,
      gesture: gesture,
      velocity: velocity,
      handedness: results.multiHandedness ? results.multiHandedness[0].label : 'Unknown'
    });

    this.previousLandmarks = landmarks;
    this.previousTime = Date.now();
  }

  /**
   * Process MediaPipe Face results
   */
  onFaceResults(results) {
    this.latestFaceResults = results;
  }

  /**
   * Send combined results to callback
   */
  sendCallback(handData) {
    if (!this.callback) return;

    const faceData = this.latestFaceResults;
    const eyePositions = faceData && faceData.multiFaceLandmarks && faceData.multiFaceLandmarks.length > 0
      ? this.getEyePositions(faceData.multiFaceLandmarks[0])
      : null;

    this.callback({
      ...handData,
      eyePositions: eyePositions
    });
  }

  /**
   * Get cursor position from index finger tip (normalized 0-1)
   */
  getCursorPosition(landmarks) {
    // Use index finger tip (landmark 8)
    const indexTip = landmarks[8];
    
    // Return normalized coordinates
    return { x: indexTip.x, y: indexTip.y };
  }

  /**
   * Recognize hand gestures
   */
  recognizeGesture(landmarks) {
    // Calculate finger states
    const thumbExtended = this.isThumbExtended(landmarks);
    const indexExtended = this.isFingerExtended(landmarks, 'index');
    const middleExtended = this.isFingerExtended(landmarks, 'middle');
    const ringExtended = this.isFingerExtended(landmarks, 'ring');
    const pinkyExtended = this.isFingerExtended(landmarks, 'pinky');

    const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended].filter(Boolean).length;

    // PINCH - Thumb and index finger close together, index extended, and few other fingers extended
    if (this.isPinching(landmarks) && this.isFingerExtended(landmarks, 'index') && extendedCount <= 1) {
      return 'PINCH';
    }

    // POINTING - Only index finger extended
    if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      return 'POINTING';
    }

    // PEACE/VICTORY - Index and middle fingers extended
    if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
      return 'PEACE';
    }

    // OPEN_PALM - All fingers extended
    if (extendedCount >= 4) {
      return 'OPEN_PALM';
    }

    // CLOSED_FIST - All fingers closed
    if (extendedCount === 0 && !thumbExtended) {
      return 'CLOSED_FIST';
    }

    // THUMBS_UP - Only thumb extended upward
    if (thumbExtended && extendedCount === 0 && landmarks[4].y < landmarks[0].y) {
      return 'THUMBS_UP';
    }

    // THUMBS_DOWN - Only thumb extended downward
    if (thumbExtended && extendedCount === 0 && landmarks[4].y > landmarks[0].y) {
      return 'THUMBS_DOWN';
    }

    return 'IDLE';
  }

  /**
   * Check if pinching (thumb and index finger close)
   */
  isPinching(landmarks) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];

    const distance = Math.sqrt(
      Math.pow(thumbTip.x - indexTip.x, 2) +
      Math.pow(thumbTip.y - indexTip.y, 2) +
      Math.pow(thumbTip.z - indexTip.z, 2)
    );

    return distance < 0.03; // Reduced threshold for more precise pinch detection
  }

  /**
   * Check if thumb is extended
   */
  isThumbExtended(landmarks) {
    const thumbTip = landmarks[4];
    const thumbIP = landmarks[3];
    const thumbMCP = landmarks[2];
    const wrist = landmarks[0];

    // Calculate distance from tip to wrist vs MCP to wrist
    const tipToWrist = Math.sqrt(
      Math.pow(thumbTip.x - wrist.x, 2) +
      Math.pow(thumbTip.y - wrist.y, 2)
    );

    const mcpToWrist = Math.sqrt(
      Math.pow(thumbMCP.x - wrist.x, 2) +
      Math.pow(thumbMCP.y - wrist.y, 2)
    );

    return tipToWrist > mcpToWrist * 1.3;
  }

  /**
   * Check if a finger is extended
   */
  isFingerExtended(landmarks, fingerName) {
    const fingerIndices = {
      index: [5, 6, 7, 8],
      middle: [9, 10, 11, 12],
      ring: [13, 14, 15, 16],
      pinky: [17, 18, 19, 20]
    };

    const indices = fingerIndices[fingerName];
    if (!indices) return false;

    const mcp = landmarks[indices[0]];
    const tip = landmarks[indices[3]];
    const wrist = landmarks[0];

    // Calculate distance from tip to wrist vs MCP to wrist
    const tipToWrist = Math.sqrt(
      Math.pow(tip.x - wrist.x, 2) +
      Math.pow(tip.y - wrist.y, 2)
    );

    const mcpToWrist = Math.sqrt(
      Math.pow(mcp.x - wrist.x, 2) +
      Math.pow(mcp.y - wrist.y, 2)
    );

    return tipToWrist > mcpToWrist * 1.1;
  }

  /**
   * Calculate movement velocity
   */
  getMovementVelocity(landmarks) {
    if (!this.previousLandmarks) return 0;

    const currentTime = Date.now();
    const deltaTime = (currentTime - this.previousTime) / 1000; // Convert to seconds

    if (deltaTime === 0) return 0;

    // Use wrist position for overall hand movement
    const current = landmarks[0];
    const previous = this.previousLandmarks[0];

    const distance = Math.sqrt(
      Math.pow(current.x - previous.x, 2) +
      Math.pow(current.y - previous.y, 2) +
      Math.pow(current.z - previous.z, 2)
    );

    return distance / deltaTime;
  }

  /**
   * Get finger bend angles
   */
  getFingerBendAngles(landmarks) {
    const fingers = ['index', 'middle', 'ring', 'pinky'];
    const angles = {};

    fingers.forEach(fingerName => {
      const fingerIndices = {
        index: [5, 6, 7, 8],
        middle: [9, 10, 11, 12],
        ring: [13, 14, 15, 16],
        pinky: [17, 18, 19, 20]
      };

      const indices = fingerIndices[fingerName];
      const angle = this.calculateAngle(
        landmarks[indices[0]],
        landmarks[indices[2]],
        landmarks[indices[3]]
      );

      angles[fingerName] = angle;
    });

    return angles;
  }

  /**
   * Get eye positions from face landmarks
   */
  getEyePositions(faceLandmarks) {
    // Approximate eye centers (MediaPipe Face Mesh landmarks)
    const leftEye = faceLandmarks[159]; // Left eye center
    const rightEye = faceLandmarks[386]; // Right eye center
    
    return {
      leftEye: { x: leftEye.x, y: leftEye.y },
      rightEye: { x: rightEye.x, y: rightEye.y }
    };
  }
}
