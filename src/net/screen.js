/**
 * One person's screen, on everybody's screen.
 *
 * The other way to watch a film together, and the honest one. Everything else
 * in this app is SYNCHRONISATION: every browser runs its own player and they
 * are nudged towards agreeing. That works, but it can only ever be as good as
 * the slowest player in the room, and a player that stutters drags the whole
 * hall with it.
 *
 * This is not synchronisation. One person's picture is encoded once and sent
 * to everybody, so there is nothing to agree about: what you see IS what they
 * see, frame for frame, because it is the same frames. No clock, no drift, no
 * catching up, and no arguing about who pressed pause.
 *
 * It also quietly solves the thing that could not be solved: a film off
 * somebody's own disk, a player nobody else can open, anything at all - if it
 * is on their screen, it is on the room's screen.
 *
 * WHAT IT COSTS, because it is not free:
 *
 *   The sharer's upload. Every viewer is a separate copy going out of one
 *   connection - this is a mesh, not a broadcast tower - so a household
 *   upload realistically carries a handful of people, not a full hall. The
 *   picture is capped rather than left to fight for room.
 *
 *   Protected films (Netflix, Disney+ and the like) come out black. That is
 *   the point of the protection and there is nothing to be done about it.
 *
 *   const share = createScreenShare({ voice, media, onChange })
 *   await share.start()
 */

/**
 * Asked for, not demanded: a browser gives what it can. 1080p30 is plenty for
 * a screen in a room, and asking for more only takes bitrate away from the
 * frames that matter.
 */
const WANTED = {
  video: { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
  audio: {
    // The sharer has to keep hearing their own film, so their playback is left
    // alone. And none of the processing meant for a voice call belongs on a
    // film soundtrack: it would duck the music every time somebody spoke.
    suppressLocalAudioPlayback: false,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};

/** A ceiling, so one viewer on a bad line cannot starve the rest. */
const MAX_BITRATE = 2_500_000;

class ScreenShareRefused extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'ScreenShareRefused';
    this.reason = reason;
  }
}

/**
 * @param {object} options
 * @param {import('./voice.js').VoiceMesh} options.voice
 * @param {object} options.media the handle from createMedia()
 * @param {(state: {sharing: boolean, watching: string|null}) => void} [options.onChange]
 */
export function createScreenShare(options = {}) {
  const { voice, media, client = null } = options;
  const changed = () => options.onChange?.({ sharing: !!local, watching });

  /** What we are sending, when we are the one sharing. */
  let local = null;
  /** Whose screen we are watching, when somebody else is sharing. */
  let watching = null;
  /** Built from the tracks as they arrive - picture and sound come separately. */
  let incoming = null;

  const supported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  /* ----------------------------------------------------------------------- */
  /* sending                                                                  */
  /* ----------------------------------------------------------------------- */

  async function start() {
    if (local) return true;
    if (!supported()) throw new ScreenShareRefused('unsupported', 'this browser cannot share a screen');

    const stream = await navigator.mediaDevices.getDisplayMedia(WANTED);
    const video = stream.getVideoTracks()[0] || null;
    const audio = stream.getAudioTracks()[0] || null;
    if (!video) {
      for (const track of stream.getTracks()) track.stop();
      throw new ScreenShareRefused('no-video', 'the share came back without a picture');
    }

    local = { stream, video, audio };
    voice.setScreen({ video, audio });
    capBitrate();

    // Ended from the browser's own "stop sharing" bar, which is the way most
    // people will stop. The room has to notice on its own.
    video.addEventListener('ended', () => stop(), { once: true });

    // The sharer keeps watching their own thing in their own tab; the room's
    // screen shows them what everybody else is getting, so they can see it is
    // actually going out.
    await media.showStream(new MediaStream([video]));
    // Said out loud on the hall's own channel, not left to be inferred. See
    // announce() for why the peer connection cannot be trusted to say it.
    announce(client?.id || 'on');
    changed();
    return true;
  }

  /**
   * Tell the hall who is sharing, or that nobody is.
   *
   * The obvious place to learn a share has stopped is the peer connection, and
   * it is not reliable: stopping is replaceTrack(null), which leaves the track
   * open on the receiving end rather than ending it, and the 'mute' that does
   * fire is not guaranteed to be prompt. Measured, the last frame simply stayed
   * frozen on everybody's screen. The websocket already carries the state of
   * the room and it is never ambiguous, so it carries this too.
   */
  function announce(who) {
    client?.sendStage?.({ live: who });
  }

  /**
   * Hold the picture to something a household connection can post.
   *
   * Left alone, a peer connection will happily try to send a 1080p screen at
   * whatever it thinks the link can take, per viewer, and the first thing to
   * give way is the frame rate for everyone.
   */
  function capBitrate() {
    for (const conn of voice.connections?.values?.() ?? []) {
      const sender = conn.senderFor?.('1');
      if (!sender?.getParameters) continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = MAX_BITRATE;
        sender.setParameters(params).catch(() => {});
      } catch {
        /* an older browser will simply send what it wants to */
      }
    }
  }

  function stop() {
    if (!local) return false;
    voice.setScreen(null);
    for (const track of local.stream.getTracks()) track.stop();
    local = null;
    media.showStream(null);
    announce('');
    changed();
    return true;
  }

  /** The hall says nobody is sharing any more: take it off our screen too. */
  const offStage = client?.on?.('stage', (stage) => {
    if (!stage || local) return;
    if (stage.live) return;
    if (!watching) return;
    watching = null;
    incoming = null;
    media.showStream(null);
    changed();
  });

  /* ----------------------------------------------------------------------- */
  /* receiving                                                                */
  /* ----------------------------------------------------------------------- */

  /**
   * Picture and sound arrive as two separate tracks, in no fixed order, so the
   * stream is assembled as they turn up and the screen is told each time.
   *
   * @param {string} from peer id
   * @param {MediaStreamTrack} track
   * @param {'video'|'audio'} kind
   */
  function onTrack(from, track, kind) {
    if (local) return; // we are the one sharing; our own screen stays ours

    /**
     * An m-line that exists is not a screen being shared.
     *
     * `ontrack` fires for EVERY negotiated m-line, the moment it is agreed,
     * whether or not anything is being sent down it - and ours are agreed at
     * the start and left empty on purpose. The track that arrives is muted.
     *
     * Taking that as "somebody is sharing" was a real bug and a bad one: the
     * second person in any hall had their cinema screen handed to a live
     * stream carrying nothing, so an ordinary film would not play for them at
     * all. It hid behind YouTube, which draws in its own frame and never
     * touches this element.
     *
     * So the rule is the honest one: a track counts when it carries something.
     */
    const show = () => {
      if (track.muted) return;
      if (!incoming || watching !== from) {
        incoming = new MediaStream();
        watching = from;
      }
      if (!incoming.getTracks().includes(track)) incoming.addTrack(track);
      if (kind === 'video') media.showStream(incoming);
      changed();
    };

    /**
     * "Muted", not "ended".
     *
     * Somebody stopping a share does it with replaceTrack(null), and that does
     * NOT end the track on the receiving side - the m-line stays open for the
     * next time, and the track simply goes quiet. Waiting for 'ended' left the
     * last frame frozen on the room's screen for good. 'mute' is the event
     * that actually fires, and it comes back as 'unmute' if they start again.
     */
    const gone = () => {
      if (kind !== 'video' || watching !== from) return;
      watching = null;
      incoming = null;
      media.showStream(null);
      changed();
    };
    track.addEventListener('mute', gone);
    track.addEventListener('ended', gone);
    // The moment it starts carrying something is the moment it counts.
    track.addEventListener('unmute', show);
    show();
  }

  return {
    supported,
    start,
    stop,
    onTrack,
    get sharing() {
      return !!local;
    },
    get watching() {
      return watching;
    },
    dispose() {
      stop();
      offStage?.();
    },
  };
}

export { ScreenShareRefused };
export default createScreenShare;
