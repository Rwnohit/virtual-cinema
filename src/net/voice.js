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

/**
 * The three m-lines, by the name both sides agree on.
 *
 * The offerer declares them in this order and the answerer adopts them, so the
 * mid is "0", "1", "2" for everybody. It is the only identifier that survives
 * the trip: a transceiver object on one side is a different object on the
 * other, and matching by object was why a shared screen went out and was never
 * seen.
 */
const VOICE_MID = '0';
const PICTURE_MID = '1';
const FILM_SOUND_MID = '2';

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
      onScreenTrack: (track, kind) => this.onScreenTrack?.(remoteId, track, kind),
    });
    this.connections.set(remoteId, conn);
    const track = this.localStream?.getAudioTracks()[0] || null;
    conn.open(track);
    // Somebody who walks in while a screen is being shared gets it straight
    // away, on the connection that was just built for them.
    if (this.screenTracks) conn.setScreen(this.screenTracks.video, this.screenTracks.audio);
    return conn;
  }

  /**
   * Send our screen to everybody in the hall, or stop.
   * @param {{video: MediaStreamTrack|null, audio: MediaStreamTrack|null}|null} tracks
   */
  setScreen(tracks) {
    this.screenTracks = tracks;
    for (const conn of this.connections.values()) {
      conn.setScreen(tracks?.video ?? null, tracks?.audio ?? null);
    }
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
  constructor({ remoteId, isOfferer, polite, signal, tuning, onSink, onScreenTrack }) {
    this.remoteId = remoteId;
    this.isOfferer = isOfferer;
    this.polite = polite;
    this.signalOut = signal;
    this.tuning = tuning;
    this.onSink = onSink;
    this.onScreenTrack = onScreenTrack;

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

    /**
     * Three m-lines, declared once, and ONLY BY THE OFFERER.
     *
     * A transceiver with no track costs nothing and saves everything: adding
     * one later means renegotiating, and renegotiating in a mesh where several
     * people may act at once is where the "wrong state" races live. So the
     * shapes are agreed at the start - a voice, a picture, and the sound that
     * goes with the picture - and after that every change is a replaceTrack(),
     * which needs no round trip at all.
     *
     * The answering side deliberately declares NOTHING. Measured: with both
     * sides calling addTransceiver, the answerer ended up with six - its own
     * three, never associated, and three more created from the offer - and
     * every incoming track arrived on one of the second set. The screen went
     * out and simply never appeared. Letting the offer define the m-lines
     * means one set, on both sides, with matching mids.
     *
     * The other half of this rule is in handleSignal(): the m-lines the offer
     * creates on the answering side arrive `recvonly`, and have to be opened
     * before the answer is written or that side can never send anything.
     */
    if (this.isOfferer) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    }
    this.voiceTrack = track ?? null;

    // Mids do not exist until the two sides have agreed on them, so whatever
    // was asked for before that is applied the moment they do.
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable') this._flush();
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signalOut({ cand: candidate.toJSON ? candidate.toJSON() : candidate });
    };

    pc.ontrack = (event) => {
      // The mid says what it is, and the mid is the one name both sides agree
      // on. Object identity does not work here: the answering side's own
      // transceivers are never the ones a track arrives on.
      const mid = event.transceiver?.mid;
      if (mid === PICTURE_MID) {
        this.onScreenTrack?.(event.track, 'video');
        return;
      }
      if (mid === FILM_SOUND_MID) {
        this.onScreenTrack?.(event.track, 'audio');
        return;
      }
      const stream = event.streams[0];
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

  /** The sender for one agreed m-line, or null before there is an agreement. */
  senderFor(mid) {
    return this.pc?.getTransceivers().find((t) => t.mid === mid)?.sender ?? null;
  }

  setTrack(track) {
    this.voiceTrack = track ?? null;
    this._flush();
  }

  /**
   * Send this peer our screen, or stop sending it. Both null takes it back.
   * @param {MediaStreamTrack|null} video
   * @param {MediaStreamTrack|null} audio
   */
  setScreen(video, audio) {
    this.screenTracks = video || audio ? { video: video ?? null, audio: audio ?? null } : null;
    this._flush();
  }

  /** Put whatever we are meant to be sending onto the agreed m-lines. */
  _flush() {
    const put = (mid, track) => {
      const sender = this.senderFor(mid);
      if (!sender) return;
      if (sender.track === track) return;
      sender.replaceTrack(track ?? null).catch((err) => console.warn('[voice] replaceTrack', err));
    };
    put(VOICE_MID, this.voiceTrack ?? null);
    put(PICTURE_MID, this.screenTracks?.video ?? null);
    put(FILM_SOUND_MID, this.screenTracks?.audio ?? null);
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
          /**
           * Open the m-lines the offer just created, both ways.
           *
           * They arrive `recvonly` - that is what the spec says a transceiver
           * created by setRemoteDescription is - and NOTHING here ever changed
           * it. `replaceTrack()` does not: on a recvonly sender it resolves,
           * reports no error, and sends nothing at all. So this side could
           * receive everything and send nothing, silently, for ever.
           *
           * That is the whole of "I shared my screen and nobody saw it". Which
           * side you were was a coin toss - the lower random id offers, and ids
           * are `randomUUID().slice(0, 8)` - so it worked about half the time
           * and looked haunted. Measured across four pairs: 8 out of 8 followed
           * the id order and none followed who joined first. With three people
           * and the middle id sharing, exactly half the hall saw it. It also
           * meant voice only ever went one way, in every pair, always.
           *
           * Done before the answer is written, so the answer says sendrecv.
           * After this every change is still just a replaceTrack().
           */
          for (const transceiver of pc.getTransceivers()) {
            if (transceiver.direction === 'recvonly') transceiver.direction = 'sendrecv';
          }
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
