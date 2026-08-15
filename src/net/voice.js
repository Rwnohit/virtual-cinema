/**
 * Peer to peer voice chat over WebRTC, positioned in 3D.
 *
 * Topology is a full mesh: with a couple of dozen people in a cinema that is
 * simpler and lower latency than an SFU. The server only forwards SDP and ICE.
 *
 * Two details that matter:
 *  - we open the connection as soon as we see a peer, even before the mic is
 *    granted, using a sendrecv transceiver with an empty sender. Turning the
 *    mic on later is then just replaceTrack(), with no renegotiation.
 *  - who offers is decided by comparing peer ids, and perfect negotiation is
 *    kept as a safety net for the rare simultaneous offer.
 */

import { ICE_SERVERS } from './config.js';
import { createVoiceSink, createMicMeter, getAudioContext } from './audio.js';

export class VoiceMesh {
  constructor({ client, peers, tuning = {}, onChange = null } = {}) {
    this.client = client;
    this.peers = peers;
    this.tuning = tuning;
    this.onChange = onChange;

    /** @type {Map<string, Connection>} */
    this.connections = new Map();
    this.localStream = null;
    this.micMeter = null;
    this.micEnabled = false;
    this.muted = false;
    this.speaking = false;
    this.error = null;

    this._unsubscribe = [
      client.on('welcome', (msg) => {
        for (const peer of msg.peers || []) this._maybeConnect(peer.id);
      }),
      client.on('peer:join', (peer) => this._maybeConnect(peer.id)),
      client.on('peer:leave', (id) => this.drop(id)),
      client.on('signal', (msg) => this._onSignal(msg)),
      client.on('reset', () => this.dropAll()),
    ];
  }

  /* ------------------------------------------------------------------ mic */

  /** Must be called from a user gesture, browsers require it. */
  async enableMic() {
    if (this.micEnabled) return this.localStream;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (err) {
      this.error = err?.name === 'NotAllowedError' ? 'mic-denied' : 'mic-failed';
      this._changed();
      throw err;
    }

    getAudioContext()?.resume?.().catch(() => {});
    this.micEnabled = true;
    this.error = null;
    this.micMeter = createMicMeter(this.localStream);

    const track = this.localStream.getAudioTracks()[0];
    track.enabled = !this.muted;
    for (const conn of this.connections.values()) conn.setTrack(track);

    this._changed();
    return this.localStream;
  }

  disableMic() {
    if (!this.micEnabled) return;
    for (const conn of this.connections.values()) conn.setTrack(null);
    this.micMeter?.dispose();
    this.micMeter = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.micEnabled = false;
    this.speaking = false;
    this._changed();
  }

  setMuted(muted) {
    this.muted = !!muted;
    const track = this.localStream?.getAudioTracks()[0];
    if (track) track.enabled = !this.muted;
    if (this.muted) this.speaking = false;
    this._changed();
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /* ---------------------------------------------------------- connections */

  _maybeConnect(remoteId) {
    if (!remoteId || remoteId === this.client.id) return;
    // Lower id offers, higher id waits. No glare in the common case.
    if (this.client.id && this.client.id < remoteId) this._ensure(remoteId, true);
  }

  _ensure(remoteId, isOfferer) {
    let conn = this.connections.get(remoteId);
    if (conn) return conn;
    conn = new Connection({
      remoteId,
      isOfferer,
      polite: !!this.client.id && this.client.id > remoteId,
      signal: (data) => this.client.signal(remoteId, data),
      tuning: this.tuning,
      onSink: () => this._changed(),
    });
    this.connections.set(remoteId, conn);
    const track = this.localStream?.getAudioTracks()[0] || null;
    conn.open(track);
    return conn;
  }

  async _onSignal(msg) {
    const from = msg?.from;
    if (!from) return;
    const conn = this._ensure(from, false);
    await conn.handleSignal(msg.data);
  }

  drop(remoteId) {
    const conn = this.connections.get(remoteId);
    if (!conn) return;
    conn.close();
    this.connections.delete(remoteId);
    this._changed();
  }

  dropAll() {
    for (const id of [...this.connections.keys()]) this.drop(id);
  }

  /* --------------------------------------------------------------- frame */

  /**
   * Push interpolated peer poses into the panners and refresh our own
   * speaking flag. Call once per rendered frame.
   */
  update() {
    for (const [id, conn] of this.connections) {
      const peer = this.peers.get(id);
      if (peer) conn.sink?.setPose(peer.position, peer.quaternion);
    }

    if (this.micMeter && !this.muted) {
      const { speaking } = this.micMeter.poll();
      if (speaking !== this.speaking) {
        this.speaking = speaking;
        this._changed();
      }
    }
    return this.speaking;
  }

  stats() {
    let connected = 0;
    for (const conn of this.connections.values()) {
      if (conn.pc?.connectionState === 'connected') connected += 1;
    }
    return { connected, total: this.connections.size, micEnabled: this.micEnabled, muted: this.muted };
  }

  _changed() {
    this.onChange?.(this);
  }

  dispose() {
    this._unsubscribe.forEach((off) => off());
    this.dropAll();
    this.disableMic();
  }
}

/* ------------------------------------------------------- one peer, one pc */

class Connection {
  constructor({ remoteId, isOfferer, polite, signal, tuning, onSink }) {
    this.remoteId = remoteId;
    this.isOfferer = isOfferer;
    this.polite = polite;
    this.signalOut = signal;
    this.tuning = tuning;
    this.onSink = onSink;

    this.pc = null;
    this.sender = null;
    this.sink = null;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.pendingCandidates = [];
  }

  open(track) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });
    this.pc = pc;

    // One audio m-line from the start: the mic can arrive later without a
    // second round of negotiation.
    const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.sender = transceiver.sender;
    if (track) this.sender.replaceTrack(track).catch(() => {});

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signalOut({ cand: candidate.toJSON ? candidate.toJSON() : candidate });
    };

    pc.ontrack = ({ streams }) => {
      const stream = streams[0];
      if (!stream) return;
      this.sink?.dispose();
      this.sink = createVoiceSink(stream, this.tuning);
      this.onSink?.();
    };

    pc.onnegotiationneeded = async () => {
      // Only the designated offerer ever starts a negotiation. The other side
      // answers, and replaceTrack() never needs a new round anyway, so this
      // removes the whole class of "wrong state" races.
      if (!this.isOfferer || pc.signalingState !== 'stable') return;
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.signalOut({ desc: pc.localDescription });
      } catch (err) {
        console.warn('[voice] offer failed', err);
      } finally {
        this.makingOffer = false;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce?.();
    };

    return pc;
  }

  setTrack(track) {
    if (!this.sender) return;
    this.sender.replaceTrack(track).catch((err) => console.warn('[voice] replaceTrack', err));
  }

  async handleSignal(data) {
    const pc = this.pc;
    if (!pc || !data) return;

    try {
      if (data.desc) {
        const collision = data.desc.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;

        await pc.setRemoteDescription(data.desc);
        await this._flushCandidates();

        if (data.desc.type === 'offer') {
          await pc.setLocalDescription();
          this.signalOut({ desc: pc.localDescription });
        }
      } else if (data.cand) {
        if (!pc.remoteDescription) {
          this.pendingCandidates.push(data.cand);
        } else {
          await pc.addIceCandidate(data.cand).catch((err) => {
            if (!this.ignoreOffer) console.warn('[voice] ice', err);
          });
        }
      }
    } catch (err) {
      console.warn('[voice] signal handling failed', err);
    }
  }

  async _flushCandidates() {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const cand of queued) {
      await this.pc.addIceCandidate(cand).catch(() => {});
    }
  }

  close() {
    this.sink?.dispose();
    this.sink = null;
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onnegotiationneeded = null;
      this.pc.close();
      this.pc = null;
    }
  }
}
