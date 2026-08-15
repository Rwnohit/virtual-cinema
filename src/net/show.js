/**
 * One screening per hall.
 *
 * The hall owns the film, not the person who put it on. The server keeps
 * "what is playing, and where it was at this instant", every browser in that
 * hall is told the same thing, and anyone who walks in twenty minutes late is
 * placed twenty minutes in. That is the whole feature, and everything below is
 * the two problems it runs into.
 *
 * PROBLEM ONE: the echo. Applying what the hall said moves our own player,
 * which fires 'play' and 'timeupdate', which would report the move back to the
 * hall as if we had done it. Two people in a room and that is a loop. Hence
 * `applying`: while the hall is talking, this module is deaf to its own player.
 *
 * PROBLEM TWO: drift. Two players started at the same second do not stay
 * together - buffering, a slow frame, a phone that throttled the tab. So the
 * hall's clock is the truth and the local film is nudged onto it, never the
 * other way round: correcting by asking everybody else to wait would mean the
 * slowest machine in the room decides what everyone sees.
 *
 *   const show = createShowSync({ client, media })
 *   show.dispose()
 */

import { SHOW_DRIFT_S, SHOW_RESTATE_MS } from './protocol.js';

/** How often we compare our film against the hall's clock. */
const WATCH_MS = 1500;
/** A seek this small is not worth the stutter it costs to make. */
const SEEK_EPSILON_S = 0.35;
/**
 * How long after obeying the hall we stay deaf to our own player.
 *
 * A player told to load, seek and play does not do it at once: YouTube reports
 * ready, then playing, then a first real position, over about a second. Every
 * one of those is an event that looks exactly like the viewer having done
 * something, and reporting them back is how a room ends up arguing with itself.
 */
const SETTLE_MS = 1200;

/**
 * Where the hall's film is right now, on our clock.
 * @param {object|null} show
 * @param {number} serverNow
 */
export function livePosition(show, serverNow) {
  if (!show || !show.src) return 0;
  if (!show.playing) return Number(show.time) || 0;
  const elapsed = Math.max(0, serverNow - (Number(show.at) || serverNow)) / 1000;
  return (Number(show.time) || 0) + elapsed;
}

/**
 * @param {object} options
 * @param {import('./client.js').NetClient} options.client
 * @param {object} options.media the handle from createMedia()
 * @param {(text: string) => void} [options.onNotice] a line for the viewer
 */
export function createShowSync(options = {}) {
  const { client, media } = options;
  if (!client || !media) return { dispose() {}, get show() { return null; } };

  const notice = typeof options.onNotice === 'function' ? options.onNotice : () => {};

  /** The hall's last word. */
  let show = null;
  /**
   * Until when we are deaf to our own player. See PROBLEM ONE.
   *
   * A moment in time and not a flag, and that distinction was a bug: it used
   * to be a boolean cleared in a `finally`, which meant it stayed set for as
   * long as `media.play()` took to settle - and play() runs the whole opening
   * ceremony, curtains and lights and all. Measured: a viewer seeked to 445
   * one second after putting a film on, the seek never left the browser
   * because the gate was still shut, and the hall then dragged them back to
   * the second they had left. Whatever happens, this expires.
   */
  let applyingUntil = 0;
  /**
   * True only while a load asked for by the hall is still in flight.
   *
   * Separate from the timer, and it has to be: putting a film on a player is
   * the one thing here with no useful upper bound - it is a network away - and
   * `sourcechange` fires from inside it. Caught live and not locally: on this
   * machine the load finished inside the timer, on the real server it did not,
   * so the second viewer's own load reported "I am at second zero" and threw
   * the whole hall back to the start of the film. Unlike play(), a load does
   * settle, and a throw still clears it.
   */
  let loading = false;
  const hold = (ms = SETTLE_MS) => {
    applyingUntil = Math.max(applyingUntil, Date.now() + ms);
  };
  const applying = () => loading || Date.now() < applyingUntil;
  /** The film we last put on because the hall asked, so we do not reload it. */
  let loadedSrc = null;
  let disposed = false;
  let watcher = null;
  let lastToldAt = 0;

  const off = [];

  /* ----------------------------------------------------------------------- */
  /* the hall speaks                                                          */
  /* ----------------------------------------------------------------------- */

  async function apply(next, { reason = 'update' } = {}) {
    if (disposed || !next) return;
    // Late and duplicate messages lose. Two people pressing pause together is
    // ordinary, and the slower of the two must not be the one that wins.
    if (show && Number(next.rev) < Number(show.rev)) return;
    show = next;

    // NOT held up front. The gate exists to ignore the events our own obedience
    // causes, so it may only be shut when we are about to cause some. Held on
    // arrival it shut for over a second on the empty welcome every hall sends -
    // during which a viewer who walked in and put a film on straight away had
    // that thrown away, silently, with the room left showing nothing.
    try {
      if (!next.src) {
        // Only stop a film the HALL put on. A private one - a file off this
        // viewer's own disk, which never reached the hall and never could -
        // has nothing to do with the hall being empty, and pausing it was how
        // "I press play and it stops by itself" happened.
        if (loadedSrc && media.hasSource) {
          hold();
          media.pause();
        }
        loadedSrc = null;
        return;
      }

      const target = livePosition(next, client.serverNow);
      hold();

      if (next.src !== loadedSrc) {
        loadedSrc = next.src;
        loading = true;
        try {
          // `at` is where to come in, and the media module hands it to YouTube
          // as the player's own start point, so a late arrival never sees the
          // first frame before jumping.
          await media.load(next.src, { at: target, autoplay: next.playing });
        } finally {
          loading = false;
          hold();
        }
        // Worth saying once: you did not miss the start by accident, you walked
        // into a screening that was already running.
        if (reason === 'join' && target > 5) notice({ kind: 'joined', at: Math.round(target) });
      }

      const local = media.currentTime;
      if (Math.abs(local - target) > SEEK_EPSILON_S) media.seek(target);

      // Not awaited. play() runs the opening ceremony - the curtain, the lights
      // and the pause between them - and a viewer who reaches for the bar while
      // that is happening is a viewer, not an echo.
      if (next.playing && !media.isPlaying) Promise.resolve(media.play()).catch(() => {});
      else if (!next.playing && media.isPlaying) media.pause();
      hold();
    } catch (err) {
      console.warn('[net] could not follow the hall', err);
    }
  }

  /* ----------------------------------------------------------------------- */
  /* we speak                                                                 */
  /* ----------------------------------------------------------------------- */

  function tell(data) {
    if (applying()) return;
    tellNow(data);
  }

  /**
   * Say it whatever the gate is doing.
   *
   * For the one thing a viewer can do that must never be swallowed: dragging
   * the film. The gate is a guess about who caused an event, and a guess that
   * throws away a deliberate jump is worse than useless - measured, a viewer
   * who seeked one second after putting a film on had their jump discarded and
   * was then pulled back by the hall, twice in a row, with no way to tell why.
   * What keeps the echo out here is not timing but meaning: see onSeeked().
   */
  function tellNow(data) {
    if (disposed || !client.online) return;
    lastToldAt = Date.now();
    client.sendShow(data);
  }

  /** The viewer put something on. Only a link the others can open travels. */
  function onSourceChange(payload) {
    if (applying()) return;
    const src = payload?.src;
    if (typeof src !== 'string' || !/^https?:/i.test(src)) {
      // A file off their own disk. It plays for them and nobody else can open
      // it, so the hall is left alone rather than pointed at a dead name - and
      // the viewer is told, because silently watching alone in a room full of
      // people is the kind of thing you only notice an hour later.
      loadedSrc = null;
      notice({ kind: 'local' });
      return;
    }

    // A link everyone can open: whatever warning was up about a private film
    // is no longer true, so it comes down.
    notice({ kind: 'shared' });
    loadedSrc = src;
    // Putting on the film that is already on is not a new screening, and must
    // never restate the clock: a player still opening reports second zero, and
    // that would send everyone back to the first frame of the film they are
    // halfway through. Only a DIFFERENT film starts one.
    if (show?.src === src) return;
    tell({ src, label: payload.label ?? null, playing: true, time: media.currentTime || 0 });
  }

  /**
   * Play and pause carry NO position, on purpose.
   *
   * They are about the state, and the hall already knows where the film is -
   * it has been keeping that clock itself. Sending our own reading alongside
   * looks harmless and is not: a player that has just been given a film, or
   * has just been seeked, reports the second it is leaving rather than the one
   * it is going to, for about a second. Measured: a film seeked to 300 played
   * happily to 305 and then snapped back to 7, because 'play' had fired at
   * second one and told the hall that was where everybody was.
   *
   * The two moments that DO carry a position are the two that mean it: putting
   * a film on, and moving one.
   */
  /**
   * Told apart from our own obedience by MEANING, not by timing.
   *
   * If the hall already says the film is playing and our player has just
   * started playing, that is us catching up and there is nothing to report. If
   * the hall says playing and our player stopped, somebody pressed pause. A
   * clock cannot tell those apart and kept getting it wrong at exactly the
   * worst moment: press pause a second after walking in and it was thrown
   * away, because the gate was still shut from loading the film.
   */
  const onPlay = () => {
    if (show?.src && show.src === loadedSrc && show.playing === true) return;
    tellNow({ playing: true });
  };
  const onPause = () => {
    if (show?.src && show.src === loadedSrc && show.playing === false) return;
    tellNow({ playing: false });
  };
  /**
   * A drag of the bar, or a moment typed into it. The hall follows us.
   *
   * Told apart from our own catching-up by where it lands, not by when it
   * happened: a seek that puts us where the hall already is says nothing the
   * hall does not know, and anything else is somebody having moved the film.
   */
  const onSeeked = (payload) => {
    const time = Number(payload?.time) || media.currentTime || 0;
    if (show?.src && show.src === loadedSrc) {
      const hall = livePosition(show, client.serverNow);
      if (Math.abs(time - hall) <= SHOW_DRIFT_S) return;
    }
    tellNow({ playing: media.isPlaying, time });
  };

  off.push(
    client.on('show', (next) => apply(next)),
    client.on('welcome', (msg) => apply(msg?.show, { reason: 'join' })),
    media.on('sourcechange', onSourceChange),
    media.on('play', onPlay),
    media.on('pause', onPause),
    media.on('seeked', onSeeked),
    media.on('ended', onPause),
  );

  /* ----------------------------------------------------------------------- */
  /* keeping together                                                         */
  /* ----------------------------------------------------------------------- */

  /**
   * Catching up is rare, deliberate, and never twice in a row.
   *
   * The first version of this checked every second and a half and corrected
   * whenever it was out, which is a trap: a player that is buffering falls
   * behind, gets seeked, has to buffer the new place, falls behind again. The
   * loop is self feeding and what it looks like from a seat is a film that
   * stutters and will not settle - reported as "for some reason it freezes".
   *
   * So: two readings in a row have to agree that we are out (one can be a
   * stale poll - an embed's position is only read every half second), and a
   * correction is not allowed within COOLDOWN of the last one. That leaves
   * the film alone long enough to actually buffer, and the hall is at most a
   * few seconds ahead of somebody on a bad connection - which is the right
   * trade: a stutter is unwatchable, two seconds of lag is not.
   */
  const CORRECTION_COOLDOWN_MS = 9000;
  let strikes = 0;
  let lastCorrectionAt = 0;

  watcher = setInterval(() => {
    if (disposed || applying() || !show?.src || !client.online) return;

    const target = livePosition(show, client.serverNow);
    const local = media.currentTime;

    if (Math.abs(local - target) <= SHOW_DRIFT_S) {
      strikes = 0;
      return;
    }
    // A deliberate jump never gets here: it told the hall on its way past,
    // and the hall moved with it.
    if (Date.now() - lastToldAt < SHOW_RESTATE_MS) return;
    if (++strikes < 2) return;
    if (Date.now() - lastCorrectionAt < CORRECTION_COOLDOWN_MS) return;

    strikes = 0;
    lastCorrectionAt = Date.now();
    hold();
    media.seek(target);
  }, WATCH_MS);

  return {
    /** The hall's last word, for the panel and for QA. */
    get show() {
      return show;
    },
    /** Where the hall's film is right now, in seconds. */
    get position() {
      return livePosition(show, client.serverNow);
    },
    /** Say where we are, on purpose: used when the viewer drags the bar. */
    report() {
      tell({ playing: media.isPlaying, time: media.currentTime || 0 });
    },
    dispose() {
      disposed = true;
      clearInterval(watcher);
      off.forEach((fn) => typeof fn === 'function' && fn());
    },
  };
}

export default createShowSync;
