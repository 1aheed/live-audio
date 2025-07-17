/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() isCameraOn = false;
  @state() status = '';
  @state() error = '';
  @state() private callDuration = 0;
  private callTimerInterval: number | null = null;

  private client: GoogleGenAI;
  private session: Session;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  private videoStream: MediaStream | null = null;
  private videoPreviewElement: HTMLVideoElement;
  private videoFrameSender: number | null = null;

  // Call recording functionality
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private aiAudioChunks: Blob[] = [];
  private callStartTime: Date | null = null;
  private enableCallRecording: boolean = false;

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
    }

    #camera-preview {
      position: absolute;
      top: 20px;
      right: 20px;
      width: 160px;
      height: 120px;
      border-radius: 8px;
      border: 2px solid rgba(255, 255, 255, 0.2);
      background-color: #000;
      object-fit: cover;
      transform: scaleX(-1); /* Mirror effect */
      display: none;
      z-index: 20;
    }

    #camera-preview.active {
      display: block;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: row;
      gap: 10px;

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button[disabled] {
        display: none;
      }
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopRecording();
    this.stopCamera();
    this.session?.close();
    this.inputAudioContext?.close();
    this.outputAudioContext?.close();
  }

  protected firstUpdated() {
    this.videoPreviewElement =
      this.shadowRoot!.querySelector('#camera-preview')!;
  }


  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-live-preview';
    
    // Validate environment variables
    const systemInstruction = process.env.SYSTEM_INSTRUCTION;
    const voiceName = process.env.VOICE_NAME || 'Orus';
    const enableGoogleSearch = process.env.ENABLE_GOOGLE_SEARCH === 'true';
    this.enableCallRecording = process.env.ENABLE_CALL_RECORDING === 'true';
    
    if (!systemInstruction) {
      console.error('SYSTEM_INSTRUCTION environment variable is not set');
      this.updateError('System instruction not configured');
      return;
    }

    // Configure tools based on environment settings
    const tools = enableGoogleSearch ? [{ googleSearch: {} }] : undefined;

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
    
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              // Capture AI audio for call recording
              if (this.enableCallRecording && audio.data) {
                console.log('Capturing AI audio chunk, size:', audio.data.length);
                this.captureAIAudio(audio.data);
              }

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateError('' + e.reason);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: voiceName}},
            languageCode: 'ur-PK'
          },
          systemInstruction: {
            parts: [{
              text: systemInstruction,
            }]
          },
          ...(tools && { tools }),
        },
      });
    } catch (e) {
      console.error(e);
      this.updateError((e as Error).message);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async toggleCamera() {
    if (this.isCameraOn) {
      this.stopCamera();
    } else {
      await this.startCamera();
    }
  }

  private async startCamera() {

    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });
      this.videoPreviewElement.srcObject = this.videoStream;
      await this.videoPreviewElement.play();
      this.isCameraOn = true;

      this.videoFrameSender = window.setInterval(() => {
        this.sendVideoFrame();
      }, 1000); // Send a frame every second
    } catch (err) {
      console.error('Error starting camera:', err);
      this.updateError(`Camera error: ${(err as Error).message}`);
      this.stopCamera();
    }
  }

  private stopCamera() {

    if (this.videoFrameSender) {
      clearInterval(this.videoFrameSender);
      this.videoFrameSender = null;
    }
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((track) => track.stop());
      this.videoStream = null;
    }
    if (this.videoPreviewElement) {
      this.videoPreviewElement.srcObject = null;
    }
    this.isCameraOn = false;
  }

  private sendVideoFrame() {
    if (
      !this.isCameraOn ||
      !this.session ||
      this.videoPreviewElement.paused ||
      this.videoPreviewElement.ended ||
      !this.videoStream ||
      this.videoPreviewElement.videoWidth === 0
    ) {
      return;
    }

    const canvas = document.createElement('canvas');
    const targetWidth = 320; // Send a smaller frame for performance
    const scale = targetWidth / this.videoPreviewElement.videoWidth;
    canvas.width = targetWidth;
    canvas.height = this.videoPreviewElement.videoHeight * scale;

    const context = canvas.getContext('2d');
    context!.drawImage(
      this.videoPreviewElement,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) return;

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = (reader.result as string).split(',')[1];
          if (this.session && this.isCameraOn) {
            try {
              this.session.sendRealtimeInput({
                media: {
                  data: base64data,
                  mimeType: 'image/jpeg',
                },
              });
            } catch (e) {
              console.error('Failed to send video frame:', e);
              this.updateError('Failed to send video frame.');
              this.stopCamera();
            }
          }
        };
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      0.8,
    );
  }

  private formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    const paddedMinutes = String(minutes).padStart(2, '0');
    const paddedSeconds = String(remainingSeconds).padStart(2, '0');
    return `${paddedMinutes}:${paddedSeconds}`;
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      // Start call recording if enabled
      if (this.enableCallRecording) {
        this.startCallRecording();
      }

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
    this.callDuration = 0;
    this.status = this.formatDuration(this.callDuration);
    this.callTimerInterval = window.setInterval(() => {
      this.callDuration++;
      this.status = this.formatDuration(this.callDuration);
    }, 1000);

    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${(err as Error).message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }
    this.status = '';
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;

    // Stop call recording if enabled
    if (this.enableCallRecording) {
      this.stopCallRecording();
    }

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Call Ended. Click Start to begin again.');
  }

  private startCallRecording() {
    if (!this.mediaStream) return;

    try {
      this.callStartTime = new Date();
      this.recordedChunks = [];
      this.aiAudioChunks = [];

      // Create MediaRecorder for user audio
      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(1000); // Collect data every second
      console.log('Call recording started');
    } catch (error) {
      console.error('Error starting call recording:', error);
    }
  }

  private stopCallRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      
      // Wait a bit for final data and then save
      setTimeout(() => {
        this.saveCallRecording();
      }, 1000);
    }
  }

  private captureAIAudio(base64Data: string) {
    try {
      console.log('Capturing AI audio chunk:', base64Data.substring(0, 50) + '... (length:', base64Data.length, ')');
      
      // Store the raw base64 data exactly as received from API
      // This preserves the original quality and format
      const blob = new Blob([base64Data], { type: 'audio/raw-base64' });
      this.aiAudioChunks.push(blob);
      
      console.log('AI audio chunks collected:', this.aiAudioChunks.length);
    } catch (error) {
      console.error('Error capturing AI audio:', error, error.stack);
    }
  }

  private pcmToWav(pcmData: Uint8Array, sampleRate: number, numChannels: number, bitsPerSample: number): ArrayBuffer {
    const length = pcmData.length;
    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length, true); // file size - 8
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM format chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true); // byte rate
    view.setUint16(32, numChannels * bitsPerSample / 8, true); // block align
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, length, true);
    
    // Copy PCM data
    const uint8Array = new Uint8Array(buffer, 44);
    uint8Array.set(pcmData);
    
    return buffer;
  }

  private async saveCallRecording() {
    if (!this.callStartTime) return;

    const timestamp = this.callStartTime.toISOString().replace(/[:.]/g, '-').split('T');
    const dateStr = timestamp[0];
    const timeStr = timestamp[1].split('.')[0];
    const filename = `call-${dateStr}_${timeStr}`;

    try {
      let savedFiles = 0;
      const totalFiles = (this.recordedChunks.length > 0 ? 1 : 0) + 
                         (this.aiAudioChunks.length > 0 ? 1 : 0) + 1; // +1 for log

      // Save user audio
      if (this.recordedChunks.length > 0) {
        const userBlob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        await this.saveBlobToServer(userBlob, `${filename}_user.webm`, 'User Audio');
        savedFiles++;
      }

      // Save AI audio as raw data from API
      if (this.aiAudioChunks.length > 0) {
        // Combine all base64 chunks and convert to binary
        const allBase64Data = this.aiAudioChunks.map(chunk => {
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsText(chunk);
          });
        });
        
        const base64Chunks = await Promise.all(allBase64Data);
        const combinedBase64 = base64Chunks.join('');
        
        // Convert to binary and save as original audio format
        const binaryString = atob(combinedBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Save as raw audio data (the format from Gemini API)
        const aiBlob = new Blob([bytes], { type: 'audio/pcm' });
        await this.saveBlobToServer(aiBlob, `${filename}_ai_raw.pcm`, 'AI Audio (Raw)');
        
        // Also save as base64 text file for reference
        const base64Blob = new Blob([combinedBase64], { type: 'text/plain' });
        await this.saveBlobToServer(base64Blob, `${filename}_ai_base64.txt`, 'AI Audio (Base64)');
        
        savedFiles += 2; // We're saving 2 files for AI audio
      }

      // Create comprehensive call log
      const callLog = {
        callInfo: {
          startTime: this.callStartTime.toISOString(),
          endTime: new Date().toISOString(),
          duration: Math.round((Date.now() - this.callStartTime.getTime()) / 1000),
          totalFiles: savedFiles
        },
        files: {
          userAudio: this.recordedChunks.length > 0 ? `${filename}_user.webm` : null,
          aiAudio: this.aiAudioChunks.length > 0 ? `${filename}_ai.wav` : null
        },
        statistics: {
          userChunks: this.recordedChunks.length,
          aiChunks: this.aiAudioChunks.length,
          userAudioSize: this.recordedChunks.reduce((total, chunk) => total + chunk.size, 0),
          aiAudioSize: this.aiAudioChunks.reduce((total, chunk) => total + chunk.size, 0)
        },
        settings: {
          voiceName: process.env.VOICE_NAME || 'Unknown',
          googleSearchEnabled: process.env.ENABLE_GOOGLE_SEARCH === 'true',
          callRecordingEnabled: process.env.ENABLE_CALL_RECORDING === 'true'
        }
      };

      const logBlob = new Blob([JSON.stringify(callLog, null, 2)], { type: 'application/json' });
      await this.saveBlobToServer(logBlob, `${filename}_call-info.json`, 'Call Information');
      savedFiles++;

      console.log(`Call recording complete: ${savedFiles} files saved`);
      this.updateStatus(`Call saved: ${savedFiles} files downloaded to your Downloads folder`);
      
      // Show a summary in console
      console.log('📞 Call Summary:');
      console.log(`   Duration: ${callLog.callInfo.duration} seconds`);
      console.log(`   User audio chunks: ${callLog.statistics.userChunks}`);
      console.log(`   AI audio chunks: ${callLog.statistics.aiChunks}`);
      console.log(`   Files saved: ${savedFiles}`);
      
    } catch (error) {
      console.error('Error saving call recording:', error);
      this.updateError('Failed to save call recording');
    }
  }

  private downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private async saveBlobToServer(blob: Blob, filename: string, type: string) {
    try {
      console.log(`Saving ${type}: ${filename}`);
      
      // Simple download approach - saves to Downloads folder
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log(`${type} downloaded: ${filename}`);
      return true;
    } catch (error) {
      console.error(`Error saving ${type}:`, error);
      return false;
    }
  }

  private saveBlobLocally(blob: Blob, filename: string) {
    // For development/admin access - save to browser storage or local file system
    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result as string;
      // Store in localStorage for admin access (temporary solution)
      const recordings = JSON.parse(localStorage.getItem('adminRecordings') || '[]');
      recordings.push({
        filename,
        data: base64Data,
        timestamp: new Date().toISOString(),
        type: 'ai-audio'
      });
      localStorage.setItem('adminRecordings', JSON.stringify(recordings));
      console.log(`AI audio stored locally for admin access: ${filename}`);
    };
    reader.readAsDataURL(blob);
  }

  private reset() {
    this.session?.close();
    this.stopCamera();
    this.initSession();

    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }
  }

  render() {
    return html`
      <div>
        <video
          id="camera-preview"
          class=${this.isCameraOn ? 'active' : ''}
          muted
          playsinline></video>
        <div class="controls">
          <button
            id="cameraButton"
            @click=${this.toggleCamera}
            title=${this.isCameraOn ? 'Turn off camera' : 'Turn on camera'}>
            ${this.isCameraOn
              ? html`<svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="40px"
                  viewBox="0 0 24 24"
                  width="40px"
                  fill="#ffffff">
                  <path d="M0 0h24v24H0V0z" fill="none" />
                  <path
                    d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                </svg>`
              : html`<svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="40px"
                  viewBox="0 0 24 24"
                  width="40px"
                  fill="#ffffff">
                  <path d="M0 0h24v24H0V0z" fill="none" />
                  <path
                    d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.55-.18L19.73 21 21 19.73 3.27 2z" />
                </svg>`}
          </button>
          <button
            id="resetButton"
            @click=${this.reset}
            ?disabled=${this.isRecording}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 -960 960 960"
              width="40px"
              fill="#ffffff">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
          </button>
          <button
            id="startButton"
            @click=${this.startRecording}
            ?disabled=${this.isRecording}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 0 24 24"
              width="40px"
              fill="#00FF00">
              <path d="M0 0h24v24H0V0z" fill="none" />
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
            </svg>
          </button>
          <button
            id="stopButton"
            @click=${this.stopRecording}
            ?disabled=${!this.isRecording}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 0 24 24"
              width="40px"
              fill="#FF0000">
              <path d="M0 0h24v24H0V0z" fill="none" />
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.18-.29-.43-.29-.71 0-.28.11-.53.29-.71C2.34 9.61 6.91 8 12 8s9.66 1.61 11.71 3.66c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
            </svg>
          </button>
        </div>


        <div id="status"> ${this.error || this.status} </div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
